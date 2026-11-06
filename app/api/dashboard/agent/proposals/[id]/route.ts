import { revalidateTag } from 'next/cache';
import { agentContext, HttpError, jsonError } from '@/lib/agent/service';
import { forgetArchiveCache } from '@/lib/agent/archive-db';
import type { ProposalRow } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await agentContext(request, null);
    const { id } = await params;
    const p = await c.db.one<ProposalRow>('agent_proposals', { id: `eq.${id}`, select: '*' });
    if (!p) throw new HttpError(404, 'Proposal not found.');
    const approvals = await c.db.select('agent_approvals', { proposal_id: `eq.${id}`, select: 'id,proposal_version,approver_email,approver_role,selected_ops,outcome,decided_at', order: 'decided_at.desc' });
    return Response.json({ proposal: p, approvals });
  } catch (e) { return jsonError(e); }
}

type Body = { action?: string; version?: number; ops?: string[]; request_id?: string; changes?: unknown[]; note?: string };

/**
 * A person's decision on a proposal. Approval is the only way an agent change reaches the archive:
 * the database re-checks the person, their permissions, the version and every current value, and runs
 * all chosen changes in one transaction. Images are copied into the archive's storage first and removed
 * again if the database refuses (storage isn't part of the database transaction).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let uploaded: string[] = [];
  let c;
  try {
    c = await agentContext(request, null);
    const { id } = await params;
    const b = (await request.json().catch(() => ({}))) as Body;
    const db = c.db;
    if (b.action === 'reject' || b.action === 'cancel' || b.action === 'submit') {
      const status = await db.rpc<string>('agent_decide_proposal', { p_id: id, p_action: b.action, p_note: typeof b.note === 'string' ? b.note.slice(0, 1000) : null });
      return Response.json({ ok: true, status });
    }
    if (b.action === 'update' || b.action === 'refresh') {
      if (typeof b.version !== 'number') throw new HttpError(400, 'Missing version.');
      const p = await db.rpc<ProposalRow>('agent_update_proposal', { p_id: id, p_version: b.version, p_changes: b.action === 'update' ? b.changes ?? null : null });
      return Response.json({ ok: true, proposal: p });
    }
    if (b.action !== 'approve') throw new HttpError(400, 'Unknown action.');
    if (typeof b.version !== 'number' || !Array.isArray(b.ops) || !b.ops.length) throw new HttpError(400, 'Choose the changes to approve.');
    const requestId = String(b.request_id ?? '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new HttpError(400, 'Missing request id.');
    const p = await db.one<ProposalRow>('agent_proposals', { id: `eq.${id}`, select: '*' });
    if (!p) throw new HttpError(404, 'Proposal not found.');

    // copy chosen staged images into the archive's storage (same request id → same file names, so a retry doesn't duplicate)
    const paths: Record<string, string> = {};
    const imageOps = p.changes.filter((o) => o.op === 'image_add' && b.ops!.includes(o.id));
    if (imageOps.length && p.status === 'pending' && p.version === b.version) {
      const day = new Date().toISOString().slice(0, 10);
      const assets = await db.select<{ id: string; staging_path: string; status: string }>('agent_assets', { id: `in.(${imageOps.map((o) => String(o.asset)).join(',')})`, select: 'id,staging_path,status' });
      for (const op of imageOps) {
        const a = assets.find((x) => x.id === op.asset);
        if (!a || a.status !== 'staged') throw new HttpError(409, 'An image in this proposal is no longer available. Ask the agent to find it again.');
        const path = `agent/${day}/${a.id}.webp`;
        const file = await db.download('agent-staging', a.staging_path);
        try { await db.upload('studio', path, file.bytes, 'image/webp'); uploaded.push(path); }
        catch (e) { if (!/409|Duplicate|exists/i.test(e instanceof Error ? e.message : '')) throw e; }
        paths[op.id] = path;
      }
    }
    const result = await db.rpc<{ ok: boolean; status: string; code?: string; message?: string; already?: boolean }>('agent_execute_proposal', { p_id: id, p_version: b.version, p_ops: b.ops, p_request: requestId, p_paths: paths });
    if (!result.ok) {
      await db.remove('studio', uploaded).catch(() => undefined); // undo the copies: nothing uses them
      uploaded = [];
      return Response.json(result, { status: result.code === 'stale_version' || result.code === 'conflict' || result.code === 'not_pending' ? 409 : result.code === 'forbidden' ? 403 : 422 });
    }
    // the staged originals are no longer needed
    const attached = imageOps.map((o) => String(o.asset));
    if (attached.length) {
      const rows = await db.select<{ staging_path: string }>('agent_assets', { id: `in.(${attached.join(',')})`, select: 'staging_path' }).catch(() => []);
      await db.remove('agent-staging', rows.map((r) => r.staging_path)).catch(() => undefined);
    }
    forgetArchiveCache();
    try { revalidateTag('fahress', { expire: 0 }); } catch { /* the site refreshes within 10 minutes anyway */ }
    return Response.json(result);
  } catch (e) {
    if (uploaded.length && c) await c.db.remove('studio', uploaded).catch(() => undefined);
    return jsonError(e);
  }
}
