import 'server-only';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import { BOT_UA, checkUrl, safeFetch } from '@/lib/web/fetch';

export type Staff = { userId: string; email: string; role: 'admin' | 'editor'; token: string };

/**
 * Checks the caller is a signed-in member of the dashboard team (dashboard_roles).
 * Uses the caller's own login token — no secret keys on the server.
 */
export async function staffFrom(request: Request): Promise<Staff | null> {
  if (process.env.NEXT_PUBLIC_DASHBOARD_DEMO === '1' && process.env.FAHRESS_FIXTURE) return { userId: 'demo', email: 'demo@fahress', role: 'admin', token: '' };
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers, cache: 'no-store' });
  if (!user.ok) return null;
  const u = (await user.json()) as { id: string; email?: string };
  const role = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dashboard_role`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}', cache: 'no-store' });
  if (!role.ok) return null;
  const r = await role.json();
  if (r !== 'admin' && r !== 'editor') return null;
  return { userId: u.id, email: u.email ?? '', role: r, token };
}

/** Like staffFrom, but explains why someone was turned away. */
export async function staffCheck(request: Request): Promise<Staff | { status: number; message: string }> {
  const staff = await staffFrom(request);
  if (staff) return staff;
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { status: 401, message: 'You’re not signed in to the dashboard. Reload the page and sign in again.' };
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!user.ok) return { status: 401, message: 'Your dashboard sign-in has expired. Reload the page (or sign out and back in), then try again.' };
  const u = (await user.json()) as { email?: string };
  return { status: 403, message: `${u.email ?? 'This account'} isn’t on the dashboard team. Sign in with an admin or editor account.` };
}

/** Signed in at all (any Fahress account). */
export async function userFrom(request: Request): Promise<{ id: string } | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store' });
  return res.ok ? ((await res.json()) as { id: string }) : null;
}

/** Blocks requests to private / internal addresses so the fetch tools can't be pointed inside a network.
 *  The form of the link is checked here; the address the name resolves to is checked when connecting (lib/web/fetch.ts). */
export function safeExternalUrl(raw: string): URL | null {
  return checkUrl(raw);
}

/** fetch for other sites: checks every redirect and the resolved address, with one total time limit.
 *  Some stores (Payhip and others behind bot filters) refuse requests that name a bot: those get one retry with ordinary browser headers. */
export { safeFetch };

export const UA = BOT_UA;
