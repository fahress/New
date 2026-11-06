'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentApi, ApiError, newId, streamChat } from './api';
import Markdown from './Markdown';
import SetupNeeded from './SetupNeeded';
import { CardView, RefsCtx, SourceChip, useRefStore } from './Cards';
import { ConfirmButton, Loading, timeAgo, useToast } from '@/components/dashboard/ui';
import { useData } from '@/lib/admin/store';
import type { AgentSettings } from '@/lib/agent/settings';
import type { Card, ConversationRow, MessageRow, ProgressStep, StreamEvent } from '@/lib/agent/types';

type ConvItem = { id: string; title: string; updated_at: string; archived_at: string | null; context_type: string | null };
type Loaded = { conversation: ConversationRow; messages: MessageRow[]; siblings: Record<string, string[]>; branchHeads: Record<string, string>; running: { id: string; assistant_message_id: string } | null };
type Setup = { settings: AgentSettings; perms: Record<string, boolean>; gateway: { installed: boolean; error?: string }; usage: { user_today: number; team_today: number; user_limit: number; team_limit: number } | null; integrations: { provider: string; configured: boolean }[] };

const EXAMPLES = [
  'ابحث عن هذا الخط وكمل بياناته الناقصة',
  'مين مصممه؟ وهل عندنا حساب له أصلًا؟',
  'متى أطلق الخط؟ وش أقدم منشور تقدر تلقاه عنه؟',
  'ابحث عن الخطوط اللي ناقصها سنة الإصدار',
  'Compare what we have with the sources',
  'Review similar records and suggest a merge',
];

