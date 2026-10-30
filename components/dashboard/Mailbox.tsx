'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmButton, timeAgo, useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { useData } from '@/lib/admin/store';
import {
  download, emailOf, mail, nameOf, quote, refreshMailStatus, useMailStatus, when,
  type MailMessage, type MailStatus, type ThreadSummary,
} from '@/lib/admin/mail';

type Sel = { kind: 'gmail' | 'web'; id: string } | { kind: 'new' } | null;
type Item = { kind: 'gmail' | 'web'; id: string; date: number; who: string; subject: string; snippet: string; unread: boolean; attach?: boolean; count?: number };

const REASONS: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  expired: 'The Google sign-in took too long. Try again.',
  'no-refresh': 'Google didn’t give long-term access. Remove “Fahress” at myaccount.google.com/permissions, then connect again.',
  'not-configured': 'Gmail isn’t set up on the server yet.',
};

/** Messages: the connected Gmail inbox and the website contact form, in one list. */
export default function Mailbox() {
  const { data, reload } = useData();
  const toast = useToast();
  const status = useMailStatus(60_000);
  const [view, setView] = useState<'inbox' | 'done'>('inbox');
  const [source, setSource] = useState<'all' | 'gmail' | 'web'>('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const gmailOn = Boolean(status?.connected);

  // back from Google's sign-in page
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const g = p.get('gmail');
    if (!g) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (g === 'connected') {
      mail<{ email: string }>('finish')
        .then((r) => { toast(`Gmail connected — ${r.email}`); refreshMailStatus(); })
        .catch((e: Error) => toast(e.message, 'err'));
    } else toast(REASONS[p.get('reason') ?? ''] ?? 'Gmail wasn’t connected. Try again.', 'err');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gq = useMemo(() => [view === 'inbox' ? 'in:inbox' : '-in:inbox -in:spam -in:trash -in:draft', search].filter(Boolean).join(' '), [view, search]);

  const load = useCallback(async (more?: string | null) => {
    if (!gmailOn) { setThreads([]); return; }
    setLoading(true);
    setListErr(null);
    try {
      const r = await mail<{ threads: ThreadSummary[]; nextPageToken: string | null }>('list', { q: gq, pageToken: more ?? undefined });
      setThreads((t) => (more ? [...t, ...r.threads.filter((x) => !t.some((y) => y.id === x.id))] : r.threads));
      setNext(r.nextPageToken);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : 'Couldn’t load Gmail');
    } finally {
      setLoading(false);
    }
  }, [gmailOn, gq]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!gmailOn) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible' && !next) load(); }, 60_000);
    return () => clearInterval(t);
  }, [gmailOn, load, next]);

  const web = useMemo(() => (data?.submissions ?? []).filter((s) => s.kind === 'message' && (view === 'inbox' ? s.status === 'new' : s.status !== 'new')), [data, view]);

  const items: Item[] = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const w: Item[] = source === 'gmail' ? [] : web
      .filter((s) => !needle || [s.name, s.email, s.message, (s.payload as Row)?.subject].join(' ').toLowerCase().includes(needle))
      .map((s) => ({
        kind: 'web', id: String(s.id), date: Date.parse(String(s.created_at)), who: String(s.name || s.email || 'Website visitor'),
        subject: String((s.payload as Row)?.subject ?? 'Website message'), snippet: String(s.message ?? '').slice(0, 160), unread: s.status === 'new',
      }));
    const g: Item[] = source === 'web' ? [] : threads.map((t) => ({
      kind: 'gmail', id: t.id, date: t.date, who: nameOf(t.from), subject: t.subject, snippet: t.snippet, unread: t.unread, attach: t.attachments, count: t.count,
    }));
    return [...w, ...g].sort((a, b) => b.date - a.date);
  }, [web, threads, source, search]);

  const patchThread = (id: string, patch: Partial<ThreadSummary> | null) =>
    setThreads((ts) => (patch ? ts.map((t) => (t.id === id ? { ...t, ...patch } : t)) : ts.filter((t) => t.id !== id)));

  const selected = sel && sel.kind === 'web' ? (data?.submissions ?? []).find((s) => String(s.id) === sel.id) : undefined;

  return (
    <>
      <Connection status={status} />
      <div className="dz-toolbar">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} style={{ display: 'flex', gap: 8, flex: '1 1 260px', maxWidth: 420 }}>
          <input className="dz-input" placeholder="Search messages…" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setSearch(''); }} />
        </form>
        <div className="dz-seg">
          {(['all', 'gmail', 'web'] as const).map((s) => <button key={s} type="button" className={source === s ? 'is-on' : ''} onClick={() => setSource(s)}>{s === 'all' ? 'All' : s === 'gmail' ? 'Gmail' : 'Website'}</button>)}
        </div>
        <div className="dz-seg">
          <button type="button" className={view === 'inbox' ? 'is-on' : ''} onClick={() => { setView('inbox'); setSel(null); }}>Inbox</button>
          <button type="button" className={view === 'done' ? 'is-on' : ''} onClick={() => { setView('done'); setSel(null); }}>Done / archived</button>
        </div>
        {gmailOn ? <button type="button" className="dz-btn dz-btn--sm" onClick={() => { load(); refreshMailStatus(); reload(); }} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button> : null}
        {gmailOn ? <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" onClick={() => setSel({ kind: 'new' })}>Write email</button> : null}
      </div>

      <div className={`dz-mail${sel ? ' has-sel' : ''}`}>
        <div className="dz-mail__list">
          {listErr ? <p className="dz-error" style={{ padding: '12px 16px', margin: 0 }}>{listErr}</p> : null}
          {items.length === 0 ? (
            <div className="dz-empty" style={{ border: 0 }}>{loading ? 'Loading…' : search ? 'Nothing matches.' : view === 'inbox' ? 'Inbox zero. Nothing new.' : 'Nothing here.'}</div>
          ) : items.map((it) => (
            <button
              key={`${it.kind}:${it.id}`} type="button"
              className={`dz-mrow${it.unread ? ' is-unread' : ''}${sel && 'id' in sel && sel.id === it.id ? ' is-on' : ''}`}
              onClick={() => setSel({ kind: it.kind, id: it.id })}
            >
              <span className="dz-mrow__top">
                <span className="dz-mrow__who" dir="auto">{it.who}{it.count && it.count > 1 ? <small> {it.count}</small> : null}</span>
                <span className="dz-mrow__date">{when(it.date)}</span>
              </span>
              <span className="dz-mrow__subj" dir="auto">{it.subject}</span>
              <span className="dz-mrow__snip" dir="auto">{it.snippet}</span>
              <span className="dz-mrow__tags">
                <span className={`dz-tag${it.kind === 'web' ? ' dz-tag--solid' : ''}`}>{it.kind === 'web' ? 'Website' : 'Gmail'}</span>
                {it.attach ? <span className="dz-tag">Attachment</span> : null}
              </span>
            </button>
          ))}
          {gmailOn && next && source !== 'web' ? <div style={{ padding: 14, textAlign: 'center' }}><button type="button" className="dz-btn dz-btn--sm" disabled={loading} onClick={() => load(next)}>Load older emails</button></div> : null}
        </div>

        <div className="dz-mail__read">
          {sel ? <button type="button" className="dz-link dz-mail__back" onClick={() => setSel(null)}>← All messages</button> : null}
          {!sel ? <div className="dz-empty" style={{ border: 0 }}>Pick a message to read it here.</div>
            : sel.kind === 'new' ? <NewEmail me={status?.email ?? ''} onDone={() => { setSel(null); load(); }} />
            : sel.kind === 'gmail' ? <Thread key={sel.id} id={sel.id} me={status?.email ?? ''} inInbox={threads.find((t) => t.id === sel.id)?.inbox ?? view === 'inbox'} onPatch={(p) => patchThread(sel.id, p)} onGone={() => { patchThread(sel.id, null); setSel(null); }} />
            : selected ? <WebMessage key={sel.id} s={selected} gmail={gmailOn ? status?.email ?? '' : ''} onGone={() => setSel(null)} />
            : <div className="dz-empty" style={{ border: 0 }}>This message was removed.</div>}
        </div>
      </div>
    </>
  );
}

