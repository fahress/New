'use client';
import { db } from '@/lib/admin/db';
import type { StreamEvent } from '@/lib/agent/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public body?: Record<string, unknown>) { super(message); }
}

/** JSON call to the agent's API with the dashboard sign-in (renewed when it's about to run out). */
export async function agentApi<T = Record<string, unknown>>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const send = async (force: boolean) => fetch(`/api/dashboard/agent/${path}`, {
    method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${await db.token(force)}` }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(j.error ?? j.message ?? `Request failed (${res.status})`), res.status, j.code as string | undefined, j);
  return j as T;
}

export type ChatBody = { conversation_id?: string; content?: string; client_request_id: string; edit_of?: string; regenerate_of?: string; context?: { type: string; id: string } };

/** Sends a message and reads the streamed reply. Returns the JSON answer instead when the request is already running. */
export async function streamChat(body: ChatBody, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<{ state: 'streamed' } | { state: 'running' | 'done'; conversation_id: string; run_id: string; assistant_message_id: string | null }> {
  const res = await fetch('/api/dashboard/agent/chat', {
    method: 'POST', signal, cache: 'no-store',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${await db.token()}` }, body: JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(String(j.error ?? `Request failed (${res.status})`), res.status, j.code as string | undefined, j);
    return j as never;
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent); } catch { /* skip */ }
    }
  }
  return { state: 'streamed' };
}

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
