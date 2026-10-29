'use client';
import { useState } from 'react';
import { db } from '@/lib/admin/db';
import { dupKey, useData } from '@/lib/admin/store';
import { CountryPicker, Field, SingleImage, slugify, useToast } from './ui';

/** Small pop-up to add a designer or foundry without leaving the font form. */
export default function PersonQuickAdd({ name, onClose, onCreated }: { name: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { data, reload } = useData();
  const toast = useToast();
  const [form, setForm] = useState({ name, type: 'designer', country: '', logo: '' });
  const [busy, setBusy] = useState(false);
  const similar = data?.people.filter((p) => dupKey(String(p.name)) === dupKey(form.name)) ?? [];

  async function create() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const taken = new Set(data!.people.map((p) => String(p.slug)));
      let slug = slugify(form.name) || `designer-${Date.now()}`;
      if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
      const row: Record<string, unknown> = { name: form.name.trim(), slug, type: form.type, logo: form.logo || null, social_links: {}, bio: '' };
      if (data!.hasCountry) row.country = form.country || null;
      const [made] = await db.insert('designers', row);
      await reload();
      toast(`Added ${form.name.trim()}`);
      onCreated(String(made.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dz-modal" role="dialog" aria-modal="true" aria-label="Add designer or foundry" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dz-modal__card">
        <h2 className="dz-h2">Add a designer or foundry</h2>
        <div style={{ display: 'grid', gap: 18 }}>
          <Field label="Name" required><input className="dz-input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          {similar.length > 0 && <div className="dz-warn"><b>Already in the archive?</b>{similar.map((p) => <span key={String(p.id)}>{String(p.name)} <span className="dz-muted">· {p.type === 'foundry' ? 'Foundry' : 'Designer'}</span></span>)}</div>}
          <Field label="Type">
            <div className="dz-seg">
              <button type="button" className={form.type === 'designer' ? 'is-on' : ''} onClick={() => setForm({ ...form, type: 'designer' })}>Designer</button>
              <button type="button" className={form.type === 'foundry' ? 'is-on' : ''} onClick={() => setForm({ ...form, type: 'foundry' })}>Foundry</button>
            </div>
          </Field>
          <Field label={form.type === 'foundry' ? 'Country' : 'From'} hint={data?.hasCountry ? 'Where they are from.' : 'Country saving switches on after the one-time database update.'}>
            <CountryPicker value={form.country} onChange={(country) => setForm({ ...form, country })} />
          </Field>
          <Field label={form.type === 'foundry' ? 'Logo' : 'Photo'}><SingleImage value={form.logo} onChange={(logo) => setForm({ ...form, logo })} grey={form.type !== 'foundry'} round={form.type !== 'foundry'} /></Field>
          <p className="dz-hint" style={{ margin: 0 }}>You can add their bio and links later from their profile.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="dz-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="dz-btn dz-btn--primary" disabled={busy || !form.name.trim()} onClick={create}>{busy ? 'Adding…' : 'Add and credit'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
