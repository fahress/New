import { after } from 'next/server';
import { agentContext, buildDeps, contextRecord, finishRun, HttpError, integrations, jsonError, pathTo, runAgent, sse } from '@/lib/agent/service';
import { DbStore } from '@/lib/agent/store-db';
import type { ConversationRow, MessageRow } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Body = { conversation_id?: string; content?: string; client_request_id?: string; edit_of?: string; regenerate_of?: string; context?: { type?: string; id?: string } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sends a message and streams the agent's reply (server-sent events).
 * The same client_request_id never starts a second run: if it is still working, the page follows it by polling.
 * The run keeps going if the page closes; the reply is saved as it grows.
 */
export async function POST(request: Request) {
  let c;
  try { c = await agentContext(request); } catch (e) { return jsonError(e); }
  const b = (await request.json().catch(() => ({}))) as Body;
  const rid = String(b.client_request_id ?? '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(rid)) return Response.json({ error: 'Missing request id.' }, { status: 400 });
  const content = String(b.content ?? '').trim();
  if (!b.regenerate_of && (!content || content.length > 8000)) return Response.json({ error: 'Write a message (up to 8000 characters).' }, { status: 400 });
  if (!c.settings.runtime.enabled) return Response.json({ error: 'The agent is switched off. An admin can switch it on in Agent settings.', code: 'disabled' }, { status: 423 });

  const db = c.db;
  try {
    /* ----- the conversation ----- */
    let conv: ConversationRow | null = null;
    if (b.conversation_id) {
      if (!UUID.test(b.conversation_id)) throw new HttpError(400, 'Bad conversation id');
      conv = await db.one<ConversationRow>('agent_conversations', { id: `eq.${b.conversation_id}`, select: '*' });
      if (!conv) throw new HttpError(404, 'Conversation not found.');
    } else {
      const ctxType = ['font', 'designer', 'foundry'].includes(String(b.context?.type)) ? String(b.context!.type) : null;
      const ctxId = ctxType && UUID.test(String(b.context?.id)) ? String(b.context!.id) : null;
      [conv] = await db.insert<ConversationRow>('agent_conversations', {
        owner_id: c.staff.userId, title: content.replace(/\s+/g, ' ').slice(0, 70) || 'New conversation', context_type: ctxId ? ctxType : null, context_id: ctxId,
      });
    }

    /* ----- same request again? follow the existing run ----- */
    const prior = await db.one<{ id: string; status: string; assistant_message_id: string | null; user_message_id: string | null }>('agent_runs', { idempotency_key: `eq.${rid}`, select: 'id,status,assistant_message_id,user_message_id' });
    if (prior) return Response.json({ state: prior.status === 'running' ? 'running' : 'done', conversation_id: conv.id, run_id: prior.id, assistant_message_id: prior.assistant_message_id, user_message_id: prior.user_message_id });

    /* ----- the user's message (a new branch when editing) ----- */
    let userMsg: MessageRow;
    if (b.regenerate_of) {
      const old = await db.one<MessageRow>('agent_messages', { id: `eq.${b.regenerate_of}`, conversation_id: `eq.${conv.id}`, select: '*' });
      if (!old || old.role !== 'assistant' || !old.parent_id) throw new HttpError(404, 'Nothing to regenerate.');
      const parent = await db.one<MessageRow>('agent_messages', { id: `eq.${old.parent_id}`, select: '*' });
      if (!parent) throw new HttpError(404, 'Nothing to regenerate.');
      userMsg = parent;
    } else {
      let parentId = conv.head_message_id;
      if (b.edit_of) {
        const edited = await db.one<MessageRow>('agent_messages', { id: `eq.${b.edit_of}`, conversation_id: `eq.${conv.id}`, select: 'id,parent_id,role' });
        if (!edited || edited.role !== 'user') throw new HttpError(404, 'That message can’t be edited.');
        parentId = edited.parent_id;
      }
      const existing = await db.one<MessageRow>('agent_messages', { conversation_id: `eq.${conv.id}`, client_request_id: `eq.${rid}`, select: '*' });
      userMsg = existing ?? (await db.insert<MessageRow>('agent_messages', { conversation_id: conv.id, owner_id: c.staff.userId, parent_id: parentId, role: 'user', content, client_request_id: rid }))[0];
    }

    /* ----- start the run (limits are checked in the database) ----- */
    const run = await db.rpc<{ id: string; existing: boolean }>('agent_start_run', { p_conversation: conv.id, p_user_message: userMsg.id, p_kind: 'chat', p_idempotency: rid, p_job_item: null });
    const [asst] = await db.insert<MessageRow>('agent_messages', { conversation_id: conv.id, owner_id: c.staff.userId, parent_id: userMsg.id, role: 'assistant', content: '', status: 'streaming', run_id: run.id });
    await db.update('agent_runs', { id: `eq.${run.id}` }, { assistant_message_id: asst.id });
    await db.rpc('agent_set_head', { p_conversation: conv.id, p_head: asst.id });
    const history = await pathTo(db, conv.id, userMsg.id);

    const list = await integrations(db);
    const deps = buildDeps(c, list, run.id, conv.id);
    const memories = c.settings.memory.enabled && c.settings.memory.scope === 'user' ? (await new DbStore(db, c.staff.userId).memories().catch(() => [])).map((m) => m.content) : [];
    const record = await contextRecord(deps, conv);
    const out = sse();
    out.send({ type: 'meta', conversation_id: conv.id, user_message_id: userMsg.id, assistant_message_id: asst.id, run_id: run.id });

    const work = (async () => {
      const result = await runAgent(deps, { runId: run.id, conversation: conv!, history, assistantMessageId: asst.id, memories, context: record, mode: 'chat' }, out.send);
      await finishRun(c, run.id, asst.id, result);
      if (result.status === 'failed') out.send({ type: 'error', message: result.error ?? 'The agent stopped with an error.', code: 'failed', retryable: true });
      const saved = await db.one<MessageRow>('agent_messages', { id: `eq.${asst.id}`, select: '*' }).catch(() => null);
      if (saved) out.send({ type: 'done', message: saved });
      out.close();
    })().catch(async (e) => {
      await finishRun(c, run.id, asst.id, { status: 'failed', content: '', cards: [], progress: [], error: e instanceof Error ? e.message.slice(0, 300) : 'error', provider: '', model: '', fallbackUsed: false, steps: 0, proposals: [] });
      out.send({ type: 'error', message: 'The agent stopped with an error.', code: 'failed', retryable: true });
      out.close();
    });
    // keep working after the page disconnects; the reply is saved as it goes
    after(() => work);
    return new Response(out.stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  } catch (e) {
    return jsonError(e);
  }
}
