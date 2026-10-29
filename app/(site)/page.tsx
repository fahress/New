import Image from 'next/image';
import Link from 'next/link';
import FontCard from '@/components/FontCard';
import HomeSearch, { type SearchIndex } from '@/components/HomeSearch';
import HoverRows from '@/components/HoverRows';
import RandomWall from '@/components/RandomWall';
import { getArchive } from '@/lib/data';
import { SCRIPT_ARABIC, excerpt, label, personHref, storageUrl, thumbUrl } from '@/lib/format';
import { creditOf, toCard } from '@/lib/view';
import type { Archive, Font } from '@/lib/types';

export const revalidate = 600;

export default async function Home() {
  const a = await getArchive();
  const designers = a.people.filter((p) => p.type === 'designer' && p.fontIds.length > 0);
  const foundries = a.people.filter((p) => p.type === 'foundry' && p.fontIds.length > 0);

  // newest releases by release year (then most recently added within the same year)
  const newest = a.fonts
    .filter((f) => f.year)
    .sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || y.createdAt.localeCompare(x.createdAt))
    .slice(0, 6);

  // Designer spotlight rotates weekly among designers with a bio and at least 4 typefaces.
  const pool = designers.filter((p) => p.fontIds.length >= 4 && p.bio.length > 40 && p.logo);
  const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const star = pool.length ? pool[week % pool.length] : null;
  const starFonts = star ? star.fontIds.map((id) => a.fontById.get(id)!).filter(Boolean) : [];

  const scriptRows = a.scripts.map((s, i) => {
    const fonts = a.fonts.filter((f) => f.scripts.includes(s.id));
    return {
      key: s.slug,
      href: `/fonts?scripts=${s.slug}`,
      img: fonts[0]?.cover ?? null,
      imgs: fonts.map((f) => f.cover).filter(Boolean),
      content: (
        <>
          <span className="row__n mono">{String(i + 1).padStart(2, '0')}</span>
          <span className="row__name">{s.name}</span>
          <span className="row__ar" dir="rtl" lang="ar">{SCRIPT_ARABIC[s.slug] ?? ''}</span>
          <span className="row__count mono muted">{fonts.length}</span>
          <span aria-hidden="true" style={{ fontSize: 28 }}>→</span>
        </>
      ),
    };
  });

  const awarded = a.fonts.filter((f) => f.awards.length > 0);

  const index: SearchIndex = {
    fonts: a.fonts.map((f) => ({ n: f.name, s: f.slug, c: f.cover, by: creditOf(a, f) })),
    people: a.people.filter((p) => p.fontIds.length).map((p) => ({ n: p.name, s: p.slug, t: p.type, k: p.fontIds.length })),
    tags: [
      ...a.scripts.map((t) => ({ n: t.name, href: `/fonts?scripts=${t.slug}`, g: 'Script' })),
      ...a.styles.map((t) => ({ n: label(t.name), href: `/fonts?styles=${t.slug}`, g: 'Style' })),
      ...a.types.map((t) => ({ n: t.name, href: `/fonts?types=${t.slug}`, g: 'Type' })),
      ...a.genres.map((t) => ({ n: t.name, href: `/fonts?genres=${t.slug}`, g: 'Genre' })),
      { n: 'Free', href: '/fonts?license=free', g: 'License' },
      { n: 'Variable', href: '/fonts?weights=variable', g: 'Weights' },
    ],
  };

  return (
    <>
      <section className="wrap hero">
        <div className="hero__text rise">
          <p className="hero__eyebrow mono"><span>فهرس / Fahress</span><span className="muted">The Arabic Type Design Archive</span></p>
          <h1 className="display h-xl" style={{ margin: 0 }}>
            Every font
            <br />
            has a{' '}
            <span className="rotator"><span>designer.</span><span>foundry.</span><span>story.</span></span>
          </h1>
        </div>
      </section>

      <section className="wrap" aria-label="Search">
        <HomeSearch index={index} tries={['Diwani', 'Pixel', 'Mostafa Abasiry', 'Free', 'Variable', 'Thuluth']} />
      </section>

      <section className="band" aria-label="Recently archived">
        <div className="wrap band__head mono"><span>Live from the index</span><span style={{ color: 'var(--mute-inv)' }}>Hover to pause</span></div>
        <RandomWall pool={a.fonts.map((f) => ({ s: f.slug, n: f.name, c: f.cover, by: creditOf(a, f) }))} />
      </section>

      <section className="wrap" aria-label="The archive in numbers">
        <div className="counters">
          <div className="counter"><b>{a.fonts.length}</b><span className="mono">Typefaces indexed</span></div>
          <div className="counter"><b>{designers.length}</b><span className="mono">Designers credited</span></div>
          <div className="counter"><b>{foundries.length}</b><span className="mono">Foundries</span></div>
          <div className="counter"><b>{a.scripts.length}</b><span className="mono">Calligraphic scripts</span></div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section__head">
          <h2 className="display h-lg">New releases</h2>
          <Link href="/fonts?sort=year" className="ul">All typefaces by release year →</Link>
        </div>
        <div className="grid">
          {newest.map((f, i) => <FontCard key={f.id} f={{ ...toCard(a, f), script: `${toCard(a, f).script} · ${f.year}` }} index={i} priority={i < 3} />)}
        </div>
      </section>

      <section className="wrap section" id="scripts">
        <div className="section__head">
          <h2 className="display h-lg">Browse by script</h2>
          <p className="muted" style={{ margin: 0 }}>Hover a script to preview one of its typefaces</p>
        </div>
        <HoverRows rows={scriptRows} />
      </section>

      {star ? (
        <section className="spotlight on-dark">
          <div className="wrap spotlight__in">
            <div className="spotlight__text">
              <p className="mono" style={{ margin: 0, color: 'var(--mute-inv)' }}>Designer of the week</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <img className="avatar avatar--grey" src={thumbUrl(star.logo, 256)} alt="" width={104} height={104} />
                <div>
                  <h2 className="display h-lg" style={{ margin: 0 }}>{star.name}</h2>
                  <p style={{ margin: '8px 0 0', color: 'var(--mute-inv)' }}>{star.from ? `${star.from} · ` : ''}{star.fontIds.length} typefaces on Fahress</p>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 18, lineHeight: 1.65, color: '#e6e6e6' }}>{excerpt(star.bio, 320)}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Link href={personHref(star.type, star.slug)} className="btn">Read the profile</Link>
                {starFonts[0] ? <Link href={`/fonts/${starFonts[0].slug}`} className="btn btn--ghost">View {starFonts[0].name} →</Link> : null}
              </div>
            </div>
            <div className="spotlight__media">
              <div className="xfade">
                {starFonts.slice(0, 4).map((f) => (
                  <Image key={f.id} src={storageUrl(f.cover)} alt={`${f.name} presentation`} fill sizes="(max-width: 900px) 100vw, 60vw" />
                ))}
              </div>
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 14, color: 'var(--mute-inv)', flexWrap: 'wrap' }}>
                <span>{starFonts.slice(0, 4).map((f) => f.name).join(' · ')}</span>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {awarded.length ? (
        <section className="wrap section">
          <div className="section__head">
            <h2 className="display h-lg">Award-winning Arabic type</h2>
            <Link href="/fonts?award=yes" className="ul">All award winners →</Link>
          </div>
          <div className="award-list">
            {awarded.slice(0, 8).map((f) => (
              <Link key={f.id} href={`/fonts/${f.slug}`} className="award-row">
                <span className="award-row__img"><img className="spec" src={thumbUrl(f.cover, 384)} alt="" loading="lazy" /></span>
                <span className="award-row__name">{f.name}</span>
                <span className="muted" style={{ fontSize: 15 }}>{creditOf(a, f)}</span>
                <span className="mono">{f.awards.map((w) => a.awards.find((x) => x.id === w.awardId)?.name).filter(Boolean).join(' · ')}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="ticker-band" aria-label="Foundries in the archive" style={{ marginTop: 64, borderTop: '1px solid var(--ink)' }}>
        <div className="ticker">
          {[...foundries, ...foundries].map((p, i) => (
            <span key={p.id + i} style={{ display: 'inline-flex', gap: 48 }}>
              <Link href={personHref(p.type, p.slug)} className="ul" tabIndex={i >= foundries.length ? -1 : undefined}>{p.name}</Link>
              <span aria-hidden="true">✳</span>
            </span>
          ))}
        </div>
      </section>

      <section className="wrap cta">
        <h2 className="display" style={{ margin: 0, flex: '1 1 560px', fontSize: 'clamp(44px, 6.4vw, 100px)' }}>Drew an Arabic typeface? Put your name on it.</h2>
        <div style={{ flex: '0 1 360px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="lede" style={{ margin: 0 }}>Send us your typeface, portrait and story, and we’ll credit you on every font you drew, with a link to where it can be bought.</p>
          <Link href="/submit" className="btn">Submit a font</Link>
        </div>
      </section>
    </>
  );
}
