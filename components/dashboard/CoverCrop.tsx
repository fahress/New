'use client';
import { useEffect, useRef, useState } from 'react';
import { DEMO } from '@/lib/admin/client';
import { demoUrls } from '@/lib/admin/db';
import { storageUrl } from '@/lib/format';

/** Covers are shown in a 2:1 frame everywhere on the site. */
const RATIO = 2;
const OUT_W = 2000;

type Props = { src: string; onCancel: () => void; onDone: (file: File) => void | Promise<void> };

/** Lets the editor choose which part of an image shows on the cover: drag the image under a 2:1 frame, optionally zoom. */
export default function CoverCrop({ src, onCancel, onDone }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [im, setIm] = useState<HTMLImageElement | null>(null);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 }); // centre of the frame, as a fraction of the image
  const [frameW, setFrameW] = useState(560);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setIm(i);
    i.onerror = () => setErr('Could not load this image.');
    i.src = (DEMO && demoUrls.get(src)) || storageUrl(src);
  }, [src]);

  useEffect(() => {
    const measure = () => setFrameW(Math.min(640, (box.current?.clientWidth ?? 600) - 0));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const frameH = frameW / RATIO;
  // the image is scaled so it always covers the frame; zoom enlarges it further
  const base = im ? Math.max(frameW / im.naturalWidth, frameH / im.naturalHeight) : 1;
  const scale = base * zoom;
  const imgW = im ? im.naturalWidth * scale : 0;
  const imgH = im ? im.naturalHeight * scale : 0;
  const clamp = (v: number, size: number, frame: number) => {
    if (size <= frame) return 0.5;
    const half = frame / 2 / size;
    return Math.min(1 - half, Math.max(half, v));
  };
  const cx = clamp(pos.x, imgW, frameW);
  const cy = clamp(pos.y, imgH, frameH);
  const left = frameW / 2 - cx * imgW;
  const top = frameH / 2 - cy * imgH;
  const vertical = im ? im.naturalHeight / im.naturalWidth > 1 / RATIO : true;

  const onDown = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: cx, y: cy }; };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !imgW) return;
    const d = drag.current;
    setPos({ x: d.x - (e.clientX - d.px) / imgW, y: d.y - (e.clientY - d.py) / imgH });
  };
  const onUp = () => { drag.current = null; };
  const nudge = (dx: number, dy: number) => setPos({ x: cx + dx * (frameW / imgW), y: cy + dy * (frameH / imgH) });

  async function save() {
    if (!im) return;
    setSaving(true);
    try {
      const sw = frameW / scale, sh = frameH / scale; // frame size in source pixels
      const sx = cx * im.naturalWidth - sw / 2, sy = cy * im.naturalHeight - sh / 2;
      const outW = Math.min(OUT_W, Math.round(sw * 2)) || OUT_W;
      const c = document.createElement('canvas');
      c.width = outW; c.height = Math.round(outW / RATIO);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Could not create the cover'))), 'image/jpeg', 0.9));
      await onDone(new File([blob], 'cover-crop.jpg', { type: 'image/jpeg' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the cover');
      setSaving(false);
    }
  }

  return (
    <div className="dz-modal" role="dialog" aria-modal="true" aria-label="Choose the cover area" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div className="dz-modal__card" style={{ display: 'grid', gap: 16, maxWidth: 720, width: '100%' }}>
        <h2 className="dz-h2" style={{ margin: 0 }}>Choose the cover area</h2>
        <p className="dz-muted" style={{ margin: 0 }}>The frame is the cover as it appears on the site (2:1). Drag the image {vertical ? 'up or down' : 'left or right'} to choose what shows; zoom in to show a smaller part.</p>
        <div ref={box} style={{ width: '100%' }}>
          <div
            style={{ position: 'relative', width: frameW, height: frameH, margin: '0 auto', overflow: 'hidden', borderRadius: 8, background: '#eee', cursor: im ? 'grab' : 'default', touchAction: 'none', boxShadow: '0 0 0 2px var(--ink)' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02;
              if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
              if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
              if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
            }}
          >
            {im ? <img src={im.src} alt="" draggable={false} style={{ position: 'absolute', left, top, width: imgW, height: imgH, maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' }} /> : <span className="dz-loading" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><span className="dz-spin" /></span>}
          </div>
        </div>
        {im ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="dz-muted" style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 220 }}>
              Zoom
              <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ flex: 1 }} />
            </label>
            <button type="button" className="dz-btn dz-btn--sm" onClick={() => { setZoom(1); setPos({ x: 0.5, y: 0.5 }); }}>Reset</button>
            <small className="dz-muted">Image {im.naturalWidth}×{im.naturalHeight}px · cover 2:1</small>
          </div>
        ) : null}
        {err ? <p className="dz-error" style={{ margin: 0 }}>{err}</p> : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="dz-btn" disabled={saving} onClick={onCancel}>Cancel</button>
          <button type="button" className="dz-btn dz-btn--primary" disabled={!im || saving} onClick={save}>{saving ? 'Saving…' : 'Use this area'}</button>
        </div>
      </div>
    </div>
  );
}
