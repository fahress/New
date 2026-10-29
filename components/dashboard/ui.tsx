'use client';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { COMMON, COUNTRIES, countryByName } from '@/lib/admin/countries';
import { db } from '@/lib/admin/db';
import { img } from '@/lib/admin/store';

/* ---------------- toasts ---------------- */
type Toast = { id: number; text: string; tone: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function Toasts({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'err' ? 9000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="dz-toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`dz-toast dz-toast--${t.tone}`} onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- field ---------------- */
export function Field({ label, hint, required, children, error, wide }: { label: string; hint?: React.ReactNode; required?: boolean; children: React.ReactNode; error?: string | null; wide?: boolean }) {
  return (
    <div className={`dz-field${wide ? ' dz-field--wide' : ''}`}>
      <span className="dz-label">{label}{required ? <i aria-hidden="true"> *</i> : null}</span>
      {children}
      {error ? <span className="dz-error">{error}</span> : hint ? <span className="dz-hint">{hint}</span> : null}
    </div>
  );
}

/* ---------------- status ---------------- */
export const STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'pending', label: 'In review' },
  { id: 'published', label: 'Published' },
  { id: 'featured', label: 'Featured' },
] as const;
export function StatusPill({ status }: { status: string }) {
  const s = STATUSES.find((x) => x.id === status);
  return <span className={`dz-status dz-status--${status}`}>{s?.label ?? status}</span>;
}

/* ---------------- multi picker ---------------- */
export type Option = { id: string; label: string; meta?: string; thumb?: string | null; grey?: boolean };

export function MultiPicker({
  options, value, onChange, placeholder = 'Search…', single = false, onCreate, createLabel, orderable = false,
}: {
  options: Option[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; single?: boolean;
  onCreate?: (text: string) => void; createLabel?: string; orderable?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    const pool = options.filter((o) => !value.includes(o.id));
    if (!n) return pool.slice(0, 60);
    const starts = pool.filter((o) => o.label.toLowerCase().startsWith(n));
    const words = pool.filter((o) => !starts.includes(o) && o.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(n)));
    const rest = pool.filter((o) => !starts.includes(o) && !words.includes(o) && o.label.toLowerCase().includes(n));
    return [...starts, ...words, ...rest].slice(0, 60);
  }, [options, value, q]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (id: string) => {
    onChange(single ? [id] : [...value, id]);
    setQ('');
    setHi(0);
    if (single) setOpen(false);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const v = value.slice();
    [v[i], v[j]] = [v[j], v[i]];
    onChange(v);
  };

  return (
    <div className="dz-picker" ref={box}>
      {value.length > 0 && (
        <div className="dz-chips">
          {value.map((id, i) => {
            const o = byId.get(id);
            return (
              <span key={id} className="dz-chip">
                {o?.thumb ? <img src={o.thumb} alt="" className={o.grey ? 'is-grey' : ''} /> : null}
                {o?.label ?? 'Unknown'}
                {orderable && value.length > 1 ? (
                  <>
                    <button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>‹</button>
                    <button type="button" aria-label="Move later" disabled={i === value.length - 1} onClick={() => move(i, 1)}>›</button>
                  </>
                ) : null}
                <button type="button" aria-label={`Remove ${o?.label ?? ''}`} onClick={() => onChange(value.filter((x) => x !== id))}>×</button>
              </span>
            );
          })}
        </div>
      )}
      {(!single || value.length === 0) && (
        <input
          className="dz-input"
          value={q}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (results[hi]) pick(results[hi].id); else if (onCreate && q.trim()) { onCreate(q.trim()); setQ(''); } }
            else if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
          }}
        />
      )}
      {open && (results.length > 0 || (onCreate && q.trim())) && (
        <ul className="dz-menu" id={listId} role="listbox">
          {results.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === hi} className={i === hi ? 'is-hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.id); }}>
              {o.thumb !== undefined ? (o.thumb ? <img src={o.thumb} alt="" className={o.grey ? 'is-grey' : ''} /> : <span className="dz-mono-av">{o.label[0]}</span>) : null}
              <span>{o.label}</span>
              {o.meta ? <small>{o.meta}</small> : null}
            </li>
          ))}
          {onCreate && q.trim() ? (
            <li className="dz-menu__create" onMouseDown={(e) => { e.preventDefault(); onCreate(q.trim()); setQ(''); setOpen(false); }}>
              + {createLabel ?? 'Create'} “{q.trim()}”
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/* ---------------- country picker ---------------- */
export function CountryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = countryByName(value);
  const options: Option[] = useMemo(() => {
    const common = COMMON.map((n) => countryByName(n)!).filter(Boolean);
    const rest = COUNTRIES.filter((c) => !COMMON.includes(c.name));
    return [...common, ...rest].map((c) => ({ id: c.name, label: `${c.flag}  ${c.name}` }));
  }, []);
  const current = value ? [known ? known.name : value] : [];
  const opts = known || !value ? options : [{ id: value, label: value }, ...options];
  return <MultiPicker single options={opts} value={current} onChange={(v) => onChange(v[0] ?? '')} placeholder="Search countries…" />;
}

/* ---------------- images ---------------- */
const MAX_BYTES = 2 * 1024 * 1024;

/** Big photos are shrunk in the browser before upload (max 2400px wide, WebP), so pages stay fast. */
async function shrink(file: File): Promise<File> {
  if (file.size <= MAX_BYTES || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.86));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
}

