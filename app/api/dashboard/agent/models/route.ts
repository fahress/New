import { agentContext, HttpError, jsonError } from '@/lib/agent/service';
import { gatewayJson } from '@/lib/agent/gateway';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/** Checks that a model really streams and calls tools (a tiny request of a few tokens). The result is kept for the settings page and the agent. */
export async function POST(request: Request) {
  try {
    const c = await agentContext(request, 'manage_settings');
    const b = (await request.json().catch(() => ({}))) as { provider?: string; model?: string };
    if (!['fireworks', 'openrouter'].includes(String(b.provider))) throw new HttpError(400, 'Unknown provider');
    if (!b.model || typeof b.model !== 'string' || b.model.length > 200) throw new HttpError(400, 'Choose a model');
    return Response.json(await gatewayJson(c.staff.token, { action: 'models.probe', provider: b.provider, model: b.model }));
  } catch (e) { return jsonError(e); }
}
