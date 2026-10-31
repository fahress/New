'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/admin/client';
import Modal from './Modal';
import { useMember } from './useMember';

/** "Claim this account" on a designer or foundry page. Once the Fahress team approves, the member manages the profile and its fonts from their account. */
export default function ClaimProfile({ designerId, name, slug, kind }: { designerId: string; name: string; slug: string; kind: 'designer' | 'foundry' }) {
  const me = useMember();
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState('');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (!me || !open) return;
    supabase().from('submissions').select('id').eq('kind', 'claim').eq('designer_id', designerId).eq('user_id', me.id).eq('status', 'new').limit(1)
      .then(({ data }) => setPending(!!data?.length));
  }, [me, open, designerId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setState('sending');
    const { error } = await supabase().from('submissions').insert({
      kind: 'claim', designer_id: designerId, user_id: me.id, email: me.email, name: me.name || null,
      message: comment.trim().slice(0, 2000), payload: { name, proof: proof.trim() },
    });
    setState(error ? 'error' : 'sent');
  }

  const noun = kind === 'foundry' ? 'foundry' : 'designer';
  return (
    <>
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>Claim this account</button>
      {open ? (
        <Modal title={`Claim ${name}`} onClose={() => setOpen(false)}>
          {me === undefined ? <p className="muted">One moment…</p> : !me ? (
            <div className="form">
              <p style={{ margin: 0 }}>Is this you? Sign in or create a free account first. Once we&apos;ve checked it&apos;s you, you can edit this profile and the fonts under it from your account.</p>
              <Link className="btn" href={`/account?claim=${encodeURIComponent(slug)}`} style={{ justifySelf: 'start' }}>Sign in to claim</Link>
            </div>
          ) : state === 'sent' || pending ? (
            <div className="form">
              <p style={{ margin: 0 }}>{state === 'sent' ? 'Thank you — your claim is with the Fahress team.' : 'Your claim for this account is already being reviewed.'} We check every claim by hand, usually within a few days. You can follow it in <Link href="/account" className="ul">your account</Link>.</p>
              <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => setOpen(false)}>Close</button>
            </div>
          ) : (
            <form className="form" onSubmit={send}>
              <p className="muted" style={{ margin: 0 }}>Once approved, you manage this {noun}: you can update the profile and edit the fonts under it. Every change is checked by the Fahress team before it goes live.</p>
              <label className="field"><span>Proof it&apos;s you</span><input className="input" type="url" required placeholder="https:// — your Instagram, Behance or website" value={proof} onChange={(e) => setProof(e.target.value)} /><small>We&apos;ll check this link shows the same {noun}.</small></label>
              <label className="field"><span>Comment (optional)</span><textarea className="textarea" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
              {state === 'error' ? <p className="form-error">Couldn&apos;t send your claim. This account may already be claimed — email admin@fahress.com if that&apos;s a mistake.</p> : null}
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
