/**
 * Pure helpers for the agent gateway (no Deno or Node APIs, so the dashboard tests can import them).
 * Provider addresses are fixed here on purpose: no setting can point a key at another host.
 */

export const PROVIDERS = {
  fireworks: { base: 'https://api.fireworks.ai/inference/v1', kind: 'llm', label: 'Fireworks AI' },
  openrouter: { base: 'https://openrouter.ai/api/v1', kind: 'llm', label: 'OpenRouter' },
  tavily: { base: 'https://api.tavily.com', kind: 'search', label: 'Tavily' },
} as const;
export type Provider = keyof typeof PROVIDERS;
export type LlmProvider = 'fireworks' | 'openrouter';
export const isProvider = (p: unknown): p is Provider => typeof p === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, p);
export const isLlm = (p: unknown): p is LlmProvider => p === 'fireworks' || p === 'openrouter';

/** Returns a reason the key is unusable, or null. Doesn't prove the key works — the connection test does. */
export function keyProblem(provider: Provider, key: unknown): string | null {
  if (typeof key !== 'string') return 'Paste the key as text.';
  const k = key.trim();
  if (k.length < 16 || k.length > 400) return 'That doesn’t look like a complete key (too short or too long).';
  if (!/^[\x21-\x7e]+$/.test(k)) return 'The key has spaces or unusual characters — copy it again from the provider’s site.';
  if (provider === 'tavily' && !/^tvly-/i.test(k)) return 'Tavily keys start with “tvly-”.';
  if (provider === 'openrouter' && !/^sk-or-/i.test(k)) return 'OpenRouter keys start with “sk-or-”.';
  return null;
}

export const maskKey = (key: string) => `••••${key.trim().slice(-4)}`;

/** Removes anything that looks like a key or token from text that leaves the gateway. */
export function scrub(text: string, secrets: string[] = []): string {
  let out = String(text ?? '');
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[key]');
  return out
    .replace(/\b(fw|sk-or-v1|sk-or|sk|tvly(?:-dev|-prod)?)[-_][A-Za-z0-9_-]{8,}/gi, '[key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [key]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, '[token]')
    .slice(0, 500);
}

export type Capability = boolean | null; // null = the provider doesn't say
export type ModelInfo = { id: string; name: string; context: number | null; tools: Capability; vision: Capability; structured: Capability; stream: Capability; pricePerMIn: number | null; pricePerMOut: number | null };

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): Capability => (typeof v === 'boolean' ? v : null);

/** Normalises each provider's model list into the capabilities the agent needs. Unknown stays unknown. */
export function normalizeModels(provider: LlmProvider, body: unknown): ModelInfo[] {
  const list = (body && typeof body === 'object' && Array.isArray((body as Json).data) ? (body as Json).data : Array.isArray((body as Json)?.models) ? (body as Json).models : []) as Json[];
  const out: ModelInfo[] = [];
  for (const m of list) {
    const id = typeof m.id === 'string' ? m.id : typeof m.name === 'string' ? m.name : '';
    if (!id || id.length > 200) continue;
    if (provider === 'openrouter') {
      const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as unknown[]).map(String) : null;
      const inputs = Array.isArray((m.architecture as Json | undefined)?.input_modalities) ? ((m.architecture as Json).input_modalities as unknown[]).map(String) : null;
      const pricing = (m.pricing ?? {}) as Json;
      const pin = num(pricing.prompt), pout = num(pricing.completion);
      out.push({
        id, name: typeof m.name === 'string' ? m.name : id, context: num(m.context_length),
        tools: params ? params.includes('tools') : null, vision: inputs ? inputs.includes('image') : null,
        structured: params ? params.includes('structured_outputs') || params.includes('response_format') : null, stream: true,
        pricePerMIn: pin === null ? null : pin * 1e6, pricePerMOut: pout === null ? null : pout * 1e6,
      });
    } else {
      if (m.supports_chat === false) continue;
      out.push({
        id, name: typeof m.display_name === 'string' ? m.display_name : id.replace(/^accounts\/[^/]+\/models\//, ''), context: num(m.context_length),
        tools: bool(m.supports_tools), vision: bool(m.supports_image_input), structured: bool(m.supports_response_schema ?? m.supports_json_mode), stream: true,
        pricePerMIn: null, pricePerMOut: null,
      });
    }
  }
  return out.slice(0, 2000);
}

/* ---------- chat requests ---------- */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: Json } };
export type ChatRequest = {
  model: string; messages: ChatMessage[]; tools?: ToolDef[]; tool_choice?: 'auto' | 'none' | 'required';
  max_tokens?: number; temperature?: number; response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: Json };
};

/** Builds the body sent upstream from whitelisted fields only (callers can't add provider options such as webhooks or other endpoints). */
export function chatBody(provider: LlmProvider, req: ChatRequest, stream: boolean): Json {
  const body: Json = { model: String(req.model).slice(0, 200), messages: req.messages, stream };
  if (req.tools?.length) { body.tools = req.tools.slice(0, 40); body.tool_choice = req.tool_choice ?? 'auto'; }
  if (typeof req.max_tokens === 'number') body.max_tokens = Math.max(16, Math.min(Math.round(req.max_tokens), 16384));
  if (typeof req.temperature === 'number') body.temperature = Math.max(0, Math.min(req.temperature, 1.5));
  if (req.response_format) body.response_format = req.response_format;
  if (stream) body.stream_options = { include_usage: true };
  if (provider === 'openrouter') body.usage = { include: true };
  return body;
}

