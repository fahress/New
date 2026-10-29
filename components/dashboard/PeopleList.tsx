'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { countryByName } from '@/lib/admin/countries';
import { img, useData } from '@/lib/admin/store';
import { placeOf } from '@/lib/places';

export default function PeopleList({ kind }: { kind: 'designer' | 'foundry' }) {
  const { data, fontsOf } = useData();
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState<'az' | 'fonts' | 'new'>('az');
  const [missing, setMissing] = useState('');
  const base = kind === 'foundry' ? '/dashboard/foundries' : '/dashboard/designers';

  const people = useMemo(() => {
    if (!data) return [];
    return data.people
      .filter((p) => (kind === 'foundry' ? p.type === 'foundry' : p.type !== 'foundry'))
      .map((p) => ({ p, n: fontsOf(String(p.id)).length, c: String(p.country ?? '') || placeOf(String(p.slug)).from || '', saved: !!p.country }));
  }, [data, kind, fontsOf]);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    let list = people.filter(({ p, c }) => {
      if (n && !String(p.name).toLowerCase().includes(n)) return false;
      if (country === '—' ? c : country && c !== country) return false;
      if (missing === 'photo' && p.logo) return false;
      if (missing === 'bio' && String(p.bio ?? '').trim()) return false;
      if (missing === 'country' && c) return false;
      return true;
    });
    if (sort === 'fonts') list = list.slice().sort((a, b) => b.n - a.n);
    if (sort === 'new') list = list.slice().sort((a, b) => String(b.p.created_at).localeCompare(String(a.p.created_at)));
    return list;
  }, [people, q, country, sort, missing]);

  if (!data) return null;
  const countries = [...new Set(people.map((x) => x.c).filter(Boolean))].sort();
  const title = kind === 'foundry' ? 'Foundries' : 'Designers';

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">{title}</p>
          <h1 className="display">{people.length} {title.toLowerCase()}</h1>
        </div>
        <Link href={`${base}/new`} className="dz-btn dz-btn--primary">+ New {kind}</Link>
      </div>
      <div className="dz-toolbar">
        <input className="dz-input" placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="dz-select" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
          <option value="">All countries</option>
          <option value="—">No country</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="dz-select" value={missing} onChange={(e) => setMissing(e.target.value)} aria-label="Missing">
          <option value="">Complete or not</option>
          <option value="photo">Missing {kind === 'foundry' ? 'logo' : 'photo'}</option>
          <option value="bio">Missing bio</option>
          <option value="country">Missing country</option>
        </select>
        <select className="dz-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="az">A–Z</option><option value="fonts">Most fonts</option><option value="new">Recently added</option>
        </select>
        <span className="dz-muted" style={{ fontSize: 13 }}>{rows.length} shown</span>
      </div>
      <div className="dz-tablewrap">
        <table className="dz-table">
          <thead><tr><th style={{ width: 56 }} /><th>Name</th><th>{kind === 'foundry' ? 'Country' : 'From'}</th><th>Fonts</th><th>Links</th></tr></thead>
          <tbody>
            {rows.map(({ p, n, c, saved }) => {
              const flag = countryByName(c)?.flag;
              const links = Object.values((p.social_links as Record<string, string>) ?? {}).filter(Boolean).length;
              return (
                <tr key={String(p.id)}>
                  <td>{p.logo ? <img className={`dz-av${kind === 'foundry' ? ' is-sq' : ' is-grey'}`} src={img(String(p.logo), 256)} alt="" loading="lazy" /> : <span className="dz-mono-av" style={{ width: 40, height: 40 }}>{String(p.name)[0]}</span>}</td>
                  <td><Link className="dz-row-link" href={`${base}/${p.id}`}>{String(p.name)}</Link>{!String(p.bio ?? '').trim() ? <><br /><small className="dz-muted">No bio</small></> : null}</td>
                  <td>{c ? <>{flag ? `${flag} ` : ''}{c}{!saved && data.hasCountry ? <small className="dz-muted"> · suggested</small> : null}</> : <span className="dz-tag dz-tag--warn">Not set</span>}</td>
                  <td>{n || <span className="dz-muted">0</span>}</td>
                  <td>{links || <span className="dz-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="dz-empty" style={{ border: 0 }}>No one matches.</div> : null}
      </div>
    </>
  );
}
