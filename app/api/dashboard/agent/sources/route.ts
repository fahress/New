import { agentContext, HttpError, jsonError } from '@/lib/agent/service';

export const dynamic = 'force-dynamic';

/** Sources by id (for evidence shown next to a proposal or finding). Only the person's own sources are returned. */
export async function POST(request: Request) {
  try {
    const c = await agentContext(request, null);
    const b = (await request.json().catch(() => ({}))) as { ids?: string[] };
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => /^[0-9a-f-]{36}$/.test(String(x))).slice(0, 100) : [];
    if (!ids.length) throw new HttpError(400, 'No sources');
    const rows = await c.db.select('agent_sources', { id: `in.(${ids.join(',')})`, select: 'id,kind,url,title,publisher,excerpt,page,published_at,published_precision,modified_at,retrieved_at,opened' });
    return Response.json({ sources: rows });
  } catch (e) { return jsonError(e); }
}
