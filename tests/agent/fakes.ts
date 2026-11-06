/** Test doubles for the agent: a scripted model, a fake search and web reader, and an in-memory store. Nothing here talks to a network. */
import { readFileSync } from 'node:fs';
import { AgentError, type ChatModel, type LlmResult, type SearchClient, type ToolCall } from '../../lib/agent/providers';
import { DEFAULT_SETTINGS, PERM_KEYS, withDefaults, type AgentSettings, type Perm } from '../../lib/agent/settings';
import { Index, type Snapshot } from '../../lib/agent/archive';
import type { AgentStore, NewProposal } from '../../lib/agent/store';
import type { WebReader, PageRead } from '../../lib/agent/web-reader';
import type { ConversationRow, MessageRow, SourceRow } from '../../lib/agent/types';
import type { EngineDeps } from '../../lib/agent/engine';

export type Step = { text?: string; calls?: { name: string; args: unknown }[]; error?: AgentError; hang?: boolean; chunk?: number };

/** A model that plays back a script. Text is streamed in small chunks, like a real provider. */
export class ScriptedModel implements ChatModel {
  calls: { messages: unknown[]; tools: unknown }[] = [];
  constructor(public steps: Step[], public provider: 'fireworks' | 'openrouter' = 'fireworks', public model = 'test-model') {}
  async chat(req: Parameters<ChatModel['chat']>[0], opts: Parameters<ChatModel['chat']>[1]): Promise<LlmResult> {
    this.calls.push({ messages: structuredClone(req.messages), tools: req.tools });
    const s = this.steps.shift() ?? { text: '' };
    if (s.hang) await new Promise((_, rej) => opts.signal?.addEventListener('abort', () => rej(new AgentError('Stopped.', 'error', false, 499))));
    if (s.error) throw s.error;
    const text = s.text ?? '';
    const n = s.chunk ?? 7;
    for (let i = 0; i < text.length; i += n) opts.onText?.(text.slice(i, i + n));
    const toolCalls: ToolCall[] = (s.calls ?? []).map((c, i) => ({ id: `call_${this.calls.length}_${i}`, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) } }));
    return { content: text, toolCalls, finish: toolCalls.length ? 'tool_calls' : 'stop', usage: { input: 10, output: 5 }, provider: this.provider, model: this.model };
  }
}

export class FakeSearch implements SearchClient {
  queries: string[] = [];
  constructor(public results: { title: string; url: string; content: string }[] = [], public fail = false) {}
  async search(req: Parameters<SearchClient['search']>[0]) {
    this.queries.push(req.query);
    if (this.fail) throw new AgentError('Tavily is rate-limiting requests. Try again shortly.', 'rate_limited', true);
    return { results: this.results.map((r) => ({ ...r, score: 0.9, published: null })), images: [], credits: 1, estimated: false };
  }
  async extract() { return { results: [], failed: [] }; }
}

export class FakeWeb implements WebReader {
  constructor(public pages: Record<string, Partial<PageRead>> = {}) {}
  async readPage(url: string): Promise<PageRead> {
    const p = this.pages[url];
    if (!p) throw new Error('Couldn’t read the page (the site answered 404).');
    return { url, title: '', site: null, author: [], description: '', lang: null, text: '', truncated: false, dates: [], images: [], pdfs: [], profiles: [], via: 'direct', ...p };
  }
  async readPdf(): Promise<never> { throw new Error('no pdf'); }
  async fetchBytes(): Promise<never> { throw new Error('no network'); }
}

let seq = 0;
const id = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
export const uuidLike = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

export class MemoryStore implements AgentStore {
  userId = 'u-1';
  toolCalls: Parameters<AgentStore['saveToolCall']>[0][] = [];
  sources: (SourceRow & { conversation_id: string })[] = [];
  claims: unknown[] = [];
  proposals: (NewProposal & { id: string; status: string })[] = [];
  messages: Record<string, Partial<MessageRow>> = {};
  runs: Record<string, Record<string, unknown>> = {};
  runState = 'running';
  memoriesList: { id: string; content: string }[] = [];
  userText = '';
  conv: Partial<ConversationRow> = {};
  async saveToolCall(r: Parameters<AgentStore['saveToolCall']>[0]) { this.toolCalls.push(r); }
  async saveSource(_run: string, conversationId: string, _tc: string, s: Parameters<AgentStore['saveSource']>[3]) {
    const row = { id: id().replace(/^aaaaaaaa/, (++seq).toString(16).padStart(8, '0')), retrieved_at: new Date().toISOString(), conversation_id: conversationId, ...s } as SourceRow & { conversation_id: string };
    this.sources.push(row);
    return row;
  }
  async findSources(conversationId: string, prefixes: string[]) { return this.sources.filter((s) => s.conversation_id === conversationId && prefixes.some((p) => s.id.startsWith(p))); }
  async saveClaims(_r: string, _c: string, claims: unknown[]) { this.claims.push(...claims); return claims.map(() => id()); }
  async createProposal(p: NewProposal) { const row = { ...p, id: id(), status: 'pending' }; this.proposals.push(row); return { id: row.id, version: 1, changes: p.changes, existing: false }; }
  async saveAsset() { /* not used */ }
  async uploadStaging() { /* not used */ }
  async signedAssetUrl() { return null; }
  async updateMessage(mid: string, patch: Partial<MessageRow>) { this.messages[mid] = { ...this.messages[mid], ...patch }; }
  async updateRun(rid: string, patch: Record<string, unknown>) { this.runs[rid] = { ...this.runs[rid], ...patch }; }
  async runStatus() { return this.runState; }
  async updateConversation(_id: string, patch: Partial<ConversationRow>) { this.conv = { ...this.conv, ...patch }; }
  async userMessagesText() { return this.userText; }
  async saveMemory(content: string) { this.memoriesList.push({ id: id(), content }); }
  async memories() { return this.memoriesList; }
  async history() { return []; }
  async createJob() { return id(); }
}

