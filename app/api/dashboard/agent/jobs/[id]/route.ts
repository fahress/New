import { after } from 'next/server';
import { agentContext, HttpError, jsonError } from '@/lib/agent/service';
import { workJob } from '@/lib/agent/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request);
    const { id } = await params;
    const job = await c.db.one('agent_jobs', { id: `eq.${id}`, select: '*' });
    if (!job) throw new HttpError(404, 'Job not found.');
    const items = await c.db.select('agent_job_items', { job_id: `eq.${id}`, select: 'id,idx,entity_type,entity_id,label,status,attempts,summary,proposal_ids,error,updated_at', order: 'idx.asc', limit: 1000 });
    return Response.json({ job, items });
  } catch (e) { return jsonError(e); }
}

/**
 * work: process records for up to ~4 minutes, then hand over to a fresh request (so the job continues
 * after the page is closed, while the sign-in is valid). pause / resume / cancel change the job's state;
 * a running worker notices before its next record.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request);
    const { id } = await params;
    const b = (await request.json().catch(() => ({}))) as { action?: string };
    if (b.action === 'pause' || b.action === 'resume' || b.action === 'cancel') {
      const status = await c.db.rpc<string>('agent_job_control', { p_job: id, p_action: b.action });
      if (b.action === 'resume') after(() => continueLater(request, id));
      return Response.json({ ok: true, status });
    }
    if (b.action !== 'work') throw new HttpError(400, 'Unknown action');
    after(async () => {
      const r = await workJob(c, id, 240_000).catch(() => ({ state: 'error', processed: 0 }));
      if (r.state === 'running') await continueLater(request, id);
    });
    return Response.json({ ok: true, started: true });
  } catch (e) { return jsonError(e); }
}

async function continueLater(request: Request, id: string) {
  await fetch(new URL(`/api/dashboard/agent/jobs/${id}`, request.url), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: request.headers.get('authorization') ?? '' }, body: JSON.stringify({ action: 'work' }),
  }).catch(() => undefined);
}
