import { NextResponse } from 'next/server';
import { safeFetch, staffCheck } from '@/lib/admin/server';
import { decode, rawJsonLd, readableText } from '@/lib/web/page';

export const maxDuration = 30;

/** Reads a font's page and returns its readable text — menus, headers, footers and scripts removed — for the dashboard to classify. */
export async function POST(request: Request) {
  const who = await staffCheck(request);
  if ('message' in who) return new NextResponse(who.message, { status: who.status });
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url) return new NextResponse('Missing url', { status: 400 });
  let res: Response;
  try {
    res = await safeFetch(url, { headers: { accept: 'text/html,application/xhtml+xml' } }, 12000);
  } catch (e) {
    return new NextResponse(`Couldn't open that page (${e instanceof Error ? e.message : 'error'}).`, { status: 502 });
  }
  if (!res.ok) return new NextResponse(`The site answered with an error (${res.status}).`, { status: 502 });
  const html = (await res.text()).slice(0, 3_000_000);
  const meta = (k: string) => decode(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)?.[1] ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i').exec(html)?.[1] ?? '');
  const title = meta('og:title') || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '');
  const description = meta('og:description') || meta('description');
  // structured data often carries the release date and family details
  const ld = rawJsonLd(html);
  const text = readableText(html);
  return NextResponse.json({ url: res.url || url, title: decode(title), description: decode(description), text: text.slice(0, 40000), ld });
}
