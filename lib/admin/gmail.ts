import 'server-only';
import crypto from 'node:crypto';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import type { Staff } from './server';

/**
 * Gmail inside the dashboard.
 * - The admin signs in with Google once; the long-lived Google token is encrypted with
 *   MAIL_TOKEN_SECRET (server only) and kept in the admin-only `mail_account` table.
 * - Every request uses the caller's own Supabase login, so no Supabase secret key is needed.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const SECRET = process.env.MAIL_TOKEN_SECRET ?? '';
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'openid', 'email'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me/';

export const gmailConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET && SECRET.length >= 16);

export class MailError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}

/* ---------- small crypto helpers ---------- */
const key = () => crypto.createHash('sha256').update(SECRET).digest();

export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function unseal<T>(s: string | undefined | null): T | null {
  if (!s) return null;
  try {
    const raw = Buffer.from(s, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function sign(value: unknown): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', key()).update(body).digest('base64url')}`;
}

export function verify<T>(s: string | null): T | null {
  if (!s) return null;
  const [body, mac] = s.split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', key()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
}

/* ---------- Google sign-in ---------- */
export const redirectUri = (origin: string) => `${origin}/api/dashboard/gmail/callback`;

export function authUrl(origin: string, state: string, hint?: string) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(origin), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  if (hint) p.set('login_hint', hint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }), cache: 'no-store',
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    if (j.error === 'invalid_grant') throw new MailError('Gmail access has expired or was removed. Connect Gmail again.', 401, 'reconnect');
    throw new MailError(`Google sign-in failed: ${j.error_description || j.error || res.status}`, 502);
  }
  return j as { access_token: string; refresh_token?: string; expires_in?: number };
}

export const exchangeCode = (code: string, origin: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(origin) });

