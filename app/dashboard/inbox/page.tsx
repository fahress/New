'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { timeAgo, useToast } from '@/components/dashboard/ui';
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
  { id: 'font_claim', label: 'Font claims' },
  { id: 'font_edit', label: 'Font edits' },
] as const;

const FONT_FIELD: Record<string, string> = { name: 'Name', year: 'Release year', license: 'License', description: 'About', purchase_links: 'Where to buy', images: 'Images', cover: 'Cover', status: 'On the site' };
const STATUS_WORD: Record<string, string> = { published: 'Published', featured: 'Featured', draft: 'Draft (hidden)', pending: 'Draft (hidden)' };

/** Decline with a reason the sender sees in their account. */
function Decline({ required, busy, onDecline }: { required: boolean; busy: boolean; onDecline: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  if (!open) return <button type="button" className="dz-btn dz-btn--danger" onClick={() => setOpen(true)}>Decline</button>;
  return (
    <div style={{ display: 'grid', gap: 8, flexBasis: '100%' }}>
      <textarea className="dz-textarea" autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder={required ? 'Why are you declining? They will see this in their account.' : 'Reason (optional) — they will see this in their account.'} style={{ minHeight: 80 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="dz-btn dz-btn--danger" disabled={busy || (required && why.trim().length < 3)} onClick={() => onDecline(why.trim())}>Decline{required ? ' and send reason' : ''}</button>
        <button type="button" className="dz-btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = { name: 'Name', bio: 'Bio', country: 'Country', logo: 'Photo / logo', social_links: 'Links' };

export default function Inbox() {
  const { data, personById, fontById, linked, reload } = useData();
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

  async function close(s: Row, status: 'accepted' | 'rejected', msg: string, extra?: () => Promise<void>, reply?: string) {
    setBusy(String(s.id));
    try {
      if (extra) await extra();
      await db.update('submissions', { id: String(s.id) }, { status, handled_at: new Date().toISOString(), ...(reply ? { reply } : {}) });
      await db.log({ action: `${s.kind}:${status}`, entity: 'submission', entity_id: String(s.id), label: String((s.payload as Row)?.name ?? s.kind), before: s });
      await reload();
      toast(msg);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'err');
    } finally {
      setBusy(null);
    }
  }

  const ownedBy = (s: Row) => (s.user_id ? data.people.filter((o) => o.user_id && String(o.user_id) === String(s.user_id)) : []);

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
                    {s.kind === 'font' ? String(p.name ?? 'Untitled font') : s.kind === 'correction' ? `About ${font ? font.name : person ? person.name : 'the site'}` : s.kind === 'font_claim' || s.kind === 'font_edit' ? String(font?.name ?? p.name ?? 'Unknown font') : `${person?.name ?? 'Unknown profile'}`}
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

                {s.kind === 'font_claim' && (
                  <dl className="dz-kv" style={{ marginTop: 12 }}>
                    <dt>Font</dt><dd>{font ? <Link href={`/dashboard/fonts/${font.id}`}>{String(font.name)}</Link> : String(p.name ?? '—')}{font ? <span className="dz-muted"> · credited to {linked(String(font.id), 'designers').map((d) => String(personById.get(d)?.name ?? '')).filter(Boolean).join(', ') || 'nobody yet'}</span> : null}</dd>
                    <dt>Name</dt><dd>{String(s.name ?? '—')}</dd>
                    <dt>Email</dt><dd>{s.email ? <a href={`mailto:${s.email}`}>{String(s.email)}</a> : '—'}</dd>
                    <dt>Comment</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{String(s.message ?? '—')}</dd>
                    <dt>Their profile</dt><dd>{ownedBy(s).length ? ownedBy(s).map((o) => <Link key={String(o.id)} href={`/dashboard/${o.type === 'foundry' ? 'foundries' : 'designers'}/${o.id}`} style={{ marginRight: 10 }}>{String(o.name)}</Link>) : <span className="dz-muted">No claimed profile yet — add their name from the font page.</span>}</dd>
                  </dl>
                )}
                {s.kind === 'font_edit' && (
                  <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                    <p className="dz-muted" style={{ margin: 0, fontSize: 14 }}>Sent by {person ? <Link href={`/dashboard/${person.type === 'foundry' ? 'foundries' : 'designers'}/${person.id}`}>{String(person.name)}</Link> : 'the profile owner'} for {font ? <Link href={`/dashboard/fonts/${font.id}`}>{String(font.name)}</Link> : String(p.name ?? 'a font')}</p>
                    {Object.entries((p.changes as Row) ?? {}).filter(([k]) => k !== 'cover').map(([k, v]) => {
                      const was = font ? (k === 'images' ? [font.cover, ...(Array.isArray(font.images) ? font.images : [])].filter((x, i, a) => x && a.indexOf(x) === i) : font[k]) : (p.before as Row)?.[k];
                      return (
                        <div key={k} className="dz-diff">
                          <span className="dz-label">{FONT_FIELD[k] ?? k}</span>
                          {k === 'images' ? (
                            <div style={{ display: 'grid', gap: 8 }}>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: .55 }}>{((was as string[]) ?? []).map((im) => <img key={im} src={img(im, 256)} alt="" className="dz-thumb" />)}{!(was as string[])?.length ? <span className="dz-muted">no images</span> : null}</div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{((v as string[]) ?? []).map((im, i) => <span key={im} style={{ display: 'grid', gap: 2 }}><img src={img(im, 256)} alt="" className="dz-thumb" />{i === 0 ? <small className="dz-muted">cover</small> : null}</span>)}{!(v as string[])?.length ? <span className="dz-muted">all removed</span> : null}</div>
                            </div>
                          ) : k === 'purchase_links' ? (
                            <div className="dz-diff__pair"><del>{((was as string[]) ?? []).join('\n') || '—'}</del><ins style={{ whiteSpace: 'pre-wrap' }}>{((v as string[]) ?? []).join('\n') || '—'}</ins></div>
                          ) : k === 'status' ? (
                            <div className="dz-diff__pair"><del>{STATUS_WORD[String(was)] ?? String(was ?? '—')}</del><ins>{STATUS_WORD[String(v)] ?? String(v)}</ins></div>
                          ) : (
                            <div className="dz-diff__pair"><del style={{ whiteSpace: 'pre-wrap' }}>{String(was ?? '') || '—'}</del><ins style={{ whiteSpace: 'pre-wrap' }}>{String(v ?? '') || '—'}</ins></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {s.status !== 'new' && s.reply ? <p className="dz-muted" style={{ margin: '12px 0 0', fontSize: 14 }}>Reason sent: {String(s.reply)}</p> : null}

                {s.status === 'new' && (
                  <div className="dz-review__actions" style={{ marginTop: 16, flexWrap: 'wrap' }}>
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
                    {s.kind === 'font_claim' && font && isAdmin && ownedBy(s).filter((o) => !linked(String(font.id), 'designers').includes(String(o.id))).map((o) => (
                      <button key={String(o.id)} type="button" className="dz-btn dz-btn--primary" disabled={busy === id} onClick={() => close(s, 'accepted', `${o.name} added to ${font.name}`, async () => {
                        await db.link('font_designers', [{ font_id: String(font.id), designer_id: String(o.id) }]);
                        await db.log({ action: 'update', entity: 'font', entity_id: String(font.id), label: `${font.name}: credited ${o.name} (claim)`, after: { designer_id: o.id } });
                        await db.refreshSite();
                      })}>Credit {String(o.name)}</button>
                    ))}
                    {s.kind === 'font_claim' && font ? <Link className="dz-btn" href={`/dashboard/fonts/${font.id}`}>Open font</Link> : null}
                    {s.kind === 'font_claim' && <button type="button" className="dz-btn" disabled={busy === id} onClick={() => close(s, 'accepted', 'Marked as done')}>Mark as done</button>}
                    {s.kind === 'font_edit' && font && isAdmin && (
                      <button type="button" className="dz-btn dz-btn--primary" disabled={busy === id} onClick={() => close(s, 'accepted', `Changes to ${font.name} are live`, async () => {
                        const changes = { ...((p.changes as Row) ?? {}) };
                        if (changes.status === 'published' && font.status === 'featured') delete changes.status;
                        await db.update('fonts', { id: String(font.id) }, { ...changes, updated_at: new Date().toISOString() });
                        await db.log({ action: 'update', entity: 'font', entity_id: String(font.id), label: `${font.name} (edit by ${person?.name ?? 'owner'})`, before: { row: font }, after: { changes } });
                        await db.refreshSite();
                      })}>Approve and publish</button>
                    )}
                    {s.kind === 'font_edit' && !font ? <span className="dz-muted">This font no longer exists.</span> : null}
                    <Decline required={s.kind === 'font_edit' || s.kind === 'profile_edit' || s.kind === 'font_claim' || s.kind === 'claim'} busy={busy === id} onDecline={(why) => close(s, 'rejected', 'Declined', undefined, why)} />
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
