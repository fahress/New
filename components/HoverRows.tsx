'use client';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { storageUrl } from '@/lib/format';

export type HoverRow = { key: string; href: string; img: string | null; face?: boolean; content: ReactNode; className?: string };

/** A list of links; hovering a row floats an image next to the cursor. */
export default function HoverRows({ rows, variant = 'top', empty }: { rows: HoverRow[]; variant?: 'top' | 'side'; empty?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [cur, setCur] = useState<HoverRow | null>(null);

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
        <Link key={r.key} href={r.href} className={r.className ?? 'row'} onMouseEnter={() => setCur(r)} onFocus={() => setCur(null)}>
          {r.content}
        </Link>
      ))}
      {cur && cur.img ? (
        <div
          aria-hidden="true"
          className={`cursor-preview${variant === 'side' ? (cur.face ? ' cursor-preview--face' : ' cursor-preview--side') : ''}`}
          style={{ left: pos.x, top: pos.y }}
        >
          <img src={storageUrl(cur.img)} alt="" />
        </div>
      ) : null}
    </div>
  );
}
