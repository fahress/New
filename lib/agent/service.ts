import 'server-only';
import { staffCheck, type Staff } from '@/lib/admin/server';
import { Supa, DbError, publicImage } from './supa';
import { withDefaults, PERM_KEYS, type AgentSettings, type LlmProviderId, type Perm } from './settings';
import { GatewayModel, GatewaySearch } from './gateway';
import { ServerWebReader } from './web-reader';
import { DbStore } from './store-db';
import { loadSnapshot } from './archive-db';
import { Index, getRecord } from './archive';
import { makeStager } from './stage-images';
import { runAgent, type Capabilities, type EngineDeps, type RunOutcome } from './engine';
import type { ChatModel } from './providers';
import type { ConversationRow, MessageRow, StreamEvent } from './types';

export type AgentCtx = { staff: Staff; db: Supa; settings: AgentSettings; version: number; perms: Record<Perm, boolean>; role: string };

export class HttpError extends Error { constructor(public status: number, message: string, public code = 'error') { super(message); } }

export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof DbError) return Response.json({ error: e.message, code: e.code ?? 'db', ...(e.code === 'not_installed' && typeof e.detail === 'string' ? { detail: e.detail.slice(0, 300) } : {}) }, { status: e.status >= 400 && e.status < 600 ? e.status : 500 });
  const err = e as { message?: string; status?: number; code?: string };
  if (err && typeof err.status === 'number' && err.status >= 400) return Response.json({ error: err.message ?? 'Error', code: err.code ?? 'error' }, { status: err.status });
  return Response.json({ error: 'Something went wrong on the server.', code: 'error' }, { status: 500 });
}

/** Signed in, on the team, and the agent's database update installed. Permissions come from the database, never assumed. */
export async function agentContext(request: Request, need: Perm | null = 'use'): Promise<AgentCtx> {
  const who = await staffCheck(request);
  if ('message' in who) throw new HttpError(who.status, who.message, 'auth');
  if (!who.token) throw new HttpError(503, 'The agent isn’t available in demo mode.', 'demo');
  const db = new Supa(who.token);
  const [row, mine] = await Promise.all([
    db.one<{ config: unknown; version: number }>('agent_settings', { id: 'eq.1', select: 'config,version' }),
    db.rpc<{ role: string | null; permissions: Record<string, boolean> }>('agent_my_permissions'),
  ]);
  if (!row || !mine?.role) throw new HttpError(403, 'Your account isn’t on the dashboard team, or the agent settings couldn’t be read.', 'forbidden');
  const perms = Object.fromEntries(PERM_KEYS.map((p) => [p, mine.permissions?.[p] === true])) as Record<Perm, boolean>;
  if (need && !perms[need]) throw new HttpError(403, `Your account isn’t allowed to ${need === 'use' ? 'use the agent' : 'do this'}.`, 'forbidden');
  return { staff: who, db, settings: withDefaults(row.config), version: row.version, perms, role: mine.role };
}

type Integration = { provider: string; configured: boolean; status: string; details: { models?: { id: string; tools: boolean | null; vision: boolean | null }[]; probes?: Record<string, { tools?: boolean }> } };

export async function integrations(db: Supa): Promise<Integration[]> {
  return db.select<Integration>('agent_integrations', { select: 'provider,configured,status,details,hint,last_checked_at,last_error,updated_at' });
}

/** Does this model call tools? A real check on the settings page beats the provider's list; unknown stays null. */
export function toolSupport(list: Integration[], provider: LlmProviderId, model: string): boolean | null {
  const i = list.find((x) => x.provider === provider);
  const probe = i?.details?.probes?.[model];
  if (probe && typeof probe.tools === 'boolean') return probe.tools;
  const m = i?.details?.models?.find((x) => x.id === model);
  return m ? m.tools : null;
}

const ctxSummary = (rec: ReturnType<typeof getRecord>) => {
  if (!rec) return null;
  const r = rec as Record<string, unknown>;
  return { ...r, images: Array.isArray(r.images) ? (r.images as unknown[]).length : undefined, description: typeof r.description === 'string' ? r.description.slice(0, 800) : r.description };
};

