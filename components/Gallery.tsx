'use client';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { storageUrl, thumbUrl } from '@/lib/format';

export default function Gallery({ images, name }: { images: string[]; name: string }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const n = images.length;
  const go = useCallback((k: number) => { setI(((k % n) + n) % n); setTick((t) => t + 1); }, [n]);

  useEffect(() => {
    if (n < 2 || paused) return;
    const t = setTimeout(() => go(i + 1), 6000);
    return () => clearTimeout(t);
  }, [i, n, paused, go, tick]);

  if (!n) return null;
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(i + 1);
        if (e.key === 'ArrowLeft') go(i - 1);
      }}
    >
      <div className="stage" role="region" aria-roledescription="carousel" aria-label={`${name} presentation images`}>
        {images.map((src, k) => (
          <Image
            key={src}
            src={storageUrl(src)}
            alt={`${name} — presentation image ${k + 1} of ${n}`}
            fill
            sizes="(max-width: 900px) 100vw, 66vw"
            priority={k === 0}
            loading={k === 0 ? undefined : 'lazy'}
            style={{ opacity: k === i ? 1 : 0, transform: k === i ? 'none' : 'scale(1.04)' }}
            aria-hidden={k !== i}
          />
        ))}
        {n > 1 ? (
          <>
            <button type="button" className="stage__nav" style={{ left: 14 }} onClick={() => go(i - 1)} aria-label="Previous image">←</button>
            <button type="button" className="stage__nav" style={{ right: 14 }} onClick={() => go(i + 1)} aria-label="Next image">→</button>
            <span className="stage__count mono">{String(i + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</span>
            {!paused ? <div className="stage__prog"><div key={`${i}-${tick}`} /></div> : null}
          </>
        ) : null}
      </div>
      {n > 1 ? (
        <div className="thumbs">
          {images.map((src, k) => (
            <button key={src} type="button" aria-pressed={k === i} aria-label={`Show image ${k + 1}`} onClick={() => go(k)}>
              <img src={thumbUrl(src, 256)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
