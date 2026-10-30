'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { db, type Row } from '@/lib/admin/db';
import { coverOf, dupKey, img, useData } from '@/lib/admin/store';
import { personHref } from '@/lib/format';
import { mergePeople } from '@/lib/admin/merge';
import { placeOf } from '@/lib/places';
import { ConfirmButton, CountryPicker, Field, SingleImage, StatusPill, slugify, useToast } from './ui';

type Kind = 'designer' | 'foundry';
const SOCIAL = [
  { key: 'website_url', label: 'Website' },
  { key: 'instagram_url', label: 'Instagram' },
  { key: 'behance_url', label: 'Behance' },
  { key: 'linkedin_url', label: 'LinkedIn' },
  { key: 'x_url', label: 'X / Twitter' },
  { key: 'myfonts_url', label: 'MyFonts' },
];

type Form = { name: string; slug: string; slugTouched: boolean; type: Kind; country: string; bio: string; logo: string; social: Record<string, string> };

function fromRow(p: Row | undefined, kind: Kind): Form {
  if (!p) return { name: '', slug: '', slugTouched: false, type: kind, country: '', bio: '', logo: '', social: {} };
  const slug = String(p.slug ?? '');
  // until the database has a country column, show the researched country the site uses
  const country = String(p.country ?? '') || placeOf(slug).from || '';
  return {
    name: String(p.name ?? ''), slug, slugTouched: true, type: p.type === 'foundry' ? 'foundry' : 'designer', country,
    bio: String(p.bio ?? ''), logo: String(p.logo ?? ''), social: { ...((p.social_links as Record<string, string>) ?? {}) },
  };
}

