'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { img, useData, weekStart } from '@/lib/admin/store';

const nice = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Choose the designer shown in the "Designer of the week" section of the home page. */
export default function DesignerOfTheWeek() {
  const { data, reload, personById, fontsOf } = useData();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [week, setWeek] = useState<0 | 1>(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const picks = useMemo(() => [...(data?.dotw ?? [])].sort((a, b) => String(b.week_start).localeCompare(String(a.week_start))), [data]);
  const lastPicked = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of picks) if (!m.has(String(r.designer_id))) m.set(String(r.designer_id), String(r.week_start));
    return m;
  }, [picks]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data?.people ?? [])
      .filter((p) => p.type !== 'foundry')
      .map((p) => ({ p, fonts: fontsOf(String(p.id)).filter((f) => ['published', 'featured'].includes(String(f.status))).length, last: lastPicked.get(String(p.id)) }))
      .filter((x) => x.fonts > 0 && (!n || String(x.p.name).toLowerCase().includes(n)))
      // never chosen first, then the ones chosen longest ago; more typefaces first
      .sort((a, b) => (a.last ?? '').localeCompare(b.last ?? '') || b.fonts - a.fonts || String(a.p.name).localeCompare(String(b.p.name)));
  }, [data, q, lastPicked, fontsOf]);

  if (!data) return null;

  if (data.dotw === null) {
    return (
      <div className="dz-panel" style={{ maxWidth: 680 }}>
        <h3>One-time setup needed</h3>
        <p className="dz-muted">Designer of the week needs a small table in the database. In Supabase, open <b>SQL Editor</b>, paste the contents of <code>supabase/designer-of-week.sql</code> and press <b>Run</b>, then reload this page.</p>
        <p className="dz-muted">Until then the home page keeps choosing a designer automatically each week.</p>
      </div>
    );
  }

  const thisWeek = weekStart(0);
  const target = weekStart(week);
  const current = picks.find((r) => String(r.week_start) === thisWeek);
  const next = picks.find((r) => String(r.week_start) === weekStart(1));
  const nameOf = (r?: Row) => (r ? String(personById.get(String(r.designer_id))?.name ?? 'Removed profile') : '');

  async function choose(p: Row) {
    setBusy(String(p.id));
    try {
      const row = { week_start: target, designer_id: String(p.id), note: note.trim() || null };
      await db.upsert('designer_of_week', [row], 'week_start');
      await db.log({ action: 'update', entity: 'designer_of_week', entity_id: target, label: `Designer of the week (${nice(target)}): ${p.name}`, after: row });
      await db.refreshSite();
      await reload();
      setNote('');
      toast(`${p.name} is the designer of the week from ${nice(target)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'err');
    } finally {
      setBusy('');
    }
  }

  async function remove(r: Row) {
    setBusy(String(r.week_start));
    try {
      await db.remove('designer_of_week', { week_start: String(r.week_start) });
      await db.log({ action: 'delete', entity: 'designer_of_week', entity_id: String(r.week_start), label: `Removed designer of the week (${nice(String(r.week_start))}): ${nameOf(r)}`, before: r });
      await db.refreshSite();
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove', 'err');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Home page</p>
          <h1 className="display">Designer of the week</h1>
          <p>The designer shown in the &ldquo;Designer of the week&rdquo; section of the home page. Weeks start on Sunday. In a week with no pick, the site chooses one itself.</p>
        </div>
      </div>

      <section className="dz-panel" style={{ display: 'grid', gap: 8 }}>
        <p style={{ margin: 0 }}>
          <b>This week</b> ({nice(thisWeek)}):{' '}
          {current ? <><b>{nameOf(current)}</b>{current.note ? <span className="dz-muted"> — {String(current.note)}</span> : null}</> : <span style={{ color: 'var(--danger, #c0392b)' }}>not chosen yet — the site is picking one automatically</span>}
        </p>
        <p style={{ margin: 0 }} className="dz-muted"><b>Next week</b> ({nice(weekStart(1))}): {next ? nameOf(next) : 'not chosen yet'}</p>
        <p style={{ margin: 0 }}><Link href="/" target="_blank" className="dz-link">See it on the home page ↗</Link></p>
      </section>

      <section className="dz-panel" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="dz-select" value={week} onChange={(e) => setWeek(Number(e.target.value) as 0 | 1)} aria-label="Which week">
            <option value={0}>Choose for this week ({nice(thisWeek)})</option>
            <option value={1}>Choose for next week ({nice(weekStart(1))})</option>
          </select>
          <input className="dz-input" style={{ flex: '1 1 220px' }} placeholder="Search designers…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <input className="dz-input" placeholder="Optional line shown under their name, e.g. why they're featured this week" value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} />
        <p className="dz-hint" style={{ margin: 0 }}>Designers never featured come first, then those featured longest ago.</p>
        <div style={{ display: 'grid', gap: 6 }}>
          {list.slice(0, 60).map(({ p, fonts, last }) => (
            <div key={String(p.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--line, #eee)' }}>
              {p.logo ? <img src={img(String(p.logo), 256)} alt="" width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover', filter: 'grayscale(1)' }} /> : <span className="dz-mono-av" style={{ width: 40, height: 40 }}>{String(p.name)[0]}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/dashboard/designers/${p.id}`}><b>{String(p.name)}</b></Link>
                <div className="dz-muted" style={{ fontSize: 13 }}>
                  {fonts} typeface{fonts === 1 ? '' : 's'}{p.country ? ` · ${p.country}` : ''}{!p.bio ? ' · no bio' : ''}{!p.logo ? ' · no portrait' : ''}{last ? ` · last featured ${nice(last)}` : ' · never featured'}
                </div>
              </div>
              <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" disabled={!!busy} onClick={() => choose(p)}>{busy === String(p.id) ? 'Saving…' : 'Choose'}</button>
            </div>
          ))}
          {list.length > 60 ? <p className="dz-hint" style={{ margin: 0 }}>Showing 60 of {list.length} — search to find others.</p> : null}
        </div>
      </section>

      {picks.length > 0 && (
        <section className="dz-panel" style={{ display: 'grid', gap: 6 }}>
          <h3 style={{ margin: 0 }}>Past and planned picks</h3>
          {picks.map((r) => (
            <div key={String(r.week_start)} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="dz-muted" style={{ minWidth: 150 }}>{nice(String(r.week_start))}</span>
              <b>{nameOf(r)}</b>
              {r.note ? <span className="dz-muted">— {String(r.note)}</span> : null}
              {String(r.week_start) >= thisWeek ? <button type="button" className="dz-link" disabled={!!busy} onClick={() => remove(r)}>Remove</button> : null}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
