'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { db, type Row } from '@/lib/admin/db';
import { classify, type Guess, type Page } from '@/lib/admin/classify';
import { LINK_TABLES, useData } from '@/lib/admin/store';
import { useToast } from '@/components/dashboard/ui';

type Plan = {
  id: string; name: string; host: string; url: string; error?: string;
  add: { scripts: string[]; styles: string[]; types: string[]; genres: string[]; groups: string[]; year: number | null; weights: number | null; variable: boolean };
  guess?: Guess;
};

const linkOf = (f: Row) => {
  const u = String(f.source_url || (Array.isArray(f.purchase_links) ? f.purchase_links[0] : '') || '');
  return /^https?:\/\//.test(u) ? u : '';
};
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '?'; } };
const notAFontPage = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname.replace(/\/+$/, '') === '' || /\.pdf$/i.test(x.pathname) || /linkedin\.com|luc\.devroye\.org|worldcrunch\.com|prnewswire\.com|omantel\.om|atypi\.org|archive\.tdc\.org|europeandesign\.org/i.test(x.hostname);
  } catch { return true; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FIELDS = ['scripts', 'styles', 'types', 'genres', 'groups'] as const;

/** Reads each draft's link and fills the details that are still empty: script, style, type, genre, languages, year and weights. Drafts only. */
export default function FillDetails() {
  const { data, linked, reload } = useData();
  const toast = useToast();
  const [phase, setPhase] = useState<'idle' | 'reading' | 'review' | 'saving' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [saved, setSaved] = useState(0);
  const stop = useRef(false);

  const drafts = useMemo(() => (data?.fonts ?? []).filter((f) => String(f.status) === 'draft' && linkOf(f)), [data]);
  const names = useMemo(() => {
    const m = (rows: { id: number; name: string }[]) => new Map(rows.map((r) => [String(r.name).trim().toLowerCase(), String(r.id)]));
    return data ? { scripts: m(data.scripts), styles: m(data.styles), types: m(data.types), genres: m(data.genres), groups: m(data.groups) } : null;
  }, [data]);
  const label = useMemo(() => {
    const m = new Map<string, string>();
    if (data) for (const k of FIELDS) for (const t of data[k]) m.set(`${k}:${t.id}`, String(t.name).trim());
    return m;
  }, [data]);
  if (!data || !names) return null;
  const isAdmin = data.role === 'admin';

  /** what the font is missing */
  const missing = (f: Row) => {
    const id = String(f.id);
    return {
      scripts: !linked(id, 'scripts').length, styles: !linked(id, 'styles').length, types: !linked(id, 'types').length, genres: !linked(id, 'genres').length,
      groups: !(Array.isArray(f.language_group) && f.language_group.length), year: !f.year, weights: !f.weights, variable: !f.is_variable,
    };
  };
  const todo = drafts.filter((f) => Object.values(missing(f)).some(Boolean));

  async function read() {
    stop.current = false;
    setPhase('reading');
    const out: Plan[] = [];
    setProgress({ done: 0, total: todo.length, current: '' });
    // three pages at a time
    let next = 0;
    let done = 0;
    const one = async (f: Row) => {
      const url = linkOf(f);
      const base = { id: String(f.id), name: String(f.name), host: hostOf(url), url };
      const empty = { scripts: [], styles: [], types: [], genres: [], groups: [], year: null, weights: null, variable: false };
      if (notAFontPage(url)) { out.push({ ...base, add: empty, error: 'The link isn’t a page about this font (home page, article or PDF)' }); return; }
      try {
        const page = await db.api<Page>('/api/dashboard/read-page', { url });
        if ((page.text ?? '').length < 200 && !page.description) { out.push({ ...base, add: empty, error: 'The page has almost no text (it may need a sign-in or loads its content later)' }); return; }
        out.push({ ...base, add: empty, guess: classify(page, names!) });
      } catch (e) {
        out.push({ ...base, add: empty, error: e instanceof Error ? e.message : 'Could not read the page' });
      }
    };
    await Promise.all([0, 1, 2].map(async () => {
      while (!stop.current && next < todo.length) {
        const f = todo[next++];
        await one(f);
        done++;
        setProgress({ done, total: todo.length, current: String(f.name) });
        await sleep(200);
      }
    }));

    // words that turn up on most pages of one site come from its menus, not the font — drop them unless they're in the font's title or description
    const byHost = new Map<string, Plan[]>();
    for (const p of out) if (p.guess) byHost.set(p.host, [...(byHost.get(p.host) ?? []), p]);
    for (const list of byHost.values()) {
      if (list.length < 4) continue;
      const seen = new Map<string, number>();
      for (const p of list) for (const k of FIELDS) for (const v of p.guess![k]) if (p.guess!.from[`${k}:${v}`] === 'body') seen.set(`${k}:${v}`, (seen.get(`${k}:${v}`) ?? 0) + 1);
      const years = new Map<number, number>();
      for (const p of list) if (p.guess!.year && p.guess!.from.year === 'body') years.set(p.guess!.year, (years.get(p.guess!.year) ?? 0) + 1);
      for (const p of list) {
        for (const k of FIELDS) p.guess![k] = p.guess![k].filter((v) => p.guess!.from[`${k}:${v}`] === 'head' || (seen.get(`${k}:${v}`) ?? 0) / list.length < 0.6);
        if (p.guess!.year && p.guess!.from.year === 'body' && (years.get(p.guess!.year) ?? 0) / list.length >= 0.6) p.guess!.year = null;
      }
    }

    // only what's still empty on the font
    for (const p of out) {
      if (!p.guess) continue;
      const f = data!.fonts.find((x) => String(x.id) === p.id)!;
      const m = missing(f);
      p.add = {
        scripts: m.scripts ? p.guess.scripts : [], styles: m.styles ? p.guess.styles : [], types: m.types ? p.guess.types : [], genres: m.genres ? p.guess.genres : [],
        groups: m.groups ? p.guess.groups : [], year: m.year ? p.guess.year : null, weights: m.weights ? p.guess.weights : null, variable: m.variable && p.guess.variable,
      };
    }
    setPlans(out);
    setPhase('review');
  }

  const useful = plans.filter((p) => !p.error && (FIELDS.some((k) => p.add[k].length) || p.add.year || p.add.weights || p.add.variable));

  async function apply() {
    setPhase('saving');
    let n = 0;
    setProgress({ done: 0, total: useful.length, current: '' });
    for (const [i, p] of useful.entries()) {
      setProgress({ done: i, total: useful.length, current: p.name });
      try {
        for (const k of ['scripts', 'styles', 'types', 'genres'] as const) {
          if (!p.add[k].length) continue;
          const { table, key } = LINK_TABLES[k];
          await db.link(table, p.add[k].map((v) => ({ font_id: p.id, [key]: Number(v) })));
        }
        const patch: Row = {};
        if (p.add.year) patch.year = p.add.year;
        if (p.add.weights) patch.weights = p.add.weights;
        if (p.add.variable) patch.is_variable = true;
        if (p.add.groups.length) {
          patch.language_group = p.add.groups;
          const langs = [...new Set(data!.groupLangs.filter((g) => p.add.groups.includes(String(g.language_group_id))).map((g) => Number(g.language_id)))];
          await db.link('font_languages', langs.map((l) => ({ font_id: p.id, lang_id: l })));
        }
        if (Object.keys(patch).length) await db.update('fonts', { id: p.id }, { ...patch, updated_at: new Date().toISOString() });
        await db.log({ action: 'update', entity: 'font', entity_id: p.id, label: `${p.name}: details read from ${p.host}`, after: { add: p.add, source: p.url } });
        n++;
      } catch { /* keep going */ }
    }
    setSaved(n);
    setPhase('done');
    await reload();
    toast(`Filled details on ${n} drafts`);
  }

  const describe = (p: Plan) => {
    const bits: string[] = [];
    for (const k of FIELDS) if (p.add[k].length) bits.push(p.add[k].map((v) => label.get(`${k}:${v}`) ?? v).join(', '));
    if (p.add.year) bits.push(String(p.add.year));
    if (p.add.weights) bits.push(`${p.add.weights} weights`);
    if (p.add.variable) bits.push('variable');
    return bits.join(' · ');
  };
  const hosts = (() => {
    const m = new Map<string, Plan[]>();
    for (const p of plans) m.set(p.host, [...(m.get(p.host) ?? []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  })();

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Drafts</p>
          <h1 className="display">Fill draft details</h1>
          <p>Reads the link of every <b>draft</b> and fills what&apos;s still empty: script (Naskh, Kufi, Nastaliq, Ruqa, Diwani, Thuluth, Maghribi), style (sans serif, serif, slab…), type (handwritten, pixel, geometric…), genre, languages, release year and number of weights. Nothing already filled in is changed, published fonts are never touched, and you see every change before it&apos;s saved.</p>
        </div>
      </div>

      <section className="dz-panel" style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0 }}><b>{todo.length}</b> drafts with a link are missing at least one of these details.</p>
        {phase === 'reading' || phase === 'saving' ? (
          <>
            <p style={{ margin: 0 }}>{phase === 'reading' ? 'Reading pages' : 'Saving'} · {progress.done} of {progress.total}{progress.current ? ` · ${progress.current}` : ''}</p>
            <div style={{ height: 6, background: 'var(--soft)', borderRadius: 3 }}><div style={{ height: 6, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--ink)', borderRadius: 3 }} /></div>
            {phase === 'reading' ? <div><button type="button" className="dz-btn" onClick={() => { stop.current = true; }}>Stop and review what&apos;s read</button></div> : null}
          </>
        ) : phase === 'review' ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="dz-btn dz-btn--primary" disabled={!isAdmin || !useful.length} onClick={apply}>Save details on {useful.length} drafts</button>
            <button type="button" className="dz-btn" onClick={() => { setPlans([]); setPhase('idle'); }}>Discard</button>
            <span className="dz-muted">Check the list below first.</span>
          </div>
        ) : (
          <div>
            {phase === 'done' ? <p style={{ margin: '0 0 10px' }}>Saved details on <b>{saved}</b> drafts.</p> : null}
            <button type="button" className="dz-btn dz-btn--primary" disabled={!isAdmin || !todo.length} onClick={read}>{phase === 'done' ? 'Read again' : `Read ${todo.length} pages`}</button>
            {!isAdmin ? <span className="dz-muted" style={{ marginLeft: 10 }}>Only admins can run this.</span> : null}
          </div>
        )}
      </section>

      {plans.length > 0 && (
        <>
          <h2 className="dz-h2" style={{ marginTop: 28 }}>{useful.length} drafts get new details · {plans.length - useful.length} don&apos;t</h2>
          <div className="dz-panel" style={{ display: 'grid', gap: 6 }}>
            {hosts.map(([host, ps]) => {
              const got = ps.filter((p) => useful.includes(p)).length;
              const errs = [...new Set(ps.filter((p) => p.error).map((p) => p.error))];
              return (
                <details key={host}>
                  <summary style={{ cursor: 'pointer' }}><b>{host}</b> — {got} of {ps.length}{errs.length ? ` · ${errs.slice(0, 2).join(' · ')}` : ''}</summary>
                  <ul style={{ margin: '6px 0 10px', paddingLeft: 18, fontSize: 14 }}>
                    {ps.map((p) => <li key={p.id}><Link href={`/dashboard/fonts/${p.id}`} target="_blank">{p.name}</Link> — {p.error ?? (describe(p) || 'nothing new found')}</li>)}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
