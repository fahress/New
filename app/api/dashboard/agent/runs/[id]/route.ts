import { agentContext, jsonError } from '@/lib/agent/service';

export const dynamic = 'force-dynamic';

/** Status of a run (for following a reply after a reload). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request);
    const { id } = await params;
    const run = await c.db.one('agent_runs', { id: `eq.${id}`, select: 'id,status,steps,provider,model,fallback_used,input_tokens,output_tokens,search_credits,estimated_cost_usd,started_at,finished_at,error,assistant_message_id,conversation_id' });
    if (!run) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ run });
  } catch (e) { return jsonError(e); }
}

/** Stop: marks the run stopped; the worker sees it within a couple of seconds and ends the reply. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request);
    const { id } = await params;
    const rows = await c.db.update('agent_runs', { id: `eq.${id}`, status: 'eq.running' }, { status: 'stopped', finished_at: new Date().toISOString() });
    return Response.json({ ok: true, stopped: rows.length > 0 });
  } catch (e) { return jsonError(e); }
}
