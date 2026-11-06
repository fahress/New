import 'server-only';
import { FetchBlocked, checkUrl, readCapped, readText, safeFetch } from '@/lib/web/fetch';
import { decode, jsonLd, metas, names, pageImages, pageLinks, pdfLinks, readableText } from '@/lib/web/page';
import { sniff } from '@/lib/web/image';
import { datesInMeta, datesInText, parseDate, type FoundDate } from './dates';
import { hostOf } from './text';
import type { SearchClient } from './providers';

export type PageRead = {
  url: string; title: string; site: string | null; author: string[]; description: string; lang: string | null;
  text: string; truncated: boolean; dates: FoundDate[]; images: string[]; pdfs: string[]; profiles: string[]; via: 'direct' | 'search_extract';
};
export type PdfRead = { url: string; title: string | null; author: string | null; created: FoundDate | null; pages: { page: number; text: string }[]; total_pages: number };

export interface WebReader {
  readPage(url: string, opts: { maxChars: number; runId: string; signal?: AbortSignal }): Promise<PageRead>;
  readPdf(url: string, opts: { from: number; to: number; maxChars: number }): Promise<PdfRead>;
  fetchBytes(url: string, max: number): Promise<{ bytes: Uint8Array; type: string | null; url: string }>;
}

export class WebError extends Error {}

const PROFILE_HOSTS = /(^|\.)(instagram\.com|behance\.net|linkedin\.com|x\.com|twitter\.com|dribbble\.com|facebook\.com|github\.com|youtube\.com|myfonts\.com|vimeo\.com|threads\.net)$/;

export class ServerWebReader implements WebReader {
  constructor(private search: SearchClient | null) {}

  async readPage(url: string, opts: { maxChars: number; runId: string; signal?: AbortSignal }): Promise<PageRead> {
    if (!checkUrl(url)) throw new WebError('That address can’t be opened (only public http/https pages).');
    let html = '';
    let final = url;
    let failure = '';
    try {
      const res = await safeFetch(url, { headers: { accept: 'text/html,application/xhtml+xml,application/pdf;q=0.5' }, signal: opts.signal }, 15000);
      final = res.url || url;
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (type.includes('pdf')) throw new WebError('This link is a PDF — read it with read_pdf.');
      if (res.ok && (type.includes('html') || type.includes('xml') || !type)) html = (await readText(res, 3_000_000)).text;
      else { failure = `the site answered ${res.status}`; await res.body?.cancel().catch(() => undefined); }
    } catch (e) {
      if (e instanceof WebError) throw e;
      failure = e instanceof FetchBlocked ? 'blocked address' : 'could not connect';
      if (e instanceof FetchBlocked) throw new WebError('That address points to a private or blocked network and can’t be opened.');
    }
    if (!html) {
      // some shops block direct reading; the search provider's reader can sometimes still read them
      if (this.search) {
        try {
          const x = await this.search.extract([url], 'basic', opts.runId, opts.signal);
          const r = x.results[0];
          if (r?.text) {
            const text = r.text.slice(0, opts.maxChars);
            return { url, title: /^#\s+(.+)$/m.exec(r.text)?.[1]?.slice(0, 200) ?? '', site: hostOf(url), author: [], description: '', lang: null, text, truncated: r.text.length > opts.maxChars,
              dates: datesInText(text), images: r.images.filter((u) => /^https?:/.test(u)).slice(0, 30), pdfs: [], profiles: [], via: 'search_extract' };
          }
        } catch { /* fall through */ }
      }
      throw new WebError(`Couldn’t read the page (${failure || 'empty page'}).`);
    }
    const base = new URL(final);
    const meta = metas(html);
    const ld = jsonLd(html);
    const text = readableText(html);
    const title = decode(meta['og:title']?.[0] || names(ld.find((x) => x.name)?.name)[0] || /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '');
    const author = [...new Set([...(meta['author'] ?? []), ...ld.flatMap((x) => [...names(x.author), ...names(x.creator)])].map((a) => a.trim()).filter((a) => a && a.length < 80))].slice(0, 6);
    const dates = [...datesInMeta(meta, ld, html), ...datesInText(`${title}\n${text}`)];
    return {
      url: final, title: title.slice(0, 300), site: meta['og:site_name']?.[0]?.slice(0, 120) ?? null, author,
      description: (meta['og:description']?.[0] || meta['description']?.[0] || '').slice(0, 600), lang: /<html[^>]*\blang=["']([\w-]+)/i.exec(html)?.[1] ?? null,
      text: text.slice(0, opts.maxChars), truncated: text.length > opts.maxChars, dates,
      images: pageImages(html, base, meta, ld), pdfs: pdfLinks(html, base),
      profiles: [...new Set(pageLinks(html, base).map((l) => l.url).filter((u) => PROFILE_HOSTS.test(hostOf(u))))].slice(0, 15), via: 'direct',
    };
  }

  async readPdf(url: string, opts: { from: number; to: number; maxChars: number }): Promise<PdfRead> {
    if (!checkUrl(url)) throw new WebError('That address can’t be opened.');
    let res: Response;
    try { res = await safeFetch(url, { headers: { accept: 'application/pdf,*/*' } }, 30000); } catch { throw new WebError('Couldn’t download the PDF.'); }
    if (!res.ok) throw new WebError(`The PDF link answered ${res.status}.`);
    const { bytes, truncated } = await readCapped(res, 40 * 1024 * 1024);
    if (truncated) throw new WebError('The PDF is larger than 40 MB.');
    if (sniff(bytes) !== 'application/pdf') throw new WebError('That link isn’t a PDF.');
    // pdf.js runs its worker in this process: loading the worker module first registers it (globalThis.pdfjsWorker)
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false } as never).promise;
    try {
      const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as Record<string, unknown>;
      const raw = typeof info.CreationDate === 'string' ? info.CreationDate.replace(/^D:/, '') : '';
      const created = raw.length >= 4 ? parseDate(raw.length >= 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 4)) : null;
      const pages: { page: number; text: string }[] = [];
      let used = 0;
      const from = Math.max(1, opts.from), to = Math.min(doc.numPages, opts.to, from + 29);
      for (let i = from; i <= to && used < opts.maxChars; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = (content.items as { str?: string; hasEOL?: boolean }[]).map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
        const take = text.slice(0, opts.maxChars - used);
        used += take.length;
        pages.push({ page: i, text: take });
        page.cleanup();
      }
      return {
        url, title: typeof info.Title === 'string' ? info.Title.slice(0, 200) : null, author: typeof info.Author === 'string' ? info.Author.slice(0, 120) : null,
        created: created ? { ...created, kind: 'page_published', from: 'meta', evidence: `PDF creation date: ${raw.slice(0, 14)}` } : null, pages, total_pages: doc.numPages,
      };
    } finally {
      await doc.destroy();
    }
  }

  async fetchBytes(url: string, max: number) {
    if (!checkUrl(url)) throw new WebError('Blocked address');
    const res = await safeFetch(url, { headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*' } }, 15000);
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new WebError(`answered ${res.status}`); }
    const { bytes, truncated } = await readCapped(res, max);
    if (truncated) throw new WebError('too large');
    return { bytes, type: sniff(bytes), url: res.url || url };
  }
}
