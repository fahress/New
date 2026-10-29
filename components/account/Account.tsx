'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/admin/client';
import { COUNTRIES } from '@/lib/admin/countries';
import { personHref, storageUrl, thumbUrl } from '@/lib/format';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { id: string; email: string };

const SOCIAL = [['website_url', 'Website'], ['instagram_url', 'Instagram'], ['behance_url', 'Behance'], ['linkedin_url', 'LinkedIn']] as const;
const KIND: Record<string, string> = { font: 'Font submission', correction: 'Correction', claim: 'Profile claim', profile_edit: 'Profile changes' };
const STATUS: Record<string, string> = { new: 'Waiting for review', accepted: 'Accepted', rejected: 'Declined' };

export default function Account() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session ? { id: data.session.user.id, email: data.session.user.email ?? '' } : null));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s ? { id: s.user.id, email: s.user.email ?? '' } : null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <p className="muted">Loading…</p>;
  if (recovering && session) return <NewPassword onDone={() => setRecovering(false)} />;
  if (!session) return <SignIn />;
  return <Dashboard me={session} />;
}

/* ---------------- sign in / up ---------------- */
function SignIn() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const claiming = params.get('claim');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabase();
    const back = `${window.location.origin}/account${claiming ? `?claim=${encodeURIComponent(claiming)}` : ''}`;
    if (mode === 'in') {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMsg({ text: error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message, err: true });
    } else if (mode === 'up') {
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: back, data: { full_name: name.trim() } } });
      if (error) setMsg({ text: error.message, err: true });
      else if (!data.session) setMsg({ text: 'Almost there — check your email and click the link to confirm your account.' });
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: back });
      setMsg(error ? { text: error.message, err: true } : { text: 'If that email has an account, a reset link is on its way.' });
    }
    setBusy(false);
  }

  return (
    <div className="acct-grid">
      <div>
        <p className="mono muted" style={{ margin: '0 0 16px' }}>For designers &amp; foundries</p>
        <h2 className="display h-lg" style={{ margin: '0 0 20px' }}>Your work, credited properly.</h2>
        <ul className="acct-list">
          <li><b>Claim your profile</b> and keep your photo, bio, country and links up to date.</li>
          <li><b>Submit new releases</b> straight to the archive.</li>
          <li><b>See how many visitors</b> Fahress sends to your store each month.</li>
        </ul>
        {claiming ? <p className="form-note">Sign in or create an account to claim this profile.</p> : null}
      </div>
      <form className="form acct-card" onSubmit={submit}>
        <div className="seg seg--pill" role="tablist" style={{ justifySelf: 'start' }}>
          <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
          <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>Create account</button>
        </div>
        {mode === 'up' ? <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label> : null}
        <label className="field"><span>Email</span><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        {mode !== 'reset' ? (
          <label className="field"><span>Password</span><input className="input" type="password" required minLength={mode === 'up' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />{mode === 'up' ? <small>At least 8 characters.</small> : null}</label>
        ) : null}
        {msg ? <p className={msg.err ? 'form-error' : 'form-note'}>{msg.text}</p> : null}
        <button className="btn" disabled={busy}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        {mode === 'in' ? <button type="button" className="correction__toggle ul" onClick={() => setMode('reset')}>Forgot your password?</button> : mode === 'reset' ? <button type="button" className="correction__toggle ul" onClick={() => setMode('in')}>Back to sign in</button> : null}
      </form>
    </div>
  );
}

function NewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form className="form acct-card" style={{ maxWidth: 480 }} onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase().auth.updateUser({ password: pw }); if (error) setMsg(error.message); else onDone(); }}>
      <h2 className="display h-md" style={{ margin: 0 }}>Choose a new password</h2>
      <label className="field"><span>New password</span><input className="input" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
      {msg ? <p className="form-error">{msg}</p> : null}
      <button className="btn">Save password</button>
    </form>
  );
}

