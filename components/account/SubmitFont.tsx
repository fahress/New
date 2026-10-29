'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/admin/client';
import { storageUrl } from '@/lib/format';

export default function SubmitFont() {
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);
  const [f, setF] = useState({ name: '', designers: '', year: '', license: 'paid', link: '', link2: '', description: '', isDesigner: false, submitter: '', email: '' });
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => setMe(data.session ? { id: data.session.user.id, email: data.session.user.email ?? '' } : null));
  }, []);

  async function upload(files: FileList | null) {
    if (!me || !files) return;
    for (const file of [...files].slice(0, 8)) {
      if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) continue;
      setUploading((n) => n + 1);
      const path = `submissions/${me.id}/${Date.now()}-${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-60)}`;
      const { error } = await supabase().storage.from('studio').upload(path, file, { upsert: false, contentType: file.type });
      if (!error) setImages((x) => [...x, path]);
      setUploading((n) => n - 1);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (trap) return;
    setState('sending');
    const { error } = await supabase().from('submissions').insert({
      kind: 'font',
      user_id: me?.id ?? null,
      email: (me?.email || f.email).trim() || null,
      name: f.submitter.trim() || null,
      payload: {
        name: f.name.trim(), designers: f.designers.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean), year: f.year.trim(), license: f.license,
        links: [f.link, f.link2].map((s) => s.trim()).filter(Boolean), description: f.description.trim().slice(0, 3000), is_designer: f.isDesigner, images,
      },
    });
    setState(error ? 'error' : 'sent');
  }

  if (state === 'sent') return (
    <div className="acct-card" style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <h2 className="display h-md" style={{ margin: 0 }}>Thank you — it&apos;s in.</h2>
      <p style={{ margin: 0 }}>The Fahress team reviews every submission by hand. {me ? 'You can follow its status on your account page.' : 'We’ll email you if we have a question.'}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => { setF({ ...f, name: '', year: '', link: '', link2: '', description: '' }); setImages([]); setState('idle'); }}>Submit another</button>
        {me ? <Link href="/account" className="btn btn--ghost">Your account</Link> : null}
      </div>
    </div>
  );

  return (
    <form className="form" onSubmit={send} style={{ maxWidth: 760 }}>
      <div className="form-grid">
        <label className="field"><span>Typeface name *</span><input className="input" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Designer(s) / foundry *</span><input className="input" required maxLength={300} value={f.designers} onChange={(e) => setF({ ...f, designers: e.target.value })} placeholder="Separate names with commas" /></label>
        <label className="field"><span>Release year</span><input className="input" inputMode="numeric" maxLength={4} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="field"><span>License</span>
          <select className="input" value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })}><option value="paid">Paid</option><option value="free">Free</option><option value="custom">Custom / not for sale</option></select>
        </label>
      </div>
      <label className="field"><span>Where to buy or download *</span><input className="input" type="url" required placeholder="https://…" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></label>
      <label className="field"><span>Presentation (Behance, website…)</span><input className="input" type="url" placeholder="https://…" value={f.link2} onChange={(e) => setF({ ...f, link2: e.target.value })} /><small>We show typefaces through the designer&apos;s own presentation images, so a link to them helps a lot.</small></label>
      {me ? (
        <div className="field">
          <span>Presentation images (optional)</span>
          <label className="btn btn--ghost" style={{ justifySelf: 'start', cursor: 'pointer' }}>{uploading ? `Uploading ${uploading}…` : 'Add images'}<input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} /></label>
          {images.length ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{images.map((p) => <img key={p} src={storageUrl(p)} alt="" style={{ width: 140, height: 70, objectFit: 'cover', borderRadius: 10 }} />)}</div> : null}
          <small>Up to 8 images, 8 MB each. Wide images (2:1) look best.</small>
        </div>
      ) : null}
      <label className="field"><span>About the typeface</span><textarea className="textarea" maxLength={3000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What inspired it, what it’s good for, how many weights…" /></label>
      <label className="check"><input type="checkbox" checked={f.isDesigner} onChange={(e) => setF({ ...f, isDesigner: e.target.checked })} />I designed or published this typeface</label>
      {!me ? (
        <div className="form-grid">
          <label className="field"><span>Your name</span><input className="input" value={f.submitter} onChange={(e) => setF({ ...f, submitter: e.target.value })} /></label>
          <label className="field"><span>Your email *</span><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        </div>
      ) : null}
      <input className="hp" tabIndex={-1} aria-hidden="true" autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      {state === 'error' ? <p className="form-error">Couldn’t send right now. Please try again, or email admin@fahress.com.</p> : null}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" disabled={state === 'sending' || uploading > 0}>{state === 'sending' ? 'Sending…' : 'Submit for review'}</button>
        {!me ? <span className="muted" style={{ fontSize: 14 }}>Are you the designer? <Link href="/account" className="ul">Create an account</Link> to upload images and track your submissions.</span> : null}
      </div>
    </form>
  );
}