/** Messages from the start of the conversation to `headId`, following each message's parent (one branch). */
export async function pathTo(db: Supa, conversationId: string, headId: string | null): Promise<MessageRow[]> {
  if (!headId) return [];
  const rows = await db.select<MessageRow>('agent_messages', { conversation_id: `eq.${conversationId}`, select: '*', order: 'created_at.asc', limit: 2000 });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: MessageRow[] = [];
  let cur = byId.get(headId);
  while (cur && out.length < 2000) { out.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return out;
}

export function buildDeps(c: AgentCtx, list: Integration[], runId: string, conversationId: string): EngineDeps {
  const s = c.settings;
  const token = c.staff.token;
  // OpenRouter models are only used while OpenRouter is allowed in the settings
  const mk = (provider: LlmProviderId, model: string): ChatModel | null => (model && (provider !== 'openrouter' || s.providers.openrouter.enabled) ? new GatewayModel(token, provider, model, { temperature: s.models.temperature, max_tokens: s.models.max_output_tokens }) : null);
  const configured = (p: string) => list.some((i) => i.provider === p && i.configured);
  const search = s.search.provider === 'tavily' && configured('tavily') ? new GatewaySearch(token) : null;
  const web = new ServerWebReader(search);
  const store = new DbStore(c.db, c.staff.userId);
  const primary = mk(s.models.chat_provider, s.models.chat);
  if (!primary) throw new HttpError(412, 'No chat model is chosen. Open Agent settings → Models.', 'no_model');
  const caps: Capabilities = { primaryTools: toolSupport(list, s.models.chat_provider, s.models.chat), fallbackTools: s.models.fallback.enabled ? toolSupport(list, s.models.fallback.provider, s.models.fallback.model) : null };
  const vision = s.models.vision ? mk(s.models.vision_provider, s.models.vision) : null;
  const visionOk = vision && list.find((i) => i.provider === s.models.vision_provider)?.details?.models?.find((m) => m.id === s.models.vision)?.vision !== false;
  return {
    store, settings: s, perms: c.perms, role: c.role, caps, search, web,
    models: { primary, fallback: s.models.fallback.enabled ? mk(s.models.fallback.provider, s.models.fallback.model) : null, summary: mk(s.models.summary_provider, s.models.summary) ?? primary, vision: visionOk ? vision : null },
    archive: async () => new Index(await loadSnapshot(c.db, c.staff.userId), c.perms.read_drafts),
    imageUrl: publicImage,
    stageImages: makeStager({ web, store, runId, conversationId }),
  };
}

export async function contextRecord(deps: EngineDeps, conv: ConversationRow) {
  if (!conv.context_type || !conv.context_id) return null;
  try { return ctxSummary(getRecord(await deps.archive(), conv.context_type, conv.context_id, deps.imageUrl)); } catch { return null; }
}

/** Saves the end of a run: the reply, the run's status and which model answered. */
export async function finishRun(c: AgentCtx, runId: string, messageId: string | null, out: RunOutcome) {
  const store = new DbStore(c.db, c.staff.userId);
  if (messageId) {
    await store.updateMessage(messageId, {
      content: out.content || (out.status === 'failed' ? '' : out.status === 'stopped' ? '' : '…'), cards: out.cards, progress: out.progress,
      status: out.status === 'completed' || out.status === 'limit' ? 'complete' : out.status === 'stopped' ? 'stopped' : 'error', error: out.error,
    }).catch(() => undefined);
  }
  await store.updateRun(runId, { status: out.status, provider: out.provider, model: out.model, fallback_used: out.fallbackUsed, steps: out.steps, finished_at: new Date().toISOString(), error: out.error }).catch(() => undefined);
}

export function sse(): { stream: ReadableStream<Uint8Array>; send: (e: StreamEvent) => void; close: () => void } {
  const enc = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; }, cancel() { open = false; } });
  return {
    stream,
    send(e) { if (!open || !ctrl) return; try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { open = false; } },
    close() { if (!open || !ctrl) return; open = false; try { ctrl.close(); } catch { /* already closed */ } },
  };
}

export { runAgent };
