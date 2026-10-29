'use client';
import { useState } from 'react';
import FontCard, { type CardFont } from './FontCard';

export default function WorkGrid({ fonts, filters }: { fonts: (CardFont & { keys: string[] })[]; filters: string[] }) {
  const [f, setF] = useState('All');
  const list = f === 'All' ? fonts : fonts.filter((x) => x.keys.includes(f));
  return (
    <>
      {filters.length > 1 ? (
        <div role="group" aria-label="Filter by script" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
          {['All', ...filters].map((k) => (
            <button key={k} type="button" className={`pill${f === k ? ' pill--solid' : ''}`} style={{ minHeight: 40, padding: '0 16px', fontSize: 14, cursor: 'pointer', background: f === k ? undefined : 'var(--paper)' }} aria-pressed={f === k} onClick={() => setF(k)}>
              {k} <span className="mono" style={{ fontSize: 10, opacity: .7 }}>{k === 'All' ? fonts.length : fonts.filter((x) => x.keys.includes(k)).length}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid">
        {list.map((x, i) => <FontCard key={x.slug} f={x} index={i} priority={i < 3} />)}
      </div>
    </>
  );
}
