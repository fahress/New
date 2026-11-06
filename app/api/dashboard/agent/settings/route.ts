import { agentContext, HttpError, integrations, jsonError } from '@/lib/agent/service';
import { gatewayJson } from '@/lib/agent/gateway';
import { settingsProblems, withDefaults, type AgentSettings } from '@/lib/agent/settings';

export const dynamic = 'force-dynamic';

/** Everything the settings page shows. Keys are never returned — only whether one is saved and its last four characters. */
export async function GET(request: Request) {
  try {
    const c = await agentContext(request, null);
    const [list, usage, log, errors] = await Promise.all([
      integrations(c.db).catch(() => []),
      c.db.rpc('agent_usage_summary').catch(() => null),
      c.perms.manage_settings || c.perms.manage_secrets ? c.db.select('agent_settings_log', { select: 'id,at,user_email,section,changes', order: 'at.desc', limit: 30 }).catch(() => []) : [],
      c.db.select('agent_usage', { ok: 'eq.false', select: 'at,provider,model,kind,error', order: 'at.desc', limit: 10 }).catch(() => []),
    ]);
    let gateway: { installed: boolean; version?: string; error?: string } = { installed: false };
    if (c.perms.use || c.perms.manage_settings) {
      try {
        const g = await gatewayJson<{ version?: string }>(c.staff.token, { action: 'status' }, AbortSignal.timeout(6000));
        gateway = { installed: true, version: g.version };
      } catch (e) {
        gateway = { installed: false, error: e instanceof Error ? e.message : 'unreachable' };
      }
    }
    return Response.json({
      settings: c.settings, version: c.version, perms: c.perms, role: c.role, gateway, usage, log, errors,
      integrations: list.map((i) => {
        const x = i as typeof i & { hint?: string; last_checked_at?: string; last_error?: string; updated_at?: string };
        return { provider: x.provider, configured: x.configured, hint: x.hint ?? null, status: x.status, last_checked_at: x.last_checked_at ?? null, last_error: x.last_error ?? null,
          models: (x.details?.models ?? []).slice(0, 1500), models_at: (x.details as { models_at?: string })?.models_at ?? null, probes: x.details?.probes ?? {} };
      }),
    });
  } catch (e) { return jsonError(e); }
}

/** Saves the settings after checking every value; the database checks the permission and the version. */
export async function PUT(request: Request) {
  try {
    const c = await agentContext(request, 'manage_settings');
    const b = (await request.json().catch(() => ({}))) as { settings?: AgentSettings; version?: number };
    if (!b.settings || typeof b.version !== 'number') throw new HttpError(400, 'Missing settings.');
    const next = withDefaults(b.settings);
    if (JSON.stringify(next) !== JSON.stringify(b.settings)) {
      // withDefaults dropped or fixed something: the request had unknown keys or values editors can't hold
      const extra = settingsProblems(b.settings as AgentSettings);
      if (extra.length) return Response.json({ error: 'Some settings aren’t valid.', problems: extra }, { status: 422 });
    }
    const problems = settingsProblems(next);
    if (problems.length) return Response.json({ error: 'Some settings aren’t valid.', problems }, { status: 422 });
    const r = await c.db.rpc<{ version: number; changed: string[] }>('agent_save_settings', { p_config: next, p_expected_version: b.version });
    return Response.json({ ok: true, ...r, settings: next });
  } catch (e) { return jsonError(e); }
}
