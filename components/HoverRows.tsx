'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { thumbUrl } from '@/lib/format';

export type HoverRow = {
  key: string;
  href: string;
  img: string | null;
  /** When given, each hover shows a random image from this list instead of `img`. */
  imgs?: string[];
  face?: boolean;
  grey?: boolean;
  content: ReactNode;
  className?: string;
};

/** Small preview size: the floating box is ~340px wide, so 384px is plenty and light to download. */
const PREVIEW_W = 384 as const;
const small = (path: string) => thumbUrl(path, PREVIEW_W);

const loaded = new Set<string>();
function preload(path: string): Promise<void> {
  const url = small(path);
  if (loaded.has(url)) return Promise.resolve();
  return new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => { loaded.add(url); resolve(); };
    im.onerror = () => resolve();
    im.src = url;
  });
}

const pickRandom = (pool: string[], avoid?: string | null) => {
  if (pool.length === 1) return pool[0];
  let next = pool[Math.floor(Math.random() * pool.length)];
  while (next === avoid) next = pool[Math.floor(Math.random() * pool.length)];
  return next;
};

/** A list of links; hovering a row floats a small image next to the cursor. */
export default function HoverRows({ rows, variant = 'top', empty }: { rows: HoverRow[]; variant?: 'top' | 'side'; empty?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [cur, setCur] = useState<HoverRow | null>(null);
  const [shown, setShown] = useState<string | null>(null); // image currently on screen (already downloaded)
  const wanted = useRef<string | null>(null);
  const queued = useRef<Record<string, string>>({}); // next image per row, downloaded ahead of time

  const poolOf = (r: HoverRow) => (r.imgs && r.imgs.length ? r.imgs : r.img ? [r.img] : []);

  const queueNext = useCallback((r: HoverRow, avoid?: string | null) => {
    const pool = r.imgs && r.imgs.length ? r.imgs : r.img ? [r.img] : [];
    if (!pool.length) return;
    const next = pickRandom(pool, avoid);
    queued.current[r.key] = next;
    void preload(next);
  }, []);

  // once the page is idle, quietly download one preview per row (only for short lists such as scripts)
  useEffect(() => {
    if (rows.length > 20) return;
    const run = () => rows.forEach((r) => queueNext(r));
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run);
    else setTimeout(run, 1500);
  }, [rows, queueNext]);

  const enter = (r: HoverRow) => {
    setCur(r);
    const pool = poolOf(r);
    if (!pool.length) { wanted.current = null; setShown(null); return; }
    const next = queued.current[r.key] ?? pickRandom(pool, shown);
    wanted.current = next;
    // people lists: never show the previous person's picture under a new name
    if (variant === 'side' && !loaded.has(small(next))) setShown(null);
    // keep the previous picture until the new one has arrived, so the box is never empty
    preload(next).then(() => { if (wanted.current === next) setShown(next); });
    queueNext(r, next); // get the following one ready for the next hover
  };

  return (
    <div
      ref={box}
      className="rows"
      onMouseMove={(e) => {
        const b = box.current?.getBoundingClientRect();
        if (b) setPos({ x: e.clientX - b.left, y: e.clientY - b.top });
      }}
      onMouseLeave={() => { setCur(null); wanted.current = null; }}
    >
      {rows.length === 0 ? empty : null}
      {rows.map((r) => (
        <Link
          key={r.key}
          href={r.href}
          className={r.className ?? 'row'}
          onMouseEnter={() => enter(r)}
          onFocus={() => setCur(null)}
        >
          {r.content}
        </Link>
      ))}
      {cur && poolOf(cur).length ? (
        <div
          aria-hidden="true"
          className={`cursor-preview${variant === 'side' ? (cur.face ? ' cursor-preview--face' : ' cursor-preview--side') : ''}${cur.grey ? ' cursor-preview--grey' : ''}${shown ? '' : ' is-loading'}`}
          style={{ left: pos.x, top: pos.y }}
        >
          {shown ? <img key={shown} src={small(shown)} alt="" /> : null}
        </div>
      ) : null}
    </div>
  );
}
