import { NextResponse } from 'next/server';
import { safeFetch, staffCheck } from '@/lib/admin/server';

export const maxDuration = 30;

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).trim();

function metas(html: string) {
  const out: Record<string, string[]> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const val = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && val) (out[key] ??= []).push(decode(val));
  }
  return out;
}

function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]);
      const list = Array.isArray(v) ? v : v['@graph'] ? v['@graph'] : [v];
      out.push(...list.filter((x: unknown) => x && typeof x === 'object'));
    } catch { /* ignore broken blocks */ }
  }
  return out;
}

const names = (v: unknown): string[] => {
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(names);
  if (typeof v === 'object' && v && 'name' in v) return names((v as { name: unknown }).name);
  return [];
};

function cleanTitle(t: string, host: string) {
  // "29LT Zawi - Multilingual Arabic & Latin Fonts - …" → "29LT Zawi"; "Ocean Brush Arabic Font | Webfont & Desktop" → "Ocean Brush Arabic"
  const first = t.split(/\s+[|–—·•:-]\s+/)[0]?.trim() || t;
  return first
    .replace(/\s*[|–—-]\s*(Behance|MyFonts|Fonts\.com|Creative Market|Envato.*|Dribbble|Instagram|Google Fonts|29LT|Linotype|Monotype).*$/i, '')
    .replace(/\s*(Fonts?|Typefaces?|Font Family|Typeface Family|Webfont.*)\s*$/i, '')
    .replace(/^(Download|Buy)\s+/i, '')
    .replace(new RegExp(`\\s*[|–—-]\\s*${host.split('.')[0]}.*$`, 'i'), '')
    .trim();
}

function images(html: string, base: URL, meta: Record<string, string[]>, ld: Record<string, unknown>[]) {
  const urls: string[] = [];
  const push = (u?: string) => {
    if (!u) return;
    try {
      const abs = new URL(decode(u), base).toString();
      if (/^data:/.test(abs) || /\.(svg|ico)(\?|$)/i.test(abs) || /(logo|icon|avatar|sprite|favicon|badge|emoji|pixel|tracking|placeholder|blank|banner|top_hat)/i.test(abs)) return;
      // MyFonts: only the font's own gallery (not site promos), at full size
      if (/myfonts\.com$/.test(base.hostname)) {
        if (!/cdn\.myfonts\.net\/.*\/images\/pim\//.test(abs)) return;
        urls.push(abs.replace(/width=\d+,height=\d+/, 'width=1600,height=1600'));
        return;
      }
      urls.push(abs);
    } catch { /* skip */ }
  };
  (meta['og:image'] ?? []).forEach(push);
  (meta['twitter:image'] ?? []).forEach(push);
  const imgOf = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(imgOf) : v && typeof v === 'object' && 'url' in v ? imgOf((v as { url: unknown }).url) : []);
  for (const x of ld) imgOf(x.image).forEach(push);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = /srcset\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (srcset) {
      const best = srcset.split(',').map((s) => s.trim().split(/\s+/)).sort((a, b) => parseInt(b[1] ?? '0') - parseInt(a[1] ?? '0'))[0]?.[0];
      push(best);
    } else push(/(?:data-src|src)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]);
  }
  // Behance stores the large versions under project_modules/<size>/
  const seen = new Set<string>();
  return urls
    .map((u) => u.replace(/\/project_modules\/(?:disp|max_632|max_1200|1400|fs)\//, '/project_modules/max_3840/'))
    .filter((u) => {
      const k = u.split('?')[0].split('/').pop() ?? u;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 24);
}

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
  if (!res.ok) return new NextResponse(`That page answered with an error (${res.status}). Some stores block automatic reading — fill it in by hand.`, { status: 502 });
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
