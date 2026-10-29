import 'server-only';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

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

/** Signed in at all (any Fahress account). */
export async function userFrom(request: Request): Promise<{ id: string } | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, cache: 'no-store' });
  return res.ok ? ((await res.json()) as { id: string }) : null;
}

/** Blocks requests to private / internal addresses so the fetch tools can't be pointed inside a network. */
export function safeExternalUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' || h.startsWith('[')) return null;
  if (/^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^\d+$/.test(h)) return null;
  return u;
}

/** fetch that re-checks every redirect hop against safeExternalUrl, with a timeout. */
export async function safeFetch(raw: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  let url = safeExternalUrl(raw);
  for (let hop = 0; hop < 6; hop++) {
    if (!url) throw new Error('Blocked address');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, redirect: 'manual', signal: ctrl.signal, cache: 'no-store', headers: { 'user-agent': UA, accept: '*/*', ...(init.headers ?? {}) } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { url = safeExternalUrl(new URL(loc, url).toString()); continue; }
      return res;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error('Too many redirects');
}

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 FahressBot/1.0 (+https://fahress.com)';
