'use client';
import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { agentApi, ApiError, newId } from './api';
import { useToast } from '@/components/dashboard/ui';
import { useData } from '@/lib/admin/store';
import type { AssetRow, Card, EntityRef, FindingRow, ProposalOp, ProposalRow, SourceRow } from '@/lib/agent/types';

/* ---------- shared data for cards (proposals, sources, images, jobs) ---------- */
type Job = { id: string; title: string; status: string; total: number; done: number; failed: number; updated_at: string; error: string | null };
type Asset = AssetRow & { preview: string | null };
export type Refs = {
  proposals: Record<string, ProposalRow>; sources: Record<string, SourceRow>; assets: Record<string, Asset>; jobs: Record<string, Job>;
  merge: (p: Partial<{ proposals: ProposalRow[]; sources: SourceRow[]; assets: Asset[]; jobs: Job[] }>) => void;
  need: (c: Card) => void;
  perms: Record<string, boolean>;
};
export const RefsCtx = createContext<Refs | null>(null);
const useRefs = () => useContext(RefsCtx)!;

export function useRefStore(perms: Record<string, boolean>): Refs {
  const [state, set] = useState({ proposals: {} as Record<string, ProposalRow>, sources: {} as Record<string, SourceRow>, assets: {} as Record<string, Asset>, jobs: {} as Record<string, Job> });
  const asking = useRef(new Set<string>());
  return useMemo<Refs>(() => {
    const merge: Refs['merge'] = (p) => set((s) => ({
      proposals: { ...s.proposals, ...Object.fromEntries((p.proposals ?? []).map((x) => [x.id, x])) },
      sources: { ...s.sources, ...Object.fromEntries((p.sources ?? []).map((x) => [x.id, x])) },
      assets: { ...s.assets, ...Object.fromEntries((p.assets ?? []).map((x) => [x.id, x])) },
      jobs: { ...s.jobs, ...Object.fromEntries((p.jobs ?? []).map((x) => [x.id, x])) },
    }));
    const need = (c: Card) => {
      const once = (k: string, f: () => Promise<void>) => { if (asking.current.has(k)) return; asking.current.add(k); f().catch(() => asking.current.delete(k)); };
      if (c.kind === 'proposal' && !state.proposals[c.id]) once(`p:${c.id}`, async () => merge({ proposals: [(await agentApi<{ proposal: ProposalRow }>(`proposals/${c.id}`)).proposal] }));
      if (c.kind === 'sources') { const miss = c.ids.filter((id) => !state.sources[id]); if (miss.length) once(`s:${miss.join()}`, async () => merge({ sources: (await agentApi<{ sources: SourceRow[] }>('sources', { ids: miss })).sources })); }
      if (c.kind === 'images') { const miss = c.assets.filter((id) => !state.assets[id]); if (miss.length) once(`a:${miss.join()}`, async () => merge({ assets: (await agentApi<{ assets: Asset[] }>('assets', { ids: miss })).assets })); }
      if (c.kind === 'job' && !state.jobs[c.id]) once(`j:${c.id}`, async () => merge({ jobs: [(await agentApi<{ job: Job }>(`jobs/${c.id}`)).job] }));
    };
    return { ...state, merge, need, perms };
  }, [state, perms]);
}

/* ---------- helpers ---------- */
const hrefOf = (e: { type: string; id: string }) => `/dashboard/${e.type === 'font' ? 'fonts' : e.type === 'foundry' ? 'foundries' : 'designers'}/${e.id}`;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([, x]) => x).map(([k, x]) => `${k.replace(/_url$/, '')}: ${show(x)}`).join(' · ') || '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
};
const STATUS_LABEL: Record<string, string> = { supported: 'Supported', inferred: 'Inferred', conflicting: 'Conflicting', unverified: 'Unverified', user_provided: 'Said by you' };

export function SourceChip({ id, n }: { id: string; n?: number }) {
  const { sources } = useRefs();
  const s = sources[id];
  if (!s) return <span className="ag-cite">source</span>;
  return <a className="ag-cite" href={s.url} target="_blank" rel="noopener noreferrer nofollow" title={`${s.title ?? s.url}${s.published_at ? ` · published ${s.published_at}` : ''}`}><bdi>{n ? `${n} · ` : ''}{s.publisher || host(s.url)}</bdi></a>;
}

