'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { STATUSES, StatusPill, useToast } from '@/components/dashboard/ui';
import { db } from '@/lib/admin/db';
import { coverOf, img, useData } from '@/lib/admin/store';

export default function FontsPage() {
  return <Suspense><Fonts /></Suspense>;
}

function Fonts() {
  const { data, peopleOf, linked, reload } = useData();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState('');
  const status = params.get('status') ?? '';
  const [script, setScript] = useState('');
  const [license, setLicense] = useState('');
  const [sort, setSort] = useState<'new' | 'az' | 'year' | 'updated'>('new');
  const [shown, setShown] = useState(60);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    let list = data.fonts.filter((f) => {
      if (status && f.status !== status) return false;
      if (license && f.license !== license) return false;
      if (script && !linked(String(f.id), 'scripts').includes(script)) return false;
      if (!n) return true;
      const credit = peopleOf(String(f.id)).map((p) => String(p.name)).join(' ');
      return `${f.name} ${f.slug} ${credit}`.toLowerCase().includes(n);
    });
    if (sort === 'az') list = list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (sort === 'year') list = list.slice().sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
    if (sort === 'updated') list = list.slice().sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)));
    return list;
  }, [data, q, status, script, license, sort, linked, peopleOf]);

  if (!data) return null;
  const setStatus = (s: string) => router.replace(s ? `/dashboard/fonts?status=${s}` : '/dashboard/fonts');
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, data.fonts.filter((f) => f.status === s.id).length]));
  const allPicked = rows.length > 0 && rows.slice(0, shown).every((r) => picked.includes(String(r.id)));

  async function bulk(next: string) {
    setBusy(true);
    try {
      for (const id of picked) {
        const f = data!.fonts.find((x) => String(x.id) === id);
        await db.update('fonts', { id }, { status: next, updated_at: new Date().toISOString() });
        await db.log({ action: `status:${next}`, entity: 'font', entity_id: id, label: String(f?.name ?? ''), before: { row: f } });
      }
      await db.refreshSite();
      toast(`${picked.length} font${picked.length === 1 ? '' : 's'} set to ${STATUSES.find((s) => s.id === next)?.label}`);
      setPicked([]);
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Fonts</p>
          <h1 className="display">{data.fonts.length} typefaces</h1>
        </div>
        <Link href="/dashboard/fonts/new" className="dz-btn dz-btn--primary">+ New font</Link>
      </div>

      <div className="dz-toolbar">
        <div className="dz-seg" role="tablist">
          <button type="button" className={!status ? 'is-on' : ''} onClick={() => setStatus('')}>All {data.fonts.length}</button>
          {STATUSES.map((s) => (
            <button type="button" key={s.id} className={status === s.id ? 'is-on' : ''} onClick={() => setStatus(s.id)}>{s.label} {counts[s.id]}</button>
          ))}
        </div>
      </div>
      <div className="dz-toolbar">
        <input className="dz-input" placeholder="Search by name, slug or designer…" value={q} onChange={(e) => { setQ(e.target.value); setShown(60); }} />
        <select className="dz-select" value={script} onChange={(e) => setScript(e.target.value)} aria-label="Script">
          <option value="">All scripts</option>
          {data.scripts.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>
        <select className="dz-select" value={license} onChange={(e) => setLicense(e.target.value)} aria-label="License">
          <option value="">Any license</option>
          <option value="free">Free</option><option value="paid">Paid</option><option value="custom">Custom</option>
        </select>
        <select className="dz-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="new">Recently added</option>
          <option value="updated">Recently edited</option>
          <option value="year">Release year</option>
          <option value="az">A–Z</option>
        </select>
        <span className="dz-muted" style={{ fontSize: 13 }}>{rows.length} shown</span>
      </div>

      {picked.length > 0 && (
        <div className="dz-callout" style={{ padding: '14px 18px' }}>
          <span>{picked.length} selected</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.filter((s) => data.role === 'admin' || s.id === 'draft' || s.id === 'pending').map((s) => <button key={s.id} type="button" className="dz-btn dz-btn--sm" disabled={busy} onClick={() => bulk(s.id)}>Set {s.label}</button>)}
            <button type="button" className="dz-btn dz-btn--sm" onClick={() => setPicked([])}>Clear</button>
          </div>
        </div>
      )}

      <div className="dz-tablewrap">
        <table className="dz-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={allPicked} onChange={() => setPicked(allPicked ? [] : rows.slice(0, shown).map((r) => String(r.id)))} /></th>
              <th style={{ width: 100 }}>Cover</th>
              <th>Font</th>
              <th>Credit</th>
              <th>Year</th>
              <th>License</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((f) => {
              const id = String(f.id);
              const people = peopleOf(id);
              return (
                <tr key={id}>
                  <td><input type="checkbox" aria-label={`Select ${f.name}`} checked={picked.includes(id)} onChange={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} /></td>
                  <td>{coverOf(f) ? <img className="dz-thumb" src={img(coverOf(f), 256)} alt="" loading="lazy" /> : <span className="dz-thumb" />}</td>
                  <td><Link className="dz-row-link" href={`/dashboard/fonts/${id}`}>{String(f.name)}</Link><br /><small className="dz-muted">/{String(f.slug)}</small></td>
                  <td>{people.length ? people.map((p) => String(p.name)).join(', ') : <span className="dz-tag dz-tag--warn">No credit</span>}</td>
                  <td>{f.year ? String(f.year) : <span className="dz-muted">—</span>}</td>
                  <td style={{ textTransform: 'capitalize' }}>{String(f.license ?? '')}</td>
                  <td><StatusPill status={String(f.status)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="dz-empty" style={{ border: 0 }}>No fonts match.</div> : null}
      </div>
      {rows.length > shown ? <div className="dz-more"><button type="button" className="dz-btn" onClick={() => setShown((s) => s + 120)}>Show more ({rows.length - shown} left)</button></div> : null}
    </>
  );
}
