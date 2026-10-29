import type { Metadata } from 'next';
import Catalog, { type CatFont, type FacetGroup } from '@/components/Catalog';
import { getArchive } from '@/lib/data';
import { label, slugify } from '@/lib/format';
import { creditOf, shortList, tagNames } from '@/lib/view';
import type { Tag } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Catalog — Arabic fonts by script, style and designer',
  description: 'Browse every Arabic typeface in the Fahress archive. Filter by script (Naskh, Kufi, Diwani, Thuluth…), style, type, license, language, designer and foundry.',
  alternates: { canonical: '/fonts' },
};

type SP = Record<string, string | string[] | undefined>;

const weightKey = (w: number | null) => (!w ? [] : w === 1 ? ['single'] : w >= 9 ? ['large'] : ['family']);

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const a = await getArchive();
  const lgSlug = (t: Tag) => slugify(t.name);
  const bySlug = (list: Tag[], ids: number[], key: (t: Tag) => string = (t) => t.slug) =>
    ids.map((id) => list.find((t) => t.id === id)).filter((t): t is Tag => !!t).map(key);

  const years = Array.from(new Set(a.fonts.map((f) => f.year).filter((y): y is number => !!y))).sort((x, y) => y - x);

  const fonts: CatFont[] = a.fonts.map((f) => {
    const people = f.people.map((id) => a.personById.get(id)).filter((p) => !!p);
    return {
      id: f.id,
      n: f.name,
      s: f.slug,
      c: f.cover,
      cr: creditOf(a, f),
      scr: shortList(tagNames(a.scripts, f.scripts)),
      tg: [...tagNames(a.types, f.types), ...tagNames(a.styles, f.styles)].join(', '),
      l: f.license,
      y: f.year,
      w: f.weights,
      v: f.variable,
      t: f.createdAt,
      aw: f.awards.length ? a.awards.find((w) => w.id === f.awards[0].awardId)?.name ?? null : null,
      f: {
        scripts: bySlug(a.scripts, f.scripts),
        styles: bySlug(a.styles, f.styles),
        types: bySlug(a.types, f.types),
        genres: bySlug(a.genres, f.genres),
        designers: people.filter((p) => p!.type === 'designer').map((p) => p!.slug),
        foundries: people.filter((p) => p!.type === 'foundry').map((p) => p!.slug),
        license: [f.license],
        lang: bySlug(a.languageGroups, f.languageGroups, lgSlug),
        weights: [...weightKey(f.weights), ...(f.variable ? ['variable'] : [])],
        year: f.year ? [String(f.year)] : [],
        award: f.awards.length ? ['yes'] : [],
      },
    };
  });

  const opt = (list: Tag[], key: (t: Tag) => string = (t) => t.slug) => list.map((t) => ({ value: key(t), label: label(t.name) }));
  const groups: FacetGroup[] = [
    { key: 'scripts', label: 'Script', options: opt(a.scripts) },
    { key: 'styles', label: 'Style', options: opt(a.styles) },
    { key: 'types', label: 'Type', options: opt(a.types) },
    { key: 'genres', label: 'Genre', options: opt(a.genres) },
    { key: 'designers', label: 'Designers', searchable: true, options: a.people.filter((p) => p.type === 'designer').map((p) => ({ value: p.slug, label: p.name })) },
    { key: 'foundries', label: 'Foundries', searchable: true, options: a.people.filter((p) => p.type === 'foundry').map((p) => ({ value: p.slug, label: p.name })) },
    { key: 'license', label: 'License', options: [{ value: 'free', label: 'Free' }, { value: 'paid', label: 'Paid' }, { value: 'custom', label: 'Custom' }] },
    { key: 'lang', label: 'Language', options: opt(a.languageGroups, lgSlug) },
    { key: 'weights', label: 'Weights', options: [{ value: 'single', label: 'Single weight' }, { value: 'family', label: '2–8 weights' }, { value: 'large', label: '9+ weights' }, { value: 'variable', label: 'Variable' }] },
    { key: 'year', label: 'Release year', options: years.map((y) => ({ value: String(y), label: String(y) })) },
    { key: 'award', label: 'Awards', options: [{ value: 'yes', label: 'Award winners' }] },
  ];

  // read filters from the address — accepts slugs and the old site's numeric ids (?scripts=1)
  const tagLists: Record<string, [Tag[], (t: Tag) => string]> = {
    scripts: [a.scripts, (t) => t.slug],
    styles: [a.styles, (t) => t.slug],
    types: [a.types, (t) => t.slug],
    genres: [a.genres, (t) => t.slug],
    lang: [a.languageGroups, lgSlug],
  };
  const initial: Record<string, string[]> = {};
  for (const g of groups) {
    const raw = sp[g.key];
    if (!raw) continue;
    const vals = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    const mapped = vals.map((v) => {
      const tl = tagLists[g.key];
      if (tl && /^\d+$/.test(v)) {
        const t = tl[0].find((x) => x.id === Number(v));
        return t ? tl[1](t) : v;
      }
      return v;
    });
    const valid = mapped.filter((v) => g.options.some((o) => o.value === v));
    if (valid.length) initial[g.key] = Array.from(new Set(valid));
  }
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) ?? '';

  return (
    <Catalog
      fonts={fonts}
      groups={groups}
      initial={initial}
      initialQ={one('q')}
      initialSort={['new', 'az', 'year', 'weights'].includes(one('sort')) ? one('sort') : 'new'}
      initialView={one('view') === 'list' ? 'list' : 'grid'}
    />
  );
}
