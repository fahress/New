import { NextResponse } from 'next/server';
import { safeFetch, staffFrom } from '@/lib/admin/server';

export const maxDuration = 60;

type Result = { url: string; status: number; ok: boolean; verdict: 'ok' | 'broken' | 'unknown'; error?: string };

/** 404/410 or a dead domain = broken. Stores that block robots (403/429/5xx) are "couldn't check", not broken. */
async function check(url: string): Promise<Result> {
  try {
    let res = await safeFetch(url, { method: 'HEAD' }, 9000);
    if (res.status === 405 || res.status === 403 || res.status === 400 || res.status === 501) res = await safeFetch(url, { method: 'GET', headers: { range: 'bytes=0-2048' } }, 9000);
    const s = res.status;
    const verdict = s < 400 ? 'ok' : s === 404 || s === 410 ? 'broken' : 'unknown';
    return { url, status: s, ok: verdict === 'ok', verdict };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    const dead = /ENOTFOUND|EAI_AGAIN|getaddrinfo|Blocked address|Invalid URL/i.test(String((e as { cause?: unknown })?.cause ?? msg)) || /Blocked/.test(msg);
    return { url, status: 0, ok: false, verdict: dead ? 'broken' : 'unknown', error: msg };
  }
}

export async function POST(request: Request) {
  if (!(await staffFrom(request))) return new NextResponse('Only the dashboard team can use this.', { status: 401 });
  const { urls } = (await request.json().catch(() => ({}))) as { urls?: string[] };
  const list = [...new Set((urls ?? []).filter((u) => typeof u === 'string'))].slice(0, 25);
  const results = await Promise.all(list.map(check));
  return NextResponse.json({ results });
}
