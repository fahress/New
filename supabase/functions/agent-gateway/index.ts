// Fahress agent gateway — Supabase Edge Function (Deno).
//
// The only place where the agent's API keys are decrypted. It:
//   * checks the caller's Supabase sign-in and their agent permissions on every request,
//   * stores, rotates, deletes and tests keys in Supabase Vault (write-only for people),
//   * forwards model and search requests to fixed provider addresses (lib.ts → PROVIDERS),
//   * checks the run is active and within its limits, and records usage as the provider reports it.
//
// Keys never leave this function: responses and errors are scrubbed, and nothing is logged.
// Deploy: supabase functions deploy agent-gateway   (SUPABASE_URL and the service key are provided by Supabase.)

import {
  PROVIDERS, SseUsage, chatBody, estimateCost, isLlm, isProvider, keyProblem, maskKey, normalizeModels, scrub, tavilyCredits,
  tavilyExtractBody, tavilySearchBody, usageOf, validChatRequest, type ChatRequest, type LlmProvider, type Provider, type SearchRequest,
} from './lib.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): unknown };

const VERSION = '1.0.0';
const SB_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || (() => {
  try { return (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>).default ?? ''; } catch { return ''; }
})();

type Json = Record<string, unknown>;
class GwError extends Error { constructor(public status: number, message: string, public code = 'error', public retryable = false) { super(message); } }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const svc = (): Record<string, string> => ({ apikey: SERVICE_KEY, ...(SERVICE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SERVICE_KEY}` } : {}), 'content-type': 'application/json' });

async function rpc<T>(fn: string, args: Json): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: svc(), body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) {
    let msg = 'Database error';
    try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* keep generic */ }
    throw new GwError(res.status === 403 || /AG403|not allowed/i.test(text) ? 403 : 500, scrub(msg));
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function caller(req: Request): Promise<string> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) throw new GwError(401, 'Sign in to the dashboard first.');
  const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GwError(401, 'Your dashboard sign-in has expired. Reload the page.');
  const u = (await res.json()) as { id?: string };
  if (!u.id) throw new GwError(401, 'Unknown user.');
  return u.id;
}

const can = (user: string, perm: string) => rpc<boolean>('agent_can_for', { p_user: user, p_perm: perm });
async function need(user: string, ...perms: string[]) {
  for (const p of perms) if (await can(user, p)) return;
  throw new GwError(403, 'Your account isn’t allowed to do this.');
}
const secretOf = async (p: Provider) => {
  const k = await rpc<string | null>('agent_vault_read', { p_provider: p });
  if (!k) throw new GwError(412, `No ${PROVIDERS[p].label} key is saved. Add it in Agent settings → Connections.`, 'no_key');
  return k;
};
const status = (p: Provider, s: 'ok' | 'error', err: string | null, details: Json | null = null) =>
  rpc('agent_integration_status', { p_provider: p, p_status: s, p_error: err, p_details: details }).catch(() => undefined);
const usage = (a: { user: string; run: string | null; provider: string; model: string | null; kind: string; input?: number; output?: number; credits?: number; cost?: number; reported: boolean; ok: boolean; error?: string | null; ms: number }) =>
  rpc('agent_record_usage', {
    p_user: a.user, p_run: a.run, p_provider: a.provider, p_model: a.model, p_kind: a.kind, p_in: a.input ?? 0, p_out: a.output ?? 0,
    p_credits: a.credits ?? 0, p_cost: a.cost ?? 0, p_reported: a.reported, p_ok: a.ok, p_error: a.error ?? null, p_ms: a.ms,
  }).catch(() => undefined);

function authHeaders(p: Provider, key: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' };
  if (p === 'openrouter') { h['HTTP-Referer'] = 'https://fahress.com'; h['X-Title'] = 'Fahress Agent'; }
  return h;
}

async function upstream(p: Provider, path: string, key: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${PROVIDERS[p].base}${path}`, { ...init, headers: { ...authHeaders(p, key), ...(init.headers as Record<string, string> | undefined) }, signal: ctrl.signal, redirect: 'error' });
  } catch (e) {
    throw new GwError(504, ctrl.signal.aborted ? `${PROVIDERS[p].label} didn’t answer in time.` : `Couldn’t reach ${PROVIDERS[p].label}.`, 'network', true);
  } finally {
    clearTimeout(t);
  }
}