export function fixtureSnapshot(): Snapshot {
  const fx = JSON.parse(readFileSync(new URL('../fixtures/archive.json', import.meta.url), 'utf8'));
  const l = (rows: Record<string, unknown>[], key: string) => rows.map((r) => ({ font_id: String(r.font_id), tag_id: String(r[key]) }));
  return {
    fonts: fx.fonts, people: fx.designers,
    links: {
      designers: fx.font_designers.map((r: Record<string, unknown>) => ({ font_id: String(r.font_id), designer_id: String(r.designer_id) })),
      scripts: l(fx.font_scripts, 'script_id'), genres: l(fx.font_genres, 'genre_id'), styles: l(fx.font_styles, 'style_id'), types: l(fx.font_types, 'type_id'),
      languages: l(fx.font_languages, 'lang_id'), awards: fx.font_awards.map((r: Record<string, unknown>) => ({ font_id: String(r.font_id), tag_id: String(r.award_id), url: null })),
    },
    tags: {
      scripts: fx.scripts.map((t: { id: number; name: string }) => ({ id: String(t.id), name: t.name })), genres: fx.genres.map((t: { id: number; name: string }) => ({ id: String(t.id), name: t.name })),
      styles: fx.styles.map((t: { id: number; name: string }) => ({ id: String(t.id), name: t.name })), types: fx.types.map((t: { id: number; name: string }) => ({ id: String(t.id), name: t.name })),
      awards: fx.awards.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })), language_groups: fx.language_groups.map((t: { id: number; name: string }) => ({ id: String(t.id), name: t.name })),
    },
    arabicFields: true,
  };
}

export const allPerms = (over: Partial<Record<Perm, boolean>> = {}) => ({ ...Object.fromEntries(PERM_KEYS.map((p) => [p, true])), ...over }) as Record<Perm, boolean>;

export function settings(over: (s: AgentSettings) => void = () => undefined): AgentSettings {
  const s = withDefaults({ ...DEFAULT_SETTINGS, runtime: { ...DEFAULT_SETTINGS.runtime, enabled: true }, models: { ...DEFAULT_SETTINGS.models, chat: 'test-model' } });
  over(s);
  return s;
}

export function deps(o: { model: ChatModel; store?: MemoryStore; search?: SearchClient | null; web?: WebReader; fallback?: ChatModel | null; perms?: Record<Perm, boolean>; s?: AgentSettings; primaryTools?: boolean | null; fallbackTools?: boolean | null; seeDrafts?: boolean }): EngineDeps & { store: MemoryStore } {
  const store = o.store ?? new MemoryStore();
  const snap = fixtureSnapshot();
  return {
    store, settings: o.s ?? settings(), perms: o.perms ?? allPerms(), role: 'admin',
    models: { primary: o.model, fallback: o.fallback ?? null, summary: o.model, vision: null }, caps: { primaryTools: o.primaryTools ?? true, fallbackTools: o.fallbackTools ?? true },
    search: o.search === undefined ? new FakeSearch() : o.search, web: o.web ?? new FakeWeb(), archive: async () => new Index(snap, o.seeDrafts ?? true), imageUrl: (p) => `https://img.example/${p}`, stageImages: null,
  };
}

export function conversation(over: Partial<ConversationRow> = {}): ConversationRow {
  return { id: 'conv-1', owner_id: 'u-1', title: 't', title_auto: true, created_at: '', updated_at: '', archived_at: null, head_message_id: null, context_type: null, context_id: null, summary: null, summary_upto: null, focus: [], decisions: [], ...over };
}

export function userMsg(content: string, n = 1): MessageRow {
  return { id: `m${n}`, conversation_id: 'conv-1', parent_id: n > 1 ? `m${n - 1}` : null, role: 'user', content, status: 'complete', run_id: null, client_request_id: null, cards: [], progress: [], error: null, created_at: '', updated_at: '' };
}