const cache = new Map<string, { token: string; exp: number }>();
async function accessToken(refresh: string) {
  const k = crypto.createHash('sha256').update(refresh).digest('hex');
  const hit = cache.get(k);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
  cache.set(k, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

export async function revoke(refresh: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => null);
}

/* ---------- the stored account (Supabase, with the caller's own login) ---------- */
async function rest(staff: Staff, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init, cache: 'no-store',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${staff.token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

export type Account = { email: string; refresh: string };

/** 'no-table' = the Messages database update hasn't been run yet. */
export async function loadAccount(staff: Staff): Promise<Account | 'none' | 'no-table'> {
  const res = await rest(staff, 'mail_account?select=email,token&id=eq.1');
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 404 || /42P01|does not exist|schema cache/i.test(t)) return 'no-table';
    throw new MailError(`Couldn't read the mail settings: ${t}`, 500);
  }
  const rows = (await res.json()) as { email: string; token: string }[];
  if (!rows.length) return 'none';
  const tok = unseal<{ r: string }>(rows[0].token);
  if (!tok?.r) throw new MailError('The saved Gmail sign-in can’t be read (MAIL_TOKEN_SECRET changed?). Connect Gmail again.', 401, 'reconnect');
  return { email: rows[0].email, refresh: tok.r };
}

export async function saveAccount(staff: Staff, email: string, refresh: string) {
  const res = await rest(staff, 'mail_account?on_conflict=id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, email, token: seal({ r: refresh }), connected_by: staff.userId, connected_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new MailError(`Couldn't save the Gmail connection: ${await res.text()}`, 500);
}

export async function deleteAccount(staff: Staff) {
  const res = await rest(staff, 'mail_account?id=eq.1', { method: 'DELETE' });
  if (!res.ok) throw new MailError(`Couldn't disconnect: ${await res.text()}`, 500);
}

/* ---------- Gmail API ---------- */
export class Gmail {
  constructor(private refresh: string, public email: string) {}

  async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(API + path, {
      ...init, cache: 'no-store',
      headers: { Authorization: `Bearer ${await accessToken(this.refresh)}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 401 || res.status === 403) throw new MailError(`Gmail refused the request — try connecting Gmail again. (${t.slice(0, 200)})`, 401, 'reconnect');
      throw new MailError(`Gmail error ${res.status}: ${t.slice(0, 300)}`, 502);
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  async profile() {
    return this.call<{ emailAddress: string }>('profile');
  }

  async unread() {
    const l = await this.call<{ threadsUnread?: number }>('labels/INBOX');
    return l.threadsUnread ?? 0;
  }

  async list(q: string, pageToken?: string) {
    const p = new URLSearchParams({ maxResults: '20', q });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await this.call<{ threads?: { id: string; snippet: string }[]; nextPageToken?: string }>(`threads?${p}`);
    const threads = await Promise.all((r.threads ?? []).map(async (t) => {
      const full = await this.call<GThread>(`threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      const msgs = full.messages ?? [];
      const first = msgs[0];
      const last = msgs[msgs.length - 1];
      const incoming = [...msgs].reverse().find((m) => !(m.labelIds ?? []).includes('SENT')) ?? last;
      return {
        id: t.id,
        subject: header(first, 'Subject') || '(no subject)',
        from: header(incoming, 'From'),
        to: header(incoming, 'To'),
        date: Number(last?.internalDate ?? 0),
        snippet: decodeEntities(last?.snippet ?? t.snippet ?? ''),
        unread: msgs.some((m) => (m.labelIds ?? []).includes('UNREAD')),
        inbox: msgs.some((m) => (m.labelIds ?? []).includes('INBOX')),
        count: msgs.length,
        attachments: msgs.some((m) => hasAttachment(m.payload)),
      };
    }));
    return { threads, nextPageToken: r.nextPageToken ?? null };
  }

  async thread(id: string) {
    const t = await this.call<GThread>(`threads/${encodeURIComponent(id)}?format=full`);
    const messages = [];
    for (const m of t.messages ?? []) {
      const out: Parsed = { text: '', html: '', attachments: [], inline: [] };
      if (m.payload) walk(m.payload, out);
      let html = out.html;
      // show pictures embedded in the email (cid:) — up to ~3 MB per message
      let budget = 3_000_000;
      for (const im of out.inline) {
        if (!html.includes(`cid:${im.cid}`) || im.size > budget) continue;
        budget -= im.size;
        const a = await this.call<{ data: string }>(`messages/${m.id}/attachments/${im.attachmentId}`).catch(() => null);
        if (a?.data) html = html.split(`cid:${im.cid}`).join(`data:${im.type};base64,${Buffer.from(a.data, 'base64url').toString('base64')}`);
      }
      messages.push({
        id: m.id,
        from: header(m, 'From'), to: header(m, 'To'), cc: header(m, 'Cc'), replyTo: header(m, 'Reply-To'),
        subject: header(m, 'Subject'), date: Number(m.internalDate ?? 0),
        messageId: header(m, 'Message-ID') || header(m, 'Message-Id'), references: header(m, 'References'),
        sent: (m.labelIds ?? []).includes('SENT'), unread: (m.labelIds ?? []).includes('UNREAD'),
        text: out.text, html, attachments: out.attachments,
      });
    }
    return { id: t.id, messages };
  }

  attachment(messageId: string, attachmentId: string) {
    return this.call<{ data: string; size: number }>(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  }

  modify(id: string, add: string[], remove: string[]) {
    return this.call(`threads/${encodeURIComponent(id)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
  }

  trash(id: string) {
    return this.call(`threads/${encodeURIComponent(id)}/trash`, { method: 'POST' });
  }

  async send(m: { to: string; cc?: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string }) {
    const raw = buildMime({ from: this.email, ...m });
    return this.call<{ id: string; threadId: string }>('messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(m.threadId ? { threadId: m.threadId } : {}) }) });
  }
}

/* ---------- parsing ---------- */
type GPart = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GPart[] };
type GMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GPart };
type GThread = { id: string; messages?: GMessage[] };
type Parsed = { text: string; html: string; attachments: { id: string; name: string; type: string; size: number }[]; inline: { cid: string; attachmentId: string; type: string; size: number }[] };

const header = (m: GMessage | undefined, name: string) =>
  m?.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
const partHeader = (p: GPart, name: string) => p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

function hasAttachment(p?: GPart): boolean {
  if (!p) return false;
  if (p.filename && p.body?.attachmentId) return true;
  return (p.parts ?? []).some(hasAttachment);
}

function decodeBody(p: GPart) {
  const buf = Buffer.from(p.body?.data ?? '', 'base64url');
  const cs = /charset="?([\w.:-]+)"?/i.exec(partHeader(p, 'Content-Type'))?.[1] ?? 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
}

function walk(p: GPart, out: Parsed) {
  if (p.parts?.length) { for (const c of p.parts) walk(c, out); return; }
  const type = (p.mimeType ?? '').toLowerCase();
  const cid = partHeader(p, 'Content-ID').replace(/[<>]/g, '');
  if (p.body?.attachmentId) {
    if (cid && type.startsWith('image/')) out.inline.push({ cid, attachmentId: p.body.attachmentId, type, size: p.body.size ?? 0 });
    if (p.filename) out.attachments.push({ id: p.body.attachmentId, name: p.filename, type, size: p.body.size ?? 0 });
    return;
  }
  if (type === 'text/plain' && !out.text) out.text = decodeBody(p);
  else if (type === 'text/html' && !out.html) out.html = decodeBody(p);
}

function decodeEntities(s: string) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
}

/* ---------- writing ---------- */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

/** "Name <a@b.c>, d@e.f" → encodes non-English names so Arabic names survive. */
function addresses(list: string) {
  return oneLine(list).split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
    const m = /^(.*)<([^>]+)>$/.exec(a);
    if (!m) return a;
    const name = m[1].trim().replace(/^"|"$/g, '');
    return name ? `${word(name)} <${m[2].trim()}>` : `<${m[2].trim()}>`;
  }).join(', ');
}

export function validAddresses(list: string) {
  const parts = oneLine(list).split(',').map((a) => a.trim()).filter(Boolean);
  return parts.length > 0 && parts.length <= 50 && parts.every((a) => /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/.test(a));
}

function buildMime(m: { from: string; to: string; cc?: string; subject: string; body: string; inReplyTo?: string; references?: string }) {
  const headers = [
    `From: ${addresses(m.from)}`,
    `To: ${addresses(m.to)}`,
    m.cc ? `Cc: ${addresses(m.cc)}` : '',
    `Subject: ${word(oneLine(m.subject))}`,
    m.inReplyTo ? `In-Reply-To: ${oneLine(m.inReplyTo)}` : '',
    m.references || m.inReplyTo ? `References: ${oneLine([m.references, m.inReplyTo].filter(Boolean).join(' '))}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const body = Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}
