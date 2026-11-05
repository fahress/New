import { NextResponse } from 'next/server';
import { safeFetch, staffCheck } from '@/lib/admin/server';

export const maxDuration = 30;
const MAX = 15 * 1024 * 1024;

function sniff(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif';
  const head = new TextDecoder().decode(b).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

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
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX) return new NextResponse('Image too large', { status: 413 });
    // trust the file's own bytes: storage like Amazon S3 often labels images as "binary/octet-stream"
    const type = sniff(new Uint8Array(buf.slice(0, 512))) ?? (res.headers.get('content-type') ?? '').split(';')[0];
    if (!type.startsWith('image/')) return new NextResponse('Not an image', { status: 415 });
    return new NextResponse(buf, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch {
    return new NextResponse('Could not fetch image', { status: 502 });
  }
}
