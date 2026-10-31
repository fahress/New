'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { personHref } from '@/lib/format';

type Item = { id: string; name: string; slug: string; type: string };

/** The moving line of foundries on the home page — in a new random order on every visit. */
export default function FoundryTicker({ items }: { items: Item[] }) {
  const [list, setList] = useState<Item[] | null>(null);
  useEffect(() => {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    setList(a);
  }, [items]);
  const shown = list ?? items;
  return (
    <div className="ticker" style={{ opacity: list ? 1 : 0, transition: 'opacity .4s' }}>
      {[...shown, ...shown].map((p, i) => (
        <span key={p.id + i} style={{ display: 'inline-flex', gap: 48 }}>
          <Link href={personHref(p.type, p.slug)} className="ul" tabIndex={i >= shown.length ? -1 : undefined}>{p.name}</Link>
          <span aria-hidden="true">✳</span>
        </span>
      ))}
    </div>
  );
}
