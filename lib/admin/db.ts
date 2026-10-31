'use client';
import { BUCKET, DEMO, supabase } from './client';

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Match = Record<string, string | number>;

export class DbError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

function explain(err: { message: string; code?: string } | null, action: string): never {
  const msg = err?.message ?? 'Unknown error';
  if (err?.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    throw new DbError(`Your account isn't allowed to ${action}. (The database refused: ${msg})`, '42501');
  }
  throw new DbError(`Couldn't ${action}: ${msg}`, err?.code);
}

/* ---------- demo store (local testing only) ---------- */
let demo: Record<string, Row[]> | null = null;
async function demoTables() {
  if (!demo) demo = await (await fetch('/api/dashboard-demo')).json();
  return demo!;
}
const matches = (r: Row, m: Match) => Object.entries(m).every(([k, v]) => String(r[k]) === String(v));

/* ---------- public API ---------- */
/** Stable sort for paged reads: link tables have no id column, so they sort by their two keys. */
const ORDER: Record<string, [string, string?]> = {
  font_scripts: ['font_id', 'script_id'], font_genres: ['font_id', 'genre_id'], font_styles: ['font_id', 'style_id'], font_types: ['font_id', 'type_id'],
  font_designers: ['font_id', 'designer_id'], font_awards: ['font_id', 'award_id'], font_languages: ['font_id', 'lang_id'],
};

export const db = {
  async all(table: string, select = '*'): Promise<Row[]> {
    if (DEMO) return structuredClone((await demoTables())[table] ?? []);
    const out: Row[] = [];
    // Read in pages of 1000 in a fixed order — without one, the database may return pages that
    // overlap or skip rows, and the dashboard then thinks a link is missing when it isn't.
    const [first, second] = ORDER[table] ?? ['id'];
    for (let from = 0; ; from += 1000) {
      let q = supabase().from(table).select(select).order(first);
      if (second) q = q.order(second);
      const { data, error } = await q.range(from, from + 999);
      if (error) explain(error, `read ${table}`);
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  },

  async insert(table: string, rows: Row | Row[]): Promise<Row[]> {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return [];
    if (DEMO) {
      const t = ((await demoTables())[table] ??= []);
      const made = list.map((r) => ({ id: r.id ?? (table.startsWith('font_') ? undefined : crypto.randomUUID()), created_at: new Date().toISOString(), ...r }));
      t.push(...made);
      return made;
    }
    // fonts.user_id is required: record the signed-in staff member as the one who added it
    if (table === 'fonts' && list.some((r) => !r.user_id)) {
      const { data: u } = await supabase().auth.getUser();
      if (u.user) for (const r of list) r.user_id ??= u.user.id;
    }
    const { data, error } = await supabase().from(table).insert(list).select();
    if (error) explain(error, `add to ${table}`);
    return (data ?? []) as Row[];
  },

  async update(table: string, match: Match, values: Row): Promise<void> {
    if (DEMO) {
      for (const r of (await demoTables())[table] ?? []) if (matches(r, match)) Object.assign(r, values);
      return;
    }
    let q = supabase().from(table).update(values);
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    const { data, error } = await q.select();
    if (error) explain(error, `save ${table}`);
    if (!data?.length) throw new DbError(`Nothing was saved to ${table} — your account may not be allowed to edit it.`, '42501');
  },

  async remove(table: string, match: Match): Promise<void> {
    if (DEMO) {
      const t = (await demoTables())[table] ?? [];
      (await demoTables())[table] = t.filter((r) => !matches(r, match));
      return;
    }
    let q = supabase().from(table).delete();
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    const { error } = await q;
    if (error) explain(error, `remove from ${table}`);
  },

  /** Reads a table that may not exist yet (added by the dashboard database update). Returns null instead of failing. */
  async maybe(table: string, select = '*', opts: { order?: string; limit?: number } = {}): Promise<Row[] | null> {
    if (DEMO) return (await demoTables())[table] ? structuredClone((await demoTables())[table]) : null;
    let q = supabase().from(table).select(select);
    if (opts.order) q = q.order(opts.order, { ascending: false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) return null;
    return (data ?? []) as Row[];
  },

  /** Adds font ↔ tag / designer links, skipping any that already exist. */
  async link(table: string, rows: Row[]): Promise<void> {
    if (!rows.length) return;
    const key = ORDER[table]?.[1];
    if (DEMO || !key) { await db.insert(table, rows); return; }
    const { error } = await supabase().from(table).upsert(rows, { onConflict: `font_id,${key}`, ignoreDuplicates: true });
    if (error) explain(error, `add to ${table}`);
  },

  async upsert(table: string, rows: Row[], onConflict: string): Promise<void> {
    if (!rows.length) return;
    if (DEMO) {
      const t = ((await demoTables())[table] ??= []);
      for (const r of rows) {
        const i = t.findIndex((x) => String(x[onConflict]) === String(r[onConflict]));
        if (i >= 0) t[i] = { ...t[i], ...r }; else t.push(r);
      }
      return;
    }
    const { error } = await supabase().from(table).upsert(rows, { onConflict });
    if (error) explain(error, `save ${table}`);
  },

  async rpc<T = unknown>(fn: string, args: Row = {}): Promise<T | null> {
    if (DEMO) return null;
    const { data, error } = await supabase().rpc(fn, args);
    if (error) return null;
    return data as T;
  },

  /** Records a change in the activity history (if the history table exists). Never blocks a save. */
  async log(entry: { action: string; entity: string; entity_id?: string; label?: string; before?: unknown; after?: unknown }): Promise<void> {
    try {
      if (DEMO) { ((await demoTables()).activity_log ??= []).unshift({ id: Date.now(), at: new Date().toISOString(), user_email: 'demo@fahress', ...entry }); return; }
      const { data } = await supabase().auth.getUser();
      await supabase().from('activity_log').insert({ ...entry, user_id: data.user?.id, user_email: data.user?.email ?? null });
    } catch { /* history is best-effort */ }
  },

  /** Authorised call to one of the site's own dashboard API routes. */
  /** A fresh sign-in token for the site's own server routes (renewed if it's about to run out). */
  async token(force = false): Promise<string> {
    if (DEMO) return '';
    const sb = supabase();
    let { data: { session } } = await sb.auth.getSession();
    if (session && (force || (session.expires_at ?? 0) * 1000 - Date.now() < 120_000)) {
      const r = await sb.auth.refreshSession();
      if (r.data.session) session = r.data.session;
    }
    return session?.access_token ?? '';
  },

  async api<T = unknown>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const send = async (token: string) => fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let res = await send(await db.token());
    if (res.status === 401 && !DEMO) res = await send(await db.token(true));
    if (!res.ok) throw new DbError((await res.text().catch(() => '')) || `Request failed (${res.status})`);
    return (await res.json()) as T;
  },

  /** Uploads an image to the studio bucket in the same folder layout the site already uses (YYYY-MM-DD/timestamp-name). */
  async upload(file: File): Promise<string> {
    const day = new Date().toISOString().slice(0, 10);
    const clean = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').slice(-80);
    const path = `${day}/${Date.now()}-${clean}`;
    if (DEMO) {
      demoUrls.set(path, URL.createObjectURL(file));
      return path;
    }
    const { error } = await supabase().storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) explain({ message: error.message }, 'upload the image');
    return path;
  },

  /** Asks the public site to drop its cached copy so changes show right away. */
  async refreshSite(): Promise<void> {
    if (DEMO) return;
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch('/api/revalidate', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  },
};

/** Object URLs for images uploaded in demo mode. */
export const demoUrls = new Map<string, string>();
