import Image from 'next/image';
import Link from 'next/link';
import { Fragment } from 'react';
import { personHref, storageUrl, thumbUrl } from '@/lib/format';

export type CardPerson = {
  slug: string;
  name: string;
  type: 'designer' | 'foundry';
  logo: string | null;
  from?: string;
  count: number;
};

export type CardFont = {
  slug: string;
  name: string;
  cover: string;
  credit: string;
  people?: CardPerson[];
  script: string;
  license: string;
  award?: string | null;
  badges?: string[];
};

/** A designer / foundry name that links to their profile and shows a small profile card on hover. */
export function PersonLink({ p }: { p: CardPerson }) {
  const href = personHref(p.type, p.slug);
  return (
    <span className="who">
      <Link href={href} className="who__name">{p.name}</Link>
      <Link href={href} className="who__pop" tabIndex={-1} aria-hidden="true">
        {p.logo ? (
          <img className={`avatar${p.type === 'designer' ? ' avatar--grey' : ''}`} src={thumbUrl(p.logo, 256)} alt="" width={48} height={48} loading="lazy" />
        ) : (
          <span className="mono-avatar" style={{ width: 48, height: 48, fontSize: 18 }}>{p.name[0]}</span>
        )}
        <span className="who__text">
          <span className="who__title">{p.name}</span>
          <span className="who__meta">
            {p.type === 'foundry' ? 'Foundry' : 'Designer'}
            {p.from ? ` · ${p.from}` : ''} · {p.count} {p.count === 1 ? 'typeface' : 'typefaces'}
          </span>
          <span className="who__cta">View profile →</span>
        </span>
      </Link>
    </span>
  );
}

export default function FontCard({ f, index = 0, priority = false, sizes }: { f: CardFont; index?: number; priority?: boolean; sizes?: string }) {
  const href = `/fonts/${f.slug}`;
  return (
    <article className="card tile pop" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}>
      <Link href={href} className="card__hit">
        <div className="frame">
          {f.cover ? (
            <Image
              src={storageUrl(f.cover)}
              alt={`${f.name} — presentation image${f.credit ? ` by ${f.credit}` : ''}`}
              fill
              sizes={sizes ?? '(max-width: 700px) 100vw, (max-width: 1200px) 50vw, 33vw'}
              className="spec"
              priority={priority}
            />
          ) : null}
          {f.badges && f.badges.length > 0 ? (
            <span className="card__badges">
              {f.badges.map((b) => (
                <span key={b} className="pill pill--sm">{b}</span>
              ))}
            </span>
          ) : null}
          {f.award ? <span className="card__award pill pill--sm pill--solid">★ {f.award}</span> : null}
        </div>
        <div className="card__row card__rule">
          <span className="card__name">{f.name}</span>
          <span className="pill pill--sm">{f.license}</span>
        </div>
      </Link>
      <div className="card__meta">
        <span className="card__credit">
          {f.people && f.people.length
            ? f.people.map((p, i) => (
                <Fragment key={p.slug}>
                  {i > 0 ? <span className="muted"> · </span> : null}
                  <PersonLink p={p} />
                </Fragment>
              ))
            : f.credit || 'Designer not listed'}
        </span>
        <span className="muted" style={{ whiteSpace: 'nowrap' }}>{f.script}</span>
      </div>
    </article>
  );
}
