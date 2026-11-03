import { NextResponse } from 'next/server';
import { safeFetch, staffCheck } from '@/lib/admin/server';

export const maxDuration = 60;
const MAX = 80 * 1024 * 1024;

/** Fetches a PDF (e.g. a type specimen) for the dashboard, which turns its pages into presentation images in the browser. Streamed, so large files pass. */
export async function POST(request: Request) {
  const who = await staffCheck(request);
  if ('message' in who) return new NextResponse(who.message, { status: who.status });
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url) return new NextResponse('Missing url', { status: 400 });
  try {
    const res = await safeFetch(url, { headers: { accept: 'application/pdf,*/*' } }, 30000);
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!res.ok) return new NextResponse(`The PDF link answered ${res.status}`, { status: 502 });
    if (!type.includes('pdf') && !/\.pdf(\?|#|$)/i.test(new URL(res.url || url).pathname)) return new NextResponse('That link is not a PDF', { status: 415 });
    if (Number(res.headers.get('content-length') ?? 0) > MAX) return new NextResponse('PDF too large (over 80 MB)', { status: 413 });
    return new NextResponse(res.body, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  } catch {
    return new NextResponse('Could not fetch the PDF', { status: 502 });
  }
}
