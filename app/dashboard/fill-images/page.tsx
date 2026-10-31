'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { db, type Row } from '@/lib/admin/db';
import { supabase } from '@/lib/admin/client';
import { useData } from '@/lib/admin/store';
import { useToast } from '@/components/dashboard/ui';

type Scan = { id: string; name: string; host: string; url: string; images: string[]; error?: string };
type Result = { id: string; name: string; host: string; added: number; note: string };

const PER_FONT = 8;
const linkOf = (f: Row) => {
  const u = String(f.source_url || (Array.isArray(f.purchase_links) ? f.purchase_links[0] : '') || '');
  return /^https?:\/\//.test(u) ? u : '';
};
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '?'; } };
/** Home pages, news articles, PDFs and profiles: their pictures aren't this font's. */
const notAFontPage = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname.replace(/\/+$/, '') === '' || /\.pdf$/i.test(x.pathname) || /linkedin\.com|luc\.devroye\.org|worldcrunch\.com|prnewswire\.com|omantel\.om|atypi\.org|archive\.tdc\.org|europeandesign\.org/i.test(x.hostname);
  } catch { return true; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Goes through every draft without images, reads its source link and brings in the presentation images. Drafts only. */
export default function FillImages() {
  const { data, reload } = useData();
  const toast = useToast();
  const [phase, setPhase] = useState<'idle' | 'reading' | 'importing' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [results, setResults] = useState<Result[]>([]);
  const stop = useRef(false);

  const todo = useMemo(() => (data?.fonts ?? []).filter((f) => String(f.status) === 'draft' && !(Array.isArray(f.images) && f.images.length) && !f.cover), [data]);
  const withLink = todo.filter((f) => linkOf(f));
  const byHost = useMemoHosts(results);
  if (!data) return null;
  const isAdmin = data.role === 'admin';

  async function run() {
    stop.current = false;
    setResults([]);
    const out: Result[] = [];
    const push = (r: Result) => { out.push(r); setResults([...out]); };

    // 1. read every page first, so images that repeat across a site's pages (banners, ads) can be left out
    setPhase('reading');
    const scans: Scan[] = [];
    setProgress({ done: 0, total: withLink.length, current: '' });
    for (const [i, f] of withLink.entries()) {
      if (stop.current) break;
      const url = linkOf(f);
      setProgress({ done: i, total: withLink.length, current: String(f.name) });
      if (notAFontPage(url)) { scans.push({ id: String(f.id), name: String(f.name), host: hostOf(url), url, images: [], error: 'The link isn’t a page about this font (home page, article or PDF)' }); continue; }
      try {
        const r = await db.api<{ images: string[] }>('/api/dashboard/scrape', { url });
        scans.push({ id: String(f.id), name: String(f.name), host: hostOf(url), url, images: r.images ?? [] });
      } catch (e) {
        scans.push({ id: String(f.id), name: String(f.name), host: hostOf(url), url, images: [], error: e instanceof Error ? e.message : 'Could not read the page' });
      }
      await sleep(400);
    }
    const seen = new Map<string, Set<string>>();
    for (const s of scans) for (const im of s.images) { const k = `${s.host}|${im.split('?')[0]}`; if (!seen.has(k)) seen.set(k, new Set()); seen.get(k)!.add(s.id); }
    const shared = (s: Scan, im: string) => (seen.get(`${s.host}|${im.split('?')[0]}`)?.size ?? 0) > 1;

    // 2. bring in the images, font by font
    setPhase('importing');
    setProgress({ done: 0, total: scans.length, current: '' });
    for (const [i, s] of scans.entries()) {
      if (stop.current) break;
      setProgress({ done: i, total: scans.length, current: s.name });
      if (s.error) { push({ id: s.id, name: s.name, host: s.host, added: 0, note: s.error }); continue; }
      const pick = s.images.filter((im) => !shared(s, im)).slice(0, PER_FONT);
      if (!pick.length) { push({ id: s.id, name: s.name, host: s.host, added: 0, note: s.images.length ? 'Only site-wide images on the page' : 'No images on the page' }); continue; }
      const paths: string[] = [];
      for (const u of pick) {
        try {
          const res = await fetch('/api/dashboard/image', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${await db.token()}` }, body: JSON.stringify({ url: u }) });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (blob.size < 15000) continue; // icons and thumbnails
          const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z]/g, '');
          paths.push(await db.upload(new File([blob], `${s.name}-${paths.length + 1}.${ext}`, { type: blob.type })));
        } catch { /* skip this image */ }
      }
      if (!paths.length) { push({ id: s.id, name: s.name, host: s.host, added: 0, note: 'The site refused the images' }); continue; }
      try {
        // re-check: only drafts that are still empty are changed
        const { data: now } = await supabase().from('fonts').select('id,status,images,cover').eq('id', s.id).maybeSingle();
        if (!now || String(now.status) !== 'draft' || (Array.isArray(now.images) && now.images.length)) { push({ id: s.id, name: s.name, host: s.host, added: 0, note: 'Skipped — changed meanwhile' }); continue; }
        await db.update('fonts', { id: s.id }, { images: paths, cover: paths[0], updated_at: new Date().toISOString() });
        await db.log({ action: 'update', entity: 'font', entity_id: s.id, label: `${s.name}: ${paths.length} images from ${s.host}`, after: { images: paths, source: s.url } });
        push({ id: s.id, name: s.name, host: s.host, added: paths.length, note: '' });
      } catch (e) {
        push({ id: s.id, name: s.name, host: s.host, added: 0, note: e instanceof Error ? e.message : 'Saving failed' });
      }
    }
    setProgress((p) => ({ ...p, done: p.total, current: '' }));
    setPhase('done');
    await reload();
    toast(stop.current ? 'Stopped' : 'Finished');
  }

  const ok = results.filter((r) => r.added > 0);

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Drafts</p>
          <h1 className="display">Fill draft images</h1>
          <p>Reads the source link of every <b>draft</b> without images and brings in up to {PER_FONT} presentation images from it, the first as cover. Published fonts are never touched, and nothing is published. Images that appear on many pages of the same site (banners, ads) are left out.</p>
        </div>
      </div>

      <section className="dz-panel" style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0 }}><b>{todo.length}</b> drafts have no images — <b>{withLink.length}</b> of them have a link to read{todo.length - withLink.length ? `, ${todo.length - withLink.length} have none` : ''}.</p>
        {phase === 'reading' || phase === 'importing' ? (
          <>
            <p style={{ margin: 0 }}>{phase === 'reading' ? 'Reading pages' : 'Bringing in images'} · {progress.done} of {progress.total}{progress.current ? ` · ${progress.current}` : ''}</p>
            <div style={{ height: 6, background: 'var(--soft)', borderRadius: 3 }}><div style={{ height: 6, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--ink)', borderRadius: 3 }} /></div>
            <p className="dz-hint" style={{ margin: 0 }}>Keep this tab open. It goes one font at a time so the sites aren&apos;t flooded.</p>
            <div><button type="button" className="dz-btn" onClick={() => { stop.current = true; }}>Stop after this font</button></div>
          </>
        ) : (
          <div><button type="button" className="dz-btn dz-btn--primary" disabled={!isAdmin || !withLink.length} onClick={run}>{phase === 'done' ? 'Run again' : `Start — ${withLink.length} drafts`}</button>{!isAdmin ? <span className="dz-muted" style={{ marginLeft: 10 }}>Only admins can run this.</span> : null}</div>
        )}
      </section>

      {results.length > 0 && (
        <>
          <h2 className="dz-h2" style={{ marginTop: 28 }}>{ok.length} drafts got images · {results.length - ok.length} didn&apos;t</h2>
          <div className="dz-panel" style={{ display: 'grid', gap: 6 }}>
            {byHost.map(([host, rs]) => {
              const got = rs.filter((r) => r.added > 0).length;
              return (
                <details key={host}>
                  <summary style={{ cursor: 'pointer' }}><b>{host}</b> — {got} of {rs.length} filled{got < rs.length ? ` · ${[...new Set(rs.filter((r) => !r.added).map((r) => r.note))].slice(0, 2).join(' · ')}` : ''}</summary>
                  <ul style={{ margin: '6px 0 10px', paddingLeft: 18, fontSize: 14 }}>
                    {rs.map((r) => <li key={r.id}><Link href={`/dashboard/fonts/${r.id}`}>{r.name}</Link> — {r.added ? `${r.added} images` : r.note}</li>)}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function useMemoHosts(results: Result[]) {
  return useMemo(() => {
    const m = new Map<string, Result[]>();
    for (const r of results) m.set(r.host, [...(m.get(r.host) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [results]);
}
