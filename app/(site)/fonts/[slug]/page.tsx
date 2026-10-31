import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import FontCard from '@/components/FontCard';
import Gallery from '@/components/Gallery';
import SuggestCorrection from '@/components/SuggestCorrection';
import ClaimFont from '@/components/claims/ClaimFont';
import { getArchive, getRedirect } from '@/lib/data';
import { excerpt, hostOf, label, licenseLabel, slugify, storageUrl, thumbUrl, weightsLabel, personHref } from '@/lib/format';
import { creditOf, toCard } from '@/lib/view';
import type { Tag } from '@/lib/types';

export const revalidate = 600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const a = await getArchive();
  return a.fonts.map((f) => ({ slug: f.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getArchive();
  const f = a.fontBySlug.get(slug);
  if (!f) return { title: 'Font not found' };
  const credit = creditOf(a, f);
  const title = credit ? `${f.name} — by ${credit}` : f.name;
  const description = excerpt(f.description || `${f.name}, an Arabic typeface${credit ? ` by ${credit}` : ''}.`, 155);
  return {
    title,
    description,
    alternates: { canonical: `/fonts/${f.slug}` },
    openGraph: { title, description, url: `/fonts/${f.slug}`, images: f.cover ? [{ url: storageUrl(f.cover) }] : [] },
    twitter: { card: 'summary_large_image', title, description, images: f.cover ? [storageUrl(f.cover)] : [] },
  };
}

export default async function FontPage({ params }: Props) {
  const { slug } = await params;
  const a = await getArchive();
  const f = a.fontBySlug.get(slug);
  if (!f) {
    const moved = await getRedirect(slug);
    if (moved?.kind === 'font' && a.fontBySlug.has(moved.to)) permanentRedirect(`/fonts/${moved.to}`);
    notFound();
  }

  const people = f.people.map((id) => a.personById.get(id)).filter((p) => !!p).sort((x, y) => (x!.type === y!.type ? 0 : x!.type === 'designer' ? -1 : 1));
  const tagsOf = (list: Tag[], ids: number[]) => ids.map((id) => list.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  const scripts = tagsOf(a.scripts, f.scripts);
  const styles = tagsOf(a.styles, f.styles);
  const types = tagsOf(a.types, f.types);
  const genres = tagsOf(a.genres, f.genres);
  const groups = tagsOf(a.languageGroups, f.languageGroups);
  const awards = f.awards.map((w) => ({ ...w, award: a.awards.find((x) => x.id === w.awardId) })).filter((w) => w.award);
  const images = Array.from(new Set([f.cover, ...f.images].filter(Boolean)));
  const paragraphs = f.description.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);

  const lead = people.find((p) => p!.type === 'designer') ?? people[0];
  const more = lead ? lead.fontIds.filter((id) => id !== f.id).map((id) => a.fontById.get(id)!).filter(Boolean).slice(0, 4) : [];
  const score = (o: typeof f) =>
    (o.scripts.some((x) => f.scripts.includes(x)) ? 3 : 0) +
    o.types.filter((x) => f.types.includes(x)).length * 2 +
    o.styles.filter((x) => f.styles.includes(x)).length +
    o.genres.filter((x) => f.genres.includes(x)).length * 0.5;
  const similar = a.fonts
    .filter((o) => o.id !== f.id && !more.includes(o) && !o.people.some((p) => f.people.includes(p)))
    .map((o) => ({ o, s: score(o) }))
    .filter((x) => x.s > 2)
    .sort((x, y) => y.s - x.s || y.o.createdAt.localeCompare(x.o.createdAt))
    .slice(0, 4)
    .map((x) => x.o);

  const TagLinks = ({ list, k, key2 = (t: Tag) => t.slug }: { list: Tag[]; k: string; key2?: (t: Tag) => string }) => (
    <>
      {list.map((t) => (
        <Link key={t.id} href={`/fonts?${k}=${key2(t)}`} className="pill">{label(t.name)}</Link>
      ))}
    </>
  );

  return (
    <>
      <nav className="wrap crumbs mono" aria-label="Breadcrumb">
        <Link href="/fonts" className="ul">Catalog</Link>
        {scripts[0] ? (<><span>/</span><Link href={`/fonts?scripts=${scripts[0].slug}`} className="ul">{scripts[0].name}</Link></>) : null}
        <span>/</span><span aria-current="page">{f.name}</span>
      </nav>

      <section className="wrap font-head rise">
        <div style={{ minWidth: 0 }}>
          <h1 className="display">{f.name}</h1>
          {people.length ? (
            <p style={{ margin: '18px 0 0', fontSize: 19 }}>
              by{' '}
              {people.map((p, i) => (
                <span key={p!.id}>
                  {i > 0 ? (i === people.length - 1 ? ' & ' : ', ') : null}
                  <Link href={personHref(p!.type, p!.slug)} className="ul" style={{ fontWeight: 600 }}>{p!.name}</Link>
                </span>
              ))}
            </p>
          ) : null}
        </div>
        {f.purchaseLinks[0] ? (
          <a href={`/go/${f.id}/0`} className="btn" target="_blank" rel="noopener nofollow" style={{ minHeight: 56, fontSize: 16, padding: '0 28px' }}>
            {f.license === 'free' ? 'Download' : 'Buy'} at {hostOf(f.purchaseLinks[0])} <span aria-hidden="true">↗</span>
          </a>
        ) : null}
      </section>

      <div className="wrap font-body">
        <div className="font-main">
          <Gallery images={images} name={f.name} />
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Presentation images © {creditOf(a, f) || 'the designer'}, shown with credit.</p>

          {paragraphs.length ? (
            <section className="about-font">
              <h2 className="display h-md">About the typeface</h2>
              <div className="about-font__text">{paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
            </section>
          ) : null}

          {f.caseStudies.length ? (
            <section className="about-font">
              <h2 className="display h-md">{f.caseStudies.length === 1 ? 'Case study' : 'Case studies'}</h2>
              <div className="about-font__text" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {f.caseStudies.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noopener" className="ul" style={{ alignSelf: 'flex-start' }}>Read the case study on {hostOf(u)} ↗</a>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="panel" aria-label="Typeface details">
          {people.length ? (
            <div className="panel__sec">
              <h2 className="mono" style={{ margin: '0 0 12px', fontWeight: 500 }}>Made by</h2>
              {people.map((p) => (
                <Link key={p!.id} href={personHref(p!.type, p!.slug)} className="person">
                  {p!.logo ? <img className={`avatar${p!.type === 'designer' ? ' avatar--grey' : ''}`} src={thumbUrl(p!.logo, 256)} alt="" width={52} height={52} loading="lazy" /> : <span className="mono-avatar" aria-hidden="true">{p!.name[0]}</span>}
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span className="person__name ul">{p!.name}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{p!.type === 'foundry' ? 'Foundry' : 'Designer'}{p!.from ? ` · ${p!.from}` : ''} · {p!.fontIds.length} {p!.fontIds.length === 1 ? 'typeface' : 'typefaces'}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
          <dl className="facts">
            {scripts.length ? (<><dt className="mono muted">Script</dt><dd><TagLinks list={scripts} k="scripts" /></dd></>) : null}
            {styles.length ? (<><dt className="mono muted">Style</dt><dd><TagLinks list={styles} k="styles" /></dd></>) : null}
            {types.length ? (<><dt className="mono muted">Type</dt><dd><TagLinks list={types} k="types" /></dd></>) : null}
            {genres.length ? (<><dt className="mono muted">Genre</dt><dd><TagLinks list={genres} k="genres" /></dd></>) : null}
            {weightsLabel(f.weights, f.variable) ? (<><dt className="mono muted">Weights</dt><dd>{weightsLabel(f.weights, f.variable)}</dd></>) : null}
            {groups.length ? (<><dt className="mono muted">Language</dt><dd><TagLinks list={groups} k="lang" key2={(t) => slugify(t.name)} /></dd></>) : null}
            <dt className="mono muted">License</dt><dd><Link href={`/fonts?license=${f.license}`} className="pill">{licenseLabel(f.license)}</Link></dd>
            {f.year ? (<><dt className="mono muted">Released</dt><dd><Link href={`/fonts?year=${f.year}`} className="ul">{f.year}</Link></dd></>) : null}
            {awards.length ? (
              <><dt className="mono muted">Awards</dt><dd>{awards.map((w) => { const label = `★ ${w.award!.name}${w.year ? ` ${w.year}` : ''}`; return w.url ? <a key={w.awardId} href={w.url} target="_blank" rel="noopener" className="pill pill--solid" title={w.prize ?? undefined}>{label} ↗</a> : <span key={w.awardId} className="pill pill--solid" title={w.prize ?? undefined}>{label}</span>; })}</dd></>
            ) : null}
          </dl>
          {f.purchaseLinks.length ? (
            <div className="panel__sec" style={{ borderTop: '1px solid var(--ink)' }}>
              <h2 className="mono" style={{ margin: '0 0 12px', fontWeight: 500 }}>Where to get it</h2>
              <div className="buy">
                {f.purchaseLinks.map((u, i) => (
                  <a key={u} href={`/go/${f.id}/${i}`} target="_blank" rel="noopener nofollow" className={`btn${i ? ' btn--ghost' : ''}`}>
                    <span>{hostOf(u)}</span><span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <div className="panel__sec" style={{ borderTop: '1px solid var(--ink)', display: 'grid', gap: 14 }}>
            <ClaimFont fontId={f.id} fontName={f.name} slug={f.slug} />
            <SuggestCorrection fontId={f.id} about={f.name} />
          </div>
        </aside>
      </div>

      {more.length ? (
        <section className="wrap section" style={{ paddingTop: 24 }}>
          <div className="section__head">
            <h2 className="display h-lg">More by {lead!.name}</h2>
            <Link href={personHref(lead!.type, lead!.slug)} className="ul">All {lead!.fontIds.length} typefaces →</Link>
          </div>
          <div className="grid">{more.map((o, i) => <FontCard key={o.id} f={toCard(a, o)} index={i} />)}</div>
        </section>
      ) : null}

      {similar.length ? (
        <section className="related on-dark">
          <div className="wrap section" style={{ paddingBlock: 72 }}>
            <div className="section__head">
              <h2 className="display h-lg">You might also like</h2>
              {scripts[0] ? <Link href={`/fonts?scripts=${scripts[0].slug}`} className="ul">More {scripts[0].name} →</Link> : null}
            </div>
            <div className="grid">{similar.map((o, i) => <FontCard key={o.id} f={toCard(a, o)} index={i} />)}</div>
          </div>
        </section>
      ) : null}
    </>
  );
}
