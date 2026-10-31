'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { StatusPill, useToast } from '@/components/dashboard/ui';
import { duplicateFonts, duplicatePeople } from '@/lib/admin/checks';
import type { Row } from '@/lib/admin/db';
import { mergeFonts, mergePeople, pickKeeper, profileScore } from '@/lib/admin/merge';
import { coverOf, img, useData } from '@/lib/admin/store';
import { db } from '@/lib/admin/db';

export default function Duplicates() {
  const { data, linked, fontsOf, reload } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<string[]>([]);

  const fontScore = (f: Row) => {
    const id = String(f.id);
    return (Array.isArray(f.images) ? f.images.length : 0) + (f.description ? 3 : 0) + (f.year ? 1 : 0) + linked(id, 'designers').length * 2 + linked(id, 'scripts').length + (Array.isArray(f.purchase_links) && f.purchase_links.length ? 2 : 0) + (({ featured: 6, published: 5, pending: 1 } as Record<string, number>)[String(f.status)] ?? 0);
  };
  const personScore = (p: Row) => profileScore(p, fontsOf(String(p.id)).length);

  const fontGroups = useMemo(() => (data ? duplicateFonts(data) : []), [data]);
  const peopleGroups = useMemo(() => (data ? duplicatePeople(data) : []), [data]);
  if (!data) return null;
  const isEditor = data.role === 'editor';

  const keyOf = (g: Row[]) => g.map((r) => String(r.id)).sort().join('|');

  async function merge(kind: 'font' | 'person', group: Row[]) {
    const k = keyOf(group);
    const keeper = group.find((r) => String(r.id) === choice[k]) ?? pickKeeper(group, kind === 'font' ? fontScore : personScore);
    const losers = group.filter((r) => r !== keeper);
    setBusy(k);
    try {
      if (kind === 'font') await mergeFonts(data!, keeper, losers); else await mergePeople(data!, keeper, losers);
      await db.refreshSite();
      await reload();
      toast(`Merged into ${keeper.name}${data!.redirects !== null ? ' — old addresses now redirect' : ''}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Merge failed', 'err');
    } finally {
      setBusy(null);
    }
  }

  const Group = ({ kind, group }: { kind: 'font' | 'person'; group: Row[] }) => {
    const k = keyOf(group);
    const auto = pickKeeper(group, kind === 'font' ? fontScore : personScore);
    const keep = choice[k] ?? String(auto.id);
    return (
      <section className="dz-panel">
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(group.length, 3)}, minmax(0, 1fr))`, gap: 14 }} className="dz-dupgrid">
          {group.map((r) => {
            const id = String(r.id);
            const on = keep === id;
            const href = kind === 'font' ? `/dashboard/fonts/${id}` : `/dashboard/${r.type === 'foundry' ? 'foundries' : 'designers'}/${id}`;
            return (
              <label key={id} className={`dz-dup${on ? ' is-on' : ''}`}>
                <input type="radio" name={k} checked={on} onChange={() => setChoice((c) => ({ ...c, [k]: id }))} />
                {kind === 'font'
                  ? (coverOf(r) ? <img className="dz-dup__img" src={img(coverOf(r), 384)} alt="" /> : <span className="dz-dup__img" />)
                  : (r.logo ? <img className={`dz-av${r.type === 'foundry' ? ' is-sq' : ' is-grey'}`} style={{ width: 64, height: 64 }} src={img(String(r.logo), 256)} alt="" /> : <span className="dz-mono-av" style={{ width: 64, height: 64 }}>{String(r.name)[0]}</span>)}
                <b>{String(r.name)}</b>
                <small className="dz-muted">/{String(r.slug)}</small>
                {kind === 'font' ? (
                  <small className="dz-muted"><StatusPill status={String(r.status)} /> · {Array.isArray(r.images) ? r.images.length : 0} images · {linked(id, 'designers').length} credits · added {String(r.created_at).slice(0, 10)}</small>
                ) : (
                  <small className="dz-muted">{r.type === 'foundry' ? 'Foundry' : 'Designer'} · {fontsOf(id).length} fonts · {r.bio ? 'has bio' : 'no bio'}</small>
                )}
                <span className="dz-dup__keep">{on ? 'Keep this one' : 'Merge into the kept one'}</span>
                <Link href={href} target="_blank" className="dz-link" onClick={(e) => e.stopPropagation()}>Open ↗</Link>
              </label>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="dz-btn" onClick={() => setSkipped((s) => [...s, k])}>Not a duplicate</button>
          <button type="button" className="dz-btn dz-btn--primary" disabled={!!busy || isEditor} onClick={() => merge(kind, group)}>{busy === k ? 'Merging…' : `Merge ${group.length} into one`}</button>
        </div>
      </section>
    );
  };

  const fg = fontGroups.filter((g) => !skipped.includes(keyOf(g)));
  const pg = peopleGroups.filter((g) => !skipped.includes(keyOf(g)));

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Duplicates</p>
          <h1 className="display">{fg.length + pg.length ? `${fg.length + pg.length} to tidy up` : 'No duplicates'}</h1>
          <p>Pick the copy to keep. For fonts, credits, classification, awards, images and links from the others move into it. For designers and foundries, only the font credits move — the kept profile's name, photo, bio and links stay as they are. The others are deleted{data.redirects !== null ? ', and their old web addresses redirect to the kept one' : ''}. {isEditor ? 'Only admins can merge.' : ''}</p>
        </div>
      </div>
      {fg.length > 0 && <h2 className="dz-h2">Fonts</h2>}
      <div style={{ display: 'grid', gap: 16 }}>{fg.map((g) => <Group key={keyOf(g)} kind="font" group={g} />)}</div>
      {pg.length > 0 && <h2 className="dz-h2" style={{ marginTop: 28 }}>Designers &amp; foundries</h2>}
      <div style={{ display: 'grid', gap: 16 }}>{pg.map((g) => <Group key={keyOf(g)} kind="person" group={g} />)}</div>
      {fg.length + pg.length === 0 ? <div className="dz-empty">Nothing looks doubled.</div> : null}
    </>
  );
}
