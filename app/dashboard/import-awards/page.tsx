'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { slugify, useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { similar } from '@/lib/admin/fuzzy';
import { dupKey, img, useData } from '@/lib/admin/store';
import source from '@/lib/admin/award-import.json';

type Program = { name: string; logo?: string | null; bio?: string | null };
type Rec = { fid: string; font: string; alias?: string; designers: string[]; foundry: string; award: string; year: string; prize: string; url: string | null };
const programs = source.programs as Program[];
const records = source.records as Rec[];
const awardKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Turns any image (SVG included) into a PNG file, so the site's image resizer can use it. */
async function toPng(blob: Blob, name: string): Promise<File> {
  if (blob.type === 'image/png') return new File([blob], `${name}.png`, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const im = new Image();
  await new Promise((ok, bad) => { im.onload = ok; im.onerror = bad; im.src = url; });
  const scale = Math.min(4, 512 / Math.max(im.naturalWidth || 512, im.naturalHeight || 512)) || 1;
  const c = document.createElement('canvas');
  c.width = Math.round((im.naturalWidth || 512) * scale); c.height = Math.round((im.naturalHeight || 512) * scale);
  c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const png = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'));
  return new File([png], `${name}.png`, { type: 'image/png' });
}

export default function ImportAwards() {
  const { data, reload } = useData();
  const toast = useToast();
  /** per font (by sheet id): 'new' | 'skip' | existing font id */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<string[] | null>(null);

  const fonts = useMemo(() => {
    const seen = new Map<string, Rec & { awards: Rec[] }>();
    for (const r of records) { const cur = seen.get(r.fid); if (cur) cur.awards.push(r); else seen.set(r.fid, { ...r, awards: [r] }); }
    return [...seen.values()];
  }, []);

  const match = useMemo(() => {
    const out = new Map<string, { exact?: Row; maybe: Row[] }>();
    if (!data) return out;
    const keyed = data.fonts.map((f) => ({ f, k: dupKey(String(f.name)) }));
    for (const r of fonts) {
      const k = dupKey(r.alias ?? r.font);
      const exact = keyed.find((x) => x.k === k)?.f;
      const maybe = exact ? [] : keyed.filter((x) => similar(k, x.k) || (k.length >= 6 && x.k.length >= 6 && (x.k.startsWith(k) || k.startsWith(x.k)))).map((x) => x.f).slice(0, 4);
      out.set(r.fid, { exact, maybe });
    }
    return out;
  }, [data, fonts]);

  if (!data) return null;
  const awardByKey = new Map(data.awards.map((a) => [awardKey(String(a.name)), a]));
  const decision = (fid: string) => {
    const m = match.get(fid);
    if (m?.exact) return String(m.exact.id);
    if (choice[fid]) return choice[fid];
    return m?.maybe.length ? 'skip' : 'new';
  };
  const counts = { linked: 0, create: 0, skip: 0 };
  for (const f of fonts) { const d = decision(f.fid); if (d === 'new') counts.create++; else if (d === 'skip') counts.skip++; else counts.linked++; }

  async function run() {
    setBusy('Starting…');
    const log: string[] = [];
    const people = new Map(data!.people.map((p) => [dupKey(String(p.name)), p]));
    const personSlugs = new Set(data!.people.map((p) => String(p.slug)));
    const fontSlugs = new Set(data!.fonts.map((f) => String(f.slug)));
    const unique = (taken: Set<string>, base: string) => { let s = base; let k = 2; while (taken.has(s)) s = `${base}-${k++}`; taken.add(s); return s; };
    const made: string[] = [];
    async function person(name: string, type: 'designer' | 'foundry') {
      const k = dupKey(name);
      const hit = people.get(k);
      if (hit) return String(hit.id);
      const [p] = await db.insert('designers', { name, slug: unique(personSlugs, slugify(name) || `designer-${Date.now()}`), type, logo: null, social_links: {}, bio: '' });
      people.set(k, p); made.push(`${name} (${type})`);
      return String(p.id);
    }
    try {
      // 1. award programs: create missing ones, add logo / about text where empty
      const awardId = new Map<string, string>();
      for (const p of programs) {
        setBusy(`Award: ${p.name}`);
        let a = awardByKey.get(awardKey(p.name));
        if (!a) { [a] = await db.insert('awards', { name: p.name, bio: p.bio ?? null, image: null }); log.push(`New award program: ${p.name}`); }
        else if (!a.bio && p.bio) await db.update('awards', { id: String(a.id) }, { bio: p.bio });
        awardId.set(p.name, String(a.id));
        if (!a.image && p.logo) {
          try {
            const res = await fetch(`/api/award-logo?name=${encodeURIComponent(p.name)}`);
            if (!res.ok) throw new Error(await res.text());
            const file = await toPng(await res.blob(), slugify(p.name) || 'award-logo');
            const path = await db.upload(file);
            await db.update('awards', { id: String(a.id) }, { image: path });
            log.push(`Logo added: ${p.name}`);
          } catch (e) { log.push(`Logo NOT added for ${p.name} (${e instanceof Error ? e.message : 'failed'})`); }
        }
      }
      // 2. fonts and award links
      let detailCols = true;
      const existingLinks = new Set(data!.links.awards.map((r) => `${r.font_id}|${r.award_id}`));
      let n = 0;
      for (const f of fonts) {
        n++;
        setBusy(`Fonts ${n} / ${fonts.length}`);
        const d = decision(f.fid);
        if (d === 'skip') { log.push(`Skipped (possible duplicate, not linked): ${f.font}`); continue; }
        let fontId = d;
        if (d === 'new') {
          const ids: string[] = [];
          for (const p of f.designers) ids.push(await person(p, 'designer'));
          if (f.foundry) ids.push(await person(f.foundry, 'foundry'));
          const years = f.awards.flatMap((a) => a.year.split(', ').map(Number)).filter(Boolean);
          const [font] = await db.insert('fonts', {
            name: f.font, slug: unique(fontSlugs, slugify(f.font) || `font-${Date.now()}`), description: '', year: null, weights: null, is_variable: false,
            license: 'paid', status: 'draft', cover: null, images: [], purchase_links: [], case_studies: [], language_group: [], source_url: f.awards[0].url, updated_at: new Date().toISOString(),
          });
          fontId = String(font.id);
          for (const p of [...new Set(ids)]) await db.insert('font_designers', { font_id: fontId, designer_id: p });
          await db.log({ action: 'create', entity: 'font', entity_id: fontId, label: f.font, after: { row: font, source: 'award import', firstAward: Math.min(...years) } });
          log.push(`New draft font: ${f.font}`);
        }
        for (const a of f.awards) {
          const aid = awardId.get(a.award)!;
          const row: Row = { url: a.url, year: a.year, prize: a.prize };
          const k = `${fontId}|${aid}`;
          const attempt = async (withDetails: boolean) => {
            const vals = withDetails ? row : { url: a.url };
            if (existingLinks.has(k)) await db.update('font_awards', { font_id: fontId, award_id: aid }, vals).catch((err) => { if (!/Nothing was saved/.test(String(err?.message))) throw err; });
            else await db.insert('font_awards', { font_id: fontId, award_id: aid, ...vals });
          };
          try { await attempt(detailCols); }
          catch (e) {
            if (detailCols && e instanceof Error && /year|prize|column/i.test(e.message)) { detailCols = false; await attempt(false); }
            else throw e;
          }
          existingLinks.add(k);
        }
      }
      if (!detailCols) log.unshift('Award years and prize levels were NOT saved: the database needs the two new columns (font_awards.year and font_awards.prize). Run the update, then press the button again — it only fills in what is missing.');
      if (made.length) log.push(`New designers/foundries (please check): ${made.join(', ')}`);
      await db.refreshSite();
      await reload();
      setReport(log);
      toast('Awards imported');
    } catch (e) {
      log.push(`Stopped: ${e instanceof Error ? e.message : 'failed'}`);
      setReport(log);
      toast('Import stopped — see the report', 'err');
    } finally { setBusy(null); }
  }

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Import</p>
          <h1 className="display">Award winners</h1>
          <p>{records.length} award records for {fonts.length} Arabic typefaces from {programs.length} award programs. Fonts already in the archive get the award; missing fonts are added as <b>drafts</b> with their designers. Check the “possible duplicate” rows first.</p>
        </div>
        <button type="button" className="dz-btn dz-btn--primary" disabled={!!busy} onClick={run}>{busy ?? `Import (${counts.linked} existing · ${counts.create} new · ${counts.skip} skipped)`}</button>
      </div>

      {report && <section className="dz-panel" style={{ marginBottom: 22 }}><h3 style={{ marginTop: 0 }}>Report</h3><ul>{report.map((l, i) => <li key={i}>{l}</li>)}</ul></section>}

      <section className="dz-panel" style={{ marginBottom: 22 }}>
        <p className="dz-eyebrow">Award programs</p>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {programs.map((p) => {
            const a = awardByKey.get(awardKey(p.name));
            return (
              <div key={p.name} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {a?.image ? <img src={img(String(a.image), 256)} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} /> : <span className="dz-mono-av">{p.name[0]}</span>}
                <span>{p.name}<br /><small className="dz-muted">{a ? 'Already on Fahress' : 'New'} · {a?.image ? 'has logo' : p.logo ? 'logo will be added' : 'no logo found'}</small></span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="dz-tablewrap">
        <table className="dz-table">
          <thead><tr><th>Typeface (from the list)</th><th>Awards</th><th>In the archive?</th></tr></thead>
          <tbody>
            {fonts.map((f) => {
              const m = match.get(f.fid)!;
              const d = decision(f.fid);
              return (
                <tr key={f.fid} data-fid={f.fid}>
                  <td><b>{f.font}</b><br /><small className="dz-muted">{[...f.designers, f.foundry].filter(Boolean).join(', ')}</small></td>
                  <td><small>{f.awards.map((a) => `${a.award} ${a.year}`).join(' · ')}</small></td>
                  <td>
                    {m.exact ? <Link href={`/dashboard/fonts/${m.exact.id}`} target="_blank">{String(m.exact.name)}</Link> : (
                      <select className="dz-select" value={d} disabled={!!busy} onChange={(e) => setChoice((c) => ({ ...c, [f.fid]: e.target.value }))}>
                        <option value="new">Not in the archive — add as draft</option>
                        {m.maybe.map((x) => <option key={String(x.id)} value={String(x.id)}>Same as “{String(x.name)}” ({String(x.status)})</option>)}
                        <option value="skip">Skip for now</option>
                      </select>
                    )}
                    {!m.exact && m.maybe.length ? <><br /><span className="dz-tag dz-tag--warn">Possible duplicate</span></> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
