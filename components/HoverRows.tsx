'use client';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { storageUrl } from '@/lib/format';

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

/** A list of links; hovering a row floats an image next to the cursor. */
export default function HoverRows({ rows, variant = 'top', empty }: { rows: HoverRow[]; variant?: 'top' | 'side'; empty?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [cur, setCur] = useState<HoverRow | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  const enter = (r: HoverRow) => {
    setCur(r);
    const pool = r.imgs && r.imgs.length ? r.imgs : r.img ? [r.img] : [];
    if (!pool.length) return setSrc(null);
    // pick a random image, avoiding an immediate repeat when there is a choice
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) while (next === src) next = pool[Math.floor(Math.random() * pool.length)];
    setSrc(next);
  };

  return (
    <div
      ref={box}
      className="rows"
      onMouseMove={(e) => {
        const r = box.current?.getBoundingClientRect();
        if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setCur(null)}
    >
      {rows.length === 0 ? empty : null}
      {rows.map((r) => (
        <Link key={r.key} href={r.href} className={r.className ?? 'row'} onMouseEnter={() => enter(r)} onFocus={() => setCur(null)}>
          {r.content}
        </Link>
      ))}
      {cur && src ? (
        <div
          aria-hidden="true"
          className={`cursor-preview${variant === 'side' ? (cur.face ? ' cursor-preview--face' : ' cursor-preview--side') : ''}${cur.grey ? ' cursor-preview--grey' : ''}`}
          style={{ left: pos.x, top: pos.y }}
        >
          <img key={src} src={storageUrl(src)} alt="" />
        </div>
      ) : null}
    </div>
  );
}
