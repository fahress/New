import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

/** Called by the dashboard after a save: refreshes the site's cached data. Only signed-in editors can call it. */
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ ok: false }, { status: 401 });
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ ok: false }, { status: 401 });
  revalidateTag('fahress', { expire: 0 });
  return NextResponse.json({ ok: true });
}