export function validChatRequest(r: unknown): string | null {
  if (!r || typeof r !== 'object') return 'Missing request';
  const x = r as Json;
  if (typeof x.model !== 'string' || !x.model.trim()) return 'Choose a model in the agent settings.';
  if (!Array.isArray(x.messages) || x.messages.length < 1 || x.messages.length > 400) return 'Invalid messages';
  if (JSON.stringify(x.messages).length > 1_500_000) return 'The conversation is too long for one request.';
  if (x.tools !== undefined && (!Array.isArray(x.tools) || x.tools.length > 40)) return 'Invalid tools';
  return null;
}

/* ---------- usage ---------- */
export type Usage = { input: number; output: number; cost: number | null };

/** Reads the usage block a provider sends (in the last stream chunk, or the whole JSON reply). */
export function usageOf(obj: unknown): Usage | null {
  const u = (obj as Json | null)?.usage as Json | undefined;
  if (!u || typeof u !== 'object') return null;
  const input = num(u.prompt_tokens) ?? num(u.input_tokens) ?? 0;
  const output = num(u.completion_tokens) ?? num(u.output_tokens) ?? 0;
  return { input, output, cost: num(u.cost) };
}

/** Keeps the latest usage seen in a stream of server-sent events. Feed it text as it arrives. */
export class SseUsage {
  private buf = '';
  usage: Usage | null = null;
  model: string | null = null;
  push(text: string) {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const u = usageOf(j);
        if (u) this.usage = u;
        if (typeof j.model === 'string') this.model = j.model;
      } catch { /* partial or non-JSON line */ }
    }
  }
}

export function estimateCost(u: Usage, priceIn: number | null, priceOut: number | null): { cost: number; reported: boolean } {
  if (u.cost !== null) return { cost: u.cost, reported: true };
  if (priceIn === null && priceOut === null) return { cost: 0, reported: false };
  return { cost: ((priceIn ?? 0) * u.input + (priceOut ?? 0) * u.output) / 1e6, reported: false };
}

/* ---------- search ---------- */
export type SearchRequest = {
  query: string; depth?: 'basic' | 'advanced'; max_results?: number; include_domains?: string[]; exclude_domains?: string[];
  include_images?: boolean; topic?: 'general' | 'news'; time_range?: 'day' | 'week' | 'month' | 'year';
};
const domain = (d: unknown) => (typeof d === 'string' && /^(?=.{3,120}$)[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.trim()) ? d.trim().toLowerCase() : null);
const domains = (v: unknown, max: number) => (Array.isArray(v) ? (v.map(domain).filter(Boolean) as string[]).slice(0, max) : []);

export function tavilySearchBody(r: SearchRequest): Json | string {
  const q = typeof r?.query === 'string' ? r.query.trim() : '';
  if (q.length < 2 || q.length > 400) return 'Search text must be 2–400 characters.';
  const body: Json = {
    query: q, search_depth: r.depth === 'advanced' ? 'advanced' : 'basic',
    max_results: Math.max(1, Math.min(Math.round(r.max_results ?? 5), 20)),
    include_answer: false, include_raw_content: false, include_images: r.include_images === true, include_usage: true,
    topic: r.topic === 'news' ? 'news' : 'general',
  };
  const inc = domains(r.include_domains, 50), exc = domains(r.exclude_domains, 50);
  if (inc.length) body.include_domains = inc;
  if (exc.length) body.exclude_domains = exc;
  if (r.time_range && ['day', 'week', 'month', 'year'].includes(r.time_range)) body.time_range = r.time_range;
  return body;
}

export function tavilyExtractBody(r: { urls?: unknown; depth?: unknown }): Json | string {
  const urls = Array.isArray(r?.urls) ? r.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\/[^\s]+$/.test(u) && u.length <= 2000).slice(0, 5) : [];
  if (!urls.length) return 'Give one to five page addresses.';
  return { urls, extract_depth: r.depth === 'advanced' ? 'advanced' : 'basic', format: 'markdown', include_images: true, include_usage: true };
}

/** Tavily reports credits when asked; otherwise use its published rates (basic 1, advanced 2 per search; extract 1 per 5 pages basic) and mark it as an estimate. */
export function tavilyCredits(kind: 'search' | 'extract', body: Json, reply: unknown): { credits: number; reported: boolean } {
  const c = num(((reply as Json | null)?.usage as Json | undefined)?.credits);
  if (c !== null) return { credits: c, reported: true };
  if (kind === 'search') return { credits: body.search_depth === 'advanced' ? 2 : 1, reported: false };
  const n = Array.isArray(body.urls) ? body.urls.length : 1;
  return { credits: Math.ceil(n / 5) * (body.extract_depth === 'advanced' ? 2 : 1), reported: false };
}
