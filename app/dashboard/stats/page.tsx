'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { db, type Row } from '@/lib/admin/db';
import { coverOf, img, useData } from '@/lib/admin/store';

export default function Stats() {
  const { data, fontById, peopleOf } = useData();
  const [rows, setRows] = useState<Row[] | null | undefined>(undefined);
  const [daily, setDaily] = useState<Row[]>([]);
  const [range, setRange] = useState<'7' | '30' | 'all'>('30');
  const [view, setView] = useState<'fonts' | 'people'>('fonts');

  useEffect(() => {
    Promise.all([db.rpc<Row[]>('dashboard_click_stats'), db.rpc<Row[]>('dashboard_click_daily', { days: 60 })]).then(([r, d]) => { setRows(r); setDaily(d ?? []); });
  }, []);

  const key = range === '7' ? 'clicks_7d' : range === '30' ? 'clicks_30d' : 'clicks_total';
  const fonts = useMemo(() => (rows ?? []).map((r): Row => ({ ...r, f: fontById.get(String(r.font_id)) })).filter((r) => r.f && Number(r[key]) > 0).sort((a, b) => Number(b[key]) - Number(a[key])), [rows, fontById, key]);
  const people = useMemo(() => {
    const m = new Map<string, { p: Row; n: number }>();
    for (const r of fonts) for (const p of peopleOf(String(r.font_id))) {
      const cur = m.get(String(p.id)) ?? { p, n: 0 };
      cur.n += Number(r[key]);
      m.set(String(p.id), cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [fonts, peopleOf, key]);

  if (!data) return null;
  if (rows === undefined) return <div className="dz-loading"><span className="dz-spin" />Loading stats…</div>;
  if (rows === null) return (
    <>
      <div className="dz-head"><div><p className="dz-eyebrow">Clicks &amp; stats</p><h1 className="display">Clicks &amp; stats</h1></div></div>
      <div className="dz-empty">Counting starts after the one-time database update. From then on, every click on a “Buy” or “Download” button on the site is counted, so you can show designers and foundries how many visitors Fahress sends them.</div>
    </>
  );

  const total = fonts.reduce((n, r) => n + Number(r[key]), 0);
  const max = Math.max(1, ...daily.map((d) => Number(d.clicks)));
  const top = view === 'fonts' ? fonts : people;

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Clicks &amp; stats</p>
          <h1 className="display">{total.toLocaleString()} visitors sent</h1>
          <p>Clicks on “Buy” / “Download” buttons — people Fahress sent to designers&apos; and foundries&apos; stores{range === 'all' ? ' since counting began' : ` in the last ${range} days`}.</p>
        </div>
        <div className="dz-seg">{(['7', '30', 'all'] as const).map((r) => <button key={r} type="button" className={range === r ? 'is-on' : ''} onClick={() => setRange(r)}>{r === 'all' ? 'All time' : `${r} days`}</button>)}</div>
      </div>

      {daily.length > 0 && (
        <section className="dz-panel" style={{ marginBottom: 22 }}>
          <p className="dz-eyebrow">Last 60 days</p>
          <div className="dz-bars" role="img" aria-label="Clicks per day for the last 60 days">
            {daily.map((d) => <span key={String(d.day)} title={`${d.day}: ${d.clicks}`} style={{ height: `${(Number(d.clicks) / max) * 100}%` }} />)}
          </div>
        </section>
      )}

      <div className="dz-toolbar">
        <div className="dz-seg"><button type="button" className={view === 'fonts' ? 'is-on' : ''} onClick={() => setView('fonts')}>By typeface</button><button type="button" className={view === 'people' ? 'is-on' : ''} onClick={() => setView('people')}>By designer &amp; foundry</button></div>
      </div>
      {top.length === 0 ? <div className="dz-empty">No clicks yet in this period.</div> : (
        <div className="dz-tablewrap">
          <table className="dz-table">
            <thead><tr><th style={{ width: 100 }} /><th>{view === 'fonts' ? 'Typeface' : 'Designer / foundry'}</th><th style={{ width: '40%' }}>Visitors sent</th></tr></thead>
            <tbody>
              {view === 'fonts'
                ? fonts.slice(0, 100).map((r) => (
                    <tr key={String(r.font_id)}>
                      <td>{coverOf(r.f!) ? <img className="dz-thumb" src={img(coverOf(r.f!), 256)} alt="" loading="lazy" /> : null}</td>
                      <td><Link className="dz-row-link" href={`/dashboard/fonts/${r.font_id}`}>{String(r.f!.name)}</Link><br /><small className="dz-muted">{peopleOf(String(r.font_id)).map((p) => p.name).join(', ')}</small></td>
                      <td><div className="dz-meter"><span style={{ width: `${(Number(r[key]) / Number(fonts[0][key])) * 100}%` }} /><b>{Number(r[key])}</b></div></td>
                    </tr>
                  ))
                : people.slice(0, 100).map(({ p, n }) => (
                    <tr key={String(p.id)}>
                      <td>{p.logo ? <img className={`dz-av${p.type === 'foundry' ? ' is-sq' : ' is-grey'}`} src={img(String(p.logo), 256)} alt="" loading="lazy" /> : null}</td>
                      <td><Link className="dz-row-link" href={`/dashboard/${p.type === 'foundry' ? 'foundries' : 'designers'}/${p.id}`}>{String(p.name)}</Link>{p.user_id ? <small className="dz-muted"> · sees this on their account</small> : null}</td>
                      <td><div className="dz-meter"><span style={{ width: `${(n / people[0].n) * 100}%` }} /><b>{n}</b></div></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
