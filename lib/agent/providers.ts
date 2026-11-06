/**
 * Model and search clients behind one interface, so the agent loop doesn't care which provider answers.
 * The real clients talk to the `agent-gateway` Edge Function (which holds the keys); tests use fakes.
 */
import type { ChatMessage, ChatRequest, ToolCall, ToolDef } from '@/supabase/functions/agent-gateway/lib';
import type { LlmProviderId } from './settings';

export type { ChatMessage, ChatRequest, ToolCall, ToolDef };
export type LlmUsage = { input: number; output: number };
export type LlmResult = { content: string; toolCalls: ToolCall[]; finish: string; usage: LlmUsage | null; provider: LlmProviderId; model: string };
export type ErrorCode = 'rate_limited' | 'upstream' | 'network' | 'auth' | 'bad_request' | 'limit' | 'denied' | 'no_key' | 'timeout' | 'not_found' | 'billing' | 'not_installed' | 'error';

export class AgentError extends Error {
  constructor(message: string, public code: ErrorCode = 'error', public retryable = false, public status = 502) { super(message); }
}

export interface ChatModel {
  provider: LlmProviderId;
  model: string;
  chat(req: Omit<ChatRequest, 'model'>, opts: { signal?: AbortSignal; onText?: (delta: string) => void; kind?: 'chat' | 'summary' | 'vision'; runId: string }): Promise<LlmResult>;
}

export type SearchHit = { title: string; url: string; content: string; score: number | null; published: string | null };
export type SearchResponse = { results: SearchHit[]; images: { url: string; description: string | null }[]; credits: number; estimated: boolean };
export type ExtractResponse = { results: { url: string; text: string; images: string[] }[]; failed: { url: string; error: string }[] };

export interface SearchClient {
  search(req: { query: string; depth: 'basic' | 'advanced'; max_results: number; include_domains?: string[]; exclude_domains?: string[]; include_images?: boolean; topic?: 'general' | 'news' }, runId: string, signal?: AbortSignal): Promise<SearchResponse>;
  extract(urls: string[], depth: 'basic' | 'advanced', runId: string, signal?: AbortSignal): Promise<ExtractResponse>;
}

/* ---------- streaming helpers ---------- */

/** Hides a model's private reasoning (<think>…</think>) from the reply, even when the tags arrive split across chunks. */
export class ThinkFilter {
  private inside = false;
  private carry = '';
  push(text: string): string {
    let s = this.carry + text;
    this.carry = '';
    let out = '';
    for (;;) {
      if (this.inside) {
        const end = s.search(/<\/think(?:ing)?>/i);
        if (end < 0) { this.carry = s.slice(-10); return out; }
        s = s.slice(end).replace(/^<\/think(?:ing)?>/i, '');
        this.inside = false;
      } else {
        const start = s.search(/<think(?:ing)?>/i);
        if (start < 0) {
          // keep a possible partial "<think" at the end for the next chunk
          const lt = s.lastIndexOf('<');
          const tail = lt >= 0 ? s.slice(lt).toLowerCase() : '';
          if (tail && tail.length < 11 && ('<thinking>'.startsWith(tail) || '<think>'.startsWith(tail))) { this.carry = s.slice(lt); out += s.slice(0, lt); }
          else out += s;
          return out;
        }
        out += s.slice(0, start);
        s = s.slice(start).replace(/^<think(?:ing)?>/i, '');
        this.inside = true;
      }
    }
  }
  flush(): string { const c = this.inside ? '' : this.carry; this.carry = ''; return c; }
}

type Delta = { content?: string | null; tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[]; reasoning_content?: string; reasoning?: string };

/** Collects an OpenAI-style streamed reply (text deltas, tool-call fragments, finish reason, usage). Reasoning fields are dropped. */
export class StreamCollector {
  private buf = '';
  content = '';
  finish = '';
  usage: LlmUsage | null = null;
  model: string | null = null;
  private calls: { id: string; name: string; args: string }[] = [];
  private think = new ThinkFilter();
  constructor(private onText?: (delta: string) => void) {}

  push(text: string) {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j: { choices?: { delta?: Delta; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string; error?: { message?: string } };
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new AgentError(String(j.error.message ?? 'The model stopped with an error.').slice(0, 300), 'upstream', true);
      if (j.model) this.model = j.model;
      if (j.usage) this.usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
      const ch = j.choices?.[0];
      if (!ch) continue;
      if (ch.finish_reason) this.finish = ch.finish_reason;
      const d = ch.delta ?? {};
      if (typeof d.content === 'string' && d.content) {
        const visible = this.think.push(d.content);
        if (visible) { this.content += visible; this.onText?.(visible); }
      }
      for (const tc of d.tool_calls ?? []) {
        const idx = tc.index ?? this.calls.length;
        const cur = (this.calls[idx] ??= { id: '', name: '', args: '' });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
      }
    }
  }

  end(): { content: string; toolCalls: ToolCall[] } {
    const rest = this.think.flush();
    if (rest) { this.content += rest; this.onText?.(rest); }
    const toolCalls = this.calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${i}`, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } }));
    return { content: this.content.trim(), toolCalls };
  }
}

/** Strips private reasoning from a whole (non-streamed) reply. */
export const withoutThinking = (s: string) => s.replace(/<think(?:ing)?>[\s\S]*?(<\/think(?:ing)?>|$)/gi, '').trim();
