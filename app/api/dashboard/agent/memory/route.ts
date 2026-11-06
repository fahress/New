import { agentContext, HttpError, jsonError } from '@/lib/agent/service';

export const dynamic = 'force-dynamic';

/** The person's saved preferences. Only their own; nobody else on the team can see them. */
export async function GET(request: Request) {
  try {
    const c = await agentContext(request);
    const rows = await c.db.select('agent_memories', { select: 'id,content,kind,created_at,expires_at,source_conversation_id', order: 'updated_at.desc', limit: 200 });
    return Response.json({ memories: rows });
  } catch (e) { return jsonError(e); }
}

/** Forget one preference, all of them, and/or the summaries and "recently discussed" lists of every conversation. */
export async function DELETE(request: Request) {
  try {
    const c = await agentContext(request);
    const b = (await request.json().catch(() => ({}))) as { id?: string; all?: boolean; summaries?: boolean };
    if (b.id) {
      if (!/^[0-9a-f-]{36}$/.test(b.id)) throw new HttpError(400, 'Bad id');
      await c.db.delete('agent_memories', { id: `eq.${b.id}` });
    }
    if (b.all) await c.db.delete('agent_memories', { owner_id: `eq.${c.staff.userId}` });
    if (b.summaries) await c.db.update('agent_conversations', { owner_id: `eq.${c.staff.userId}` }, { summary: null, summary_upto: null, focus: [], decisions: [] });
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
