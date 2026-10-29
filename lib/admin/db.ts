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
export const db = {
  async all(table: string, select = '*'): Promise<Row[]> {
    if (DEMO) return structuredClone((await demoTables())[table] ?? []);
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase().from(table).select(select).range(from, from + 999);
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
