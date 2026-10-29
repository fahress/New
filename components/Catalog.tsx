'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import FontCard from './FontCard';
import { storageUrl } from '@/lib/format';

export type CatFont = {
  id: string;
  n: string; // name
  s: string; // slug
  c: string; // cover
  cr: string; // credit line
  scr: string; // script names
  tg: string; // style + type names
  l: string; // license key
  y: number | null;
  w: number | null;
  v: boolean;
  t: string; // created at
  aw: string | null; // first award name
  f: Record<string, string[]>; // facet values (slugs) per group key
};

export type FacetGroup = {
  key: string;
  label: string;
  searchable?: boolean;
  options: { value: string; label: string }[];
};

type Sel = Record<string, string[]>;

const PAGE = 36;

export default function Catalog({
  fonts,
  groups,
  initial,
  initialQ,
  initialSort,
  initialView,
}: {
  fonts: CatFont[];
  groups: FacetGroup[];
  initial: Sel;
  initialQ: string;
  initialSort: string;
  initialView: 'grid' | 'list';
}) {
  const [sel, setSel] = useState<Sel>(initial);
  const [q, setQ] = useState(initialQ);
  const [sort, setSort] = useState(initialSort);
  const [view, setView] = useState<'grid' | 'list'>(initialView);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = { scripts: true, types: true, license: true };
    for (const k of Object.keys(initial)) o[k] = true;
    return o;
  });
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(PAGE);
  const [drawer, setDrawer] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // keep the address bar in sync so filtered views can be shared and bookmarked
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const g of groups) if (sel[g.key]?.length) p.set(g.key, sel[g.key].join(','));
    if (sort !== 'new') p.set('sort', sort);
    if (view !== 'grid') p.set('view', view);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [sel, q, sort, view, groups]);

  useEffect(() => setShown(PAGE), [sel, q, sort]);

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawer]);

  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const qn = norm(q.trim());

  const matches = useMemo(() => {
    return (f: CatFont, skip: string | null) => {
      for (const g of groups) {
        if (g.key === skip) continue;
        const v = sel[g.key];
        if (v && v.length && !v.some((x) => (f.f[g.key] ?? []).includes(x))) return false;
      }
      if (qn && !norm(`${f.n} ${f.cr} ${f.tg} ${f.scr} ${Object.values(f.f).flat().join(' ')}`).includes(qn)) return false;
      return true;
    };
  }, [groups, sel, qn]);

  const counts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const g of groups) {
      const tally: Record<string, number> = {};
      for (const f of fonts) {
        if (!matches(f, g.key)) continue;
        for (const v of f.f[g.key] ?? []) tally[v] = (tally[v] ?? 0) + 1;
      }
      out[g.key] = tally;
    }
    return out;
  }, [fonts, groups, matches]);

  const list = useMemo(() => {
    const r = fonts.filter((f) => matches(f, null));
    if (sort === 'az') r.sort((a, b) => a.n.localeCompare(b.n));
    else if (sort === 'year') r.sort((a, b) => (b.y ?? 0) - (a.y ?? 0));
    else if (sort === 'weights') r.sort((a, b) => (b.w ?? 0) - (a.w ?? 0));
    else r.sort((a, b) => b.t.localeCompare(a.t));
    return r;
  }, [fonts, matches, sort]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) setShown((n) => n + PAGE);
    }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length]);

  const toggle = (k: string, v: string) =>
    setSel((s) => {
      const cur = s[k] ?? [];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      const out = { ...s, [k]: next };
      if (!next.length) delete out[k];
      return out;
    });

  const chips = groups.flatMap((g) =>
    (sel[g.key] ?? []).map((v) => ({ g, v, label: g.options.find((o) => o.value === v)?.label ?? v }))
  );
  const active = chips.length + (qn ? 1 : 0);
  const clear = () => { setSel({}); setQ(''); };

  return (
    <>
      <div className="wrap page-head">
        <h1 className="display">Catalog</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <p className="mono" style={{ margin: 0 }} aria-live="polite">
            <span className="count-big">{list.length}</span>&nbsp; of {fonts.length} typefaces
          </p>
          <button type="button" className="btn btn--ghost filters-toggle" onClick={() => setDrawer(true)} aria-expanded={drawer} aria-controls="filters">
            Filters{active ? ` (${active})` : ''}
          </button>
        </div>
      </div>

      <div className="wrap catalog">
        <aside id="filters" className={`filters${drawer ? ' is-open' : ''}`} aria-label="Filters">
          <div className="filters__head">
            <span className="mono" style={{ fontWeight: 500 }}>Filter{active ? ` · ${active} on` : ''}</span>
            <button type="button" className="linkbtn" onClick={clear}>Clear all</button>
          </div>
          <div className="fsec">
            <label htmlFor="cat-q" className="sr-only">Search within the catalog</label>
            <input id="cat-q" type="search" className="fsec__find" style={{ margin: '12px 0' }} placeholder="Search name, designer, tag" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {groups.map((g) => {
            const isOpen = !!open[g.key];
            const chosen = sel[g.key] ?? [];
            const term = norm(terms[g.key] ?? '');
            const opts = g.options
              .filter((o) => !term || norm(o.label).includes(term))
              .map((o) => ({ ...o, n: counts[g.key]?.[o.value] ?? 0, on: chosen.includes(o.value) }))
              .filter((o) => !g.searchable || o.n > 0 || o.on || term);
            return (
              <div className="fsec" key={g.key}>
                <button type="button" className="fsec__btn" aria-expanded={isOpen} onClick={() => setOpen((s) => ({ ...s, [g.key]: !isOpen }))}>
                  <span>{g.label} {chosen.length ? <span className="mono muted" style={{ fontSize: 11 }}>({chosen.length})</span> : null}</span>
                  <span className="fsec__plus" aria-hidden="true">+</span>
                </button>
                {isOpen ? (
                  <div className="fsec__body">
                    {g.searchable ? (
                      <input
                        type="search"
                        className="fsec__find"
                        aria-label={`Find ${g.label.toLowerCase()}`}
                        placeholder={`Find ${g.label.toLowerCase()}`}
                        value={terms[g.key] ?? ''}
                        onChange={(e) => setTerms((t) => ({ ...t, [g.key]: e.target.value }))}
                      />
                    ) : null}
                    <div className="fsec__list">
                      {opts.map((o) => (
                        <label key={o.value} className={`opt${o.n === 0 && !o.on ? ' opt--empty' : ''}`}>
                          <input className="ck" type="checkbox" checked={o.on} onChange={() => toggle(g.key, o.value)} />
                          <span>{o.label}</span>
                          <span className="opt__n">{o.n}</span>
                        </label>
                      ))}
                      {opts.length === 0 ? <p className="muted" style={{ fontSize: 14, margin: '6px' }}>No match.</p> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="fsec" />
          <button type="button" className="btn filters__close" onClick={() => setDrawer(false)}>
            Show {list.length} typefaces
          </button>
        </aside>

        <section className="results" aria-label="Results">
          <div className="toolbar">
            <div className="chips">
              {chips.map((c) => (
                <button key={c.g.key + c.v} type="button" className="chip" onClick={() => toggle(c.g.key, c.v)} aria-label={`Remove filter ${c.label}`}>
                  <small>{c.g.label}</small>{c.label}<span aria-hidden="true">×</span>
                </button>
              ))}
              {qn ? (
                <button type="button" className="chip" onClick={() => setQ('')} aria-label="Clear search"><small>Search</small>“{q}”<span aria-hidden="true">×</span></button>
              ) : null}
              {!active ? <span className="muted" style={{ fontSize: 14 }}>Every script, style and license</span> : null}
            </div>
            <div className="tools">
              <label htmlFor="sort" className="mono">Sort</label>
              <select id="sort" className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="new">Recently added</option>
                <option value="year">Release year</option>
                <option value="az">A–Z</option>
                <option value="weights">Most weights</option>
              </select>
              <div className="seg" role="group" aria-label="View">
                <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button>
                <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
              </div>
            </div>
          </div>

          {list.length === 0 ? (
            <div className="empty">
              <p className="display" style={{ margin: 0, fontSize: 32 }}>Nothing matches — yet.</p>
              <p className="muted" style={{ margin: '10px 0 18px' }}>Remove a filter, or tell us about a typeface we’re missing.</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn" onClick={clear}>Clear filters</button>
                <Link href="/about#submit" className="btn btn--ghost">Suggest a font</Link>
              </div>
            </div>
          ) : view === 'grid' ? (
            <div className="grid" style={{ gap: '36px 20px' }}>
              {list.slice(0, shown).map((f, i) => (
                <FontCard
                  key={f.id}
                  index={i % PAGE}
                  priority={i < 3}
                  sizes="(max-width: 700px) 100vw, (max-width: 1300px) 50vw, 30vw"
                  f={{ slug: f.s, name: f.n, cover: f.c, credit: f.cr, script: f.scr, license: f.l === 'free' ? 'Free' : f.l === 'custom' ? 'Custom' : 'Paid', award: f.aw, badges: f.tg ? f.tg.split(', ').slice(0, 2) : [] }}
                />
              ))}
            </div>
          ) : (
            <div style={{ borderTop: '1px solid var(--ink)' }}>
              {list.slice(0, shown).map((f) => (
                <Link key={f.id} href={`/fonts/${f.s}`} className="lrow">
                  <span className="lrow__img">{f.c ? <img className="spec" src={storageUrl(f.c)} alt="" loading="lazy" /> : null}</span>
                  <span className="lrow__name">{f.n}</span>
                  <span style={{ flex: '1 1 200px', fontSize: 15 }}>{f.cr || '—'}</span>
                  <span className="muted" style={{ flex: '0 1 220px', fontSize: 13 }}>{f.scr}{f.tg ? ` · ${f.tg}` : ''}</span>
                  <span className="mono muted" style={{ flex: '0 0 110px', textAlign: 'right' }}>{f.l} · {f.y ?? '—'}</span>
                </Link>
              ))}
            </div>
          )}
          {shown < list.length ? <div ref={sentinel} style={{ height: 1 }} /> : null}
          {shown < list.length ? (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setShown((n) => n + PAGE)}>Load more ({list.length - shown} left)</button>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