/** Turns a provider's error reply into a short, key-free explanation. */
async function providerError(p: Provider, res: Response, key: string): Promise<GwError> {
  let detail = '';
  try {
    const t = await res.text();
    try { const j = JSON.parse(t) as Json; detail = String((j.error as Json | undefined)?.message ?? j.error ?? j.message ?? j.detail ?? t); } catch { detail = t; }
  } catch { /* no body */ }
  detail = scrub(detail, [key]).slice(0, 300);
  const name = PROVIDERS[p].label;
  if (res.status === 401 || res.status === 403) return new GwError(res.status, `${name} refused the key (${res.status}). Check or replace it in Agent settings.`, 'auth');
  if (res.status === 402) return new GwError(402, `${name} says the account has no credit left.`, 'billing');
  if (res.status === 404) return new GwError(404, `${name} doesn’t know this model or address. ${detail}`, 'not_found');
  if (res.status === 429) return new GwError(429, `${name} is rate-limiting requests. Try again shortly.`, 'rate_limited', true);
  if (res.status >= 500) return new GwError(502, `${name} had a problem (${res.status}).`, 'upstream', true);
  return new GwError(400, `${name} rejected the request: ${detail}`, 'bad_request');
}

/* ---------- connection tests ---------- */
async function testKey(p: Provider, key: string): Promise<{ ok: boolean; message: string; details: Json }> {
  const t0 = Date.now();
  try {
    if (p === 'tavily') {
      const body = tavilySearchBody({ query: 'Arabic type design archive', max_results: 1 }) as Json;
      const res = await upstream(p, '/search', key, { method: 'POST', body: JSON.stringify(body) }, 15000);
      if (!res.ok) throw await providerError(p, res, key);
      await res.json();
      return { ok: true, message: `Tavily answered in ${Date.now() - t0} ms (one basic search, about 1 credit).`, details: {} };
    }
    const res = await upstream(p, '/models', key, { method: 'GET' }, 15000);
    if (!res.ok) throw await providerError(p, res, key);
    const models = normalizeModels(p as LlmProvider, await res.json());
    if (p === 'openrouter') {
      // the models list is public on OpenRouter, so also check the key itself
      const k = await upstream(p, '/key', key, { method: 'GET' }, 15000);
      if (!k.ok) throw await providerError(p, k, key);
    }
    return { ok: true, message: `${PROVIDERS[p].label} accepted the key and listed ${models.length} models (${Date.now() - t0} ms).`, details: { models, models_at: new Date().toISOString() } };
  } catch (e) {
    const g = e instanceof GwError ? e : new GwError(500, 'Unexpected error');
    return { ok: false, message: g.message, details: { code: g.code } };
  }
}

/** Checks a model really streams and calls tools, with a tiny request (a few tokens). */
async function probe(user: string, p: LlmProvider, key: string, model: string) {
  const t0 = Date.now();
  const req: ChatRequest = {
    model, max_tokens: 48, temperature: 0, tool_choice: 'required',
    messages: [{ role: 'user', content: 'Call the ping tool with word "ok".' }],
    tools: [{ type: 'function', function: { name: 'ping', description: 'Connectivity check.', parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false } } }],
  };
  const out: Json = { model, at: new Date().toISOString() };
  const res = await upstream(p, '/chat/completions', key, { method: 'POST', body: JSON.stringify(chatBody(p, req, false)) }, 30000);
  if (!res.ok) { const e = await providerError(p, res, key); out.tools = false; out.error = e.message; }
  else {
    const j = (await res.json()) as Json;
    const calls = ((j.choices as Json[] | undefined)?.[0]?.message as Json | undefined)?.tool_calls;
    out.tools = Array.isArray(calls) && calls.length > 0;
    const u = usageOf(j);
    await usage({ user, run: null, provider: p, model, kind: 'test', input: u?.input, output: u?.output, cost: u?.cost ?? 0, reported: !!u, ok: true, ms: Date.now() - t0 });
  }
  const s = await upstream(p, '/chat/completions', key, { method: 'POST', body: JSON.stringify(chatBody(p, { model, max_tokens: 8, messages: [{ role: 'user', content: 'Say OK.' }] }, true)) }, 30000);
  out.stream = s.ok && (s.headers.get('content-type') ?? '').includes('text/event-stream');
  if (s.ok) {
    const tracker = new SseUsage();
    const reader = s.body!.getReader();
    const dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; tracker.push(dec.decode(value, { stream: true })); }
    out.streamUsage = !!tracker.usage;
    await usage({ user, run: null, provider: p, model, kind: 'test', input: tracker.usage?.input, output: tracker.usage?.output, cost: tracker.usage?.cost ?? 0, reported: !!tracker.usage, ok: true, ms: Date.now() - t0 });
  } else {
    await s.body?.cancel();
  }
  return out;
}

