import 'server-only';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

/**
 * Supabase REST, signed in as the dashboard user (their token), so row-level security decides
 * what every query may read or change. No service key exists on this server.
 */
export class DbError extends Error {
  constructor(message: string, public status = 500, public code?: string, public detail?: unknown) { super(message); }
}

/** Maps database error codes (including the agent's own AGxxx codes) to HTTP statuses and plain words. */
function fromPostgrest(status: number, body: string): DbError {
  let j: { message?: string; code?: string; details?: string; hint?: string } = {};
  try { j = JSON.parse(body); } catch { /* not JSON */ }
  const code = j.code ?? '';
  const msg = j.message || body.slice(0, 300) || `Database error (${status})`;
  // missing table / function / column: the agent's database update (supabase/agent-setup.sql) hasn't been run
  const missing = ['PGRST202', 'PGRST205', 'PGRST204', '42P01', '42883', '42703'].includes(code) || /schema cache/i.test(msg);
  const http = missing ? 503 : code === 'AG401' ? 401 : code === 'AG403' || code === '42501' ? 403 : code === 'AG404' ? 404 : code === 'AG409' ? 409
    : code === 'AG422' ? 422 : code === 'AG423' ? 423 : code === 'AG429' ? 429 : status;
  if (missing) return new DbError('The agent’s database update hasn’t been run yet (supabase/agent-setup.sql).', 503, 'not_installed', msg);
  const plain = code === '42501' ? `Your account isn’t allowed to do that. (${msg})` : msg;
  return new DbError(plain, http, code, j.details);
}

type Params = Record<string, string | number | undefined>;

export class Supa {
  constructor(public token: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${this.token}`, ...extra };
  }

  async rest<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init, cache: 'no-store',
      headers: this.headers({ 'content-type': 'application/json', ...(init.prefer ? { Prefer: init.prefer } : {}), ...(init.headers as Record<string, string> | undefined) }),
    });
    const text = await res.text();
    if (!res.ok) throw fromPostgrest(res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  select<T = Record<string, unknown>>(table: string, params: Params = {}): Promise<T[]> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    return this.rest<T[]>(`${table}?${q}`);
  }

  async one<T = Record<string, unknown>>(table: string, params: Params): Promise<T | null> {
    const rows = await this.select<T>(table, { ...params, limit: 1 });
    return rows[0] ?? null;
  }

  /** Reads a whole table in pages of 1000 in a fixed order (only the columns asked for). */
  async all<T = Record<string, unknown>>(table: string, select: string, order: string, filter: Params = {}): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; from < 50000; from += 1000) {
      const q = new URLSearchParams({ select, order });
      for (const [k, v] of Object.entries(filter)) if (v !== undefined) q.set(k, String(v));
      const rows = await this.rest<T[]>(`${table}?${q}`, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  insert<T = Record<string, unknown>>(table: string, rows: unknown, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): Promise<T[]> {
    const q = opts.onConflict ? `?on_conflict=${encodeURIComponent(opts.onConflict)}` : '';
    const prefer = ['return=representation', ...(opts.onConflict ? [opts.ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates'] : [])].join(',');
    return this.rest<T[]>(`${table}${q}`, { method: 'POST', body: JSON.stringify(rows), prefer });
  }

  update<T = Record<string, unknown>>(table: string, filter: Params, values: unknown): Promise<T[]> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v !== undefined) q.set(k, String(v));
    return this.rest<T[]>(`${table}?${q}`, { method: 'PATCH', body: JSON.stringify(values), prefer: 'return=representation' });
  }

  delete(table: string, filter: Params): Promise<unknown> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v !== undefined) q.set(k, String(v));
    return this.rest(`${table}?${q}`, { method: 'DELETE', prefer: 'return=minimal' });
  }

  rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.rest<T>(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  }

  /* ---------- storage ---------- */
  async upload(bucket: string, path: string, body: Uint8Array, type: string): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', headers: this.headers({ 'content-type': type, 'x-upsert': 'false', 'cache-control': '31536000' }), body: body as unknown as BodyInit, cache: 'no-store',
    });
    if (!res.ok) throw new DbError(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`, res.status === 403 ? 403 : 502);
  }

  async download(bucket: string, path: string): Promise<{ bytes: Uint8Array; type: string }> {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: this.headers(), cache: 'no-store' });
    if (!res.ok) throw new DbError(`Couldn’t read the staged image (${res.status}).`, res.status === 404 ? 404 : 502);
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: paths }), cache: 'no-store' });
  }

  /** Short-lived links to private staged images, for the chat to show them. */
  async signed(bucket: string, paths: string[], seconds = 3600): Promise<Record<string, string>> {
    if (!paths.length) return {};
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}`, {
      method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds, paths }), cache: 'no-store',
    });
    if (!res.ok) return {};
    const list = (await res.json()) as { path: string; signedURL?: string; error?: string | null }[];
    return Object.fromEntries(list.filter((x) => x.signedURL).map((x) => [x.path, `${SUPABASE_URL}/storage/v1${x.signedURL}`]));
  }
}

export const publicImage = (path: string) => (/^https?:/.test(path) ? path : `${SUPABASE_URL}/storage/v1/object/public/studio/${path.split('/').map(encodeURIComponent).join('/')}`);
