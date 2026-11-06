import { agentContext, HttpError, jsonError } from '@/lib/agent/service';

export const dynamic = 'force-dynamic';

/** Fresh preview links for staged images (they expire after an hour), or discard images that aren't wanted. */
export async function POST(request: Request) {
  try {
    const c = await agentContext(request);
    const b = (await request.json().catch(() => ({}))) as { ids?: string[]; discard?: string[] };
    const valid = (l: unknown) => (Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)).slice(0, 60) : []);
    const discard = valid(b.discard);
    if (discard.length) {
      const rows = await c.db.update<{ staging_path: string }>('agent_assets', { id: `in.(${discard.join(',')})`, status: 'eq.staged' }, { status: 'discarded' });
      await c.db.remove('agent-staging', rows.map((r) => r.staging_path)).catch(() => undefined);
      return Response.json({ ok: true, discarded: rows.length });
    }
    const ids = valid(b.ids);
    if (!ids.length) throw new HttpError(400, 'No images');
    const rows = await c.db.select<{ id: string; staging_path: string; status: string }>('agent_assets', { id: `in.(${ids.join(',')})`, select: 'id,source_url,page_url,staging_path,width,height,kind,status,attached_path,bytes' });
    const signed = await c.db.signed('agent-staging', rows.filter((a) => a.status === 'staged').map((a) => a.staging_path), 3600);
    return Response.json({ assets: rows.map((a) => ({ ...a, preview: signed[a.staging_path] ?? null })) });
  } catch (e) { return jsonError(e); }
}