/* ---------- handler ---------- */
async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!SB_URL || !SERVICE_KEY) return json({ error: 'The gateway is missing its Supabase service identity.' }, 500);
  if (Number(req.headers.get('content-length') ?? 0) > 2_000_000) return json({ error: 'Request too large' }, 413);
  const user = await caller(req);
  const body = (await req.json().catch(() => ({}))) as Json;
  const action = String(body.action ?? '');
  const t0 = Date.now();

  if (action === 'status') {
    await need(user, 'use', 'manage_settings');
    return json({ ok: true, version: VERSION });
  }

  if (action === 'secret.put' || action === 'secret.delete' || action === 'secret.test') {
    await need(user, 'manage_secrets');
    const p = body.provider;
    if (!isProvider(p)) throw new GwError(400, 'Unknown provider');
    if (action === 'secret.delete') {
      await rpc('agent_vault_delete', { p_provider: p, p_user: user });
      return json({ ok: true, configured: false });
    }
    if (action === 'secret.put') {
      const problem = keyProblem(p, body.key);
      if (problem) throw new GwError(400, problem, 'invalid_key');
      const key = String(body.key).trim();
      const test = await testKey(p, key);
      if (!test.ok && test.details.code === 'auth') throw new GwError(400, `${test.message} The key was not saved.`, 'auth');
      await rpc('agent_vault_put', { p_provider: p, p_secret: key, p_hint: maskKey(key), p_user: user });
      await status(p, test.ok ? 'ok' : 'error', test.ok ? null : test.message, test.details);
      return json({ ok: test.ok, configured: true, hint: maskKey(key), message: test.ok ? `Saved. ${test.message}` : `Saved, but the test failed: ${test.message}` });
    }
    const key = await secretOf(p);
    const test = await testKey(p, key);
    await status(p, test.ok ? 'ok' : 'error', test.ok ? null : test.message, test.details);
    return json({ ok: test.ok, message: test.message, models: (test.details as Json).models ?? null });
  }

  if (action === 'models.probe') {
    await need(user, 'manage_settings');
    const p = body.provider;
    if (!isLlm(p)) throw new GwError(400, 'Unknown provider');
    const model = String(body.model ?? '').slice(0, 200);
    if (!model) throw new GwError(400, 'Choose a model');
    const result = await probe(user, p, await secretOf(p), model);
    await status(p, 'ok', null, { probes: { [model]: result } });
    return json({ ok: true, probe: result });
  }

  if (action === 'chat') {
    const p = body.provider;
    if (!isLlm(p)) throw new GwError(400, 'Unknown provider');
    const kind = ['chat', 'summary', 'vision'].includes(String(body.kind)) ? String(body.kind) : 'chat';
    const run = typeof body.run_id === 'string' ? body.run_id : '';
    const auth = await rpc<{ ok: boolean; code?: number; message?: string; config?: Json }>('agent_gateway_authorize', { p_user: user, p_run: run, p_kind: kind });
    if (!auth.ok) throw new GwError(auth.code ?? 403, auth.message ?? 'Not allowed', auth.code === 429 ? 'limit' : 'denied');
    const bad = validChatRequest(body.request);
    if (bad) throw new GwError(400, bad);
    const cfg = auth.config ?? {};
    if (p === 'openrouter' && ((cfg.providers as Json | undefined)?.openrouter as Json | undefined)?.enabled !== true) throw new GwError(403, 'OpenRouter is switched off in the agent settings.', 'denied');
    const timeout = Math.max(10, Math.min(Number((cfg.limits as Json | undefined)?.request_timeout_seconds ?? 90), 280)) * 1000;
    const prices = ((cfg.providers as Json | undefined)?.[p] as Json | undefined) ?? {};
    const priceIn = typeof prices.price_in === 'number' ? prices.price_in : null, priceOut = typeof prices.price_out === 'number' ? prices.price_out : null;
    const key = await secretOf(p);
    const stream = body.stream !== false;
    const reqBody = chatBody(p, body.request as ChatRequest, stream);
    const res = await upstream(p, '/chat/completions', key, { method: 'POST', body: JSON.stringify(reqBody), headers: { accept: stream ? 'text/event-stream' : 'application/json' } }, timeout);
    const model = String(reqBody.model);
    if (!res.ok) {
      const e = await providerError(p, res, key);
      await usage({ user, run, provider: p, model, kind, reported: false, ok: false, error: e.message, ms: Date.now() - t0 });
      if (e.code === 'auth') await status(p, 'error', e.message);
      throw e;
    }
    if (!stream) {
      const j = (await res.json()) as Json;
      const u = usageOf(j) ?? { input: 0, output: 0, cost: null };
      const c = estimateCost(u, priceIn, priceOut);
      await usage({ user, run, provider: p, model, kind, input: u.input, output: u.output, cost: c.cost, reported: !!usageOf(j), ok: true, ms: Date.now() - t0 });
      return json({ ...j, fahress: { provider: p, cost_estimated: !c.reported } });
    }
    const tracker = new SseUsage();
    const dec = new TextDecoder();
    const tee = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) { tracker.push(dec.decode(chunk, { stream: true })); ctrl.enqueue(chunk); },
      async flush() {
        const u = tracker.usage ?? { input: 0, output: 0, cost: null };
        const c = estimateCost(u, priceIn, priceOut);
        await usage({ user, run, provider: p, model: tracker.model ?? model, kind, input: u.input, output: u.output, cost: c.cost, reported: !!tracker.usage, ok: true, ms: Date.now() - t0 });
      },
    });
    return new Response(res.body!.pipeThrough(tee), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-fahress-provider': p } });
  }

  if (action === 'search' || action === 'extract') {
    const run = typeof body.run_id === 'string' ? body.run_id : '';
    const auth = await rpc<{ ok: boolean; code?: number; message?: string; config?: Json }>('agent_gateway_authorize', { p_user: user, p_run: run, p_kind: action });
    if (!auth.ok) throw new GwError(auth.code ?? 403, auth.message ?? 'Not allowed', 'denied');
    const reqBody = action === 'search' ? tavilySearchBody(body.request as SearchRequest) : tavilyExtractBody(body.request as Json);
    if (typeof reqBody === 'string') throw new GwError(400, reqBody);
    const key = await secretOf('tavily');
    const res = await upstream('tavily', action === 'search' ? '/search' : '/extract', key, { method: 'POST', body: JSON.stringify(reqBody) }, 30000);
    if (!res.ok) {
      const e = await providerError('tavily', res, key);
      await usage({ user, run, provider: 'tavily', model: null, kind: action, reported: false, ok: false, error: e.message, ms: Date.now() - t0 });
      if (e.code === 'auth') await status('tavily', 'error', e.message);
      throw e;
    }
    const j = (await res.json()) as Json;
    const c = tavilyCredits(action, reqBody, j);
    await usage({ user, run, provider: 'tavily', model: null, kind: action, credits: c.credits, reported: c.reported, ok: true, ms: Date.now() - t0 });
    return json({ ...j, fahress: { credits: c.credits, credits_estimated: !c.reported } });
  }

  throw new GwError(400, 'Unknown action');
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    const g = e instanceof GwError ? e : new GwError(500, 'The gateway hit an unexpected error.');
    return json({ error: scrub(g.message), code: g.code, retryable: g.retryable }, g.status);
  }
});