export function useUploader() {
  const toast = useToast();
  const [busy, setBusy] = useState(0);
  const upload = useCallback(async (files: File[]): Promise<string[]> => {
    const out: string[] = [];
    setBusy((b) => b + files.length);
    for (const f of files) {
      try {
        if (!f.type.startsWith('image/')) { toast(`${f.name} isn't an image`, 'err'); continue; }
        out.push(await db.upload(await shrink(f)));
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Upload failed', 'err');
      } finally {
        setBusy((b) => b - 1);
      }
    }
    return out;
  }, [toast]);
  return { upload, busy };
}

export function DropZone({ onFiles, multiple = true, children, compact = false }: { onFiles: (f: File[]) => void; multiple?: boolean; children?: React.ReactNode; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dz-drop${over ? ' is-over' : ''}${compact ? ' dz-drop--compact' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
    >
      <input ref={input} type="file" accept="image/*" multiple={multiple} hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      {children ?? <><b>Drop images here</b><span>or click to choose · JPG, PNG, WEBP, GIF, SVG · big files are shrunk automatically</span></>}
    </div>
  );
}

/** Single image (photo / logo / award badge). */
export function SingleImage({ value, onChange, grey = false, round = false }: { value: string; onChange: (v: string) => void; grey?: boolean; round?: boolean }) {
  const { upload, busy } = useUploader();
  return (
    <div className="dz-single">
      <div className={`dz-single__img${round ? ' is-round' : ''}`}>
        {value ? <img src={img(value, 256)} alt="" className={grey ? 'is-grey' : ''} /> : <span>No image</span>}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <DropZone compact multiple={false} onFiles={async (f) => { const [p] = await upload(f.slice(0, 1)); if (p) onChange(p); }}>
          <b>{busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}</b>
        </DropZone>
        {value ? <button type="button" className="dz-link" onClick={() => onChange('')}>Remove</button> : null}
      </div>
    </div>
  );
}

/* ---------------- confirm ---------------- */
export function ConfirmButton({ children, onConfirm, label = 'Click again to confirm', className = 'dz-btn dz-btn--danger' }: { children: React.ReactNode; onConfirm: () => void; label?: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button type="button" className={className} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? label : children}
    </button>
  );
}

export function Loading({ text = 'Loading the archive…' }: { text?: string }) {
  return <div className="dz-loading"><span className="dz-spin" aria-hidden="true" />{text}</div>;
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '');

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const u: [number, string][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [2592000, 'month'], [31536000, 'year']];
  let i = 0;
  while (i < u.length - 1 && s >= u[i + 1][0]) i++;
  const n = Math.floor(s / u[i][0]);
  return `${n} ${u[i][1]}${n === 1 ? '' : 's'} ago`;
};
