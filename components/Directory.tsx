'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import HoverRows from './HoverRows';
import { personHref } from '@/lib/format';

export type DirEntry = { slug: string; name: string; logo: string | null; cover: string | null; work: string; count: number; place: string; country: string };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export default function Directory({ kind, entries, counts }: { kind: 'designer' | 'foundry'; entries: DirEntry[]; counts: { designers: number; foundries: number } }) {
  const [q, setQ] = useState('');
  const [letter, setLetter] = useState('');
  const [sort, setSort] = useState<'az' | 'most'>('az');
  const [country, setCountry] = useState('');
  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.country) m.set(e.country, (m.get(e.country) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries]);

  const first = (s: string) => {
    const c = norm(s).trim()[0]?.toUpperCase() ?? '#';
    return /[A-Z]/.test(c) ? c : '#';
  };
  const has = useMemo(() => new Set(entries.map((e) => first(e.name))), [entries]);
  const list = useMemo(() => {
    const t = norm(q.trim());
    const r = entries.filter((e) => (!t || norm(e.name).includes(t)) && (!letter || first(e.name) === letter) && (!country || e.country === country));
    if (sort === 'most') r.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
    return r;
  }, [entries, q, letter, sort, country]);

  return (
    <>
      <div className="wrap dir-tools">
        <div className="tabs" role="navigation" aria-label="Directory">
          <Link href="/designers" aria-current={kind === 'designer' ? 'page' : undefined}>Designers <span className="mono" style={{ opacity: .7, fontSize: 11 }}>{counts.designers}</span></Link>
          <Link href="/foundries" aria-current={kind === 'foundry' ? 'page' : undefined}>Foundries <span className="mono" style={{ opacity: .7, fontSize: 11 }}>{counts.foundries}</span></Link>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', flex: '0 1 560px' }}>
          <label htmlFor="dq" className="sr-only">Search names</label>
          <input id="dq" type="search" className="input-pill" style={{ flex: '1 1 240px' }} placeholder={`Search ${kind === 'designer' ? 'designers' : 'foundries'}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <label htmlFor="dc" className="sr-only">Country</label>
          <select id="dc" className="select" style={{ height: 46, borderRadius: 999, padding: '0 16px', borderWidth: 1.5 }} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All countries</option>
            {countries.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
          </select>
          <div className="seg" role="group" aria-label="Sort">
            <button type="button" aria-pressed={sort === 'az'} onClick={() => setSort('az')}>A–Z</button>
            <button type="button" aria-pressed={sort === 'most'} onClick={() => setSort('most')}>Most fonts</button>
          </div>
        </div>
      </div>
      <nav className="wrap az" aria-label="Jump to letter">
        {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => (
          <button key={c} type="button" disabled={!has.has(c)} aria-pressed={letter === c} onClick={() => setLetter(letter === c ? '' : c)}>{c}</button>
        ))}
      </nav>
      <div className="wrap" style={{ paddingBottom: 96 }}>
        <HoverRows
          variant="side"
          empty={<p className="muted" style={{ padding: '40px 8px', fontSize: 18 }}>No one by that name yet.</p>}
          rows={list.map((e) => ({
            key: e.slug,
            href: personHref(kind, e.slug),
            img: e.logo ?? e.cover,
            face: !!e.logo,
            grey: !!e.logo && kind === 'designer',
            className: 'nrow',
            content: (
              <>
                <span className="nrow__name">{e.name}</span>
                <span className="nrow__work muted">{e.place ? <><b style={{ fontWeight: 500 }}>{e.place}</b><br /></> : null}{e.work}</span>
                <span className="nrow__n mono muted">{e.count} {e.count === 1 ? 'font' : 'fonts'}</span>
              </>
            ),
          }))}
        />
      </div>
    </>
  );
}
