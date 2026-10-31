'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, type Row } from '@/lib/admin/db';
import { LINK_TABLES, coverOf, dupKey, img, useData, type Data } from '@/lib/admin/store';
import { ConfirmButton, DropZone, Field, MultiPicker, STATUSES, StatusPill, slugify, useToast, useUploader, type Option } from './ui';
import PersonQuickAdd from './PersonQuickAdd';
import type { Prefill } from '@/lib/admin/prefill';

type Form = {
  name: string; slug: string; slugTouched: boolean; year: string; description: string; status: string; license: string;
  weights: string; variable: boolean; scripts: string[]; groups: string[]; genres: string[]; styles: string[]; types: string[];
  people: string[]; awards: { id: string; url: string }[]; purchase: string[]; cases: string[]; source: string; images: string[]; cover: string;
};

const blank: Form = {
  name: '', slug: '', slugTouched: false, year: '', description: '', status: 'draft', license: 'paid', weights: '', variable: false,
  scripts: [], groups: [], genres: [], styles: [], types: [], people: [], awards: [], purchase: [''], cases: [], source: '', images: [], cover: '',
};

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function fromRow(f: Row, data: Data, linked: (id: string, k: keyof Data['links']) => string[]): Form {
  const id = String(f.id);
  const awardRows = data.links.awards.filter((a) => String(a.font_id) === id);
  const images = strs(f.images);
  const cover = String(f.cover ?? '');
  return {
    name: String(f.name ?? ''), slug: String(f.slug ?? ''), slugTouched: true, year: f.year ? String(f.year) : '',
    description: String(f.description ?? ''), status: String(f.status ?? 'draft'), license: String(f.license ?? 'paid'),
    weights: f.weights ? String(f.weights) : '', variable: f.is_variable === true,
    scripts: linked(id, 'scripts'), groups: strs(f.language_group), genres: linked(id, 'genres'), styles: linked(id, 'styles'), types: linked(id, 'types'),
    people: linked(id, 'designers'), awards: awardRows.map((a) => ({ id: String(a.award_id), url: String(a.url ?? '') })),
    purchase: strs(f.purchase_links).length ? strs(f.purchase_links) : [''], cases: strs(f.case_studies), source: String(f.source_url ?? ''),
    images: cover && !images.includes(cover) ? [cover, ...images] : images, cover,
  };
}

/** Everything about a font, for the history (so a delete or merge can be undone). */
export function snapshotFont(fontId: string, data: Data, fontById: Map<string, Row>) {
  const links = Object.fromEntries(Object.entries(LINK_TABLES).map(([k, { table }]) => [table, data.links[k as keyof Data['links']].filter((r) => String(r.font_id) === fontId)]));
  return { row: fontById.get(fontId) ?? null, links };
}

