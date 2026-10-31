'use client';
import Link from 'next/link';
import { useState } from 'react';
import { supabase } from '@/lib/admin/client';
import Modal from './Modal';
import { useMember } from './useMember';

/** "Claim this font" — a signed-in member tells the Fahress team the font is theirs. Arrives in the dashboard inbox. */
export default function ClaimFont({ fontId, fontName, slug }: { fontId: string; fontName: string; slug: string }) {
  const me = useMember();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  function show() {
    if (me) { setName((n) => n || me.name); setEmail((x) => x || me.email); }
    setOpen(true);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setState('sending');
    const { error } = await supabase().from('submissions').insert({
      kind: 'font_claim', font_id: fontId, user_id: me.id,
      name: name.trim().slice(0, 200), email: email.trim().slice(0, 320), message: comment.trim().slice(0, 4000),
      payload: { name: fontName, page: window.location.pathname },
    });
    setState(error ? 'error' : 'sent');
  }

  return (
    <>
      <button type="button" className="btn btn--ghost" onClick={show} style={{ width: '100%' }}>Claim this font</button>
      {open ? (
        <Modal title={`Claim ${fontName}`} onClose={() => setOpen(false)}>
          {me === undefined ? <p className="muted">One moment…</p> : !me ? (
            <div className="form">
              <p style={{ margin: 0 }}>Is this your typeface? Sign in or create a free account first, then tell us how you worked on it and we&apos;ll add your name.</p>
              <Link className="btn" href={`/account?next=${encodeURIComponent(`/fonts/${slug}`)}`} style={{ justifySelf: 'start' }}>Sign in to claim</Link>
            </div>
          ) : state === 'sent' ? (
            <div className="form">
              <p style={{ margin: 0 }}>Thank you — the Fahress team will check it and add your name. You can follow it in <Link href="/account" className="ul">your account</Link>.</p>
              <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => setOpen(false)}>Close</button>
            </div>
          ) : (
            <form className="form" onSubmit={send}>
              <p className="muted" style={{ margin: 0 }}>Designed or published this typeface and your name is missing? Tell us and we&apos;ll credit you.</p>
              <label className="field"><span>Your name</span><input className="input" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
              <label className="field"><span>Your email</span><input className="input" type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
              <label className="field"><span>Comment</span><textarea className="textarea" required minLength={5} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Your role on the typeface, and a link that shows it (your website, Behance, the foundry page…)" /></label>
              {state === 'error' ? <p className="form-error">Couldn&apos;t send right now. Please try again, or email admin@fahress.com.</p> : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send claim'}</button>
                <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </form>
          )}
        </Modal>
      ) : null}
    </>
  );
}
