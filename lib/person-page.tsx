import type { Metadata } from 'next';
import type { PersonType } from '@/lib/types';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import SuggestCorrection from '@/components/SuggestCorrection';
import WorkGrid from '@/components/WorkGrid';
import { getArchive, getRedirect } from '@/lib/data';
import { excerpt, hostOf, personHref, storageUrl, thumbUrl } from '@/lib/format';
import ClaimProfile from '@/components/claims/ClaimProfile';
import { tagNames, toCard } from '@/lib/view';

export async function personParams(kind: PersonType) {
  const a = await getArchive();
  return a.people.filter((p) => p.type === kind).map((p) => ({ slug: p.slug }));
}

export async function personMetadata(slug: string): Promise<Metadata> {
  const a = await getArchive();
  const p = a.personBySlug.get(slug);
  if (!p) return { title: 'Not found' };
  const what = p.type === 'foundry' ? 'Arabic type foundry' : 'Arabic type designer';
  const description = excerpt(p.bio || `${p.name}, ${what} with ${p.fontIds.length} typefaces on Fahress.`, 155);
  return {
    title: `${p.name} — ${what}`,
    description,
    alternates: { canonical: personHref(p.type, p.slug) },
    openGraph: { title: p.name, description, url: personHref(p.type, p.slug), images: p.logo ? [{ url: storageUrl(p.logo) }] : [] },
  };
}

const SOCIAL: [string, string][] = [['instagram_url', 'Instagram'], ['behance_url', 'Behance'], ['linkedin_url', 'LinkedIn'], ['website_url', 'Website']];

