'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { timeAgo, useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { useData } from '@/lib/admin/store';

type Owner = { href: string; label: string; where: string };
type Check = { url: string; status: number; verdict: 'ok' | 'broken' | 'unknown'; checked_at?: string; error?: string };

export default function LinkHealth() {
  const { data, reload } = useData();
  const toast = useToast();
  const [local, setLocal] = useState<Record<string, Check>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<'broken' | 'unknown' | 'ok' | 'never'>('broken');
  const stop = useRef(false);

  const owners = useMemo(() => {
    const m = new Map<string, Owner[]>();
    const add = (url: unknown, o: Owner) => {
      const u = String(url ?? '').trim();
      if (!/^https?:\/\//i.test(u)) return;
      m.set(u, [...(m.get(u) ?? []), o]);
    };
    for (const f of data?.fonts ?? []) {
      const href = `/dashboard/fonts/${f.id}`;
      for (const u of (f.purchase_links as string[]) ?? []) add(u, { href, label: String(f.name), where: 'Buy link' });
      for (const u of (f.case_studies as string[]) ?? []) add(u, { href, label: String(f.name), where: 'Case study' });
    }
    for (const p of data?.people ?? []) {
      const href = `/dashboard/${p.type === 'foundry' ? 'foundries' : 'designers'}/${p.id}`;
      for (const [k, u] of Object.entries((p.social_links as Row) ?? {})) add(u, { href, label: String(p.name), where: k.replace('_url', '') });
    }
    return m;
  }, [data]);

  const saved = useMemo(() => new Map((data?.linkChecks ?? []).map((r) => [String(r.url), r as unknown as Check])), [data]);
  const resultOf = (u: string): Check | undefined => local[u] ?? saved.get(u);

  if (!data) return null;
  const urls = [...owners.keys()];
  const counts = { broken: 0, unknown: 0, ok: 0, never: 0 };
  for (const u of urls) counts[resultOf(u)?.verdict ?? 'never']++;
  const last = [...saved.values()].map((c) => c.checked_at).filter(Boolean).sort().pop();
  const shown = urls.filter((u) => (resultOf(u)?.verdict ?? 'never') === filter);

  async function run(list: string[]) {
    stop.current = false;
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i += 20) {
      if (stop.current) break;
      const batch = list.slice(i, i + 20);
      try {
        const { results } = await db.api<{ results: Check[] }>('/api/dashboard/check-links', { urls: batch });
        const now = new Date().toISOString();
        setLocal((l) => ({ ...l, ...Object.fromEntries(results.map((r) => [r.url, { ...r, checked_at: now }])) }));
        if (data!.upgraded) await db.upsert('link_checks', results.map((r) => ({ url: r.url, status: r.status, verdict: r.verdict, ok: r.verdict === 'ok', error: r.error ?? null, checked_at: now })), 'url').catch(() => undefined);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Check failed', 'err');
        break;
      }
      setProgress({ done: Math.min(i + 20, list.length), total: list.length });
    }
    setProgress(null);
    if (data!.upgraded) await reload();
  }

  const LABEL = { broken: 'Broken', unknown: 'Couldn’t check', ok: 'Working', never: 'Not checked yet' } as const;

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Link health</p>
          <h1 className="display">{counts.broken ? `${counts.broken} broken link${counts.broken === 1 ? '' : 's'}` : 'Links'}</h1>
          <p>{urls.length} links across fonts and profiles.{last ? ` Last checked ${timeAgo(last)}.` : ''} A dead buy link costs the designer a sale, so fix these first.</p>
        </div>
        {progress ? (
          <button type="button" className="dz-btn" onClick={() => { stop.current = true; }}>Stop ({progress.done}/{progress.total})</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {counts.broken + counts.unknown > 0 ? <button type="button" className="dz-btn" onClick={() => run(urls.filter((u) => ['broken', 'unknown'].includes(resultOf(u)?.verdict ?? '')))}>Re-check problems</button> : null}
            <button type="button" className="dz-btn dz-btn--primary" onClick={() => run(urls)}>Check all links</button>
          </div>
        )}
      </div>
      {progress ? <div className="dz-progress"><span style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></div> : null}
      {!data.upgraded ? <p className="dz-hint">Results are kept for this visit only until the database update is run.</p> : null}
      <div className="dz-toolbar">
        <div className="dz-seg">{(Object.keys(LABEL) as (keyof typeof LABEL)[]).map((k) => <button key={k} type="button" className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{LABEL[k]} {counts[k]}</button>)}</div>
      </div>
      {filter === 'unknown' ? <p className="dz-hint">Some stores (MyFonts, Instagram…) block automatic checks. These aren&apos;t necessarily broken — open them to be sure.</p> : null}
      {shown.length === 0 ? <div className="dz-empty">{filter === 'broken' ? (counts.never === urls.length ? 'Press “Check all links” to start.' : 'No broken links.') : 'Nothing here.'}</div> : (
        <div className="dz-tablewrap">
          <table className="dz-table">
            <thead><tr><th>Link</th><th>Used on</th><th>Result</th></tr></thead>
            <tbody>
              {shown.slice(0, 400).map((u) => {
                const r = resultOf(u);
                return (
                  <tr key={u}>
                    <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><a href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\/(www\.)?/, '')}</a></td>
                    <td>{(owners.get(u) ?? []).map((o, i) => <div key={i}><Link className="dz-row-link" href={o.href}>{o.label}</Link> <span className="dz-muted">· {o.where}</span></div>)}</td>
                    <td>{r ? <span className={`dz-tag${r.verdict === 'broken' ? ' dz-tag--warn' : ''}`}>{r.status || r.error?.slice(0, 30) || 'no answer'}</span> : <span className="dz-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