export default function PersonEditor({ id, kind }: { id?: string; kind: Kind }) {
  const { data, personById, fontsOf, reload } = useData();
  const router = useRouter();
  const toast = useToast();
  const existing = id ? personById.get(id) : undefined;
  const [form, setForm] = useState<Form>(() => fromRow(existing, kind));
  const [initial, setInitial] = useState(() => JSON.stringify(fromRow(existing, kind)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const f = fromRow(existing, kind);
    setForm(f);
    setInitial(JSON.stringify(f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!existing]);

  const dirty = JSON.stringify(form) !== initial;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const similar = useMemo(() => {
    if (!data || form.name.trim().length < 3) return [];
    return data.people.filter((p) => String(p.id) !== id && dupKey(String(p.name)) === dupKey(form.name));
  }, [data, form.name, id]);

  if (!data) return null;
  if (id && !existing) return <div className="dz-empty">Not found. <Link href={`/dashboard/${kind === 'foundry' ? 'foundries' : 'designers'}`}>Back</Link></div>;

  const fonts = id ? fontsOf(id) : [];
  const listHref = `/dashboard/${form.type === 'foundry' ? 'foundries' : 'designers'}`;
  const noun = form.type === 'foundry' ? 'foundry' : 'designer';
  const countryFromResearch = !data.hasCountry || (existing && !existing.country && !!form.country);

  async function save() {
    if (!form.name.trim()) { toast('Add a name first.', 'err'); return; }
    setBusy(true);
    try {
      const taken = new Set(data!.people.filter((p) => String(p.id) !== id).map((p) => String(p.slug)));
      let slug = slugify(form.slug || form.name) || `${noun}-${Date.now()}`;
      if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
      const social = Object.fromEntries(Object.entries(form.social).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      const row: Row = { name: form.name.trim(), slug, type: form.type, bio: form.bio.trim(), logo: form.logo || null, social_links: social, updated_at: new Date().toISOString() };
      if (data!.hasCountry) row.country = form.country || null;
      let pid = id;
      if (pid) await db.update('designers', { id: pid }, row);
      else pid = String((await db.insert('designers', row))[0].id);
      await db.log({ action: id ? 'update' : 'create', entity: 'designer', entity_id: pid, label: row.name, before: id ? { row: existing } : null, after: { row } });
      await db.refreshSite();
      await reload();
      toast(id ? 'Saved' : `${form.name.trim()} added`);
      const next = { ...form, slug };
      setForm(next);
      setInitial(JSON.stringify(next));
      if (!id || form.type !== kind) router.replace(`/dashboard/${form.type === 'foundry' ? 'foundries' : 'designers'}/${pid}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Saving failed', 'err');
    } finally {
      setBusy(false);
    }
  }

  const [mergeQ, setMergeQ] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  const mergeOptions = useMemo(() => {
    const n = mergeQ.trim().toLowerCase();
    if (!data || !n) return [];
    return data.people.filter((p) => String(p.id) !== id && String(p.name).toLowerCase().includes(n)).slice(0, 8);
  }, [data, mergeQ, id]);

  async function mergeInto() {
    const target = personById.get(mergeTo);
    if (!id || !existing || !target) return;
    setBusy(true);
    try {
      await mergePeople(data!, target, [existing]);
      await db.refreshSite();
      await reload();
      toast(`Merged ${form.name} into ${target.name}`);
      router.replace(`/dashboard/${target.type === 'foundry' ? 'foundries' : 'designers'}/${target.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Merge failed', 'err');
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    try {
      const credits = data!.links.designers.filter((r) => String(r.designer_id) === id);
      await db.remove('font_designers', { designer_id: id });
      await db.remove('designers', { id });
      await db.log({ action: 'delete', entity: 'designer', entity_id: id, label: form.name, before: { row: existing, credits } });
      await db.refreshSite();
      await reload();
      toast(`Deleted ${form.name}`);
      router.replace(listHref);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'err');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="dz-head">
        <div>
          <Link href={listHref} className="dz-crumb">← {form.type === 'foundry' ? 'Foundries' : 'Designers'}</Link>
          <h1 className="display" style={{ marginTop: 10 }}>{form.name.trim() || `New ${noun}`}</h1>
          {existing ? <p><a href={personHref(form.type, String(existing.slug))} target="_blank" rel="noreferrer">View profile on site ↗</a> · {fonts.length} font{fonts.length === 1 ? '' : 's'}</p> : null}
        </div>
      </div>

      <div className="dz-editor">
        <div>
          <section className="dz-section">
            <h2 className="dz-section__title">Profile</h2>
            <div className="dz-grid">
              <Field label="Name" required wide>
                <input className="dz-input" value={form.name} autoFocus={!id} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: f.slugTouched ? f.slug : slugify(e.target.value) }))} />
              </Field>
              {similar.length > 0 && (
                <div className="dz-warn dz-field--wide">
                  <b>Possible duplicate</b>
                  {similar.map((p) => <span key={String(p.id)}><Link href={`/dashboard/${p.type === 'foundry' ? 'foundries' : 'designers'}/${p.id}`} target="_blank">{String(p.name)}</Link> <span className="dz-muted">· {p.type === 'foundry' ? 'Foundry' : 'Designer'} · {fontsOf(String(p.id)).length} fonts</span></span>)}
                </div>
              )}
              <Field label="Type">
                <div className="dz-seg">
                  <button type="button" className={form.type === 'designer' ? 'is-on' : ''} onClick={() => setForm({ ...form, type: 'designer' })}>Designer</button>
                  <button type="button" className={form.type === 'foundry' ? 'is-on' : ''} onClick={() => setForm({ ...form, type: 'foundry' })}>Foundry</button>
                </div>
              </Field>
              <Field
                label={form.type === 'foundry' ? 'Country' : 'From'}
                hint={!data.hasCountry ? 'Shown from our research. Saving countries switches on after the one-time database update.' : countryFromResearch ? 'Suggested from our research — save to keep it.' : form.type === 'foundry' ? 'Where the foundry is from.' : 'Where they are from (shown on their profile).'}
              >
                <CountryPicker value={form.country} onChange={(country) => setForm({ ...form, country })} />
              </Field>
              <Field label="Web address" hint={`fahress.com/${form.type === 'foundry' ? 'foundries' : 'designers'}/${form.slug || '…'}`} wide>
                <input className="dz-input" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value), slugTouched: true })} />
              </Field>
              <Field label="Bio" wide hint="A few sentences about their background and work.">
                <textarea className="dz-textarea" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
              </Field>
            </div>
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">{form.type === 'foundry' ? 'Logo' : 'Photo'} <small>{form.type === 'foundry' ? 'shown in colour' : 'shown in black & white'}</small></h2>
            <SingleImage value={form.logo} onChange={(logo) => setForm({ ...form, logo })} grey={form.type !== 'foundry'} round={form.type !== 'foundry'} />
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Links</h2>
            <div className="dz-grid">
              {SOCIAL.map((s) => (
                <Field key={s.key} label={s.label}>
                  <input className="dz-input" placeholder="https://…" value={form.social[s.key] ?? ''} onChange={(e) => setForm({ ...form, social: { ...form.social, [s.key]: e.target.value } })} />
                </Field>
              ))}
            </div>
          </section>

          {id ? (
            <section className="dz-section">
              <h2 className="dz-section__title">Merge into another profile</h2>
              <p className="dz-hint" style={{ marginTop: -8 }}>Same person or foundry under another spelling? Their font credits move to the profile you pick, empty details are filled from this one, the old web address redirects, and this profile is removed.</p>
              <input className="dz-input" placeholder="Search designers and foundries…" value={mergeQ} onChange={(e) => { setMergeQ(e.target.value); setMergeTo(''); }} />
              {mergeOptions.length > 0 && !mergeTo && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {mergeOptions.map((p) => <button key={String(p.id)} type="button" className="dz-btn dz-btn--sm" onClick={() => { setMergeTo(String(p.id)); setMergeQ(String(p.name)); }}>{String(p.name)} · {p.type === 'foundry' ? 'Foundry' : 'Designer'} · {fontsOf(String(p.id)).length} fonts</button>)}
                </div>
              )}
              {mergeTo ? <div style={{ marginTop: 12 }}><ConfirmButton className="dz-btn dz-btn--primary" onConfirm={mergeInto}>Merge {form.name} into {String(personById.get(mergeTo)?.name)}</ConfirmButton></div> : null}
            </section>
          ) : null}

          {id ? (
            <section className="dz-section" style={{ borderColor: '#b42318' }}>
              <h2 className="dz-section__title">Delete</h2>
              <p className="dz-hint" style={{ marginTop: -8 }}>{fonts.length ? `Removes them and their credit from ${fonts.length} font${fonts.length === 1 ? '' : 's'}. The fonts stay.` : 'Removes this profile.'}</p>
              <ConfirmButton onConfirm={remove}>Delete this {noun}</ConfirmButton>
            </section>
          ) : null}
        </div>

        <aside className="dz-aside">
          <div className="dz-panel dz-panel--soft">
            <p className="dz-eyebrow">Fonts credited</p>
            {fonts.length === 0 ? <p className="dz-muted" style={{ margin: 0 }}>None yet. Credit them from a font&apos;s page.</p> : (
              <div style={{ display: 'grid', gap: 10, maxHeight: 520, overflowY: 'auto' }}>
                {fonts.map((f) => (
                  <Link key={String(f.id)} href={`/dashboard/fonts/${f.id}`} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 10, alignItems: 'center', textDecoration: 'none' }}>
                    {coverOf(f) ? <img className="dz-thumb" style={{ width: 72, height: 36 }} src={img(coverOf(f), 256)} alt="" loading="lazy" /> : <span className="dz-thumb" style={{ width: 72, height: 36 }} />}
                    <span><span style={{ fontSize: 14 }}>{String(f.name)}</span><br /><StatusPill status={String(f.status)} /></span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="dz-savebar">
        <span className="dz-savebar__note">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : id ? 'All changes saved' : ''}</span>
        <button type="button" className="dz-btn dz-btn--primary" disabled={busy || (!dirty && !!id)} onClick={save}>{id ? 'Save changes' : `Add ${noun}`}</button>
      </div>
    </>
  );
}
