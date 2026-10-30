'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { db } from './db';

export type MailStatus = {
  configured?: boolean; allowed?: boolean; needsUpdate?: boolean; connected?: boolean;
  email?: string; unread?: number; problem?: string;
};
export type ThreadSummary = { id: string; subject: string; from: string; to: string; date: number; snippet: string; unread: boolean; inbox: boolean; count: number; attachments: boolean };
export type MailMessage = {
  id: string; from: string; to: string; cc: string; replyTo: string; subject: string; date: number;
  messageId: string; references: string; sent: boolean; unread: boolean; text: string; html: string;
  attachments: { id: string; name: string; type: string; size: number }[];
};

export async function mail<T = { ok: true }>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    return await db.api<T>('/api/dashboard/gmail', { action, ...body });
  } catch (e) {
    // the route answers errors as JSON — show just the message
    const raw = e instanceof Error ? e.message : String(e);
    let msg = raw;
    try { msg = (JSON.parse(raw) as { error?: string }).error || raw; } catch { /* plain text */ }
    throw new Error(msg);
  }
}

/* ---------- shared status (sidebar badge + Inbox) ---------- */
let status: MailStatus | null = null;
const subs = new Set<() => void>();
let inflight: Promise<void> | null = null;

export function refreshMailStatus() {
  inflight ??= mail<MailStatus>('status')
    .then((s) => { status = s; })
    .catch(() => { status = status ?? {}; })
    .finally(() => { inflight = null; subs.forEach((f) => f()); });
  return inflight;
}

export function useMailStatus(pollMs = 120_000) {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => status, () => null);
  useEffect(() => {
    if (!status) refreshMailStatus();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshMailStatus(); }, pollMs);
    return () => clearInterval(t);
  }, [pollMs]);
  return s;
}

/* ---------- small helpers ---------- */
export const nameOf = (addr: string) => {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(addr);
  return (m ? m[1] || m[2] : addr).trim() || addr;
};
export const emailOf = (addr: string) => (/<([^>]+)>/.exec(addr)?.[1] ?? addr).trim();

export function when(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,head').forEach((n) => n.remove());
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,tr,li,h1,h2,h3').forEach((n) => n.append('\n'));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function quote(m: { date: number; from: string; text: string; html: string }) {
  const body = (m.text || htmlToText(m.html)).trim().slice(0, 6000);
  if (!body) return '';
  return `\n\nOn ${new Date(m.date).toLocaleString()}, ${m.from} wrote:\n${body.split('\n').map((l) => `> ${l}`).join('\n')}`;
}

export function download(name: string, type: string, base64url: string) {
  const bin = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
