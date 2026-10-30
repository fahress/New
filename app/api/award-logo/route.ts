import { NextResponse } from 'next/server';
import { safeFetch } from '@/lib/admin/server';
import data from '@/lib/admin/award-import.json';

/** Fetches one of the award logos listed in award-import.json (fixed addresses only), so the dashboard can upload it to Fahress storage. */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name');
  const logo = (data.programs as { name: string; logo?: string | null }[]).find((p) => p.name === name)?.logo;
  if (!logo) return new NextResponse('Unknown award', { status: 404 });
  try {
    const res = await safeFetch(logo, { headers: { accept: 'image/*' } }, 15000);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return new NextResponse('Not an image', { status: 415 });
    return new NextResponse(await res.arrayBuffer(), { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch {
    return new NextResponse('Could not fetch the logo', { status: 502 });
  }
}
