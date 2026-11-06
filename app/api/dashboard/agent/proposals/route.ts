import { agentContext, jsonError } from '@/lib/agent/service';

export const dynamic = 'force-dynamic';

/** The person's proposals, and those others shared for review that they may approve. */
export async function GET(request: Request) {
  try {
    const c = await agentContext(request, null);
    const u = new URL(request.url);
    const status = u.searchParams.get('status');
    const rows = await c.db.select('agent_proposals', {
      select: 'id,owner_id,conversation_id,title,kind,status,version,submitted_for_review,created_at,updated_at,expires_at,targets,executed_at',
      order: 'created_at.desc', limit: 200, ...(status ? { status: `eq.${status}` } : {}),
    });
    return Response.json({ proposals: rows, me: c.staff.userId });
  } catch (e) { return jsonError(e); }
}
