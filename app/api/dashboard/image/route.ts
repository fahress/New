import { NextResponse } from 'next/server';
import { safeFetch, staffFrom } from '@/lib/admin/server';

export const maxDuration = 30;
const MAX = 15 * 1024 * 1024;

/** Fetches an image from another site for the dashboard, so it can be re-uploaded to Fahress storage. */
export async function POST(request: Request) {
  if (!(await staffFrom(request))) return new NextResponse('Only the dashboard team can use this.', { status: 401 });
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url) return new NextResponse('Missing url', { status: 400 });
  try {
    const res = await safeFetch(url, { headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' } }, 15000);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return new NextResponse('Not an image', { status: 415 });
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX) return new NextResponse('Image too large', { status: 413 });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX) return new NextResponse('Image too large', { status: 413 });
    return new NextResponse(buf, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch {
    return new NextResponse('Could not fetch image', { status: 502 });
  }
}
