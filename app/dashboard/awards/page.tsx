'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmButton, Field, SingleImage, useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { img, useData } from '@/lib/admin/store';

export default function Awards() {
  const { data, fontById, reload } = useData();
  const toast = useToast();
  const [edit, setEdit] = useState<{ id?: string; name: string; image: string; bio: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const fontsFor = (a: Row) => data.links.awards.filter((r) => String(r.award_id) === String(a.id)).map((r) => fontById.get(String(r.font_id))).filter(Boolean) as Row[];

  async function save() {
    if (!edit?.name.trim()) return;
    setBusy(true);
    try {
      const row = { name: edit.name.trim(), image: edit.image || null, bio: edit.bio.trim() || null };
      if (edit.id) await db.update('awards', { id: edit.id }, { ...row, updated_at: new Date().toISOString() });
      else await db.insert('awards', row);
      await db.refreshSite();
      await reload();
      toast('Saved');
      setEdit(null);
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    try {
      await db.remove('font_awards', { award_id: id });
      await db.remove('awards', { id });
      await db.refreshSite();
      await reload();
      toast('Award deleted');
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  }

  return (
    <>
      <div className="dz-head">
        <div><p className="dz-eyebrow">Awards</p><h1 className="display">{data.awards.length} awards</h1><p>Give a font an award from the font&apos;s own page.</p></div>
        <button type="button" className="dz-btn dz-btn--primary" onClick={() => setEdit({ name: '', image: '', bio: '' })}>+ New award</button>
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        {data.awards.map((a) => {
          const fonts = fontsFor(a);
          return (
            <section key={String(a.id)} className="dz-panel">
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                {a.image ? <img src={img(String(a.image), 256)} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} /> : null}
                <div style={{ flex: 1 }}><h3>{String(a.name)}</h3><span className="dz-muted">{fonts.length} font{fonts.length === 1 ? '' : 's'}</span></div>
                <button type="button" className="dz-btn dz-btn--sm" onClick={() => setEdit({ id: String(a.id), name: String(a.name), image: String(a.image ?? ''), bio: String(a.bio ?? '') })}>Edit</button>
                <ConfirmButton className="dz-btn dz-btn--sm dz-btn--danger" onConfirm={() => remove(String(a.id))}>Delete</ConfirmButton>
              </div>
              {fonts.length > 0 && <div className="dz-tags" style={{ marginTop: 14 }}>{fonts.map((f) => <Link key={String(f.id)} className="dz-tag" href={`/dashboard/fonts/${f.id}`}>{String(f.name)}</Link>)}</div>}
            </section>
          );
        })}
      </div>
      {edit && (
        <div className="dz-modal" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(null); }}>
          <div className="dz-modal__card" style={{ display: 'grid', gap: 18 }}>
            <h2 className="dz-h2">{edit.id ? 'Edit award' : 'New award'}</h2>
            <Field label="Name" required><input className="dz-input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Badge or logo"><SingleImage value={edit.image} onChange={(image) => setEdit({ ...edit, image })} /></Field>
            <Field label="About"><textarea className="dz-textarea" value={edit.bio} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} /></Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="dz-btn" onClick={() => setEdit(null)}>Cancel</button>
              <button type="button" className="dz-btn dz-btn--primary" disabled={busy || !edit.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
