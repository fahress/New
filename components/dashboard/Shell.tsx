'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import Logo from '@/components/Logo';
import { DEMO, supabase } from '@/lib/admin/client';
import { DataProvider, coverOf, img, useData } from '@/lib/admin/store';
import { Loading, Toasts } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/review', label: 'Review queue', badge: 'pending' as const },
  { href: '/dashboard/fonts', label: 'Fonts' },
  { href: '/dashboard/designers', label: 'Designers' },
  { href: '/dashboard/foundries', label: 'Foundries' },
  { href: '/dashboard/awards', label: 'Awards' },
  { href: '/dashboard/taxonomy', label: 'Classification' },
  { href: '/dashboard/users', label: 'Users' },
];

type Auth = { state: 'loading' } | { state: 'out' } | { state: 'in'; email: string };

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [auth, setAuth] = useState<Auth>(DEMO ? { state: 'in', email: 'demo@fahress' } : { state: 'loading' });

  useEffect(() => {
    if (DEMO) return;
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setAuth(data.session ? { state: 'in', email: data.session.user.email ?? '' } : { state: 'out' }));
    const { data } = sb.auth.onAuthStateChange((_e, session) => setAuth(session ? { state: 'in', email: session.user.email ?? '' } : { state: 'out' }));
    return () => data.subscription.unsubscribe();
  }, []);

  const isLogin = path === '/dashboard/login';
  useEffect(() => {
    if (auth.state === 'out' && !isLogin) router.replace(`/dashboard/login?next=${encodeURIComponent(path)}`);
    if (auth.state === 'in' && isLogin) router.replace(new URLSearchParams(window.location.search).get('next') || '/dashboard');
  }, [auth, isLogin, path, router]);

  if (isLogin) return <Toasts>{children}</Toasts>;
  if (auth.state !== 'in') return <div className="dz-center"><Loading text="Checking your login…" /></div>;

  return (
    <Toasts>
      <DataProvider>
        <Frame email={auth.email}>{children}</Frame>
      </DataProvider>
    </Toasts>
  );
}

function Frame({ email, children }: { email: string; children: React.ReactNode }) {
  const path = usePathname();
  const { data, error } = useData();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const pending = data?.fonts.filter((f) => f.status === 'pending').length ?? 0;

  const active = (href: string) => (href === '/dashboard' ? path === href : path.startsWith(href));

  return (
    <div className={`dz${menu ? ' is-menu' : ''}`}>
      <aside className="dz-side">
        <div className="dz-side__top">
          <Link href="/dashboard" className="dz-brand" aria-label="Dashboard home"><Logo width={44} /><span>Dashboard</span></Link>
          <button type="button" className="dz-burger" aria-label="Menu" onClick={() => setMenu((m) => !m)}><span /><span /></button>
        </div>
        <div className="dz-side__body">
          <Link href="/dashboard/fonts/new" className="dz-btn dz-btn--primary dz-btn--block">+ New font</Link>
          <nav className="dz-nav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={active(n.href) ? 'is-active' : ''}>
                {n.label}
                {n.badge && pending > 0 ? <span className="dz-badge">{pending}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="dz-side__foot">
            <Link href="/" target="_blank" className="dz-link">View site ↗</Link>
            <span className="dz-me" title={email}>{email}</span>
            {DEMO ? <span className="dz-hint">Demo mode — nothing is saved</span> : (
              <button type="button" className="dz-link" onClick={() => supabase().auth.signOut()}>Sign out</button>
            )}
          </div>
        </div>
      </aside>
      <div className="dz-main">
        <div className="dz-top">
          <QuickFind />
        </div>
        <div className="dz-page">
          {error ? (
            <div className="dz-panel dz-panel--err">
              <b>Couldn&apos;t load the archive.</b>
              <p>{error}</p>
            </div>
          ) : !data ? <Loading /> : children}
        </div>
      </div>
    </div>
  );
}

/** ⌘K search across fonts, designers and foundries. */
function QuickFind() {
  const { data } = useData();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!data || !n) return [];
    const score = (s: string) => { const l = s.toLowerCase(); return l.startsWith(n) ? 0 : l.split(/\s+/).some((w) => w.startsWith(n)) ? 1 : l.includes(n) ? 2 : 9; };
    const fonts = data.fonts.map((f) => ({ s: score(String(f.name)), href: `/dashboard/fonts/${f.id}`, label: String(f.name), meta: `Font · ${f.status}`, thumb: img(coverOf(f), 256), grey: false }));
    const people = data.people.map((p) => ({ s: score(String(p.name)), href: `/dashboard/${p.type === 'foundry' ? 'foundries' : 'designers'}/${p.id}`, label: String(p.name), meta: p.type === 'foundry' ? 'Foundry' : 'Designer', thumb: img(p.logo, 256), grey: p.type !== 'foundry' }));
    return [...fonts, ...people].filter((r) => r.s < 9).sort((a, b) => a.s - b.s || a.label.localeCompare(b.label)).slice(0, 10);
  }, [data, q]);

  const go = (href: string) => { setQ(''); setOpen(false); input.current?.blur(); router.push(href); };

  return (
    <div className="dz-find">
      <input
        ref={input}
        className="dz-input"
        placeholder="Find a font, designer or foundry…   ⌘K"
        value={q}
        onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && results[hi]) go(results[hi].href);
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
      />
      {open && results.length > 0 && (
        <ul className="dz-menu">
          {results.map((r, i) => (
            <li key={r.href} className={i === hi ? 'is-hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); go(r.href); }}>
              {r.thumb ? <img src={r.thumb} alt="" className={r.grey ? 'is-grey' : ''} /> : <span className="dz-mono-av">{r.label[0]}</span>}
              <span>{r.label}</span>
              <small>{r.meta}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
