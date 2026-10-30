'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { thumbUrl } from '@/lib/format';

export type AwardRow = { id: string; s: string; n: string; c: string | null; by: string; aw: string };

const SHOW = 8;

function pick<T>(list: T[], n: number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Award winners on the home page: a different random selection on every visit. */
export default function RandomAwards({ rows }: { rows: AwardRow[] }) {
  const [list, setList] = useState<AwardRow[] | null>(null);
  useEffect(() => setList(pick(rows, SHOW)), [rows]);
  const shown = list ?? rows.slice(0, SHOW);
  return (
    <div className="award-list" style={{ opacity: list ? 1 : 0, transition: 'opacity .25s' }}>
      {shown.map((f) => (
        <Link key={f.id} href={`/fonts/${f.s}`} className="award-row">
          <span className="award-row__img"><img className="spec" src={thumbUrl(f.c, 384)} alt="" loading="lazy" /></span>
          <span className="award-row__name">{f.n}</span>
          <span className="muted" style={{ fontSize: 15 }}>{f.by}</span>
          <span className="mono">{f.aw}</span>
        </Link>
      ))}
    </div>
  );
}
