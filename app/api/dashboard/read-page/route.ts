import { NextResponse } from 'next/server';
import { safeFetch, staffCheck } from '@/lib/admin/server';

export const maxDuration = 30;

const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

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
  let html = (await res.text()).slice(0, 3_000_000);
  const meta = (k: string) => decode(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)?.[1] ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i').exec(html)?.[1] ?? '');
  const title = meta('og:title') || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '');
  const description = meta('og:description') || meta('description');
  // structured data often carries the release date and family details
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ').slice(0, 20000);
  // keep the main content when the page marks it
  const main = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0];
  if (main && main.length > 2000) html = main;
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe|form|select)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|dd|dt)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return NextResponse.json({ url: res.url || url, title: decode(title), description: decode(description), text: text.slice(0, 40000), ld });
}
