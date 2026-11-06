import { agentContext, HttpError, jsonError } from '@/lib/agent/service';
import { gatewayJson } from '@/lib/agent/gateway';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Save, replace, delete or test a provider key. The key passes through this request to the gateway,
 * which tests it and stores it in Supabase Vault. It is never logged, stored here, or sent back.
 */
export async function POST(request: Request) {
  try {
    const c = await agentContext(request, 'manage_secrets');
    const b = (await request.json().catch(() => ({}))) as { action?: string; provider?: string; key?: string };
    if (!['put', 'delete', 'test'].includes(String(b.action))) throw new HttpError(400, 'Unknown action');
    if (!['fireworks', 'openrouter', 'tavily'].includes(String(b.provider))) throw new HttpError(400, 'Unknown provider');
    const r = await gatewayJson<Record<string, unknown>>(c.staff.token, { action: `secret.${b.action}`, provider: b.provider, ...(b.action === 'put' ? { key: String(b.key ?? '') } : {}) });
    const { models: _m, ...rest } = r; // the model list is read from the database by the settings page
    void _m;
    return Response.json(rest);
  } catch (e) { return jsonError(e); }
}
