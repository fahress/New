import { NextResponse } from 'next/server';
import { safeFetch, staffCheck } from '@/lib/admin/server';
import { cleanTitle, decode, jsonLd, metas, names, pageImages as images } from '@/lib/web/page';

export const maxDuration = 30;

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
  if (!res.ok) return new NextResponse(`That page answered with an error (${res.status}). This store blocks automatic reading — use the “Add to Fahress” bookmark on the store page instead (see below the Fill in box).`, { status: 502 });
  const html = (await res.text()).slice(0, 3_000_000);
  const base = new URL(res.url || url);
  const meta = metas(html);
  const ld = jsonLd(html);
  const host = base.hostname.replace(/^www\./, '');

  const rawTitle = meta['og:title']?.[0] || names(ld.find((x) => x.name)?.name)[0] || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '');
  const description = meta['og:description']?.[0] || meta['description']?.[0] || '';
  const dates = [meta['article:published_time']?.[0], ...ld.map((x) => x.datePublished as string | undefined)].filter(Boolean) as string[];
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const stated = /(?:released?(?: date| in| on)?|release year|published(?: in| on)?|first published|launched(?: in)?)\s*[:\-–]?\s*(?:[A-Za-z]+\s+)?(?:\d{1,2},?\s+)?((?:19|20)\d\d)\b/i.exec(text)?.[1];
  const yearMatch = dates.map((d) => /(19|20)\d{2}/.exec(d)?.[0]).find(Boolean) ?? stated;

  const designers = new Set<string>();
  for (const x of ld) [...names(x.author), ...names(x.creator), ...names(x.designer)].forEach((n) => designers.add(n));
  (meta['author'] ?? []).forEach((n) => designers.add(n));
  for (const m of html.matchAll(/"owners"\s*:\s*\[([\s\S]{0,4000}?)\]/g)) for (const n of m[1].matchAll(/"display_name"\s*:\s*"([^"]+)"/g)) designers.add(decode(n[1]));

  return NextResponse.json({
    url: base.toString(),
    host,
    title: cleanTitle(decode(rawTitle), host),
    description: description.slice(0, 1200),
    year: yearMatch && Number(yearMatch) <= new Date().getFullYear() ? Number(yearMatch) : null,
    license: /fonts\.google\.com$/.test(host) || /\b(free for (personal and )?commercial use|free download|SIL Open Font License|OFL)\b/i.test(text.slice(0, 200000)) ? 'free' : null,
    designers: [...designers].filter((n) => n.length < 80).slice(0, 6),
    images: images(html, base, meta, ld),
  });
}