/* ---------------- signed in ---------------- */
function Dashboard({ me }: { me: Session }) {
  const [mine, setMine] = useState<Row[] | null>(null);
  const [subs, setSubs] = useState<Row[]>([]);
  const [stats, setStats] = useState<Row[] | null>(null);
  const params = useSearchParams();

  const load = useCallback(async () => {
    const sb = supabase();
    const [{ data: owned }, { data: own }, st] = await Promise.all([
      sb.from('designers').select('*').eq('user_id', me.id),
      sb.from('submissions').select('*').eq('user_id', me.id).order('created_at', { ascending: false }),
      sb.rpc('my_click_stats'),
    ]);
    setMine(owned ?? []);
    setSubs(own ?? []);
    setStats(st.error ? null : (st.data as Row[]));
  }, [me.id]);
  useEffect(() => { load(); }, [load]);

  if (!mine) return <p className="muted">Loading your account…</p>;
  const pendingClaims = subs.filter((s) => s.kind === 'claim' && s.status === 'new');

  return (
    <div style={{ display: 'grid', gap: 56 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>Signed in as <b style={{ color: 'var(--ink)' }}>{me.email}</b></p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/submit" className="btn">Submit a font</Link>
          <button type="button" className="btn btn--ghost" onClick={() => supabase().auth.signOut()}>Sign out</button>
        </div>
      </div>

      {mine.map((p) => <OwnedProfile key={p.id} p={p} me={me} stats={stats} pending={subs.some((s) => s.kind === 'profile_edit' && s.status === 'new' && s.designer_id === p.id)} onSent={load} />)}

      {mine.length === 0 ? (
        pendingClaims.length ? (
          <section className="acct-card"><h2 className="display h-md" style={{ marginTop: 0 }}>Your claim is being reviewed</h2><p className="muted" style={{ margin: 0 }}>The Fahress team checks every claim by hand — usually within a few days. You&apos;ll be able to edit your profile here once it&apos;s approved.</p></section>
        ) : <Claim me={me} preselect={params.get('claim')} onSent={load} />
      ) : null}

      {subs.length > 0 && (
        <section>
          <h2 className="display h-md">What you&apos;ve sent</h2>
          <div className="acct-subs">
            {subs.map((s) => (
              <div key={s.id}>
                <span>{KIND[s.kind] ?? s.kind}{s.payload?.name ? ` · ${s.payload.name}` : ''}</span>
                <span className={`pill pill--sm${s.status === 'accepted' ? ' pill--solid' : ''}`}>{STATUS[s.status] ?? s.status}</span>
                <span className="muted">{new Date(s.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function OwnedProfile({ p, me, stats, pending, onSent }: { p: Row; me: Session; stats: Row[] | null; pending: boolean; onSent: () => void }) {
  const [edit, setEdit] = useState(false);
  const mineStats = (stats ?? []).filter((r) => r.designer_id === p.id);
  const total30 = mineStats.reduce((n, r) => n + Number(r.clicks_30d ?? 0), 0);
  const totalAll = mineStats.reduce((n, r) => n + Number(r.clicks_total ?? 0), 0);
  return (
    <section className="acct-card" style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {p.logo ? <img className={`avatar${p.type === 'foundry' ? '' : ' avatar--grey'}`} src={thumbUrl(p.logo, 256)} alt="" width={84} height={84} style={{ width: 84, height: 84 }} /> : <span className="mono-avatar" style={{ width: 84, height: 84 }}>{p.name[0]}</span>}
        <div style={{ flex: 1, minWidth: 200 }}>
          <span className="verified">✓ Verified</span>
          <h2 className="display h-md" style={{ margin: '8px 0 4px' }}>{p.name}</h2>
          <Link href={personHref(p.type, p.slug)} className="ul muted" style={{ fontSize: 14 }}>View your public profile →</Link>
        </div>
        {!edit ? <button type="button" className="btn btn--ghost" onClick={() => setEdit(true)} disabled={pending}>{pending ? 'Changes waiting for review' : 'Edit profile'}</button> : null}
      </div>
      {stats !== null && (
        <div className="facts-strip" style={{ margin: 0 }}>
          <div><span className="mono muted">Visitors sent to your store · 30 days</span><b>{total30}</b></div>
          <div><span className="mono muted">All time</span><b>{totalAll}</b></div>
          <div><span className="mono muted">Top typeface</span><b>{mineStats.slice().sort((a, b) => b.clicks_30d - a.clicks_30d)[0]?.font_name ?? '—'}</b></div>
        </div>
      )}
      {mineStats.length > 0 && (
        <details>
          <summary className="ul" style={{ cursor: 'pointer', fontSize: 14 }}>Per typeface</summary>
          <div className="acct-subs" style={{ marginTop: 12 }}>
            {mineStats.sort((a, b) => b.clicks_total - a.clicks_total).map((r) => <div key={r.font_id}><span>{r.font_name}</span><span>{r.clicks_30d} this month</span><span className="muted">{r.clicks_total} total</span></div>)}
          </div>
        </details>
      )}
      {edit ? <EditProfile p={p} me={me} onClose={() => setEdit(false)} onSent={() => { setEdit(false); onSent(); }} /> : null}
    </section>
  );
}

function EditProfile({ p, me, onClose, onSent }: { p: Row; me: Session; onClose: () => void; onSent: () => void }) {
  const [f, setF] = useState({ name: p.name ?? '', bio: p.bio ?? '', country: p.country ?? '', logo: p.logo ?? '', social: { ...(p.social_links ?? {}) } as Record<string, string> });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) return;
    setBusy(true);
    const path = `submissions/${me.id}/${Date.now()}-${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-60)}`;
    const { error } = await supabase().storage.from('studio').upload(path, file, { upsert: false, contentType: file.type });
    setBusy(false);
    if (error) setErr('Couldn’t upload the image. Try a smaller file (under 5 MB).'); else setF((x) => ({ ...x, logo: path }));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const changes: Row = {};
    if (f.name.trim() !== (p.name ?? '')) changes.name = f.name.trim();
    if (f.bio.trim() !== (p.bio ?? '')) changes.bio = f.bio.trim();
    if (f.country !== (p.country ?? '')) changes.country = f.country || null;
    if (f.logo !== (p.logo ?? '')) changes.logo = f.logo || null;
    const social: Row = {};
    for (const [k] of SOCIAL) if ((f.social[k] ?? '').trim() !== (p.social_links?.[k] ?? '')) social[k] = (f.social[k] ?? '').trim();
    if (Object.keys(social).length) changes.social_links = social;
    if (!Object.keys(changes).length) { onClose(); return; }
    setBusy(true);
    const { error } = await supabase().from('submissions').insert({ kind: 'profile_edit', designer_id: p.id, user_id: me.id, email: me.email, payload: { name: p.name, changes } });
    setBusy(false);
    if (error) setErr('Couldn’t send your changes. Please try again.'); else onSent();
  }

  return (
    <form className="form" onSubmit={send} style={{ borderTop: '1px solid var(--line)', paddingTop: 24 }}>
      <p className="form-note" style={{ margin: 0 }}>Your changes are checked by the Fahress team before they appear on the site.</p>
      <div className="form-grid">
        <label className="field"><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="field"><span>{p.type === 'foundry' ? 'Country' : 'Where you’re from'}</span>
          <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
            <option value="">—</option>
            {COUNTRIES.map((c) => <option key={c.code} value={c.name}>{c.flag} {c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>Bio</span><textarea className="textarea" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={2000} /></label>
      <div className="field">
        <span>{p.type === 'foundry' ? 'Logo' : 'Photo'}</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {f.logo ? <img className={`avatar${p.type === 'foundry' ? '' : ' avatar--grey'}`} src={f.logo.startsWith('submissions/') ? storageUrl(f.logo) : thumbUrl(f.logo, 256)} alt="" style={{ width: 72, height: 72 }} /> : null}
          <label className="btn btn--ghost" style={{ cursor: 'pointer' }}>{busy ? 'Uploading…' : 'Upload new'}<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        </div>
        <small>{p.type === 'foundry' ? 'Shown in colour.' : 'Shown in black & white on the site.'}</small>
      </div>
      <div className="form-grid">
        {SOCIAL.map(([k, l]) => <label key={k} className="field"><span>{l}</span><input className="input" type="url" placeholder="https://…" value={f.social[k] ?? ''} onChange={(e) => setF({ ...f, social: { ...f.social, [k]: e.target.value } })} /></label>)}
      </div>
      {err ? <p className="form-error">{err}</p> : null}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy}>Send for review</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function Claim({ me, preselect, onSent }: { me: Session; preselect: string | null; onSent: () => void }) {
  const [people, setPeople] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Row | null>(null);
  const [proof, setProof] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase().from('designers').select('id,name,slug,type,logo,user_id').order('name').then(({ data }) => {
      setPeople(data ?? []);
      if (preselect) setChosen((data ?? []).find((x) => x.slug === preselect) ?? null);
    });
  }, [preselect]);

  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n.length < 2 ? [] : people.filter((x) => String(x.name).toLowerCase().includes(n)).slice(0, 8);
  }, [people, q]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    const { error } = await supabase().from('submissions').insert({ kind: 'claim', designer_id: chosen.id, user_id: me.id, email: me.email, message: message.trim().slice(0, 2000), payload: { name: chosen.name, proof: proof.trim() } });
    setBusy(false);
    if (error) setErr('Couldn’t send your claim. Please try again.'); else onSent();
  }

  return (
    <section className="acct-card" style={{ display: 'grid', gap: 20 }}>
      <div>
        <h2 className="display h-md" style={{ margin: '0 0 8px' }}>Claim your profile</h2>
        <p className="muted" style={{ margin: 0 }}>Are you a type designer or foundry in the archive? Claim your profile to keep it up to date and see your stats.</p>
      </div>
      {!chosen ? (
        <label className="field" style={{ position: 'relative' }}>
          <span>Find your name</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing…" />
          {results.length > 0 && (
            <div className="acct-results">
              {results.map((x) => (
                <button key={x.id} type="button" onClick={() => setChosen(x)} disabled={!!x.user_id}>
                  {x.logo ? <img className={`avatar${x.type === 'foundry' ? '' : ' avatar--grey'}`} src={thumbUrl(x.logo, 256)} alt="" style={{ width: 36, height: 36 }} /> : <span className="mono-avatar" style={{ width: 36, height: 36, fontSize: 14 }}>{x.name[0]}</span>}
                  <span>{x.name}</span>
                  <small className="muted">{x.user_id ? 'Already claimed' : x.type === 'foundry' ? 'Foundry' : 'Designer'}</small>
                </button>
              ))}
            </div>
          )}
          <small>Not in the archive yet? <Link href="/submit" className="ul">Submit your first font</Link> and we&apos;ll create your profile.</small>
        </label>
      ) : (
        <form className="form" onSubmit={send}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {chosen.logo ? <img className={`avatar${chosen.type === 'foundry' ? '' : ' avatar--grey'}`} src={thumbUrl(chosen.logo, 256)} alt="" style={{ width: 56, height: 56 }} /> : null}
            <b style={{ fontSize: 20 }}>{chosen.name}</b>
            <button type="button" className="correction__toggle ul" onClick={() => setChosen(null)}>change</button>
          </div>
          {chosen.user_id ? <p className="form-error">This profile has already been claimed. If that&apos;s a mistake, email admin@fahress.com.</p> : (
            <>
              <label className="field"><span>Proof it&apos;s you</span><input className="input" type="url" required placeholder="https:// — your Instagram, Behance or website" value={proof} onChange={(e) => setProof(e.target.value)} /><small>We&apos;ll check this link shows the same person or foundry. Mentioning fahress.com in your bio for a day speeds it up.</small></label>
              <label className="field"><span>Anything to add? (optional)</span><textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} /></label>
              {err ? <p className="form-error">{err}</p> : null}
              <button className="btn" style={{ justifySelf: 'start' }} disabled={busy}>{busy ? 'Sending…' : 'Send claim'}</button>
            </>
          )}
        </form>
      )}
    </section>
  );
}
