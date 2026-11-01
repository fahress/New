'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { thumbUrl } from '@/lib/format';
import type { WallFont } from './RandomWall';

/*
  "Live from the index" — floating version (preview).
  Font covers of many sizes scattered over the black band, swapping in and out in a quick, choppy rhythm.
  The covers drift a little with the mouse (the small ones, further back, move more).
  Rest the mouse on a cover and it comes forward to the centre, larger, with its name; click to open the font.
*/

type Card = { key: number; f: WallFont; x: number; y: number; w: number; depth: number };

const SIZES: [number, number, number][] = [ // [min width %, max width %, depth] — depth 0 = front, 1 = far back
  [24, 30, 0.1], [17, 22, 0.35], [11, 15, 0.6], [6, 9, 0.85], [3.5, 5, 1],
];
const SWAP_MS = 420;
const POOL = 60;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export default function CoverField({ pool }: { pool: WallFont[] }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const fonts = useRef<WallFont[]>([]);
  const seq = useRef(0);
  const visible = useRef(true);
  const lockUntil = useRef(0);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);

  const make = useCallback((f: WallFont, tier?: number): Card => {
    const t = tier ?? Math.floor(Math.random() * SIZES.length);
    const [a, b, depth] = SIZES[t];
    const w = rand(a, b);
    return { key: seq.current++, f, w, depth, x: rand(-2, 100 - w + 2), y: rand(-4, 96) };
  }, []);

  // pick the covers once per visit
  useEffect(() => {
    fonts.current = shuffle(pool.filter((f) => f.c)).slice(0, POOL);
    const n = window.innerWidth < 700 ? 16 : 30;
    const tiers = Array.from({ length: n }, (_, i) => [0, 1, 1, 2, 2, 2, 3, 3, 3, 4][i % 10]);
    setCards(tiers.map((t, i) => make(fonts.current[i % fonts.current.length], t)));
  }, [pool, make]);

  // pause everything when the band is off screen or the tab is hidden
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; }, { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // the choppy rhythm: every few hundred ms one cover is swapped for another, somewhere else, at another size
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      if (!visible.current || document.hidden || focus !== null || !fonts.current.length) return;
      setCards((cs) => {
        if (!cs.length) return cs;
        const i = Math.floor(Math.random() * cs.length);
        const next = cs.slice();
        const tier = SIZES.findIndex((s) => s[2] === cs[i].depth);
        next[i] = make(fonts.current[Math.floor(Math.random() * fonts.current.length)], tier < 0 ? undefined : tier);
        return next;
      });
    }, SWAP_MS);
    return () => clearInterval(id);
  }, [focus, make]);

  // mouse drift (no re-render: two CSS variables on the band)
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width - 0.5;
      const my = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { el.style.setProperty('--mx', mx.toFixed(3)); el.style.setProperty('--my', my.toFixed(3)); });
    };
    el.addEventListener('pointermove', move);
    return () => { el.removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, []);

  const enter = (key: number) => {
    if (dwell.current) clearTimeout(dwell.current);
    if (Date.now() < lockUntil.current || key === focus) return;
    // a short pause so passing over covers doesn't make them jump
    dwell.current = setTimeout(() => { setFocus(key); lockUntil.current = Date.now() + 650; }, focus === null ? 140 : 260);
  };
  const leaveField = () => { if (dwell.current) clearTimeout(dwell.current); setFocus(null); };

  return (
    <div ref={field} className={`cfield${focus !== null ? ' has-focus' : ''}`} onPointerLeave={leaveField} onClick={(e) => { if (e.target === field.current) setFocus(null); }}>
      {cards.map((c) => {
        const on = c.key === focus;
        const tiny = c.w < 6;
        return (
          <Link
            key={c.key}
            href={`/fonts/${c.f.s}`}
            className={`cf-card${on ? ' is-on' : ''}${tiny ? ' is-tiny' : ''}`}
            style={{ left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, zIndex: on ? 100 : Math.round((1 - c.depth) * 50), ['--d' as string]: c.depth }}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') enter(c.key); }}
            onClick={(e) => { if (!on && !window.matchMedia('(hover: hover)').matches) { e.preventDefault(); setFocus(c.key); } }}
            aria-label={`${c.f.n}${c.f.by ? ` by ${c.f.by}` : ''}`}
            tabIndex={tiny ? -1 : undefined}
          >
            <img src={thumbUrl(c.f.c, on || c.w > 20 ? 640 : c.w > 10 ? 384 : 256)} alt="" loading="eager" decoding="async" draggable={false} />
            {on ? <span className="cf-card__cap"><b>{c.f.n}</b><span>{c.f.by}</span></span> : null}
          </Link>
        );
      })}
    </div>
  );
}