/* ---------- cards ---------- */
export function CardView({ card, preselect }: { card: Card; preselect?: string[] }) {
  const refs = useRefs();
  useEffect(() => { refs.need(card); }, [card, refs]);
  switch (card.kind) {
    case 'sources': return <SourcesCard ids={card.ids} />;
    case 'entities': return <EntitiesCard title={card.title} items={card.items} total={card.total} />;
    case 'findings': return <FindingsCard entity={card.entity} rows={card.rows} />;
    case 'duplicates': return <DuplicatesCard groups={card.groups} />;
    case 'images': return <ImagesCard ids={card.assets} note={card.note} entity={card.entity ?? null} />;
    case 'proposal': return <ProposalCard id={card.id} preselect={card.preselect ?? preselect} />;
    case 'job': return <JobCard id={card.id} title={card.title} />;
    default: return null;
  }
}

function SourcesCard({ ids }: { ids: string[] }) {
  const { sources } = useRefs();
  const [open, setOpen] = useState<string | null>(null);
  const list = ids.map((id) => sources[id]).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="ag-card">
      <div className="ag-card__head"><b>Sources</b><small>{list.length}</small></div>
      <ol className="ag-sources">
        {list.map((s) => (
          <li key={s.id}>
            <div className="ag-src">
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" dir="auto"><bdi>{s.title || host(s.url)}</bdi> ↗</a>
              <small className="dz-muted">
                {s.publisher || host(s.url)} · {s.kind === 'search_result' ? 'search snippet (not opened)' : s.kind === 'pdf' ? `PDF${s.page ? `, page ${s.page}` : ''}` : 'opened'}
                {s.published_at ? ` · page published ${s.published_at}` : ''}{s.modified_at ? ` · updated ${s.modified_at}` : ''} · retrieved {s.retrieved_at.slice(0, 10)}
              </small>
              {s.excerpt ? <button type="button" className="dz-link" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide excerpt' : 'Show excerpt'}</button> : null}
              {open === s.id ? <blockquote className="ag-quote" dir="auto">{s.excerpt?.slice(0, 1500)}</blockquote> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EntitiesCard({ title, items, total }: { title: string; items: (EntityRef & { detail?: string })[]; total?: number }) {
  return (
    <div className="ag-card">
      <div className="ag-card__head"><b dir="auto">{title}</b>{total !== undefined ? <small>{items.length} of {total}</small> : null}</div>
      <ol className="ag-ents">
        {items.map((e) => (
          <li key={e.id}><Link href={hrefOf(e)} dir="auto"><bdi>{e.name}</bdi></Link> <small className="dz-muted">{e.type}{e.status ? ` · ${e.status}` : ''}{e.detail ? ` · ${e.detail}` : ''}</small></li>
        ))}
      </ol>
    </div>
  );
}

function FindingsCard({ entity, rows }: { entity: EntityRef | null; rows: FindingRow[] }) {
  return (
    <div className="ag-card">
      <div className="ag-card__head"><b>Fahress compared with the sources</b>{entity ? <Link href={hrefOf(entity)}><bdi>{entity.name}</bdi></Link> : null}</div>
      <div className="ag-tablewrap"><table className="ag-table">
        <thead><tr><th>Field</th><th>Fahress now</th><th>Sources say</th><th>Status</th><th>Source</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td>{r.field}{r.date_kind ? <small className="dz-muted"><br />{r.date_kind.replace(/_/g, ' ')}{r.precision ? ` · ${r.precision}` : ''}</small> : null}</td>
            <td dir="auto">{show(r.ours)}</td>
            <td dir="auto">{show(r.found)}{r.quote ? <blockquote className="ag-quote" dir="auto">“{r.quote}”</blockquote> : null}{r.note ? <small className="dz-muted" dir="auto"><br />{r.note}</small> : null}</td>
            <td><span className={`ag-badge ag-badge--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
            <td>{r.sources.map((s) => <SourceChip key={s} id={s} />)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

function DuplicatesCard({ groups }: { groups: Extract<Card, { kind: 'duplicates' }>['groups'] }) {
  return (
    <div className="ag-card">
      <div className="ag-card__head"><b>Possible duplicates</b><Link href="/dashboard/duplicates">Duplicates page →</Link></div>
      {groups.map((g, i) => (
        <div key={i} className="ag-dup">
          <span className={`ag-badge ag-badge--${g.strength === 'strong' ? 'supported' : 'unverified'}`}>{g.strength === 'strong' ? 'Strong signals' : 'Name only / weak'}</span>
          <ul>{g.records.map((r) => <li key={r.id}><Link href={hrefOf({ type: g.type === 'font' ? 'font' : g.type, id: r.id })}><bdi>{r.name}</bdi></Link> <small className="dz-muted">{r.detail}</small></li>)}</ul>
          <small>For: {g.signals.join(', ') || '—'}{g.against.length ? ` · Against: ${g.against.join(', ')}` : ''}</small>
        </div>
      ))}
    </div>
  );
}

function ImagesCard({ ids, note, entity }: { ids: string[]; note?: string; entity: EntityRef | null }) {
  const { assets, merge } = useRefs();
  const toast = useToast();
  const list = ids.map((id) => assets[id]).filter(Boolean);
  if (!list.length) return <div className="ag-card"><div className="ag-card__head"><b>Images</b><small>loading…</small></div></div>;
  const discard = async (id: string) => {
    try { await agentApi('assets', { discard: [id] }); merge({ assets: [{ ...assets[id], status: 'discarded', preview: null }] }); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  };
  return (
    <div className="ag-card">
      <div className="ag-card__head"><b dir="auto">{note ?? 'Images'}</b>{entity ? <Link href={hrefOf(entity)}><bdi>{entity.name}</bdi></Link> : null}</div>
      <p className="dz-hint" style={{ margin: '0 0 10px' }}>Kept privately for review — nothing is added to Fahress until you approve a proposal that adds an image.</p>
      <div className="ag-imgs">
        {list.map((a) => (
          <figure key={a.id} className={`ag-img${a.status !== 'staged' ? ' is-off' : ''}`}>
            {a.preview ? <img src={a.preview} alt="" loading="lazy" /> : <div className="ag-img__none">{a.status === 'attached' ? 'Added' : a.status === 'discarded' ? 'Discarded' : 'Preview expired'}</div>}
            <figcaption>
              <small>{a.width}×{a.height} · {a.kind.replace('_', ' ')}</small>
              <a href={a.page_url || a.source_url} target="_blank" rel="noopener noreferrer nofollow">{host(a.page_url || a.source_url)} ↗</a>
              {a.status === 'staged' ? <button type="button" className="dz-link" onClick={() => discard(a.id)}>Discard</button> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/* ---------- proposals ---------- */
const OP_LABEL: Record<string, string> = {
  set: 'Change', create: 'Create', link: 'Link', status: 'Status', image_add: 'Add image', image_remove: 'Remove image', image_order: 'Reorder images',
  cover: 'Change cover', merge: 'Merge', delete: 'Delete', restore: 'Restore', revert: 'Revert', taxonomy_create: 'New list entry',
};

function useNames() {
  const { data, personById, fontById } = useData();
  return (kind: string, id: string): string => {
    if (!data) return id;
    if (kind === 'designers') return String(personById.get(id)?.name ?? id);
    if (kind === 'font') return String(fontById.get(id)?.name ?? id);
    if (kind === 'person') return String(personById.get(id)?.name ?? id);
    const list = (kind === 'languages' ? data.groups : kind === 'awards' ? data.awards : (data as unknown as Record<string, { id: unknown; name: unknown }[]>)[kind]) ?? [];
    return String(list.find((t) => String(t.id) === id)?.name ?? id);
  };
}

function OpView({ op, editable, onEdit }: { op: ProposalOp; editable: boolean; onEdit: (to: unknown) => void }) {
  const name = useNames();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { assets } = useRefs();
  const target = String(op.target ?? op.font ?? '');
  const targetName = target.startsWith('$new:') ? `new ${target.slice(5)}` : name(op.entity === 'designer' ? 'person' : 'font', target);
  if (op.op === 'set') {
    const long = ['description', 'description_ar', 'bio', 'bio_ar'].includes(String(op.field));
    return (
      <div className="ag-op__body">
        <span><b>{String(op.field).replace(/_/g, ' ')}</b> of <bdi>{targetName}</bdi></span>
        {'from' in op ? <del dir="auto">{show(op.from)}</del> : null}
        {editing ? (
          <div className="ag-op__edit">
            {long ? <textarea className="dz-textarea" dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} /> : <input className="dz-input" dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} />}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" onClick={() => {
                let v: unknown = draft;
                if (['year', 'weights'].includes(String(op.field))) v = draft.trim() ? Number(draft) : null;
                else if (op.field === 'is_variable') v = draft.trim().toLowerCase() === 'true' || draft.trim() === 'yes';
                else if (['purchase_links', 'case_studies', 'language_group'].includes(String(op.field))) v = draft.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
                else if (op.field === 'social_links') { try { v = JSON.parse(draft); } catch { v = op.to; } }
                onEdit(v); setEditing(false);
              }}>Use this</button>
              <button type="button" className="dz-btn dz-btn--sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : <ins dir="auto">{show(op.to)}</ins>}
        {editable && !editing ? <button type="button" className="dz-link" onClick={() => { setDraft(Array.isArray(op.to) ? (op.to as unknown[]).join('\n') : typeof op.to === 'object' && op.to ? JSON.stringify(op.to) : String(op.to ?? '')); setEditing(true); }}>Edit value</button> : null}
      </div>
    );
  }
  if (op.op === 'link') return <div className="ag-op__body"><span>{op.action === 'add' ? 'Add' : 'Remove'} {String(op.link).replace(/s$/, '')} <b><bdi>{String(op.value).startsWith('$new:') ? `new ${String(op.value).slice(5)}` : name(String(op.link), String(op.value))}</bdi></b> {op.action === 'add' ? 'to' : 'from'} <bdi>{targetName}</bdi>{op.url ? <> (<a href={String(op.url)} target="_blank" rel="noopener noreferrer nofollow">link</a>)</> : null}</span></div>;
  if (op.op === 'status') return <div className="ag-op__body"><span><bdi>{targetName}</bdi>: <del>{String(op.from)}</del> → <ins>{String(op.to)}</ins></span></div>;
  if (op.op === 'create') return <div className="ag-op__body"><span>New {op.entity === 'font' ? 'draft font' : 'designer/foundry'} <b dir="auto">{String((op.values as Record<string, unknown>)?.name ?? '')}</b></span><small className="dz-muted" dir="auto">{show(op.values)}</small></div>;
  if (op.op === 'image_add') { const a = assets[String(op.asset)]; return <div className="ag-op__body"><span>Add an image to <bdi>{targetName}</bdi>{op.entity === 'designer' ? ' (as photo/logo)' : ''}</span>{a?.preview ? <img className="ag-op__img" src={a.preview} alt="" /> : <small className="dz-muted">preview {a ? 'expired' : 'loading'}</small>}</div>; }
  if (op.op === 'merge') return <div className="ag-op__body"><span>Keep <b><bdi>{name(op.entity === 'font' ? 'font' : 'person', String(op.keeper))}</bdi></b>, fold in and delete: {(op.losers as string[]).map((l) => name(op.entity === 'font' ? 'font' : 'person', l)).join(', ')}</span></div>;
  if (op.op === 'delete') return <div className="ag-op__body"><span>Delete <b><bdi>{name(op.entity === 'font' ? 'font' : 'person', target)}</bdi></b> (kept in History, can be restored)</span></div>;
  if (op.op === 'restore' || op.op === 'revert') return <div className="ag-op__body"><span>{op.op === 'restore' ? 'Restore' : 'Revert'} <bdi>{String(op.label ?? `history #${op.activity_id}`)}</bdi></span></div>;
  if (op.op === 'taxonomy_create') return <div className="ag-op__body"><span>Add <b dir="auto">{String(op.name)}</b> to {String(op.table)}</span></div>;
  if (op.op === 'cover') return <div className="ag-op__body"><span>Make another image the cover of <bdi>{targetName}</bdi></span></div>;
  return <div className="ag-op__body"><span>{OP_LABEL[op.op] ?? op.op} on <bdi>{targetName}</bdi></span></div>;
}

const PSTATUS: Record<string, string> = { pending: 'Waiting for approval', executing: 'Saving…', executed: 'Saved', rejected: 'Rejected', cancelled: 'Cancelled', expired: 'Expired', conflict: 'Data changed meanwhile', failed: 'Not saved', superseded: 'Replaced' };

export function ProposalCard({ id, preselect }: { id: string; preselect?: string[] }) {
  const { proposals, merge, need } = useRefs();
  const { reload } = useData();
  useEffect(() => { need({ kind: 'proposal', id }); }, [id, need]);
  const toast = useToast();
  const p = proposals[id];
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message?: string; detail?: unknown } | null>(null);
  const requestId = useRef<string | null>(null);
  useEffect(() => { if (p && picked === null) setPicked(preselect?.length ? p.changes.map((c) => c.id).filter((x) => preselect.includes(x)) : p.changes.map((c) => c.id)); }, [p, picked, preselect]);
  useEffect(() => { if (p && preselect?.length) setPicked(p.changes.map((c) => c.id).filter((x) => preselect.includes(x))); }, [preselect, p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <div className="ag-card"><div className="ag-card__head"><b>Proposal</b><small>loading…</small></div></div>;
  const open = p.status === 'pending';
  const sel = picked ?? [];
  const refresh = async () => merge({ proposals: [(await agentApi<{ proposal: ProposalRow }>(`proposals/${id}`)).proposal] });

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      if (action === 'approve') {
        requestId.current ??= newId(); // the same id for retries of this click: never executed twice
        const r = await agentApi<{ ok: boolean; status: string; message?: string; already?: boolean }>(`proposals/${id}`, { action, version: p.version, ops: sel, request_id: requestId.current });
        setResult({ ok: true, message: r.already ? 'This approval was already carried out.' : `Saved ${sel.length} change${sel.length === 1 ? '' : 's'}.` });
        requestId.current = null;
        toast('Saved to Fahress');
        await reload();
      } else {
        const r = await agentApi<{ proposal?: ProposalRow }>(`proposals/${id}`, { action, version: p.version, ...extra });
        if (r.proposal) { merge({ proposals: [r.proposal] }); setPicked(null); }
      }
      await refresh();
    } catch (e) {
      const body = e instanceof ApiError ? e.body : undefined;
      requestId.current = null;
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Failed', detail: body?.detail });
      await refresh().catch(() => undefined);
    } finally { setBusy(null); }
  };
  const edit = (opId: string, to: unknown) => act('update', { changes: p.changes.map((c) => (c.id === opId ? { ...c, to } : c)) });
  const evidenceFor = (opId: string) => p.evidence.filter((e) => e.change_id === opId);
  const expires = new Date(p.expires_at);

  return (
    <div className={`ag-card ag-prop is-${p.status}`}>
      <div className="ag-card__head">
        <b dir="auto">{p.title}</b>
        <span className={`ag-badge ag-badge--p-${p.status}`}>{PSTATUS[p.status] ?? p.status}</span>
      </div>
      <small className="dz-muted">Version {p.version}{open ? ` · expires ${expires.toLocaleString()}` : ''}{p.submitted_for_review ? ' · shared for review' : ''}</small>
      {p.reason ? <p dir="auto" className="ag-prop__reason">{p.reason}</p> : null}
      {p.impact ? <p dir="auto" className="dz-hint">Effect: {p.impact}</p> : null}
      <ul className="ag-ops">
        {p.changes.map((op) => (
          <li key={op.id} className="ag-op">
            {open ? <input type="checkbox" aria-label={`Include ${op.id}`} checked={sel.includes(op.id)} onChange={(e) => setPicked(e.target.checked ? [...sel, op.id] : sel.filter((x) => x !== op.id))} /> : null}
            <div style={{ minWidth: 0, flex: 1 }}>
              <small className="ag-op__kind">{OP_LABEL[op.op] ?? op.op}</small>
              <OpView op={op} editable={open && op.op === 'set'} onEdit={(to) => edit(op.id, to)} />
              {evidenceFor(op.id).map((ev, n) => (
                <div key={n} className="ag-ev">
                  <span className={`ag-badge ag-badge--${ev.status}`}>{STATUS_LABEL[ev.status] ?? ev.status}</span>
                  {ev.quote ? <span dir="auto">“{ev.quote}”</span> : null}
                  {ev.url ? <a href={ev.url} target="_blank" rel="noopener noreferrer nofollow"><bdi>{ev.publisher || host(ev.url)}</bdi> ↗</a> : <small className="dz-muted">{ev.title}</small>}
                  {ev.date_kind ? <small className="dz-muted">{ev.date_kind.replace(/_/g, ' ')}{ev.precision ? ` · ${ev.precision}` : ''}</small> : null}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {result ? <div className={result.ok ? 'ag-ok' : 'dz-warn'}><b>{result.ok ? '✓' : 'Not saved'}</b> {result.message}{result.detail ? <small><br />{show(result.detail)}</small> : null}</div> : null}
      {p.status === 'conflict' || p.status === 'failed' ? <p className="dz-hint">{p.error}</p> : null}
      {open ? (
        <div className="ag-prop__actions">
          <button type="button" className="dz-btn dz-btn--primary dz-btn--sm" disabled={!sel.length || !!busy} onClick={() => act('approve')}>{busy === 'approve' ? 'Saving…' : sel.length === p.changes.length ? 'Approve all' : `Approve ${sel.length} selected`}</button>
          <button type="button" className="dz-btn dz-btn--sm" disabled={!!busy} onClick={() => act('reject')}>Reject</button>
          {!p.submitted_for_review ? <button type="button" className="dz-btn dz-btn--sm" disabled={!!busy} onClick={() => act('submit')} title="Let a team member who may approve this see it">Share for review</button> : null}
        </div>
      ) : p.status === 'conflict' || p.status === 'failed' ? (
        <div className="ag-prop__actions">
          <button type="button" className="dz-btn dz-btn--sm" disabled={!!busy} onClick={() => act('refresh')}>Start from the current data (new version)</button>
          <button type="button" className="dz-btn dz-btn--sm" disabled={!!busy} onClick={() => act('cancel')}>Drop it</button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- jobs ---------- */
function JobCard({ id, title }: { id: string; title: string }) {
  const { jobs, merge } = useRefs();
  const toast = useToast();
  const job = jobs[id];
  const [items, setItems] = useState<{ id: string; label: string; status: string; summary: string | null; proposal_ids: string[]; error: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const load = async () => { const r = await agentApi<{ job: Job; items: typeof items }>(`jobs/${id}`); merge({ jobs: [r.job] }); setItems(r.items); return r.job; };
  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const j = await load(); if (alive && ['queued', 'running', 'cancel_requested'].includes(j.status)) setTimeout(tick, 4000); } catch { /* retry on next open */ } };
    tick();
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (action: string) => { try { await agentApi(`jobs/${id}`, { action }); await load(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } };
  const pct = job?.total ? Math.round(((job.done + job.failed) / job.total) * 100) : 0;
  return (
    <div className="ag-card">
      <div className="ag-card__head"><b dir="auto">{job?.title ?? title}</b><span className="ag-badge">{job?.status ?? '…'}</span></div>
      <div className="dz-progress" style={{ margin: '8px 0' }}><span style={{ width: `${pct}%` }} /></div>
      <small className="dz-muted">{job ? `${job.done} done · ${job.failed} failed · ${job.total} in total` : 'loading…'} — each result is a proposal you approve separately.</small>
      <div className="ag-prop__actions">
        {job && ['queued', 'running'].includes(job.status) ? <><button type="button" className="dz-btn dz-btn--sm dz-btn--primary" onClick={() => act('work')}>Continue working</button><button type="button" className="dz-btn dz-btn--sm" onClick={() => act('pause')}>Pause</button></> : null}
        {job && ['paused', 'failed'].includes(job.status) ? <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" onClick={() => act('resume')}>Resume</button> : null}
        {job && ['queued', 'running', 'paused'].includes(job.status) ? <button type="button" className="dz-btn dz-btn--sm" onClick={() => act('cancel')}>Cancel</button> : null}
        <button type="button" className="dz-link" onClick={() => setOpen((o) => !o)}>{open ? 'Hide records' : 'Show records'}</button>
      </div>
      {open ? <ol className="ag-ents">{items.map((it) => <li key={it.id}><bdi>{it.label}</bdi> <small className="dz-muted">· {it.status}{it.error ? ` · ${it.error}` : ''}</small>{it.summary ? <div className="dz-hint" dir="auto">{it.summary.slice(0, 300)}</div> : null}{it.proposal_ids.map((pid) => <ProposalCard key={pid} id={pid} />)}</li>)}</ol> : null}
    </div>
  );
}
