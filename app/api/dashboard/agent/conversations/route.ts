import { agentContext, jsonError } from '@/lib/agent/service';

export const dynamic = 'force-dynamic';

/** The person's own conversations (newest first), optionally searched by title and message text, or archived ones. */
export async function GET(request: Request) {
  try {
    const c = await agentContext(request);
    const u = new URL(request.url);
    const q = (u.searchParams.get('q') ?? '').trim().slice(0, 100);
    const archived = u.searchParams.get('archived') === '1';
    const base = { select: 'id,title,updated_at,created_at,archived_at,context_type,context_id', order: 'updated_at.desc', limit: 200, archived_at: archived ? 'not.is.null' : 'is.null' };
    if (!q) return Response.json({ conversations: await c.db.select('agent_conversations', base) });
    const safe = q.replace(/[%_*,()]/g, ' ');
    const [byTitle, byText] = await Promise.all([
      c.db.select<{ id: string }>('agent_conversations', { ...base, title: `ilike.*${safe}*` }),
      c.db.select<{ conversation_id: string }>('agent_messages', { select: 'conversation_id', content: `ilike.*${safe}*`, limit: 300 }),
    ]);
    const ids = [...new Set([...byTitle.map((x) => x.id), ...byText.map((x) => x.conversation_id)])].slice(0, 150);
    const rows = ids.length ? await c.db.select('agent_conversations', { ...base, id: `in.(${ids.join(',')})` }) : [];
    return Response.json({ conversations: rows });
  } catch (e) { return jsonError(e); }
}
