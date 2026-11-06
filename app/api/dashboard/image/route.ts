import { NextResponse } from 'next/server';
import { safeFetch, staffCheck } from '@/lib/admin/server';
import { readCapped } from '@/lib/web/fetch';
import { sniff } from '@/lib/web/image';

export const maxDuration = 30;
const MAX = 15 * 1024 * 1024;

/** Fetches an image from another site for the dashboard, so it can be re-uploaded to Fahress storage. */
export async function POST(request: Request) {
  const who = await staffCheck(request);
  if ('message' in who) return new NextResponse(who.message, { status: who.status });
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url) return new NextResponse('Missing url', { status: 400 });
  try {
    const res = await safeFetch(url, { headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' } }, 15000);
    if (!res.ok) return new NextResponse(`The image address answered ${res.status}`, { status: 502 });
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX) return new NextResponse('Image too large', { status: 413 });
    const { bytes, truncated } = await readCapped(res, MAX);
    if (truncated) return new NextResponse('Image too large', { status: 413 });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    // trust the file's own bytes: storage like Amazon S3 often labels images as "binary/octet-stream"
    const type = sniff(new Uint8Array(buf.slice(0, 512))) ?? (res.headers.get('content-type') ?? '').split(';')[0];
    if (!type.startsWith('image/')) return new NextResponse('Not an image', { status: 415 });
    return new NextResponse(buf, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch {
    return new NextResponse('Could not fetch image', { status: 502 });
  }
}
