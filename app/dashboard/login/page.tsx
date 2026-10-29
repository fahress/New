'use client';
import { useState } from 'react';
import Logo from '@/components/Logo';
import { supabase } from '@/lib/admin/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message);
  }

  return (
    <div className="dz-login">
      <form onSubmit={submit} className="dz-login__card">
        <Logo width={72} draw />
        <h1 className="display">Dashboard</h1>
        <p className="dz-hint">Sign in with the same account you use on admin.fahress.com.</p>
        <label className="dz-field">
          <span className="dz-label">Email</span>
          <input className="dz-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="dz-field">
          <span className="dz-label">Password</span>
          <span className="dz-pass">
            <input className="dz-input" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="dz-link" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </label>
        {error ? <p className="dz-error">{error}</p> : null}
        <button className="dz-btn dz-btn--primary dz-btn--block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
