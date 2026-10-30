'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ConfirmButton, timeAgo, useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { newFontHref } from '@/lib/admin/prefill';
import { img, useData } from '@/lib/admin/store';
import Mailbox from '@/components/dashboard/Mailbox';
import { useMailStatus } from '@/lib/admin/mail';

const TABS = [
  { id: 'message', label: 'Messages' },
  { id: 'font', label: 'Font submissions' },
  { id: 'correction', label: 'Corrections' },
  { id: 'claim', label: 'Profile claims' },
  { id: 'profile_edit', label: 'Profile edits' },
] as const;

const FIELD_LABEL: Record<string, string> = { name: 'Name', bio: 'Bio', country: 'Country', logo: 'Photo / logo', social_links: 'Links' };

export default function Inbox() {
  const { data, personById, fontById, reload } = useData();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('message');
  const [show, setShow] = useState<'new' | 'done'>('new');
  const [busy, setBusy] = useState<string | null>(null);

  const mailStatus = useMailStatus();
  const subs = useMemo(() => data?.submissions ?? [], [data]);
  if (!data) return null;
  if (!data.upgraded) return (
    <>
      <div className="dz-head"><div><p className="dz-eyebrow">Inbox</p><h1 className="display">Inbox</h1></div></div>
      <div className="dz-empty">The inbox switches on after the one-time database update. Then font submissions, corrections and profile claims from the site arrive here.</div>
    </>
  );

  const count = (k: string) => subs.filter((s) => s.kind === k && s.status === 'new').length + (k === 'message' ? mailStatus?.unread ?? 0 : 0);
  const list = subs.filter((s) => s.kind === tab && (show === 'new' ? s.status === 'new' : s.status !== 'new'));
  const isAdmin = data.role === 'admin';

  async function close(s: Row, status: 'accepted' | 'rejected', msg: string, extra?: () => Promise<void>) {
    setBusy(String(s.id));
    try {
      if (extra) await extra();
      await db.update('submissions', { id: String(s.id) }, { status, handled_at: new Date().toISOString() });
      await db.log({ action: `${s.kind}:${status}`, entity: 'submission', entity_id: String(s.id), label: String((s.payload as Row)?.name ?? s.kind), before: s });
      await reload();
      toast(msg);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'err');
    } finally {
      setBusy(null);
    }
  }

  const who = (s: Row) => {
    const p = (s.payload as Row) ?? {};
    const email = String(s.email ?? p.email ?? '');
    const name = String(s.name ?? p.submitter ?? '');
    return [name, email].filter(Boolean).join(' · ') || (s.user_id ? 'Signed-in user' : 'Anonymous visitor');
  };

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Inbox</p>
          <h1 className="display">{subs.filter((s) => s.status === 'new').length + (mailStatus?.unread ?? 0) || 'Nothing'} new</h1>
          <p>Your email and everything designers, foundries and visitors send from the site — in one place.</p>
        </div>
      </div>
      <div className="dz-toolbar">
        <div className="dz-seg">{TABS.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>{t.label} {count(t.id) || ''}</button>)}</div>
        {tab !== 'message' ? <div className="dz-seg"><button type="button" className={show === 'new' ? 'is-on' : ''} onClick={() => setShow('new')}>New</button><button type="button" className={show === 'done' ? 'is-on' : ''} onClick={() => setShow('done')}>Handled</button></div> : null}
      </div>

      {tab === 'message' ? <Mailbox /> : null}

      {tab === 'message' ? null : list.length === 0 ? <div className="dz-empty">Nothing here.</div> : (
        <div style={{ display: 'grid', gap: 16 }}>
          {list.map((s) => {
            const p = (s.payload as Row) ?? {};
            const id = String(s.id);
            const font = s.font_id ? fontById.get(String(s.font_id)) : undefined;
            const person = s.designer_id ? personById.get(String(s.designer_id)) : undefined;
            return (
              <article key={id} className="dz-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <h3 style={{ margin: 0 }}>
                    {s.kind === 'font' ? String(p.name ?? 'Untitled font') : s.kind === 'correction' ? `About ${font ? font.name : person ? person.name : 'the site'}` : `${person?.name ?? 'Unknown profile'}`}
                  </h3>
                  <span className="dz-muted" style={{ fontSize: 13 }}>{who(s)} · {timeAgo(String(s.created_at))}{s.status !== 'new' ? ` · ${s.status}` : ''}</span>
                </div>

                {s.kind === 'font' && (
                  <dl className="dz-kv" style={{ marginTop: 12 }}>
                    <dt>Designer</dt><dd>{(p.designers as string[] | undefined)?.join(', ') || '—'}</dd>
                    <dt>Year</dt><dd>{String(p.year ?? '—')}</dd>
                    <dt>License</dt><dd style={{ textTransform: 'capitalize' }}>{String(p.license ?? '—')}</dd>
                    <dt>Links</dt><dd style={{ display: 'grid' }}>{((p.links as string[]) ?? []).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</a>)}</dd>
                    {p.description ? <><dt>About</dt><dd>{String(p.description)}</dd></> : null}
                    {p.is_designer ? <><dt>Sent by</dt><dd>The designer / foundry</dd></> : null}
                    {Array.isArray(p.images) && p.images.length ? <><dt>Images</dt><dd style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(p.images as string[]).map((im) => <img key={im} src={img(im, 256)} alt="" className="dz-thumb" />)}</dd></> : null}
                  </dl>
                )}
                {s.kind === 'correction' && (
                  <>
                    <p style={{ margin: '12px 0', whiteSpace: 'pre-wrap' }}>{String(s.message ?? p.message ?? '')}</p>
                    {font ? <Link className="dz-btn dz-btn--sm" href={`/dashboard/fonts/${font.id}`}>Open {String(font.name)}</Link> : null}
                    {person ? <Link className="dz-btn dz-btn--sm" href={`/dashboard/${person.type === 'foundry' ? 'foundries' : 'designers'}/${person.id}`}>Open {String(person.name)}</Link> : null}
                  </>
                )}
                {s.kind === 'claim' && (
                  <dl className="dz-kv" style={{ marginTop: 12 }}>
                    <dt>Profile</dt><dd>{person ? <Link href={`/dashboard/${person.type === 'foundry' ? 'foundries' : 'designers'}/${person.id}`}>{String(person.name)}</Link> : '—'}{person?.user_id ? <span className="dz-tag dz-tag--warn" style={{ marginLeft: 8 }}>Already claimed</span> : null}</dd>
                    <dt>Proof</dt><dd>{p.proof ? <a href={String(p.proof)} target="_blank" rel="noreferrer">{String(p.proof).replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</a> : '—'}</dd>
                    <dt>Message</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{String(s.message ?? '—')}</dd>
                  </dl>
                )}
                {s.kind === 'profile_edit' && person && (
                  <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                    {Object.entries((p.changes as Row) ?? {}).map(([k, v]) => (
                      <div key={k} className="dz-diff">
                        <span className="dz-label">{FIELD_LABEL[k] ?? k}</span>
                        {k === 'logo' ? (
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            {person.logo ? <img className="dz-av" src={img(String(person.logo), 256)} alt="" /> : <span className="dz-muted">none</span>} → {v ? <img className="dz-av" src={img(String(v), 256)} alt="" /> : <span className="dz-muted">removed</span>}
                          </div>
                        ) : k === 'social_links' ? (
                          <div style={{ display: 'grid', gap: 2, fontSize: 14 }}>{Object.entries((v as Row) ?? {}).map(([sk, sv]) => <span key={sk}>{sk.replace('_url', '')}: {String(sv) || <em className="dz-muted">removed</em>}</span>)}</div>
                        ) : (
                          <div className="dz-diff__pair"><del>{String(person[k] ?? '') || '—'}</del><ins>{String(v ?? '') || '—'}</ins></div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {s.status === 'new' && (
                  <div className="dz-review__actions" style={{ marginTop: 16 }}>
                    {s.kind === 'font' && (
                      <Link className="dz-btn dz-btn--primary" href={newFontHref({ name: String(p.name ?? ''), designers: (p.designers as string[]) ?? [], year: (p.year as string) ?? null, links: (p.links as string[]) ?? [], description: String(p.description ?? ''), license: String(p.license ?? ''), source: ((p.links as string[]) ?? [])[0], stored: (p.images as string[]) ?? [], submissionId: id })}>Create font from this</Link>
                    )}
                    {s.kind === 'correction' && <button type="button" className="dz-btn dz-btn--primary" disabled={busy === id} onClick={() => close(s, 'accepted', 'Marked as done')}>Mark as done</button>}
                    {s.kind === 'claim' && person && isAdmin && (
                      <button type="button" className="dz-btn dz-btn--primary" disabled={busy === id} onClick={() => close(s, 'accepted', `${person.name} is now verified and managed by this account`, async () => { await db.update('designers', { id: String(person.id) }, { user_id: s.user_id }); await db.refreshSite(); })}>Approve claim</button>
                    )}
                    {s.kind === 'profile_edit' && person && (
                      <button type="button" className="dz-btn dz-btn--primary" disabled={busy === id} onClick={() => close(s, 'accepted', 'Changes applied to the profile', async () => {
                        const changes = { ...((p.changes as Row) ?? {}) };
                        if (changes.social_links) changes.social_links = Object.fromEntries(Object.entries({ ...((person.social_links as Row) ?? {}), ...(changes.social_links as Row) }).filter(([, v]) => v));
                        if (!data.hasCountry) delete changes.country;
                        await db.update('designers', { id: String(person.id) }, { ...changes, updated_at: new Date().toISOString() });
                        await db.refreshSite();
                      })}>Apply changes</button>
                    )}
                    <ConfirmButton className="dz-btn dz-btn--danger" label="Click again to decline" onConfirm={() => close(s, 'rejected', 'Declined')}>Decline</ConfirmButton>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