/* ---------- Gmail connection bar ---------- */
function Connection({ status }: { status: MailStatus | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!status || status.allowed === false) return null;

  if (status.configured === false) return (
    <div className="dz-panel dz-panel--note" style={{ marginBottom: 18 }}>
      <b>Gmail isn’t switched on yet.</b>
      <p className="dz-muted" style={{ margin: '6px 0 0' }}>Website messages already arrive here. To see and answer your Gmail here too, add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>MAIL_TOKEN_SECRET</code> to the site’s settings on Vercel (see README → “Gmail in the dashboard”), then redeploy.</p>
    </div>
  );
  if (status.needsUpdate) return (
    <div className="dz-panel dz-panel--note" style={{ marginBottom: 18 }}>
      <b>One database update needed.</b>
      <p className="dz-muted" style={{ margin: '6px 0 0' }}>Run <code>supabase/messages-update.sql</code> in Supabase → SQL Editor, then reload this page.</p>
    </div>
  );

  async function connect() {
    setBusy(true);
    try {
      const { url } = await mail<{ url: string }>('connect', { hint: 'admin@fahress.com' });
      window.location.href = url;
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try { await mail('disconnect'); await refreshMailStatus(); toast('Gmail disconnected'); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); }
  }

  if (!status.connected) return (
    <div className="dz-callout" style={{ marginBottom: 18 }}>
      <div><b>Bring your Gmail into the dashboard</b><p>Read and answer admin@fahress.com here — no need to open Gmail.</p></div>
      <button type="button" className="dz-btn" disabled={busy} onClick={connect}>{busy ? 'Opening Google…' : 'Connect Gmail'}</button>
    </div>
  );

  return (
    <div className="dz-mailbar">
      <span><span className="dz-dot" /> Gmail connected · <b>{status.email}</b>{status.problem ? <span className="dz-error"> — {status.problem}</span> : null}</span>
      <span style={{ display: 'flex', gap: 12 }}>
        {status.problem ? <button type="button" className="dz-link" disabled={busy} onClick={connect}>Reconnect</button> : null}
        <ConfirmButton className="dz-link" label="Click again to disconnect" onConfirm={disconnect}>Disconnect</ConfirmButton>
      </span>
    </div>
  );
}

