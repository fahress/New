'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { slugify, useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { dupKey, LINK_TABLES, useData, type Tag } from '@/lib/admin/store';

/** One font found by the Oct 2026 web survey that isn't on Fahress yet (see lib/admin/survey-fonts.json). */
type SurveyFont = {
  n: string; d: string[]; f: string; sc: string[]; g: string[]; st: string[]; t: string[];
  y: number | null; w: number | null; v: boolean; l: 'free' | 'paid'; u: string; s: string; a: string; lc: number | null; no: string;
};

const PAGE = 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export default function ImportPage() {
  const { data, reload } = useData();
  const toast = useToast();
  const [list, setList] = useState<SurveyFont[] | null>(null);
  const [q, setQ] = useState('');
  const [site, setSite] = useState('');
  const [script, setScript] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ fonts: number; people: string[]; failed: string[] } | null>(null);

  useEffect(() => { import('@/lib/admin/survey-fonts.json').then((m) => setList(m.default as SurveyFont[])); }, []);

  const peopleByKey = useMemo(() => new Map((data?.people ?? []).map((p) => [dupKey(String(p.name)), p])), [data]);
  const fontKeys = useMemo(() => new Set((data?.fonts ?? []).map((f) => dupKey(String(f.name)))), [data]);

  const rows = useMemo(() => {
    if (!list) return [];
    const n = q.trim().toLowerCase();
    return list.map((r, i) => ({ r, i, inDash: fontKeys.has(dupKey(r.n)) })).filter(({ r }) => {
      if (site && r.s !== site) return false;
      if (script && !(script === '-' ? r.sc.length === 0 : r.sc.includes(script))) return false;
      return !n || `${r.n} ${r.d.join(' ')} ${r.f}`.toLowerCase().includes(n);
    });
  }, [list, q, site, script, fontKeys]);

  if (!data || !list) return <div className="dz-loading"><span className="dz-spin" />Loading the survey…</div>;

  const sites = [...new Set(list.map((r) => r.s))].sort();
  const open = rows.filter((x) => !x.inDash);
  const allPicked = open.length > 0 && open.every((x) => picked.has(x.i));
  const toggle = (i: number) => setPicked((p) => { const s = new Set(p); if (s.has(i)) s.delete(i); else s.add(i); return s; });
  const credits = (r: SurveyFont) => [...new Map([...r.d, r.f].filter(Boolean).map((name) => [dupKey(name), name])).values()];

  async function run() {
    const chosen = list!.filter((r, i) => picked.has(i) && !fontKeys.has(dupKey(r.n)));
    if (!chosen.length) return;
    setProgress({ done: 0, total: chosen.length });
    setResult(null);
    const people = new Map(peopleByKey);
    const personSlugs = new Set(data!.people.map((p) => String(p.slug)));
    const fontSlugs = new Set(data!.fonts.map((f) => String(f.slug)));
    const tagIds = (tags: Tag[], names: string[]) => names.map((n) => tags.find((t) => norm(String(t.name)) === norm(n))?.id).filter((x): x is number => x != null);
    const unique = (taken: Set<string>, base: string) => { let s = base; let k = 2; while (taken.has(s)) s = `${base}-${k++}`; taken.add(s); return s; };
    const made: string[] = [];
    const failed: string[] = [];
    let ok = 0;

    async function person(name: string, type: 'designer' | 'foundry'): Promise<string> {
      const key = dupKey(name);
      const hit = people.get(key);
      if (hit) return String(hit.id);
      const row: Row = { name, slug: unique(personSlugs, slugify(name) || `designer-${Date.now()}`), type, logo: null, social_links: {}, bio: '' };
      const [p] = await db.insert('designers', row);
      people.set(key, p);
      made.push(`${name} (${type})`);
      await db.log({ action: 'create', entity: 'person', entity_id: String(p.id), label: name, after: { row: p, source: 'survey import' } });
      return String(p.id);
    }

    for (const [k, r] of chosen.entries()) {
      try {
        const ids: string[] = [];
        for (const d of r.d) ids.push(await person(d, 'designer'));
        if (r.f) ids.push(await person(r.f, 'foundry'));
        const credit = [...new Set(ids)];
        const row: Row = {
          name: r.n, slug: unique(fontSlugs, slugify(r.n) || `font-${Date.now()}`), description: '', year: r.y, weights: r.w,
          is_variable: r.v, license: r.l, status: 'draft', cover: null, images: [], purchase_links: r.u ? [r.u] : [], case_studies: [],
          language_group: [], source_url: r.u || null, updated_at: new Date().toISOString(),
        };
        const [font] = await db.insert('fonts', row);
        const fid = String(font.id);
        const link = async (kind: 'scripts' | 'genres' | 'styles' | 'types', tags: Tag[], names: string[]) => {
          const { table, key } = LINK_TABLES[kind];
          const tids = [...new Set(tagIds(tags, names))];
          if (tids.length) await db.insert(table, tids.map((id) => ({ font_id: fid, [key]: id })));
        };
        await link('scripts', data!.scripts, r.sc);
        await link('genres', data!.genres, r.g);
        await link('styles', data!.styles, r.st);
        await link('types', data!.types, r.t);
        for (const p of credit) await db.insert('font_designers', { font_id: fid, designer_id: p });
        await db.log({ action: 'create', entity: 'font', entity_id: fid, label: r.n, after: { row: font, source: `survey import · ${r.s}` } });
        ok++;
      } catch (e) {
        failed.push(`${r.n}: ${e instanceof Error ? e.message : 'failed'}`);
        if (e instanceof Error && /isn't allowed/.test(e.message)) { failed.push('Stopped: this account is not allowed to add fonts.'); break; }
      }
      setProgress({ done: k + 1, total: chosen.length });
    }
    setPicked(new Set());
    setProgress(null);
    setResult({ fonts: ok, people: made, failed });
    toast(failed.length ? `Imported ${ok}, ${failed.length} problem(s)` : `Imported ${ok} draft${ok === 1 ? '' : 's'}`, failed.length ? 'err' : undefined);
    await reload();
  }

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Import</p>
          <h1 className="display">Fonts from the web survey</h1>
          <p>{list.length} Arabic typefaces found on foundry sites and stores (Oct 2026) that weren&apos;t on Fahress. Tick the ones you want — each becomes a <b>draft</b> with its credits, classification, year and link filled in. Nothing appears on the site until you publish it.</p>
        </div>
      </div>

      {result && (
        <div className="dz-panel" style={{ marginBottom: 22 }}>
          <h3 style={{ marginTop: 0 }}>Imported {result.fonts} draft{result.fonts === 1 ? '' : 's'}</h3>
          <p><Link href="/dashboard/fonts?status=draft">See them in Fonts → Drafts</Link>. Add images and a description before publishing.</p>
          {result.people.length > 0 && <p className="dz-muted">New designers/foundries created ({result.people.length}) — please check their names, type and country: {result.people.join(', ')}</p>}
          {result.failed.length > 0 && <p className="dz-tag--warn" style={{ border: 0 }}>{result.failed.join(' · ')}</p>}
        </div>
      )}

      <div className="dz-toolbar">
        <input className="dz-input" placeholder="Search by name, designer or foundry…" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
        <select className="dz-select" value={site} onChange={(e) => { setSite(e.target.value); setShown(PAGE); }} aria-label="Found on">
          <option value="">All sources</option>
          {sites.map((s) => <option key={s} value={s}>{s} ({list.filter((r) => r.s === s).length})</option>)}
        </select>
        <select className="dz-select" value={script} onChange={(e) => { setScript(e.target.value); setShown(PAGE); }} aria-label="Script">
          <option value="">All scripts</option>
          {data.scripts.map((s) => <option key={s.id} value={String(s.name)}>{s.name}</option>)}
          <option value="-">No script</option>
        </select>
        <span className="dz-muted" style={{ fontSize: 13 }}>{rows.length} shown · {rows.length - open.length} already in the dashboard</span>
      </div>

      {(picked.size > 0 || progress) && (
        <div className="dz-callout" style={{ padding: '14px 18px', position: 'sticky', top: 8, zIndex: 5 }}>
          <span>{progress ? `Importing ${progress.done} / ${progress.total}… keep this tab open` : `${picked.size} selected`}</span>
          {!progress && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="dz-btn dz-btn--sm" onClick={run}>Import {picked.size} as drafts</button>
              <button type="button" className="dz-btn dz-btn--sm" onClick={() => setPicked(new Set())}>Clear</button>
            </div>
          )}
        </div>
      )}

      <div className="dz-tablewrap">
        <table className="dz-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={allPicked} disabled={!!progress} onChange={() => setPicked((p) => { const s = new Set(p); for (const x of open) { if (allPicked) s.delete(x.i); else s.add(x.i); } return s; })} /></th>
              <th>Font</th>
              <th>Credit</th>
              <th>Classification</th>
              <th>Year</th>
              <th>Langs</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ r, i, inDash }) => (
              <tr key={i} style={inDash ? { opacity: 0.45 } : undefined}>
                <td><input type="checkbox" aria-label={`Select ${r.n}`} checked={picked.has(i)} disabled={inDash || !!progress} onChange={() => toggle(i)} /></td>
                <td>
                  <b>{r.n}</b>{inDash ? <><br /><small className="dz-muted">Already in the dashboard</small></> : null}
                  {r.no ? <><br /><small className="dz-muted">{r.no}</small></> : null}
                </td>
                <td>
                  {credits(r).length ? credits(r).map((c) => (
                    <span key={c} style={{ display: 'inline-block', marginRight: 6 }}>{c}{peopleByKey.has(dupKey(c)) ? '' : <span className="dz-tag" style={{ marginLeft: 4 }}>new</span>}</span>
                  )) : <span className="dz-tag dz-tag--warn">No credit</span>}
                </td>
                <td><small>{[...r.sc, ...r.g, ...r.st, ...r.t].join(' · ') || '—'}</small></td>
                <td>{r.y ?? '—'}</td>
                <td>{r.lc ?? '—'}</td>
                <td><small>{r.u ? <a href={r.u} target="_blank" rel="noreferrer">{r.s} ↗</a> : r.s}</small>{r.a ? <><br /><small className="dz-muted">also: {r.a}</small></> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && <div style={{ textAlign: 'center', marginTop: 18 }}><button type="button" className="dz-btn" onClick={() => setShown((s) => s + PAGE)}>Show more ({rows.length - shown} left)</button></div>}
    </>
  );
}
