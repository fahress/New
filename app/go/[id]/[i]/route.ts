import { after, NextResponse } from 'next/server';
import { getArchive } from '@/lib/data';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|node-fetch|headless/i;

/** A font's "buy / download" button: counts the visit for the designer's stats, then sends the visitor to the store. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; i: string }> }) {
  const { id, i } = await params;
  const a = await getArchive();
  const f = a.fontById.get(id);
  const url = f?.purchaseLinks[Number(i)];
  if (!f || !url) return NextResponse.redirect(new URL(f ? `/fonts/${f.slug}` : '/fonts', request.url), 302);

  const ua = request.headers.get('user-agent') ?? '';
  if (!BOT.test(ua) && !process.env.FAHRESS_FIXTURE) {
    const ref = request.headers.get('referer');
    after(() =>
      fetch(`${SUPABASE_URL}/rest/v1/link_clicks`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ font_id: id, url, ref: ref ? new URL(ref).pathname.slice(0, 200) : null }),
      }).catch(() => undefined),
    );
  }
  const res = NextResponse.redirect(url, 302);
  res.headers.set('cache-control', 'no-store');
  res.headers.set('x-robots-tag', 'noindex');
  return res;
}
