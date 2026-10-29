import { getArchive } from '@/lib/data';
import { creditOf } from '@/lib/view';
import { label, slugify } from '@/lib/format';

export const revalidate = 600;

/** Compact list of fonts, designers and foundries for the search suggestions in the header. */
export async function GET() {
  const a = await getArchive();
  return Response.json({
    fonts: a.fonts.map((f) => ({ n: f.name, s: f.slug, c: f.cover, by: creditOf(a, f), y: f.year })),
    people: a.people
      .filter((p) => p.fontIds.length > 0)
      .map((p) => ({ n: p.name, s: p.slug, t: p.type, k: p.fontIds.length, l: p.logo, f: p.from ?? null })),
    tags: [
      ...a.scripts.map((t) => ({ n: t.name, g: 'Script', h: `/fonts?scripts=${t.slug}`, k: a.fonts.filter((f) => f.scripts.includes(t.id)).length })),
      ...a.styles.map((t) => ({ n: label(t.name), g: 'Style', h: `/fonts?styles=${t.slug}`, k: a.fonts.filter((f) => f.styles.includes(t.id)).length })),
      ...a.types.map((t) => ({ n: t.name, g: 'Type', h: `/fonts?types=${t.slug}`, k: a.fonts.filter((f) => f.types.includes(t.id)).length })),
      ...a.genres.map((t) => ({ n: t.name, g: 'Genre', h: `/fonts?genres=${t.slug}`, k: a.fonts.filter((f) => f.genres.includes(t.id)).length })),
      ...a.languageGroups.map((t) => ({ n: t.name.trim(), g: 'Language', h: `/fonts?lang=${slugify(t.name)}`, k: a.fonts.filter((f) => f.languageGroups.includes(t.id)).length })),
      { n: 'Free', g: 'License', h: '/fonts?license=free', k: a.fonts.filter((f) => f.license === 'free').length },
      { n: 'Variable', g: 'Weights', h: '/fonts?weights=variable', k: a.fonts.filter((f) => f.variable).length },
    ].filter((t) => t.k > 0),
  });
}