export async function PersonPage({ slug, kind }: { slug: string; kind: PersonType }) {
  const a = await getArchive();
  const p = a.personBySlug.get(slug);
  if (!p) {
    const moved = await getRedirect(slug);
    const to = moved && moved.kind !== 'font' ? a.personBySlug.get(moved.to) : undefined;
    if (to) permanentRedirect(personHref(to.type, to.slug));
    notFound();
  }
  // a foundry opened at /designers/… (or the reverse) moves to its proper address
  if (p.type !== kind) permanentRedirect(personHref(p.type, p.slug));

  const fonts = p.fontIds.map((id) => a.fontById.get(id)!).filter(Boolean);
  const scripts = a.scripts.filter((s) => fonts.some((f) => f.scripts.includes(s.id)));
  const years = fonts.map((f) => f.year).filter((y): y is number => !!y);
  const active = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : '—';
  const free = fonts.filter((f) => f.license === 'free').length;
  const awarded = fonts.some((f) => f.awards.length > 0);
  const role = `${awarded ? 'Award-winning type ' : 'Type '}${p.type === 'foundry' ? 'foundry' : 'designer'}`;

  // people who share typefaces with this designer / foundry
  const collab = new Map<string, number>();
  for (const f of fonts) for (const id of f.people) if (id !== p.id) collab.set(id, (collab.get(id) ?? 0) + 1);
  const collaborators = Array.from(collab.entries())
    .map(([id, n]) => ({ person: a.personById.get(id)!, n }))
    .filter((c) => c.person)
    .sort((x, y) => y.n - x.n)
    .slice(0, 12);

  const words = p.name.split(/\s+/);
  let d = 0;
  const socials = SOCIAL.filter(([k]) => p.social[k]).map(([k, l]) => ({ href: p.social[k]!, label: k === 'website_url' ? hostOf(p.social[k]!) : l }));

  return (
    <>
      <section className="dhero on-dark">
        <nav className="wrap crumbs mono" aria-label="Breadcrumb">
          <Link href={p.type === 'foundry' ? '/foundries' : '/designers'} className="ul">{p.type === 'foundry' ? 'Foundries' : 'Designers'}</Link>
          <span>/</span><span aria-current="page">{p.name}</span>
        </nav>
        <div className="wrap dhero__in">
          <div style={{ flex: '999 1 600px', minWidth: 0 }}>
            <p className="mono" style={{ margin: '0 0 22px', color: 'var(--mute-inv)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {role}
              {p.claimed ? <span className="verified" style={{ background: 'var(--paper)', color: 'var(--ink)' }} title={`This profile is managed by ${p.name}`}>✓ Verified</span> : null}
            </p>
            <h1 className="display" aria-label={p.name}>
              {words.map((w, wi) => (
                <span key={wi}>
                  <span className="w" aria-hidden="true">
                    {w.split('').map((ch, ci) => <span key={ci} className="l" style={{ animationDelay: `${(d++) * 40}ms` }}>{ch}</span>)}
                  </span>
                  {wi < words.length - 1 ? ' ' : null}
                </span>
              ))}
            </h1>
          </div>
          <div className="dhero__side">
          <div className="badge-ring" aria-hidden={!p.logo}>
            <svg viewBox="0 0 240 240" width="240" height="240" aria-hidden="true">
              <defs><path id="ring" d="M120,120 m-104,0 a104,104 0 1,1 208,0 a104,104 0 1,1 -208,0" /></defs>
              <text fill="#ffffff" style={{ fontFamily: 'var(--f-mono)', fontSize: 12, letterSpacing: 4 }}>
                <textPath href="#ring">FAHRESS · {p.type === 'foundry' ? 'FOUNDRY' : 'DESIGNER'} PROFILE · CREDIT THE MAKERS ·</textPath>
              </text>
            </svg>
            {p.logo ? <img className={`avatar${p.type === 'designer' ? ' avatar--grey' : ''}`} src={thumbUrl(p.logo, 384)} alt={`${p.name}`} /> : <span className="mono-avatar">{p.name[0]}</span>}
          </div>
          {!p.claimed ? <ClaimProfile designerId={p.id} name={p.name} slug={p.slug} kind={p.type === 'foundry' ? 'foundry' : 'designer'} className="btn" label={p.type === 'foundry' ? 'Is this your foundry? Claim this account' : 'Is this you? Claim this account'} /> : null}
          </div>
        </div>
        <div className="wrap dhero__bio">
          {p.bio ? <p>{p.bio}</p> : <p className="muted">No biography yet.</p>}
          {socials.length ? (
            <div className="links">
              {socials.map((s) => <a key={s.href} href={s.href} target="_blank" rel="noopener" className="btn btn--ghost">{s.label} ↗</a>)}
            </div>
          ) : null}
        </div>
      </section>

      <section className="wrap">
        <div className="facts-strip">
          <div><span className="mono muted">Typefaces</span><b>{fonts.length}</b></div>
          {p.from ? <div><span className="mono muted">{p.type === 'foundry' ? 'Country' : 'From'}</span><b>{p.from}</b></div> : null}
          <div><span className="mono muted">Scripts</span><b>{scripts.map((s) => s.name).join(' · ') || '—'}</b></div>
          <div><span className="mono muted">Releases</span><b>{active}</b></div>
          <div><span className="mono muted">Free fonts</span><b>{free} of {fonts.length}</b></div>
        </div>
      </section>

      <section className="wrap section" style={{ paddingTop: 64 }}>
        <div className="section__head"><h2 className="display h-lg">{p.type === 'foundry' ? 'Published typefaces' : 'Typefaces'}</h2></div>
        {fonts.length ? (
          <WorkGrid
            fonts={fonts.map((f) => ({ ...toCard(a, f), keys: tagNames(a.scripts, f.scripts) }))}
            filters={scripts.map((s) => s.name)}
          />
        ) : (
          <p className="muted">No typefaces linked yet.</p>
        )}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 48, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
          <div style={{ flex: '1 1 320px', maxWidth: 560 }}><SuggestCorrection designerId={p.id} about={p.name} /></div>
        </div>
      </section>

      {collaborators.length ? (
        <section className="wrap section" style={{ paddingTop: 24, paddingBottom: 88 }}>
          <div className="section__head">
            <h2 className="display h-lg">{p.type === 'foundry' ? 'Designers published here' : 'Worked with'}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: '6px 24px', borderTop: '1.5px solid var(--ink)' }}>
            {collaborators.map(({ person, n }) => (
              <Link key={person.id} href={personHref(person.type, person.slug)} className="person" style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
                {person.logo ? <img className={`avatar${person.type === 'designer' ? ' avatar--grey' : ''}`} src={thumbUrl(person.logo, 256)} alt="" width={52} height={52} loading="lazy" /> : <span className="mono-avatar" aria-hidden="true">{person.name[0]}</span>}
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span className="person__name ul">{person.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{person.type === 'foundry' ? 'Foundry' : 'Designer'}{person.from ? ` · ${person.from}` : ''} · {n} shared {n === 1 ? 'typeface' : 'typefaces'}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
