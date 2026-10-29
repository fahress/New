'use client';
import { useState } from 'react';
import { supabase } from '@/lib/admin/client';

/** "Spotted an error?" — sends a note to the Fahress inbox. */
export default function SuggestCorrection({ fontId, designerId, about }: { fontId?: string; designerId?: string; about: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (trap || message.trim().length < 5) return;
    setState('sending');
    const sb = supabase();
    const { data } = await sb.auth.getSession();
    const { error } = await sb.from('submissions').insert({
      kind: 'correction', font_id: fontId ?? null, designer_id: designerId ?? null,
      message: message.trim().slice(0, 4000), email: email.trim() || data.session?.user.email || null,
      user_id: data.session?.user.id ?? null, payload: { page: window.location.pathname, about },
    });
    setState(error ? 'error' : 'sent');
  }

  if (state === 'sent') return <p className="form-note">Thank you — the Fahress team will look at it.</p>;
  if (!open) return <button type="button" className="correction__toggle ul" onClick={() => setOpen(true)}>Spotted an error? Suggest a correction →</button>;
  return (
    <form className="correction" onSubmit={send}>
      <label className="field">
        <span>What should be fixed on “{about}”?</span>
        <textarea className="textarea" required minLength={5} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. The designer is missing, or the buy link has moved to…" />
      </label>
      <label className="field">
        <span>Your email (optional)</span>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="So we can thank you or ask a question" />
      </label>
      <input className="hp" tabIndex={-1} aria-hidden="true" autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      {state === 'error' ? <p className="form-error">Couldn’t send right now. Email admin@fahress.com instead.</p> : null}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