/* ---------- one Gmail conversation ---------- */
function Thread({ id, me, inInbox, onPatch, onGone }: { id: string; me: string; inInbox: boolean; onPatch: (p: Partial<ThreadSummary>) => void; onGone: () => void }) {
  const toast = useToast();
  const [t, setT] = useState<{ id: string; messages: MailMessage[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState<'one' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fetchThread = useCallback(async () => {
    try {
      const r = await mail<{ id: string; messages: MailMessage[] }>('thread', { id });
      setT(r);
      setOpen(new Set([r.messages[r.messages.length - 1]?.id, ...r.messages.filter((m) => m.unread).map((m) => m.id)]));
      if (r.messages.some((m) => m.unread)) {
        await mail('read', { id });
        onPatch({ unread: false });
        refreshMailStatus();
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t open this email'); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchThread(); }, [fetchThread]);

  if (err) return <p className="dz-error">{err}</p>;
  if (!t) return <p className="dz-muted">Opening…</p>;
  const msgs = t.messages;
  const last = msgs[msgs.length - 1];
  const meLower = me.toLowerCase();

  async function act(action: string, msg: string, gone = false) {
    setBusy(true);
    try {
      await mail(action, { id });
      toast(msg);
      refreshMailStatus();
      if (gone) onGone(); else if (action === 'unread') onPatch({ unread: true });
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); }
  }

  const lastIncoming = [...msgs].reverse().find((m) => !m.sent) ?? last;
  const replyTo = last.sent ? last.to : (lastIncoming.replyTo || lastIncoming.from);
  const others = [last.to, last.cc].join(',').split(',').map((a) => a.trim()).filter((a) => a && emailOf(a).toLowerCase() !== meLower && emailOf(a).toLowerCase() !== emailOf(replyTo).toLowerCase());
  const subject = /^re:/i.test(msgs[0].subject) ? msgs[0].subject : `Re: ${msgs[0].subject}`;

  return (
    <div className="dz-thread">
      <div className="dz-thread__head">
        <h2 dir="auto">{msgs[0].subject || '(no subject)'}</h2>
        <div className="dz-thread__actions">
          <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" onClick={() => setReply('one')}>Reply</button>
          {others.length ? <button type="button" className="dz-btn dz-btn--sm" onClick={() => setReply('all')}>Reply all</button> : null}
          {inInbox
            ? <button type="button" className="dz-btn dz-btn--sm" disabled={busy} onClick={() => act('archive', 'Archived', true)}>Done (archive)</button>
            : <button type="button" className="dz-btn dz-btn--sm" disabled={busy} onClick={() => act('inbox', 'Moved to inbox', true)}>Move to inbox</button>}
          <button type="button" className="dz-btn dz-btn--sm" disabled={busy} onClick={() => act('unread', 'Marked unread')}>Mark unread</button>
          <ConfirmButton className="dz-btn dz-btn--sm dz-btn--danger" label="Click again to delete" onConfirm={() => act('trash', 'Moved to trash', true)}>Delete</ConfirmButton>
        </div>
      </div>

      {msgs.map((m) => {
        const isOpen = open.has(m.id);
        return (
          <article key={m.id} className={`dz-email${isOpen ? ' is-open' : ''}`}>
            <button type="button" className="dz-email__head" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>
              <span><b dir="auto">{m.sent ? 'You' : nameOf(m.from)}</b> <span className="dz-muted">{emailOf(m.from)}</span></span>
              <span className="dz-muted">{new Date(m.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </button>
            {isOpen ? (
              <>
                <div className="dz-email__meta dz-muted">To {m.to}{m.cc ? ` · Cc ${m.cc}` : ''}</div>
                {m.html ? <HtmlBody html={m.html} /> : <div className="dz-email__text" dir="auto">{m.text}</div>}
                {m.attachments.length ? (
                  <div className="dz-chips" style={{ marginTop: 12 }}>
                    {m.attachments.map((a) => (
                      <button key={a.id} type="button" className="dz-chip dz-attach" onClick={async () => {
                        try { const r = await mail<{ data: string }>('attachment', { messageId: m.id, attachmentId: a.id }); download(a.name, a.type, r.data); }
                        catch (e) { toast(e instanceof Error ? e.message : 'Download failed', 'err'); }
                      }}>⤓ {a.name} <small className="dz-muted">{Math.max(1, Math.round(a.size / 1024))} KB</small></button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : <div className="dz-email__snip dz-muted" dir="auto">{(m.text || '').slice(0, 140)}</div>}
          </article>
        );
      })}

      {reply ? (
        <Composer
          key={reply}
          to={reply === 'all' ? [replyTo, ...others].join(', ') : replyTo}
          subject={subject}
          sendLabel="Send reply"
          onCancel={() => setReply(null)}
          onSend={async (f) => {
            await mail('send', { ...f, body: f.body + quote(lastIncoming), threadId: id, inReplyTo: last.messageId, references: last.references });
            toast('Reply sent');
            setReply(null);
            await fetchThread();
          }}
        />
      ) : null}
    </div>
  );
}

/** Shows an HTML email safely: no scripts can run, links open in a new tab. */
function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(60);
  const doc = useMemo(() => {
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]+http-equiv[^>]*>/gi, '');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; form-action 'none'"><base target="_blank"><style>html,body{margin:0;padding:0}body{display:flow-root;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:2px solid #ddd}</style></head><body>${clean}</body></html>`;
  }, [html]);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | null = null;
    const fit = () => { const b = f.contentDocument?.body; if (b) setH(Math.max(b.scrollHeight, b.offsetHeight) + 4); };
    const onLoad = () => { fit(); const b = f.contentDocument?.body; if (b) { ro = new ResizeObserver(fit); ro.observe(b); } };
    f.addEventListener('load', onLoad);
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [doc]);
  return <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ width: '100%', height: h, border: 0, display: 'block' }} />;
}

/* ---------- a website contact-form message ---------- */
function WebMessage({ s, gmail, onGone }: { s: Row; gmail: string; onGone: () => void }) {
  const { data, reload } = useData();
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = (s.payload as Row) ?? {};
  const replies = (p.replies as { at: string; by: string; body: string }[] | undefined) ?? [];
  const who = String(s.name || s.email || 'Website visitor');
  const subject = String(p.subject ?? 'Your message to Fahress');

  async function setStatus(status: 'new' | 'accepted', extra: Row = {}) {
    await db.update('submissions', { id: String(s.id) }, { status, handled_at: status === 'new' ? null : new Date().toISOString(), ...extra });
    await db.log({ action: `message:${status === 'new' ? 'reopened' : 'done'}`, entity: 'submission', entity_id: String(s.id), label: who });
    await reload();
  }

  return (
    <div className="dz-thread">
      <div className="dz-thread__head">
        <h2 dir="auto">{subject}</h2>
        <div className="dz-thread__actions">
          {s.email ? (gmail
            ? <button type="button" className="dz-btn dz-btn--sm dz-btn--primary" onClick={() => setReplying(true)}>Reply</button>
            : <a className="dz-btn dz-btn--sm dz-btn--primary" href={`mailto:${encodeURIComponent(String(s.email))}?subject=${encodeURIComponent(`Re: ${subject}`)}`}>Reply by email</a>) : null}
          {s.status === 'new'
            ? <button type="button" className="dz-btn dz-btn--sm" disabled={busy} onClick={async () => { setBusy(true); try { await setStatus('accepted'); toast('Marked as done'); onGone(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); } }}>Done</button>
            : <button type="button" className="dz-btn dz-btn--sm" disabled={busy} onClick={async () => { setBusy(true); try { await setStatus('new'); toast('Moved back to inbox'); onGone(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); } }}>Move to inbox</button>}
          {data?.role === 'admin' ? <ConfirmButton className="dz-btn dz-btn--sm dz-btn--danger" label="Click again to delete" onConfirm={async () => { try { await db.remove('submissions', { id: String(s.id) }); await reload(); toast('Deleted'); onGone(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } }}>Delete</ConfirmButton> : null}
        </div>
      </div>

      <article className="dz-email is-open">
        <div className="dz-email__head" style={{ cursor: 'default' }}>
          <span><b dir="auto">{who}</b> {s.email ? <span className="dz-muted">{String(s.email)}</span> : null}</span>
          <span className="dz-muted">{new Date(String(s.created_at)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
        <div className="dz-email__meta dz-muted">Sent from the website contact form{p.page ? ` · came from ${String(p.page)}` : ''}{s.user_id ? ' · signed-in member' : ''}</div>
        <div className="dz-email__text" dir="auto">{String(s.message ?? '')}</div>
      </article>

      {replies.map((r, i) => (
        <article key={i} className="dz-email is-open">
          <div className="dz-email__head" style={{ cursor: 'default' }}><span><b>You</b> <span className="dz-muted">{r.by}</span></span><span className="dz-muted">{timeAgo(r.at)}</span></div>
          <div className="dz-email__text" dir="auto">{r.body}</div>
        </article>
      ))}

      {!s.email ? <p className="dz-muted">No email address was left, so this message can’t be answered.</p> : null}

      {replying && s.email ? (
        <Composer
          to={s.name ? `${String(s.name)} <${String(s.email)}>` : String(s.email)}
          subject={`Re: ${subject}`}
          sendLabel="Send reply"
          onCancel={() => setReplying(false)}
          onSend={async (f) => {
            await mail('send', { ...f, body: f.body + quote({ date: Date.parse(String(s.created_at)), from: who, text: String(s.message ?? ''), html: '' }) });
            await setStatus('accepted', { payload: { ...p, replies: [...replies, { at: new Date().toISOString(), by: gmail, body: f.body }] } });
            toast(`Reply sent to ${String(s.email)}`);
            setReplying(false);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- writing ---------- */
function NewEmail({ me, onDone }: { me: string; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="dz-thread">
      <div className="dz-thread__head"><h2>New email</h2><span className="dz-muted">from {me}</span></div>
      <Composer to="" subject="" sendLabel="Send" onCancel={onDone} onSend={async (f) => { await mail('send', f); toast('Email sent'); onDone(); }} />
    </div>
  );
}

type Fields = { to: string; cc: string; subject: string; body: string };

function Composer({ to, subject, sendLabel, onSend, onCancel }: { to: string; subject: string; sendLabel: string; onSend: (f: Fields) => Promise<void>; onCancel: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Fields>({ to, cc: '', subject, body: '' });
  const [cc, setCc] = useState(false);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { (to ? body.current : null)?.focus(); }, [to]);

  async function send() {
    if (!f.body.trim()) return toast('Write a message first', 'err');
    setBusy(true);
    try { await onSend(f); } catch (e) { toast(e instanceof Error ? e.message : 'Sending failed', 'err'); } finally { setBusy(false); }
  }

  return (
    <form className="dz-compose" onSubmit={(e) => { e.preventDefault(); send(); }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } }}>
      <label className="dz-compose__row"><span>To</span><input className="dz-input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required />{!cc ? <button type="button" className="dz-link" onClick={() => setCc(true)}>Cc</button> : null}</label>
      {cc ? <label className="dz-compose__row"><span>Cc</span><input className="dz-input" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} /></label> : null}
      <label className="dz-compose__row"><span>Subject</span><input className="dz-input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} dir="auto" /></label>
      <textarea ref={body} className="dz-textarea" rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Write your reply…" dir="auto" />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="dz-btn dz-btn--primary" disabled={busy}>{busy ? 'Sending…' : sendLabel}</button>
        <button type="button" className="dz-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <span className="dz-hint">⌘/Ctrl + Enter to send · sent from your Gmail, so it also appears in Gmail’s Sent folder</span>
      </div>
    </form>
  );
}

