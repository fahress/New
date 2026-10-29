'use client';
import { useMemo, useState } from 'react';
import { ConfirmButton, MultiPicker, slugify, useToast } from '@/components/dashboard/ui';
import { db } from '@/lib/admin/db';
import { useData, type Data, type Tag } from '@/lib/admin/store';

type Kind = 'scripts' | 'genres' | 'styles' | 'types' | 'groups' | 'languages';
const TABS: { id: Kind; label: string; table: string; link?: { kind: keyof Data['links']; key: string } }[] = [
  { id: 'scripts', label: 'Scripts', table: 'scripts', link: { kind: 'scripts', key: 'script_id' } },
  { id: 'genres', label: 'Genres', table: 'genres', link: { kind: 'genres', key: 'genre_id' } },
  { id: 'styles', label: 'Styles', table: 'styles', link: { kind: 'styles', key: 'style_id' } },
  { id: 'types', label: 'Types', table: 'types', link: { kind: 'types', key: 'type_id' } },
  { id: 'groups', label: 'Language groups', table: 'language_groups' },
  { id: 'languages', label: 'Languages', table: 'languages', link: { kind: 'languages', key: 'lang_id' } },
];

export default function Taxonomy() {
  const { data, reload } = useData();
  const toast = useToast();
  const [tab, setTab] = useState<Kind>('scripts');
  const [draft, setDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = TABS.find((t) => t.id === tab)!;

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    if (tab === 'groups') for (const f of data.fonts) for (const g of (f.language_group as string[]) ?? []) m.set(String(g), (m.get(String(g)) ?? 0) + 1);
    else if (meta.link) for (const r of data.links[meta.link.kind]) m.set(String(r[meta.link.key]), (m.get(String(r[meta.link.key])) ?? 0) + 1);
    return m;
  }, [data, tab, meta]);

  if (!data) return null;
  const rows: Tag[] = data[tab];
  const hasSlug = rows.some((r) => 'slug' in r);

  async function run(fn: () => Promise<void>, msg: string) {
    setBusy(true);
    try { await fn(); await db.refreshSite(); await reload(); toast(msg); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); }
  }
  const saveRow = (r: Tag) => run(async () => {
    const d = draft[`${tab}:${r.id}`] ?? {};
    const values: Record<string, unknown> = { ...d };
    if (hasSlug && typeof d.name === 'string') values.slug = slugify(d.name);
    if (tab !== 'languages' && tab !== 'groups') values.updated_at = new Date().toISOString();
    await db.update(meta.table, { id: r.id }, values);
    setDraft((x) => { const y = { ...x }; delete y[`${tab}:${r.id}`]; return y; });
  }, 'Saved');
  const add = () => run(async () => {
    const name = adding.trim();
    if (!name) return;
    const row: Record<string, unknown> = { name };
    if (hasSlug) row.slug = slugify(name);
    if (tab === 'languages') Object.assign(row, { native_name: name, is_active: true, is_rtl: false });
    await db.insert(meta.table, row);
    setAdding('');
  }, `Added ${adding.trim()}`);
  const remove = (r: Tag) => run(async () => {
    if (tab === 'groups') await db.remove('language_group_languages', { language_group_id: r.id });
    if (tab === 'languages') await db.remove('language_group_languages', { language_id: r.id });
    await db.remove(meta.table, { id: r.id });
  }, `Deleted ${r.name}`);
  const setMembers = (g: Tag, ids: string[]) => run(async () => {
    const cur = data.groupLangs.filter((x) => String(x.language_group_id) === String(g.id)).map((x) => String(x.language_id));
    for (const c of cur) if (!ids.includes(c)) await db.remove('language_group_languages', { language_group_id: g.id, language_id: c });
    const add = ids.filter((x) => !cur.includes(x));
    if (add.length) await db.insert('language_group_languages', add.map((x) => ({ language_group_id: g.id, language_id: Number(x) })));
  }, `Updated ${g.name}`);

  const val = (r: Tag, k: string) => (draft[`${tab}:${r.id}`]?.[k] ?? r[k] ?? '') as string;
  const change = (r: Tag, k: string, v: unknown) => setDraft((x) => ({ ...x, [`${tab}:${r.id}`]: { ...(x[`${tab}:${r.id}`] ?? {}), [k]: v } }));
  const langOpts = data.languages.map((l) => ({ id: String(l.id), label: String(l.name), meta: String(l.native_name ?? '') }));

  return (
    <>
      <div className="dz-head"><div><p className="dz-eyebrow">Classification</p><h1 className="display">Scripts, genres &amp; more</h1><p>The filters visitors use on the catalog. Renaming here updates every font that uses it.</p></div></div>
      <div className="dz-toolbar"><div className="dz-seg">{TABS.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>{t.label} {data[t.id].length}</button>)}</div></div>
      <section className="dz-panel">
        <div className="dz-linkrow" style={{ marginBottom: 12 }}>
          <input className="dz-input" placeholder={`New ${meta.label.toLowerCase().replace(/s$/, '')}…`} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button type="button" className="dz-btn dz-btn--primary" disabled={busy || !adding.trim()} onClick={add}>Add</button>
        </div>
        <div className="dz-taglist">
          {rows.map((r) => {
            const used = usage.get(String(r.id)) ?? 0;
            const changed = !!draft[`${tab}:${r.id}`];
            return (
              <div key={r.id} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
                <div className="dz-tagrow" style={{ borderBottom: 0, padding: 0 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="dz-input" style={{ flex: '1 1 200px' }} value={val(r, 'name')} onChange={(e) => change(r, 'name', e.target.value)} aria-label="Name" />
                    {tab === 'languages' ? (
                      <>
                        <input className="dz-input" style={{ flex: '1 1 160px' }} dir="auto" placeholder="Native name" value={val(r, 'native_name')} onChange={(e) => change(r, 'native_name', e.target.value)} aria-label="Native name" />
                        <input className="dz-input" style={{ flex: '0 0 80px' }} placeholder="Code" value={val(r, 'code')} onChange={(e) => change(r, 'code', e.target.value)} aria-label="Code" />
                        <label className="dz-check"><input type="checkbox" checked={!!(draft[`${tab}:${r.id}`]?.is_rtl ?? r.is_rtl)} onChange={(e) => change(r, 'is_rtl', e.target.checked)} />Right-to-left</label>
                      </>
                    ) : null}
                  </div>
                  <span className="dz-muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{tab === 'groups' ? `${used} fonts` : meta.link ? `${used} fonts` : ''}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {changed ? <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" disabled={busy} onClick={() => saveRow(r)}>Save</button> : null}
                    <ConfirmButton className="dz-btn dz-btn--sm dz-btn--danger" label={used ? `Used by ${used} — delete?` : 'Delete?'} onConfirm={() => remove(r)}>Delete</ConfirmButton>
                  </div>
                </div>
                {tab === 'groups' ? (
                  <div style={{ marginTop: 10 }}>
                    <MultiPicker options={langOpts} value={data.groupLangs.filter((x) => String(x.language_group_id) === String(r.id)).map((x) => String(x.language_id))} onChange={(v) => setMembers(r, v)} placeholder="Add a language to this group…" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