export default function AgentChat() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { fontById, personById } = useData();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [notInstalled, setNotInstalled] = useState<string | null>(null);
  const [list, setList] = useState<ConvItem[] | null>(null);
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [convId, setConvId] = useState<string | null>(params.get('c'));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<{ user: MessageRow | null; asst: MessageRow; runId: string | null; cut: string | null; error: { message: string; retryable: boolean } | null } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const refs = useRefStore(setup?.perms ?? {});

  const ctxParam = params.get('context');
  const context = useMemo(() => {
    const m = /^(font|designer|foundry):([0-9a-f-]{36})$/.exec(ctxParam ?? '');
    if (!m) return null;
    const row = m[1] === 'font' ? fontById.get(m[2]) : personById.get(m[2]);
    return { type: m[1], id: m[2], name: row ? String(row.name) : 'record' };
  }, [ctxParam, fontById, personById]);

  /* ----- loading ----- */
  useEffect(() => {
    agentApi<Setup>('settings').then(setSetup).catch((e) => {
      if (e instanceof ApiError && e.code === 'not_installed') setNotInstalled(String((e.body as { detail?: string } | undefined)?.detail ?? ''));
      else setSetupError(e instanceof Error ? e.message : 'Couldn’t load the agent');
    });
  }, []);
  const loadList = useCallback(async () => {
    try { setList((await agentApi<{ conversations: ConvItem[] }>(`conversations?${new URLSearchParams({ ...(q ? { q } : {}), ...(archived ? { archived: '1' } : {}) })}`)).conversations); }
    catch { setList([]); }
  }, [q, archived]);
  useEffect(() => { const t = setTimeout(loadList, q ? 300 : 0); return () => clearTimeout(t); }, [loadList, q]);

  const loadConv = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await agentApi<Loaded & { proposals: never[]; sources: never[]; assets: never[]; jobs: never[] }>(`conversations/${id}`);
      refs.merge({ proposals: r.proposals, sources: r.sources, assets: r.assets, jobs: r.jobs });
      setLoaded(r);
      return r;
    } catch (e) {
      if (!quiet) toast(e instanceof Error ? e.message : 'Couldn’t open the conversation', 'err');
      if (e instanceof ApiError && e.status === 404) { setConvId(null); router.replace('/dashboard/agent'); }
      return null;
    } finally { if (!quiet) setLoading(false); }
  }, [refs, router, toast]);
  useEffect(() => { if (convId) loadConv(convId); else setLoaded(null); }, [convId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a reply still running (another tab, or after a reload): follow it from the database
  useEffect(() => {
    if (!loaded?.running || live || !convId) return;
    const t = setInterval(async () => { const r = await loadConv(convId, true); if (r && !r.running) { clearInterval(t); loadList(); } }, 1500);
    return () => clearInterval(t);
  }, [loaded?.running, live, convId, loadConv, loadList]);

  const open = (id: string | null) => {
    abort.current?.abort();
    setLive(null); setEditing(null); setSideOpen(false);
    setConvId(id);
    router.replace(id ? `/dashboard/agent?c=${id}` : '/dashboard/agent');
  };

  /* ----- sending ----- */
  const onScroll = () => { const el = scroller.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  useEffect(() => { const el = scroller.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; }, [live, loaded]);

  const send = async (opts: { content?: string; edit_of?: string; regenerate_of?: string }) => {
    if (live && !live.error) return;
    const rid = newId();
    const now = new Date().toISOString();
    const base = { conversation_id: convId ?? '', parent_id: null, run_id: null, client_request_id: null, cards: [], progress: [], error: null, created_at: now, updated_at: now };
    const user: MessageRow | null = opts.content ? { ...base, id: `tmp-u-${rid}`, role: 'user', content: opts.content, status: 'complete' } : null;
    const asst: MessageRow = { ...base, id: `tmp-a-${rid}`, role: 'assistant', content: '', status: 'streaming' };
    setLive({ user, asst, runId: null, cut: opts.edit_of ?? opts.regenerate_of ?? null, error: null });
    atBottom.current = true;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const apply = (e: StreamEvent) => {
      setLive((l) => {
        if (!l) return l;
        const a = { ...l.asst };
        if (e.type === 'meta') {
          if (!convId) { setConvId(e.conversation_id); router.replace(`/dashboard/agent?c=${e.conversation_id}`); }
          return { ...l, runId: e.run_id, asst: { ...a, id: e.assistant_message_id } };
        }
        if (e.type === 'delta') a.content += e.text;
        if (e.type === 'progress') a.progress = e.steps;
        if (e.type === 'card') {
          const i = a.cards.findIndex((c) => (c.kind === e.card.kind && 'id' in c && 'id' in e.card && c.id === e.card.id) || (c.kind === 'sources' && e.card.kind === 'sources'));
          a.cards = i >= 0 ? a.cards.map((c, n) => (n === i ? e.card : c)) : [...a.cards, e.card];
        }
        if (e.type === 'done') return { ...l, asst: e.message };
        if (e.type === 'error') return { ...l, error: { message: e.message, retryable: e.retryable } };
        return { ...l, asst: a };
      });
    };
    try {
      const r = await streamChat({ conversation_id: convId ?? undefined, content: opts.content, client_request_id: rid, edit_of: opts.edit_of, regenerate_of: opts.regenerate_of, ...(context && !convId ? { context: { type: context.type, id: context.id } } : {}) }, apply, ctrl.signal);
      if (r.state !== 'streamed') { setConvId(r.conversation_id); }
      const id = convId ?? (r.state !== 'streamed' ? r.conversation_id : null);
      setLive((l) => (l?.error ? l : null));
      if (id) await loadConv(id, true);
      else { const cur = new URL(window.location.href).searchParams.get('c'); if (cur) await loadConv(cur, true); }
      loadList();
    } catch (e) {
      if (ctrl.signal.aborted) { setLive(null); const cur = new URL(window.location.href).searchParams.get('c'); if (cur) await loadConv(cur, true); return; }
      const msg = e instanceof Error ? e.message : 'The request failed';
      setLive((l) => (l ? { ...l, error: { message: msg, retryable: !(e instanceof ApiError) || e.status >= 429 } } : l));
    }
  };

  const stop = async () => {
    const runId = live?.runId ?? loaded?.running?.id;
    if (runId) await agentApi(`runs/${runId}`, {}).catch(() => undefined);
    abort.current?.abort();
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send({ content: text });
  };

  /* ----- conversation actions ----- */
  const rename = async (c: ConvItem) => {
    const t = window.prompt('Rename conversation', c.title);
    if (!t?.trim()) return;
    try { await agentApi(`conversations/${c.id}`, { title: t }, 'PATCH'); loadList(); if (c.id === convId) loadConv(c.id, true); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  };
  const archive = async (c: ConvItem, on: boolean) => { try { await agentApi(`conversations/${c.id}`, { archived: on }, 'PATCH'); loadList(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } };
  const remove = async (c: ConvItem) => {
    try { await agentApi(`conversations/${c.id}`, {}, 'DELETE'); if (c.id === convId) open(null); loadList(); toast('Conversation deleted'); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  };
  const switchBranch = async (messageId: string, dir: -1 | 1) => {
    if (!loaded || !convId) return;
    const sibs = loaded.siblings[messageId] ?? [messageId];
    const next = sibs[sibs.indexOf(messageId) + dir];
    if (!next) return;
    try {
      const r = await agentApi<{ superseded: number }>(`conversations/${convId}`, { head: loaded.branchHeads[next] ?? next }, 'PATCH');
      if (r.superseded) toast(`${r.superseded} pending proposal${r.superseded === 1 ? ' was' : 's were'} closed because they belong to the other version.`);
      await loadConv(convId, true);
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  };

  /* ----- render ----- */
  if (notInstalled !== null) return <SetupNeeded detail={notInstalled || null} />;
  if (setupError) return <div className="dz-panel dz-panel--err"><b>The agent isn’t available.</b><p>{setupError}</p><p className="dz-hint">If this is a new installation, run <code>supabase/agent-setup.sql</code> and deploy the gateway — see the setup guide.</p></div>;
  if (!setup) return <Loading text="Opening the agent…" />;
  const s = setup.settings;
  const blocked = !s.runtime.enabled ? 'The agent is switched off.' : !setup.gateway.installed ? `The agent gateway isn’t reachable: ${setup.gateway.error ?? 'not installed'}.` : !s.models.chat ? 'No chat model is chosen yet.' : !setup.integrations.find((i) => i.provider === s.models.chat_provider)?.configured ? `No ${s.models.chat_provider === 'fireworks' ? 'Fireworks' : 'OpenRouter'} key is saved yet.` : null;
  const u = setup.usage;
  const warn = u && (u.user_today / u.user_limit >= s.usage.warn_at_percent / 100 || u.team_today / u.team_limit >= s.usage.warn_at_percent / 100);
  const messages = loaded?.messages ?? [];
  const cutAt = live?.cut ? messages.findIndex((m) => m.id === live.cut) : -1;
  const before = cutAt >= 0 ? messages.slice(0, cutAt) : messages;
  const shown: MessageRow[] = live ? [...before.filter((m) => m.id !== live.asst.id), ...(live.user ? [live.user] : []), live.asst] : messages;
  const busy = !!live && !live.error;
  const runningElsewhere = !live && !!loaded?.running;

  return (
    <RefsCtx.Provider value={refs}>
      <div className={`ag${sideOpen ? ' is-side' : ''}`}>
        <aside className="ag-side" aria-label="Conversations">
          <button type="button" className="dz-btn dz-btn--primary dz-btn--block" onClick={() => open(null)}>+ New conversation</button>
          <input className="dz-input" placeholder="Search conversations…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
          <div className="dz-seg" role="tablist">
            <button type="button" className={!archived ? 'is-on' : ''} onClick={() => setArchived(false)}>Recent</button>
            <button type="button" className={archived ? 'is-on' : ''} onClick={() => setArchived(true)}>Archived</button>
          </div>
          <ul className="ag-convs">
            {list === null ? <li className="dz-muted">Loading…</li> : list.length === 0 ? <li className="dz-muted">{q ? 'Nothing found.' : archived ? 'No archived conversations.' : 'No conversations yet.'}</li> : list.map((c) => (
              <li key={c.id} className={c.id === convId ? 'is-on' : ''}>
                <button type="button" className="ag-conv" onClick={() => open(c.id)}><span dir="auto">{c.title}</span><small>{timeAgo(c.updated_at)}</small></button>
                <details className="ag-conv__more">
                  <summary aria-label="More">⋯</summary>
                  <div>
                    <button type="button" onClick={() => rename(c)}>Rename</button>
                    <button type="button" onClick={() => archive(c, !c.archived_at)}>{c.archived_at ? 'Unarchive' : 'Archive'}</button>
                    <ConfirmButton className="ag-danger" label="Delete for good?" onConfirm={() => remove(c)}>Delete</ConfirmButton>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/agent/settings" className="dz-link">Agent settings</Link>
        </aside>

        <section className="ag-main">
          <header className="ag-head">
            <button type="button" className="dz-btn dz-btn--sm ag-sidebtn" onClick={() => setSideOpen((o) => !o)}>Conversations</button>
            <div style={{ minWidth: 0 }}>
              <p className="dz-eyebrow">{s.runtime.name}</p>
              <h1 dir="auto">{loaded?.conversation.title ?? 'New conversation'}</h1>
              {(loaded?.conversation.context_type || context) ? <small className="dz-muted">About: <Link href={`/dashboard/${(loaded?.conversation.context_type ?? context?.type) === 'font' ? 'fonts' : (loaded?.conversation.context_type ?? context?.type) === 'foundry' ? 'foundries' : 'designers'}/${loaded?.conversation.context_id ?? context?.id}`}><bdi>{loaded?.conversation.context_id ? String((loaded.conversation.context_type === 'font' ? fontById : personById).get(loaded.conversation.context_id)?.name ?? 'record') : context?.name}</bdi></Link></small> : null}
            </div>
            {u ? <small className={warn ? 'ag-usage is-warn' : 'ag-usage'} title="Tokens used today (as reported by the provider)">Today: {fmt(u.user_today)} / {fmt(u.user_limit)} tokens{warn ? ' — close to the limit' : ''}</small> : null}
          </header>

          {blocked ? <div className="dz-warn" style={{ margin: '0 0 12px' }}><b>Not ready</b>{blocked} {setup.perms.manage_settings ? <Link href="/dashboard/agent/settings">Open the agent settings →</Link> : 'Ask an admin to finish the setup.'}</div> : null}

          <div className="ag-thread" ref={scroller} onScroll={onScroll} aria-live="polite">
            {loading ? <Loading text="Opening…" /> : shown.length === 0 ? (
              <div className="ag-empty">
                <h2 dir="auto">{s.runtime.name}</h2>
                <p dir="auto">{s.runtime.description}</p>
                <div className="ag-examples">{EXAMPLES.map((x) => <button type="button" key={x} dir="auto" onClick={() => setDraft(x)}>{x}</button>)}</div>
              </div>
            ) : shown.map((m) => (
              <Message
                key={m.id} m={m} live={!!live && m.id === live.asst.id} siblings={loaded?.siblings[m.id]}
                onBranch={(d) => switchBranch(m.id, d)}
                onEdit={m.role === 'user' && !busy && !m.id.startsWith('tmp-') ? () => setEditing({ id: m.id, text: m.content }) : undefined}
                onRegenerate={m.role === 'assistant' && !busy && !m.id.startsWith('tmp-') && m.status !== 'streaming' ? () => send({ regenerate_of: m.id }) : undefined}
                editing={editing?.id === m.id ? editing.text : null}
                onEditChange={(t) => setEditing((x) => (x ? { ...x, text: t } : x))}
                onEditCancel={() => setEditing(null)}
                onEditSend={() => { const e = editing; if (!e?.text.trim()) return; setEditing(null); send({ content: e.text.trim(), edit_of: e.id }); }}
              />
            ))}
            {live?.error ? (
              <div className="dz-warn" role="alert">
                <b>The reply didn’t finish</b>{live.error.message}
                <div style={{ display: 'flex', gap: 8 }}>
                  {live.asst.id && !live.asst.id.startsWith('tmp-') ? <button type="button" className="dz-btn dz-btn--sm" onClick={() => { setLive(null); send({ regenerate_of: live.asst.id }); }}>Try again</button>
                    : live.user ? <button type="button" className="dz-btn dz-btn--sm" onClick={() => { const t = live.user!.content; setLive(null); send({ content: t }); }}>Try again</button> : null}
                  <button type="button" className="dz-btn dz-btn--sm" onClick={() => setLive(null)}>Dismiss</button>
                </div>
              </div>
            ) : null}
          </div>

          <form className="ag-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <textarea
              className="dz-textarea" dir="auto" rows={2} placeholder={context && !convId ? `Ask about ${context.name}…` : 'Ask the agent… (Enter to send, Shift+Enter for a new line)'}
              value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={8000} aria-label="Message" disabled={!!blocked}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape' && busy) stop(); }}
            />
            {busy || runningElsewhere ? <button type="button" className="dz-btn" onClick={stop}>Stop</button> : <button type="submit" className="dz-btn dz-btn--primary" disabled={!draft.trim() || !!blocked}>Send</button>}
          </form>
        </section>
      </div>
    </RefsCtx.Provider>
  );
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function Progress({ steps, live }: { steps: ProgressStep[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return live ? <div className="ag-progress"><span className="dz-spin" /> Working…</div> : null;
  const cur = steps[steps.length - 1];
  return (
    <div className="ag-progress">
      <button type="button" className="ag-progress__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {live && cur.state === 'running' ? <span className="dz-spin" /> : <span className="ag-tick">✓</span>}
        <span dir="auto">{live ? cur.label : `${steps.length} step${steps.length === 1 ? '' : 's'}`}</span>
        <small>{open ? 'hide' : 'details'}</small>
      </button>
      {open ? <ol>{steps.map((st, i) => <li key={i} className={`is-${st.state}`} dir="auto">{st.label}</li>)}</ol> : null}
    </div>
  );
}

function Message(p: {
  m: MessageRow; live: boolean; siblings?: string[]; onBranch: (d: -1 | 1) => void; onEdit?: () => void; onRegenerate?: () => void;
  editing: string | null; onEditChange: (t: string) => void; onEditCancel: () => void; onEditSend: () => void;
}) {
  const { m } = p;
  const toast = useToast();
  const sources = useMemo(() => m.cards.filter((c): c is Extract<Card, { kind: 'sources' }> => c.kind === 'sources').flatMap((c) => c.ids), [m.cards]);
  const pre = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of m.cards) if (c.kind === 'proposal' && c.preselect) out[c.id] = c.preselect;
    return out;
  }, [m.cards]);
  const cards = m.cards.filter((c, i, all) => !(c.kind === 'proposal' && c.preselect && all.findIndex((x) => x.kind === 'proposal' && x.id === c.id) !== i));
  const cite = (ref: string) => {
    const id = sources.find((x) => x.startsWith(ref.slice(4)));
    return id ? <SourceChip id={id} n={sources.indexOf(id) + 1} /> : null;
  };
  const sib = p.siblings && p.siblings.length > 1 ? { n: p.siblings.indexOf(m.id) + 1, of: p.siblings.length } : null;
  if (m.role === 'user') {
    return (
      <div className="ag-msg ag-msg--user">
        {p.editing !== null ? (
          <div className="ag-editbox">
            <textarea className="dz-textarea" dir="auto" value={p.editing} onChange={(e) => p.onEditChange(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Escape') p.onEditCancel(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) p.onEditSend(); }} />
            <small className="dz-hint">Sending starts a new version of the conversation from here. Pending proposals of the old version are closed.</small>
            <div style={{ display: 'flex', gap: 8 }}><button type="button" className="dz-btn dz-btn--sm dz-btn--primary" onClick={p.onEditSend}>Send</button><button type="button" className="dz-btn dz-btn--sm" onClick={p.onEditCancel}>Cancel</button></div>
          </div>
        ) : <div className="ag-bubble" dir="auto">{m.content}</div>}
        <div className="ag-msg__bar">
          {sib ? <Branch sib={sib} onBranch={p.onBranch} /> : null}
          {p.onEdit && p.editing === null ? <button type="button" className="dz-link" onClick={p.onEdit}>Edit</button> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="ag-msg ag-msg--asst">
      <Progress steps={m.progress ?? []} live={p.live || m.status === 'streaming'} />
      {m.content ? <Markdown text={m.content} cite={cite} /> : m.status === 'streaming' ? null : m.status === 'error' ? <p className="dz-error">{m.error ?? 'The reply failed.'}</p> : m.status === 'stopped' ? null : <p className="dz-muted">(no text)</p>}
      {cards.map((c, i) => <CardView key={`${c.kind}-${'id' in c ? c.id : i}`} card={c} preselect={c.kind === 'proposal' ? pre[c.id] : undefined} />)}
      {m.status === 'stopped' ? <small className="dz-muted">Stopped.</small> : null}
      {m.status !== 'streaming' ? (
        <div className="ag-msg__bar">
          {sib ? <Branch sib={sib} onBranch={p.onBranch} /> : null}
          <button type="button" className="dz-link" onClick={() => navigator.clipboard.writeText(m.content).then(() => toast('Copied'), () => toast('Couldn’t copy', 'err'))}>Copy</button>
          {p.onRegenerate ? <button type="button" className="dz-link" onClick={p.onRegenerate}>{m.status === 'error' ? 'Try again' : 'Regenerate'}</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function Branch({ sib, onBranch }: { sib: { n: number; of: number }; onBranch: (d: -1 | 1) => void }) {
  return (
    <span className="ag-branch">
      <button type="button" aria-label="Previous version" disabled={sib.n <= 1} onClick={() => onBranch(-1)}>‹</button>
      {sib.n} / {sib.of}
      <button type="button" aria-label="Next version" disabled={sib.n >= sib.of} onClick={() => onBranch(1)}>›</button>
    </span>
  );
}
