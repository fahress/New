/**
 * Reading other sites' HTML: meta tags, structured data, readable text, images and dates.
 * Shared by the dashboard's "Fill from a link" tools and the agent. Everything here treats the page as data.
 */

export const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => safeChar(Number(d))).trim();
const safeChar = (n: number) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

export function metas(html: string) {
  const out: Record<string, string[]> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const val = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && val) (out[key] ??= []).push(decode(val));
  }
  return out;
}

export function jsonLd(html: string): Record<string, unknown>[] {
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

export const names = (v: unknown): string[] => {
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(names);
  if (typeof v === 'object' && v && 'name' in v) return names((v as { name: unknown }).name);
  return [];
};

export function cleanTitle(t: string, host: string) {
  // "29LT Zawi - Multilingual Arabic & Latin Fonts - …" → "29LT Zawi"; "Ocean Brush Arabic Font | Webfont & Desktop" → "Ocean Brush Arabic"
  const first = t.split(/\s+[|–—·•:-]\s+/)[0]?.trim() || t;
  return first
    .replace(/\s*[|–—-]\s*(Behance|MyFonts|Fonts\.com|Creative Market|Envato.*|Dribbble|Instagram|Google Fonts|29LT|Linotype|Monotype).*$/i, '')
    .replace(/\s*(Fonts?|Typefaces?|Font Family|Typeface Family|Webfont.*)\s*$/i, '')
    .replace(/^(Download|Buy)\s+/i, '')
    .replace(new RegExp(`\\s*[|–—-]\\s*${host.split('.')[0]}.*$`, 'i'), '')
    .trim();
}

export function pageImages(html: string, base: URL, meta: Record<string, string[]>, ld: Record<string, unknown>[]) {
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
  // Sellfy stores: the product's own gallery is marked itemprop="image"; the rest are other products' thumbnails
  // (the gallery is sent as data in window.GLOBALS.gallery and drawn by script; the <img> tags in the page are other products)
  if (/\.sellfy\.store$/.test(base.hostname)) {
    const start = html.indexOf('window.GLOBALS.gallery');
    const block = start >= 0 ? html.slice(start, html.indexOf('</script>', start)) : '';
    const own = [...new Set([...block.matchAll(/https:\/\/media\.sellfy\.store\/images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|gif|webp)/gi)].map((m) => m[0]))];
    if (own.length) return own.slice(0, 24); // originals, without the ?w= resize
  }
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


/** The page's readable text: menus, headers, footers, scripts and forms removed. Prefers <main>/<article> when the page marks it. */
export function readableText(html: string): string {
  let body = html;
  const main = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0];
  if (main && main.length > 2000) body = main;
  return decode(
    body
      .replace(/<(script|style|noscript|svg|template|iframe|form|select)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|dd|dt)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Raw JSON-LD text (for the classifier, which looks for dates in it). */
export const rawJsonLd = (html: string) => [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ').slice(0, 20000);

/** Links to PDF files on the page (specimens). */
export function pdfLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+\.pdf(?:[?#][^"']*)?)["']/gi)) {
    try { out.add(new URL(decode(m[1]), base).toString()); } catch { /* skip */ }
  }
  return [...out].slice(0, 10);
}

/** Outgoing links with their text (for finding official sites, profiles and shops). */
export function pageLinks(html: string, base: URL): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    try {
      const u = new URL(decode(m[1]), base);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      const key = u.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: key, text: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 80) });
    } catch { /* skip */ }
  }
  return out.slice(0, 150);
}
