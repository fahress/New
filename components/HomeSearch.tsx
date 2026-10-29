'use client';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { personHref, thumbUrl } from '@/lib/format';

export type SearchIndex = {
  fonts: { n: string; s: string; c: string; by: string }[];
  people: { n: string; s: string; t: 'designer' | 'foundry'; k: number }[];
  tags: { n: string; href: string; g: string }[];
};

type Hit = { kind: string; label: string; sub: string; href: string; img?: string };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export default function HomeSearch({ index, tries }: { index: SearchIndex; tries: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const t = norm(q.trim());
    if (!t) return [];
    const starts = (s: string) => norm(s).startsWith(t);
    const has = (s: string) => norm(s).includes(t);
    const rank = <T,>(list: T[], key: (x: T) => string) =>
      list.filter((x) => has(key(x))).sort((a, b) => Number(starts(key(b))) - Number(starts(key(a))));
    return [
      ...rank(index.tags, (x) => x.n).slice(0, 3).map((x) => ({ kind: x.g, label: x.n, sub: 'Filter the catalog', href: x.href })),
      ...rank(index.people, (x) => x.n).slice(0, 4).map((x) => ({ kind: x.t === 'foundry' ? 'Foundry' : 'Designer', label: x.n, sub: `${x.k} ${x.k === 1 ? 'typeface' : 'typefaces'}`, href: personHref(x.t, x.s) })),
      ...rank(index.fonts, (x) => x.n).slice(0, 6).map((x) => ({ kind: 'Font', label: x.n, sub: x.by, href: `/fonts/${x.s}`, img: x.c })),
    ];
  }, [q, index]);

  const go = (href: string) => router.push(href);
  const submit = () => {
    if (hits[sel]) go(hits[sel].href);
    else if (q.trim()) go(`/fonts?q=${encodeURIComponent(q.trim())}`);
    else go('/fonts');
  };

  return (
    <div className="bigsearch">
      <form
        role="search"
        className="bigsearch__bar"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="home-q" className="sr-only">Search the archive</label>
        <input
          ref={inputRef}
          id="home-q"
          type="search"
          value={q}
          autoComplete="off"
          placeholder="Search fonts, designers, foundries…"
          aria-controls="home-hits"
          aria-expanded={hits.length > 0}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Escape') setQ('');
          }}
        />
        <button type="submit">Search →</button>
      </form>
      {q.trim() ? (
        <div className="bigsearch__results" id="home-hits" role="listbox">
          {hits.length === 0 ? (
            <p style={{ margin: '10px 14px' }} className="muted">
              Nothing matches “{q}” yet. <a href={`/fonts?q=${encodeURIComponent(q)}`}>Search the full catalog</a>
            </p>
          ) : (
            hits.map((h, i) => (
              <a key={h.href + i} href={h.href} className="hit" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)}>
                <span className="hit__kind mono muted">{h.kind}</span>
                {h.img ? <img className="hit__thumb" src={thumbUrl(h.img, 256)} alt="" loading="lazy" /> : null}
                <span style={{ fontSize: 17, fontWeight: 500 }}>{h.label}</span>
                <span className="muted" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.sub}</span>
              </a>
            ))
          )}
        </div>
      ) : null}
      <div className="tries">
        <span className="mono muted" style={{ marginRight: 6 }}>Try</span>
        {tries.map((t) => (
          <button
            key={t}
            type="button"
            className="pill"
            onClick={() => {
              setQ(t);
              setSel(0);
              inputRef.current?.focus();
            }}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
