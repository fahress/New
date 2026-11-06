import { agentContext, HttpError, jsonError, pathTo } from '@/lib/agent/service';
import type { Card, ConversationRow, MessageRow } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

/** One conversation: the current branch of messages, plus everything its cards show (proposals, sources, images, jobs). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request);
    const { id } = await params;
    const conv = await c.db.one<ConversationRow>('agent_conversations', { id: `eq.${id}`, select: '*' });
    if (!conv) throw new HttpError(404, 'Conversation not found.');
    const messages = await pathTo(c.db, id, conv.head_message_id);
    // other versions of each message (edits and regenerated replies), to switch between branches
    const all = await c.db.select<{ id: string; parent_id: string | null; role: string; created_at: string }>('agent_messages', { conversation_id: `eq.${id}`, select: 'id,parent_id,role,created_at', order: 'created_at.asc', limit: 2000 });
    const siblings: Record<string, string[]> = {};
    for (const m of messages) siblings[m.id] = all.filter((x) => x.parent_id === m.parent_id && x.role === m.role).map((x) => x.id);
    const leafOf = (startId: string) => { let cur = startId; for (;;) { const kids = all.filter((x) => x.parent_id === cur); if (!kids.length) return cur; cur = kids[kids.length - 1].id; } };
    const branchHeads = Object.fromEntries(Object.values(siblings).flat().map((sid) => [sid, leafOf(sid)]));
    const cards = messages.flatMap((m) => (m.cards ?? []) as Card[]);
    const ids = (k: Card['kind']) => [...new Set(cards.filter((x) => x.kind === k).flatMap((x) => (x.kind === 'sources' ? x.ids : x.kind === 'images' ? x.assets : 'id' in x ? [x.id] : [])))];
    const inList = (list: string[]) => `in.(${list.join(',')})`;
    const [proposals, sources, assets, jobs, run] = await Promise.all([
      ids('proposal').length ? c.db.select('agent_proposals', { id: inList(ids('proposal')), select: '*' }) : [],
      ids('sources').length ? c.db.select('agent_sources', { id: inList(ids('sources')), select: 'id,kind,url,title,publisher,excerpt,page,published_at,published_precision,modified_at,retrieved_at,opened' }) : [],
      ids('images').length ? c.db.select<{ id: string; staging_path: string; status: string; attached_path: string | null }>('agent_assets', { id: inList(ids('images')), select: 'id,source_url,page_url,staging_path,width,height,kind,status,attached_path,bytes,created_at' }) : [],
      ids('job').length ? c.db.select('agent_jobs', { id: inList(ids('job')), select: 'id,title,status,total,done,failed,updated_at,error' }) : [],
      c.db.one('agent_runs', { conversation_id: `eq.${id}`, status: 'eq.running', select: 'id,assistant_message_id,started_at', order: 'started_at.desc' }),
    ]);
    const signed = await c.db.signed('agent-staging', assets.filter((a) => a.status === 'staged').map((a) => a.staging_path), 3600);
    return Response.json({
      conversation: conv, messages, siblings, branchHeads, running: run,
      proposals, sources, jobs, assets: assets.map((a) => ({ ...a, preview: a.status === 'staged' ? signed[a.staging_path] ?? null : null })),
    });
  } catch (e) { return jsonError(e); }
}

/** Rename, archive / unarchive, or switch to another branch. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request);
    const { id } = await params;
    const b = (await request.json().catch(() => ({}))) as { title?: string; archived?: boolean; head?: string };
    const patch: Record<string, unknown> = {};
    if (typeof b.title === 'string') {
      const t = b.title.replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!t) throw new HttpError(400, 'A title is needed.');
      patch.title = t; patch.title_auto = false;
    }
    if (typeof b.archived === 'boolean') patch.archived_at = b.archived ? new Date().toISOString() : null;
    if (Object.keys(patch).length) {
      const rows = await c.db.update('agent_conversations', { id: `eq.${id}` }, patch);
      if (!rows.length) throw new HttpError(404, 'Conversation not found.');
    }
    if (typeof b.head === 'string') {
      const superseded = await c.db.rpc<number>('agent_set_head', { p_conversation: id, p_head: b.head });
      return Response.json({ ok: true, superseded });
    }
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}

/** Deletes the conversation with its messages, tool results, sources, findings and summary.
 *  Proposals stay (without the conversation) because they are part of the change history. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request);
    const { id } = await params;
    const running = await c.db.one('agent_runs', { conversation_id: `eq.${id}`, status: 'eq.running', select: 'id' });
    if (running) throw new HttpError(409, 'Stop the reply that is still running first.');
    const staged = await c.db.select<{ staging_path: string }>('agent_assets', { conversation_id: `eq.${id}`, status: 'eq.staged', select: 'staging_path' });
    await c.db.update('agent_assets', { conversation_id: `eq.${id}`, status: 'eq.staged' }, { status: 'discarded' }).catch(() => undefined);
    await c.db.delete('agent_conversations', { id: `eq.${id}` });
    await c.db.remove('agent-staging', staged.map((a) => a.staging_path)).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}

export type ConversationPayload = { conversation: ConversationRow; messages: MessageRow[] };
