import 'server-only';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import { AgentError, StreamCollector, withoutThinking, type ChatModel, type ErrorCode, type ExtractResponse, type LlmResult, type SearchClient, type SearchResponse } from './providers';
import type { LlmProviderId } from './settings';

/**
 * Talks to the `agent-gateway` Supabase Edge Function. The address comes from the existing Supabase
 * project address — no extra setting. Every call carries the person's own sign-in; the gateway checks it.
 */
export const GATEWAY_URL = `${SUPABASE_URL}/functions/v1/agent-gateway`;

type Json = Record<string, unknown>;

export async function gatewayCall(token: string, body: Json, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: 'POST', cache: 'no-store', signal,
      headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal?.aborted) throw new AgentError('Stopped.', 'error', false, 499);
    throw new AgentError('Couldn’t reach the agent gateway.', 'network', true);
  }
  if (res.status === 404 && !(res.headers.get('content-type') ?? '').includes('json')) {
    throw new AgentError('The agent gateway isn’t installed yet. Deploy the agent-gateway Edge Function (see the agent setup guide).', 'not_installed', false, 503);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string; code?: string; retryable?: boolean };
    const code = (j.code as ErrorCode) || (res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'upstream' : 'error');
    if (res.status === 404 && /not.?found|function/i.test(j.message ?? j.error ?? '') && !j.code) throw new AgentError('The agent gateway isn’t installed yet. Deploy the agent-gateway Edge Function (see the agent setup guide).', 'not_installed', false, 503);
    throw new AgentError(j.error ?? j.message ?? `The gateway answered ${res.status}.`, code, !!j.retryable || res.status === 429 || res.status >= 502, res.status);
  }
  return res;
}

export async function gatewayJson<T>(token: string, body: Json, signal?: AbortSignal): Promise<T> {
  return (await (await gatewayCall(token, body, signal)).json()) as T;
}

/** A chat model reached through the gateway. */
export class GatewayModel implements ChatModel {
  constructor(private token: string, public provider: LlmProviderId, public model: string, private defaults: { temperature: number; max_tokens: number }) {}

  async chat(req: Parameters<ChatModel['chat']>[0], opts: Parameters<ChatModel['chat']>[1]): Promise<LlmResult> {
    const request = { temperature: this.defaults.temperature, max_tokens: this.defaults.max_tokens, ...req, model: this.model };
    const stream = opts.kind !== 'summary';
    const res = await gatewayCall(this.token, { action: 'chat', provider: this.provider, run_id: opts.runId, kind: opts.kind ?? 'chat', stream, request }, opts.signal);
    if (!stream) {
      const j = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: LlmResult['toolCalls'] }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
      const ch = j.choices?.[0];
      return {
        content: withoutThinking(ch?.message?.content ?? ''), toolCalls: ch?.message?.tool_calls ?? [], finish: ch?.finish_reason ?? '',
        usage: j.usage ? { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 } : null, provider: this.provider, model: j.model ?? this.model,
      };
    }
    const col = new StreamCollector(opts.onText);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        col.push(dec.decode(value, { stream: true }));
      }
    } catch (e) {
      if (opts.signal?.aborted) throw new AgentError('Stopped.', 'error', false, 499);
      if (e instanceof AgentError) throw e;
      throw new AgentError('The connection to the model dropped.', 'network', true);
    }
    const { content, toolCalls } = col.end();
    return { content, toolCalls, finish: col.finish, usage: col.usage, provider: this.provider, model: col.model ?? this.model };
  }
}

/** Tavily through the gateway. */
export class GatewaySearch implements SearchClient {
  constructor(private token: string) {}

  async search(request: Parameters<SearchClient['search']>[0], runId: string, signal?: AbortSignal): Promise<SearchResponse> {
    const j = await gatewayJson<{ results?: Json[]; images?: unknown[]; fahress?: { credits?: number; credits_estimated?: boolean } }>(this.token, { action: 'search', run_id: runId, request }, signal);
    return {
      results: (j.results ?? []).map((r) => ({
        title: String(r.title ?? '').slice(0, 300), url: String(r.url ?? ''), content: String(r.content ?? '').slice(0, 1200),
        score: typeof r.score === 'number' ? r.score : null, published: typeof r.published_date === 'string' ? r.published_date : null,
      })).filter((r) => /^https?:\/\//.test(r.url)),
      images: (j.images ?? []).map((i) => (typeof i === 'string' ? { url: i, description: null } : { url: String((i as Json).url ?? ''), description: typeof (i as Json).description === 'string' ? String((i as Json).description) : null })).filter((i) => /^https?:\/\//.test(i.url)).slice(0, 20),
      credits: j.fahress?.credits ?? 0, estimated: !!j.fahress?.credits_estimated,
    };
  }

  async extract(urls: string[], depth: 'basic' | 'advanced', runId: string, signal?: AbortSignal): Promise<ExtractResponse> {
    const j = await gatewayJson<{ results?: Json[]; failed_results?: Json[] }>(this.token, { action: 'extract', run_id: runId, request: { urls, depth } }, signal);
    return {
      results: (j.results ?? []).map((r) => ({ url: String(r.url ?? ''), text: String(r.raw_content ?? '').slice(0, 200000), images: Array.isArray(r.images) ? (r.images as unknown[]).map(String).slice(0, 40) : [] })),
      failed: (j.failed_results ?? []).map((r) => ({ url: String(r.url ?? ''), error: String(r.error ?? '') })),
    };
  }
}
