'use client';
import { useState } from 'react';
import { supabase } from '@/lib/admin/client';

const TOPICS = ['General question', 'Licensing / where to buy', 'Partnership or press', 'Something on the site is wrong', 'Other'];

/** Contact form — messages land in the dashboard Inbox (Messages). */
export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState('');
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (trap) { setState('sent'); return; }
    if (message.trim().length < 5 || !email.includes('@')) return;
    setState('sending');
    const sb = supabase();
    const { data } = await sb.auth.getSession();
    const { error } = await sb.from('submissions').insert({
      kind: 'message',
      name: name.trim().slice(0, 200) || null,
      email: email.trim().slice(0, 320),
      message: message.trim().slice(0, 4900),
      user_id: data.session?.user.id ?? null,
      payload: { subject: topic, page: document.referrer ? new URL(document.referrer).pathname : null },
    });
    setState(error ? 'error' : 'sent');
  }

  if (state === 'sent') return <p className="form-note">Thank you — your message reached the Fahress team. We&apos;ll reply to {email || 'your email'}.</p>;

  return (
    <form className="form" onSubmit={send} style={{ maxWidth: 680 }}>
      <div className="form-grid">
        <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" /></label>
        <label className="field"><span>Your email *</span><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} autoComplete="email" /></label>
      </div>
      <label className="field">
        <span>About</span>
        <select className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select>
      </label>
      <label className="field">
        <span>Message *</span>
        <textarea className="textarea" required minLength={5} maxLength={4900} rows={7} value={message} onChange={(e) => setMessage(e.target.value)} dir="auto" />
      </label>
      <input className="hp" tabIndex={-1} aria-hidden="true" autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      {state === 'error' ? <p className="form-error">Couldn’t send right now. Email admin@fahress.com instead.</p> : null}
      <div><button className="btn" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send message'}</button></div>
    </form>
  );
}