export default function FontEditor({ id, prefill }: { id?: string; prefill?: Prefill }) {
  const { data, linked, fontById, reload } = useData();
  const router = useRouter();
  const toast = useToast();
  const { upload, busy: uploading } = useUploader();
  const existing = id ? fontById.get(id) : undefined;
  const [form, setForm] = useState<Form>(blank);
  const [initial, setInitial] = useState<string>(JSON.stringify(blank));
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [remote, setRemote] = useState<string[]>([]);
  const [newNames, setNewNames] = useState<string[]>([]);
  const [fillUrl, setFillUrl] = useState('');
  // the font's own source / buy link is ready in "Fill from a link"
  useEffect(() => {
    if (!existing) return;
    const link = String(existing.source_url || (Array.isArray(existing.purchase_links) ? existing.purchase_links[0] : '') || '');
    if (/^https?:\/\//.test(link)) setFillUrl((u) => u || link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);
  const [filling, setFilling] = useState(false);
  const [importing, setImporting] = useState(0);
  const isEditor = data?.role === 'editor';

  useEffect(() => {
    if (!data) return;
    const f = existing ? fromRow(existing, data, linked) : blank;
    setForm(f);
    setInitial(JSON.stringify(f));
    if (!existing && prefill) applyFill(prefill);
    // only when switching font
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!data, !!existing]);

  /** Merges a draft into the form. Only fills fields that are still empty. */
  function applyFill(p: Prefill) {
    if (!data) return;
    const matched: string[] = [];
    const unknown: string[] = [];
    for (const n of p.designers ?? []) {
      const k = dupKey(n);
      const hit = k ? data.people.find((x) => dupKey(String(x.name)) === k) : undefined;
      if (hit) matched.push(String(hit.id)); else if (n.trim()) unknown.push(n.trim());
    }
    setForm((f) => {
      const name = f.name || (p.name ?? '').trim();
      const links = (p.links ?? []).filter(Boolean);
      return {
        ...f,
        name,
        slug: f.slugTouched ? f.slug : slugify(name),
        description: f.description || (p.description ?? ''),
        year: f.year || (p.year ? String(p.year).slice(0, 4) : ''),
        license: p.license && !f.purchase.some(Boolean) ? p.license : f.license,
        purchase: f.purchase.some(Boolean) ? f.purchase : links.length ? links : f.purchase,
        source: f.source || (p.source ?? ''),
        people: [...f.people, ...matched.filter((m) => !f.people.includes(m))],
        images: p.stored?.length ? [...new Set([...f.images, ...p.stored])] : f.images,
        cover: f.cover || p.stored?.[0] || '',
      };
    });
    setNewNames((n) => [...new Set([...n, ...unknown])]);
    setRemote((r) => [...new Set([...r, ...(p.images ?? [])])].slice(0, 30));
  }

  async function fillFromLink() {
    const url = fillUrl.trim();
    if (!/^https?:\/\//i.test(url)) { toast('Paste a full link starting with https://', 'err'); return; }
    setFilling(true);
    try {
      const r = await db.api<{ url: string; host: string; title: string; description: string; year: number | null; license: string | null; designers: string[]; images: string[] }>('/api/dashboard/scrape', { url });
      const isStore = !/behance\.net|instagram\.com|dribbble\.com/.test(r.host);
      applyFill({ name: r.title, description: r.description, year: r.year, license: r.license ?? undefined, designers: r.designers, images: r.images, links: isStore ? [r.url] : [], source: r.url });
      // scripts named on the page (e.g. "Arabic", "Persian") are ticked if none are chosen yet
      const said = `${r.title} ${r.description}`.toLowerCase();
      const word = (n: string) => String(n).toLowerCase().replace(/[^a-z\u0600-\u06ff ]/g, '').trim();
      const scripts = data!.scripts.filter((sc) => word(sc.name).length >= 3 && new RegExp(`\\b${word(sc.name)}\\b`).test(said)).map((sc) => String(sc.id));
      setForm((f) => ({ ...f, scripts: f.scripts.length ? f.scripts : scripts, cases: !isStore && !f.cases.includes(r.url) ? [...f.cases, r.url] : f.cases }));
      setFillUrl('');
      // bring the first images straight in when the font has none yet; the rest stay below to pick from
      const take = form.images.length ? [] : r.images.slice(0, 8);
      toast(`Filled from ${r.host}${take.length ? ` — importing ${take.length} image${take.length === 1 ? '' : 's'}` : ''}. Check everything before saving.`);
      if (take.length) await importImages(take);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that page', 'err');
    } finally {
      setFilling(false);
    }
  }

  async function importImages(urls: string[]) {
    setImporting(urls.length);
    const files: File[] = [];
    for (const u of urls) {
      try {
        const token = await db.token();
        const res = await fetch('/api/dashboard/image', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ url: u }) });
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const name = decodeURIComponent(u.split('?')[0].split('/').pop() || 'image') .replace(/[^\w.-]+/g, '-');
        files.push(new File([blob], /\.\w{3,4}$/.test(name) ? name : `${name}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: blob.type }));
      } catch {
        toast(`Couldn't import ${u.slice(0, 60)}…`, 'err');
      } finally {
        setImporting((n) => n - 1);
      }
    }
    if (files.length) await addImages(files);
    setRemote((r) => r.filter((x) => !urls.includes(x)));
  }

  const dirty = JSON.stringify(form) !== initial;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = useCallback(<K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v })), []);

  const tagOpts = (rows: { id: number; name: string }[]): Option[] => rows.map((r) => ({ id: String(r.id), label: String(r.name) }));
  const peopleOpts: Option[] = useMemo(
    () => (data?.people ?? []).map((p) => ({ id: String(p.id), label: String(p.name), meta: p.type === 'foundry' ? 'Foundry' : 'Designer', thumb: p.logo ? img(String(p.logo), 256) : null, grey: p.type !== 'foundry' })),
    [data],
  );

  const dupes = useMemo(() => {
    if (!data || form.name.trim().length < 3) return [];
    const k = dupKey(form.name);
    return data.fonts.filter((f) => String(f.id) !== id && k && dupKey(String(f.name)) === k).slice(0, 5);
  }, [data, form.name, id]);
  const slugTaken = !!data?.fonts.some((f) => String(f.id) !== id && String(f.slug) === form.slug);

  if (!data) return null;
  if (id && !existing) return <div className="dz-empty">This font doesn&apos;t exist (it may have been deleted). <Link href="/dashboard/fonts">Back to fonts</Link></div>;

  const purchase = form.purchase.map((s) => s.trim()).filter(Boolean);
  const checks = [
    { ok: !!form.name.trim(), label: 'Name' },
    { ok: form.images.length > 0, label: 'Presentation images' },
    { ok: form.people.length > 0, label: 'Designer or foundry credited' },
    { ok: form.scripts.length > 0, label: 'Script' },
    { ok: form.genres.length > 0, label: 'Genre' },
    { ok: !!form.weights, label: 'Number of weights' },
    { ok: !!form.year, label: 'Release year' },
    { ok: purchase.length > 0, label: 'Link to buy or download' },
  ];
  const required = checks.filter((c) => ['Name', 'Presentation images', 'Designer or foundry credited', 'Script', 'Genre', 'Number of weights'].includes(c.label));
  const ready = required.every((c) => c.ok);

  async function syncLinks(fontId: string, kind: keyof typeof LINK_TABLES, ids: string[]) {
    const { table, key } = LINK_TABLES[kind];
    const current = data!.links[kind].filter((r) => String(r.font_id) === fontId).map((r) => String(r[key]));
    const num = kind !== 'designers' && kind !== 'awards';
    for (const old of current) if (!ids.includes(old)) await db.remove(table, { font_id: fontId, [key]: old });
    const add = ids.filter((x) => !current.includes(x));
    if (add.length) await db.link(table, add.map((x) => ({ font_id: fontId, [key]: num ? Number(x) : x })));
  }

  async function save(nextStatus?: string) {
    setTried(true);
    const status = nextStatus ?? form.status;
    if (!form.name.trim()) { toast('Give the font a name first.', 'err'); return; }
    if (status !== 'draft' && !ready) { toast('Fill in the required fields (marked *) before sending for review or publishing — or save as a draft.', 'err'); return; }
    setSaving(true);
    try {
      let slug = slugify(form.slug || form.name) || `font-${Date.now()}`;
      const taken = new Set(data!.fonts.filter((f) => String(f.id) !== id).map((f) => String(f.slug)));
      if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
      const cover = form.cover && form.images.includes(form.cover) ? form.cover : form.images[0] ?? '';
      const row: Row = {
        name: form.name.trim(), slug, description: form.description.trim(), year: form.year ? Number(form.year) : null,
        weights: form.weights ? Number(form.weights) : null, is_variable: form.variable, license: form.license, status,
        cover: cover || null, images: form.images, purchase_links: purchase, case_studies: form.cases.map((s) => s.trim()).filter(Boolean),
        language_group: form.groups, source_url: form.source.trim() || null, updated_at: new Date().toISOString(),
      };
      let fontId = id;
      if (fontId) await db.update('fonts', { id: fontId }, row);
      else {
        const [made] = await db.insert('fonts', row);
        fontId = String(made.id);
      }
      await syncLinks(fontId, 'scripts', form.scripts);
      await syncLinks(fontId, 'genres', form.genres);
      await syncLinks(fontId, 'styles', form.styles);
      await syncLinks(fontId, 'types', form.types);
      // credits keep their order: rewrite them when the order changed
      const curPeople = data!.links.designers.filter((r) => String(r.font_id) === fontId).map((r) => String(r.designer_id));
      if (curPeople.join() !== form.people.join()) {
        const sameSet = curPeople.length === form.people.length && curPeople.every((p) => form.people.includes(p));
        if (sameSet) {
          for (const p of curPeople) await db.remove('font_designers', { font_id: fontId, designer_id: p });
          await db.link('font_designers', form.people.map((p) => ({ font_id: fontId, designer_id: p })));
        } else {
          for (const p of curPeople) if (!form.people.includes(p)) await db.remove('font_designers', { font_id: fontId, designer_id: p });
          await db.link('font_designers', form.people.filter((p) => !curPeople.includes(p)).map((p) => ({ font_id: fontId, designer_id: p })));
        }
      }
      // awards carry an optional link
      const curAwards = data!.links.awards.filter((r) => String(r.font_id) === fontId);
      for (const a of curAwards) if (!form.awards.some((x) => x.id === String(a.award_id))) await db.remove('font_awards', { font_id: fontId, award_id: String(a.award_id) });
      for (const a of form.awards) {
        const cur = curAwards.find((r) => String(r.award_id) === a.id);
        if (!cur) await db.insert('font_awards', { font_id: fontId, award_id: a.id, url: a.url.trim() || null });
        else if (String(cur.url ?? '') !== a.url.trim()) await db.update('font_awards', { font_id: fontId, award_id: a.id }, { url: a.url.trim() || null });
      }
      // languages follow the chosen language groups
      const langs = [...new Set(data!.groupLangs.filter((g) => form.groups.includes(String(g.language_group_id))).map((g) => String(g.language_id)))];
      await syncLinks(fontId, 'languages', langs);

      if (!id && prefill?.submissionId) {
        await db.update('submissions', { id: prefill.submissionId }, { status: 'accepted', font_id: fontId, handled_at: new Date().toISOString() }).catch(() => undefined);
      }
      await db.log({ action: id ? (existing?.status !== status ? `status:${status}` : 'update') : 'create', entity: 'font', entity_id: fontId, label: row.name, before: id ? snapshotFont(fontId, data!, fontById) : null, after: { row: { ...existing, ...row } } });
      await db.refreshSite();
      await reload();
      const label = STATUSES.find((s) => s.id === status)?.label ?? status;
      toast(id ? `Saved · ${label}` : `Font created · ${label}`);
      const next = { ...form, slug, status, cover, purchase: purchase.length ? purchase : [''] };
      setForm(next);
      setInitial(JSON.stringify(next));
      setTried(false);
      if (!id) router.replace(`/dashboard/fonts/${fontId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Saving failed', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id) return;
    setSaving(true);
    try {
      const before = snapshotFont(id, data!, fontById);
      for (const { table } of Object.values(LINK_TABLES)) await db.remove(table, { font_id: id });
      await db.log({ action: 'delete', entity: 'font', entity_id: id, label: form.name, before });
      await db.remove('fonts', { id });
      await db.refreshSite();
      await reload();
      toast(`Deleted ${form.name}`);
      router.replace('/dashboard/fonts');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'err');
      setSaving(false);
    }
  }

  async function addImages(files: File[]) {
    const paths = await upload(files);
    if (paths.length) setForm((f) => ({ ...f, images: [...f.images, ...paths], cover: f.cover || paths[0] }));
  }
  const moveImage = (i: number, d: number) => setForm((f) => {
    const images = f.images.slice();
    const j = i + d;
    if (j < 0 || j >= images.length) return f;
    [images[i], images[j]] = [images[j], images[i]];
    return { ...f, images };
  });

  const err = (ok: boolean) => (tried && !ok ? 'Required' : null);
  const credit = form.people.map((p) => data.people.find((x) => String(x.id) === p)?.name).filter(Boolean).join(' · ');
  const isLive = existing && (existing.status === 'published' || existing.status === 'featured');

  return (
    <>
      <div className="dz-head">
        <div>
          <Link href="/dashboard/fonts" className="dz-crumb">← Fonts</Link>
          <h1 className="display" style={{ marginTop: 10 }}>{form.name.trim() || (id ? 'Untitled' : 'New font')}</h1>
          {existing ? <p style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><StatusPill status={String(existing.status)} />{isLive ? <a href={`/fonts/${existing.slug}`} target="_blank" rel="noreferrer">View on site ↗</a> : <span>Not visible on the site</span>}</p> : <p>Add a typeface to the archive. Save as a draft any time.</p>}
        </div>
      </div>

      <div className="dz-editor">
        <div>
          <section className="dz-section dz-autofill">
            <h2 className="dz-section__title">{id ? 'Fill from a link' : 'Start from a link'} <small>MyFonts, Behance, a foundry page…</small></h2>
            <div className="dz-linkrow">
              <input className="dz-input" autoFocus={!id && !prefill} placeholder="Paste the font's page — https://…" value={fillUrl} onChange={(e) => setFillUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fillFromLink(); } }} />
              <button type="button" className="dz-btn dz-btn--primary" disabled={filling || !fillUrl.trim()} onClick={fillFromLink}>{filling ? 'Reading…' : 'Fill in'}</button>
            </div>
            <p className="dz-hint" style={{ margin: '8px 0 0' }}>{id ? 'Fills the empty fields with the name, description, year, designer, script and images it finds.' : 'Paste the font’s page and press Fill in — the name, description, year, designer, script, buy link and the first images are brought in for you.'} Nothing is saved until you press save.</p>
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Details</h2>
            <div className="dz-grid">
              <Field label="Font name" required error={err(!!form.name.trim())} wide>
                <input className="dz-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: f.slugTouched ? f.slug : slugify(e.target.value) }))} />
              </Field>
              {dupes.length > 0 && (
                <div className="dz-warn dz-field--wide">
                  <b>This might already be in the archive</b>
                  {dupes.map((d) => <span key={String(d.id)}><Link href={`/dashboard/fonts/${d.id}`} target="_blank">{String(d.name)}</Link> <span className="dz-muted">/{String(d.slug)} · {String(d.status)}</span></span>)}
                </div>
              )}
              <Field label="Web address" hint={slugTaken ? 'Already used — a number will be added when you save.' : `fahress.com/fonts/${form.slug || '…'}`}>
                <input className="dz-input" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value), slugTouched: true }))} />
              </Field>
              <Field label="Release year">
                <input className="dz-input" inputMode="numeric" placeholder="e.g. 2024" value={form.year} onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </Field>
              <Field label="Description" hint="A short paragraph about the font and what it's good for." wide>
                <textarea className="dz-textarea" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Credits <small>who made it</small></h2>
            <Field label="Designed by" required error={err(form.people.length > 0)} hint="Designers first, then the foundry. Use ‹ › to change the order shown on the site.">
              <MultiPicker
                options={peopleOpts}
                value={form.people}
                onChange={(v) => set('people', v)}
                placeholder="Search designers and foundries…"
                orderable
                onCreate={(name) => setAdding(name)}
                createLabel="Add new designer or foundry"
              />
            </Field>
            {newNames.length > 0 && (
              <div className="dz-warn" style={{ borderColor: 'var(--ink)', marginTop: 14 }}>
                <b style={{ color: 'var(--ink)' }}>Found on the page, not in the archive yet</b>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {newNames.map((n) => (
                    <span key={n} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <button type="button" className="dz-btn dz-btn--sm" onClick={() => { setAdding(n); setNewNames((x) => x.filter((y) => y !== n)); }}>+ Add “{n}”</button>
                      <button type="button" className="dz-link" onClick={() => setNewNames((x) => x.filter((y) => y !== n))}>ignore</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Presentation images <small>first image or ★ = cover</small></h2>
            <DropZone onFiles={addImages} />
            {remote.length > 0 && (
              <div className="dz-remote">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b>{remote.length} image{remote.length === 1 ? '' : 's'} found on the page</b>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" disabled={importing > 0} onClick={() => importImages(remote)}>{importing ? `Importing… ${importing} left` : 'Import all'}</button>
                    <button type="button" className="dz-btn dz-btn--sm" onClick={() => setRemote([])}>Dismiss</button>
                  </span>
                </div>
                <p className="dz-hint" style={{ margin: '6px 0 10px' }}>Click an image to import just that one. Skip logos and avatars.</p>
                <div className="dz-gallery" style={{ marginTop: 0 }}>
                  {remote.map((u) => (
                    <button key={u} type="button" className="dz-gimg" style={{ padding: 0, cursor: 'pointer' }} disabled={importing > 0} onClick={() => importImages([u])} title="Import this image">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {uploading > 0 ? <p className="dz-hint" style={{ marginTop: 10 }}>Uploading {uploading} image{uploading === 1 ? '' : 's'}…</p> : null}
            {tried && !form.images.length ? <p className="dz-error" style={{ marginTop: 10 }}>Add at least one image</p> : null}
            {form.images.length > 0 && (
              <div className="dz-gallery">
                {form.images.map((p, i) => {
                  const isCover = (form.cover || form.images[0]) === p;
                  return (
                    <div key={p} className={`dz-gimg${isCover ? ' is-cover' : ''}`}>
                      <img src={img(p, 384)} alt="" loading="lazy" />
                      {isCover ? <span className="dz-gimg__flag">Cover</span> : null}
                      <div className="dz-gimg__bar">
                        {!isCover ? <button type="button" onClick={() => set('cover', p)}>★ Cover</button> : null}
                        <button type="button" aria-label="Move left" onClick={() => moveImage(i, -1)}>‹</button>
                        <button type="button" aria-label="Move right" onClick={() => moveImage(i, 1)}>›</button>
                        <button type="button" aria-label="Remove image" onClick={() => setForm((f) => ({ ...f, images: f.images.filter((x) => x !== p), cover: f.cover === p ? '' : f.cover }))}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Classification</h2>
            <div className="dz-grid">
              <Field label="Scripts" required error={err(form.scripts.length > 0)}><MultiPicker options={tagOpts(data.scripts)} value={form.scripts} onChange={(v) => set('scripts', v)} /></Field>
              <Field label="Genres" required error={err(form.genres.length > 0)}><MultiPicker options={tagOpts(data.genres)} value={form.genres} onChange={(v) => set('genres', v)} /></Field>
              <Field label="Styles"><MultiPicker options={tagOpts(data.styles)} value={form.styles} onChange={(v) => set('styles', v)} /></Field>
              <Field label="Types"><MultiPicker options={tagOpts(data.types)} value={form.types} onChange={(v) => set('types', v)} /></Field>
              <Field label="Language support" hint="Language groups the font covers. Individual languages are filled in from these." wide>
                <MultiPicker options={tagOpts(data.groups)} value={form.groups} onChange={(v) => set('groups', v)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="dz-btn dz-btn--sm" disabled={form.groups.length === data.groups.length} onClick={() => set('groups', tagOpts(data.groups).map((o) => o.id))}>All</button>
                  {form.groups.length ? <button type="button" className="dz-btn dz-btn--sm" onClick={() => set('groups', [])}>Clear</button> : null}
                </div>
              </Field>
            </div>
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Weights and license</h2>
            <div className="dz-grid dz-grid--3">
              <Field label="Weights" required error={err(!!form.weights)}>
                <input className="dz-input" inputMode="numeric" placeholder="e.g. 6" value={form.weights} onChange={(e) => set('weights', e.target.value.replace(/\D/g, '').slice(0, 3))} />
              </Field>
              <Field label="License" required>
                <select className="dz-select" value={form.license} onChange={(e) => set('license', e.target.value)}>
                  <option value="paid">Paid</option><option value="free">Free</option><option value="custom">Custom</option>
                </select>
              </Field>
              <Field label="Variable">
                <label className="dz-check" style={{ minHeight: 44 }}><input type="checkbox" checked={form.variable} onChange={(e) => set('variable', e.target.checked)} />Variable font</label>
              </Field>
            </div>
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Links</h2>
            <div className="dz-grid">
              <Field label="Where to buy or download" wide hint="Links to the designer's or foundry's store. The first one is the main button on the site.">
                <LinkList value={form.purchase} onChange={(v) => set('purchase', v)} placeholder="https://…" />
              </Field>
              <Field label="Case studies" wide hint="Links to a case study the designer or foundry made about this font (Behance, their site, an article). Shown as “Case study” on the font page.">
                <LinkList value={form.cases} onChange={(v) => set('cases', v)} placeholder="https://behance.net/…" />
              </Field>
              <Field label="Source" wide hint="Where you found this font (kept private, for your records).">
                <input className="dz-input" placeholder="https://…" value={form.source} onChange={(e) => set('source', e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="dz-section">
            <h2 className="dz-section__title">Awards</h2>
            <Field label="Awards won">
              <MultiPicker options={data.awards.map((a) => ({ id: String(a.id), label: String(a.name), thumb: a.image ? img(String(a.image), 256) : null }))} value={form.awards.map((a) => a.id)} onChange={(v) => set('awards', v.map((x) => form.awards.find((a) => a.id === x) ?? { id: x, url: '' }))} />
            </Field>
            {form.awards.length > 0 && (
              <div className="dz-links" style={{ marginTop: 14 }}>
                {form.awards.map((a) => (
                  <div key={a.id} className="dz-linkrow">
                    <small style={{ textAlign: 'left', minWidth: 110 }}>{String(data.awards.find((x) => String(x.id) === a.id)?.name ?? '')}</small>
                    <input className="dz-input" placeholder="Link to the award page (optional)" value={a.url} onChange={(e) => set('awards', form.awards.map((x) => (x.id === a.id ? { ...x, url: e.target.value } : x)))} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {id && !isEditor ? (
            <section className="dz-section" style={{ borderColor: '#b42318' }}>
              <h2 className="dz-section__title">Delete</h2>
              <p className="dz-hint" style={{ marginTop: -8 }}>Removes the font and its credits from the archive. The uploaded images stay in storage.</p>
              <ConfirmButton onConfirm={remove}>Delete this font</ConfirmButton>
            </section>
          ) : null}
        </div>

        <aside className="dz-aside">
          <div className="dz-preview">
            <div className="dz-preview__img">{form.images.length ? <img src={img(form.cover || form.images[0], 640)} alt="" /> : null}</div>
            <div className="dz-preview__meta">
              <b>{form.name || 'Font name'}</b>
              <span className="dz-muted">{credit || 'Designer'}</span>
            </div>
          </div>
          <div className="dz-panel dz-panel--soft">
            <p className="dz-eyebrow">Ready to publish</p>
            <ul className="dz-ready">{checks.map((c) => <li key={c.label} className={c.ok ? 'is-ok' : ''}>{c.label}</li>)}</ul>
          </div>
          <div className="dz-panel dz-panel--soft">
            <p className="dz-eyebrow">Status</p>
            <select className="dz-select" value={form.status} onChange={(e) => set('status', e.target.value)} disabled={isEditor}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <p className="dz-hint" style={{ margin: '10px 0 0' }}>{isEditor ? 'As an editor you can save drafts and send fonts for review. An admin publishes them.' : 'Only Published and Featured fonts appear on the site.'}</p>
          </div>
        </aside>
      </div>

      <div className="dz-savebar">
        <span className="dz-savebar__note">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : id ? 'All changes saved' : ''}</span>
        {isEditor && (existing?.status === 'published' || existing?.status === 'featured') ? (
          <span className="dz-hint">This font is live — only an admin can change it.</span>
        ) : form.status !== 'published' && form.status !== 'featured' ? (
          <>
            <button type="button" className="dz-btn" disabled={saving || uploading > 0} onClick={() => save('draft')}>Save draft</button>
            <button type="button" className={`dz-btn${isEditor ? ' dz-btn--primary' : ''}`} disabled={saving || uploading > 0} onClick={() => save('pending')}>Send for review</button>
            {!isEditor ? <button type="button" className="dz-btn dz-btn--primary" disabled={saving || uploading > 0} onClick={() => save('published')}>Publish</button> : null}
          </>
        ) : (
          <>
            <button type="button" className="dz-btn" disabled={saving || uploading > 0} onClick={() => save('draft')}>Unpublish</button>
            <button type="button" className="dz-btn dz-btn--primary" disabled={saving || uploading > 0 || (!dirty && !!id)} onClick={() => save()}>Save changes</button>
          </>
        )}
      </div>

      {adding !== null && (
        <PersonQuickAdd
          name={adding}
          onClose={() => setAdding(null)}
          onCreated={(pid) => { setForm((f) => ({ ...f, people: [...f.people, pid] })); setAdding(null); }}
        />
      )}
    </>
  );
}

function LinkList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const list = value.length ? value : [''];
  return (
    <div className="dz-links">
      {list.map((u, i) => (
        <div key={i} className="dz-linkrow">
          <input className="dz-input" placeholder={placeholder} value={u} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} />
          <small>{hostOf(u)}</small>
          <button type="button" className="dz-iconbtn" aria-label="Remove link" onClick={() => onChange(list.filter((_, j) => j !== i))}>−</button>
        </div>
      ))}
      <button type="button" className="dz-link" onClick={() => onChange([...list, ''])}>+ Add another link</button>
    </div>
  );
}
