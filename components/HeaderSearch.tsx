'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { personHref, thumbUrl } from '@/lib/format';

type Index = {
  fonts: { n: string; s: string; c: string; by: string; y: number | null }[];
  people: { n: string; s: string; t: 'designer' | 'foundry'; k: number; l: string | null; f: string | null }[];
  tags: { n: string; g: string; h: string; k: number }[];
};
type Item = { href: string; label: string; sub: string; img: string | null; round: boolean; grey: boolean; tag?: boolean };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

/** 0 = name starts with the query, 1 = a word starts with it, 2 = contains it, -1 = no match */
function score(name: string, q: string): number {
  const n = norm(name);
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s\-·.]+/).some((w) => w.startsWith(q))) return 1;
  return n.includes(q) ? 2 : -1;
}

/** best matches first; among equally good matches, the ones with more typefaces (or newer releases) win */
function best<T extends { n: string; k?: number; y?: number | null }>(list: T[], q: string, max: number): T[] {
  return list
    .map((x) => ({ x, s: score(x.n, q) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => a.s - b.s || (b.x.k ?? 0) - (a.x.k ?? 0) || (b.x.y ?? 0) - (a.x.y ?? 0) || a.x.n.localeCompare(b.x.n))
    .slice(0, max)
    .map((r) => r.x);
}

let cache: Promise<Index> | null = null;
const loadIndex = () => (cache ??= fetch('/api/search-index').then((r) => r.json()));

export default function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLFormElement>(null);

  const warm = () => { if (!index) loadIndex().then(setIndex).catch(() => { cache = null; }); };

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const groups = useMemo(() => {
    const t = norm(q);
    if (!t || !index) return [] as { title: string; items: Item[] }[];
    const designers = index.people.filter((p) => p.t === 'designer');
    const foundries = index.people.filter((p) => p.t === 'foundry');
    const person = (p: Index['people'][number]): Item => ({
      href: personHref(p.t, p.s),
      label: p.n,
      sub: [p.f, `${p.k} ${p.k === 1 ? 'typeface' : 'typefaces'}`].filter(Boolean).join(' · '),
      img: p.l, round: true, grey: p.t === 'designer',
    });
    return [
      { title: 'Fonts', items: best(index.fonts, t, 5).map((f): Item => ({ href: `/fonts/${f.s}`, label: f.n, sub: [f.by, f.y].filter(Boolean).join(' · '), img: f.c, round: false, grey: false })) },
      { title: 'Designers', items: best(designers, t, 5).map(person) },
      { title: 'Foundries', items: best(foundries, t, 4).map(person) },
      { title: 'Filters', items: best(index.tags ?? [], t, 3).filter((x) => score(x.n, t) < 2).map((x): Item => ({ href: x.h, label: x.n, sub: `${x.g} · ${x.k} typefaces`, img: null, round: false, grey: false, tag: true })) },
    ].filter((g) => g.items.length);
  }, [q, index]);

  const flat = groups.flatMap((g) => g.items);
  const go = (href: string) => { setOpen(false); setQ(''); router.push(href); };
  const all = () => go(`/fonts?q=${encodeURIComponent(q.trim())}`);

  let k = -1;
  return (
    <form
      ref={box}
      action="/fonts"
      method="get"
      role="search"
      className="header-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (flat[sel] && open) go(flat[sel].href);
        else if (q.trim()) all();
        else go('/fonts');
      }}
    >
      <label htmlFor="hs" className="sr-only">Search fonts, designers and foundries</label>
      <input
        id="hs"
        name="q"
        type="search"
        placeholder="Search fonts, designers…"
        autoComplete="off"
        value={q}
        role="combobox"
        aria-expanded={open && q.trim().length > 0}
        aria-controls="hs-list"
        aria-autocomplete="list"
        onFocus={() => { warm(); setOpen(true); }}
        onMouseEnter={warm}
        onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); warm(); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button type="submit">Search</button>
      {open && q.trim() ? (
        <div className="suggest" id="hs-list" role="listbox">
          {!index ? (
            <p className="suggest__empty muted">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="suggest__empty muted">Nothing matches “{q.trim()}”.</p>
          ) : (
            groups.map((g) => (
              <div key={g.title} className="suggest__group">
                <p className="suggest__title mono">{g.title}</p>
                {g.items.map((it) => {
                  k += 1;
                  const i = k;
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className="suggest__item"
                      role="option"
                      aria-selected={i === sel}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => { setOpen(false); setQ(''); }}
                    >
                      {it.img ? (
                        <img
                          src={thumbUrl(it.img, 256)}
                          alt=""
                          className={`suggest__img${it.round ? ' suggest__img--round' : ''}${it.grey ? ' avatar--grey' : ''}`}
                          loading="lazy"
                        />
                      ) : it.tag ? (
                        <span className="suggest__img suggest__img--tag mono" aria-hidden="true">#</span>
                      ) : (
                        <span className={`suggest__img${it.round ? ' suggest__img--round' : ''} suggest__img--blank`} aria-hidden="true">{it.label[0]}</span>
                      )}
                      <span className="suggest__text">
                        <span className="suggest__label">{it.label}</span>
                        <span className="suggest__sub">{it.sub}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))
          )}
          <button type="button" className="suggest__all" onClick={all}>See all results for “{q.trim()}” →</button>
        </div>
      ) : null}
    </form>
  );
}
