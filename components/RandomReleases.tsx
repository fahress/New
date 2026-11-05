'use client';
import { useEffect, useState } from 'react';
import FontCard, { type CardFont } from '@/components/FontCard';

export type ReleaseCard = { id: string; people: string[]; card: CardFont };

const SHOW = 8;

/** One font per designer / foundry: a font is skipped if anyone credited on it is already shown. */
function pickOnePerArtist(list: ReleaseCard[], n: number) {
  const out: ReleaseCard[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    if (f.people.some((id) => seen.has(id))) continue;
    out.push(f);
    f.people.forEach((id) => seen.add(id));
    if (out.length === n) break;
  }
  return out;
}

function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** New releases on the home page: a different random selection from this year's fonts on every visit. */
export default function RandomReleases({ pool }: { pool: ReleaseCard[] }) {
  const [list, setList] = useState<ReleaseCard[] | null>(null);
  useEffect(() => setList(pickOnePerArtist(shuffle(pool), SHOW)), [pool]);
  const shown = list ?? pickOnePerArtist(pool, SHOW);
  return (
    <div className="grid" style={{ opacity: list ? 1 : 0, transition: 'opacity .25s' }}>
      {shown.map((f, i) => <FontCard key={f.id} f={f.card} index={i} priority={i < 3} />)}
    </div>
  );
}
