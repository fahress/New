'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { thumbUrl } from '@/lib/format';

export type WallFont = { s: string; n: string; c: string; by: string };

const PER_ROW = 12;

function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Tile({ f }: { f: WallFont }) {
  return (
    <Link href={`/fonts/${f.s}`} className="mq-tile tile">
      {/* small resized copies (≈10–30 KB) instead of the full-size cover; the font page shows the full size */}
      <img
        src={thumbUrl(f.c, 384)}
        srcSet={`${thumbUrl(f.c, 384)} 1x, ${thumbUrl(f.c, 640)} 2x`}
        alt={`${f.n} presentation`}
        className="spec"
        // eager: the strip moves with a CSS transform, so the browser's lazy-loading never sees these tiles come on screen
        loading="eager"
        decoding="async"
        width={420}
        height={210}
      />
      <span className="mq-tile__cap">
        <b style={{ fontWeight: 600 }}>{f.n}</b>
        <span style={{ color: 'var(--mute-inv)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.by}</span>
      </span>
    </Link>
  );
}

/** Two scrolling rows with a fresh random selection of typefaces on every visit. */
export default function RandomWall({ pool }: { pool: WallFont[] }) {
  const [rows, setRows] = useState<[WallFont[], WallFont[]] | null>(null);

  useEffect(() => {
    const pick = shuffle(pool.filter((f) => f.c)).slice(0, PER_ROW * 2);
    setRows([pick.slice(0, PER_ROW), pick.slice(PER_ROW)]);
  }, [pool]);

  // until the random pick is made in the browser, show light placeholders (no wasted image downloads)
  const blank = Array.from({ length: PER_ROW }, (_, i) => <span key={i} className="mq-tile" aria-hidden="true" />);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="marquee">
        {rows ? [...rows[0], ...rows[0]].map((f, i) => <Tile key={f.s + i} f={f} />) : [...blank, ...blank]}
      </div>
      <div className="marquee marquee--rev">
        {rows ? [...rows[1], ...rows[1]].map((f, i) => <Tile key={f.s + i} f={f} />) : [...blank, ...blank]}
      </div>
    </div>
  );
}
