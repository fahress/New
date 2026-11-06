import 'server-only';
import type { Snapshot } from './archive';
import type { Supa } from './supa';

/** Loads the archive snapshot with the person's own permissions. Cached briefly per person; cleared after any approved change. */
const cache = new Map<string, { at: number; snap: Snapshot }>();
const TTL = 60_000;

export function forgetArchiveCache() { cache.clear(); }

type R = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function loadSnapshot(db: Supa, userId: string): Promise<Snapshot> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.snap;
  const fontCols = 'id,name,slug,status,year,weights,is_variable,license,cover,images,purchase_links,case_studies,source_url,language_group,description,created_at,updated_at';
  const personCols = 'id,name,slug,type,country,logo,bio,social_links,created_at,updated_at';
  let arabicFields = true;
  const fontsP = db.all<R>('fonts', `${fontCols},description_ar`, 'id').catch(() => { arabicFields = false; return db.all<R>('fonts', fontCols, 'id'); });
  const peopleP = db.all<R>('designers', `${personCols},bio_ar`, 'id').catch(() => { arabicFields = false; return db.all<R>('designers', personCols, 'id'); });
  const link = (table: string, key: string, extra = '') => db.all<R>(table, `font_id,${key}${extra}`, `font_id,${key}`).catch(() => [] as R[]);
  const tag = (table: string) => db.all<R>(table, 'id,name', 'id').catch(() => [] as R[]);
  const [fonts, people, ld, ls, lg, lst, lt, ll, la, scripts, genres, styles, types, awards, groups] = await Promise.all([
    fontsP, peopleP, link('font_designers', 'designer_id'), link('font_scripts', 'script_id'), link('font_genres', 'genre_id'), link('font_styles', 'style_id'),
    link('font_types', 'type_id'), link('font_languages', 'lang_id'), link('font_awards', 'award_id', ',url'),
    tag('scripts'), tag('genres'), tag('styles'), tag('types'), tag('awards'), tag('language_groups'),
  ]);
  const toL = (rows: R[], key: string) => rows.map((r) => ({ font_id: String(r.font_id), tag_id: String(r[key]) }));
  const toT = (rows: R[]) => rows.map((r) => ({ id: String(r.id), name: String(r.name ?? '') }));
  const snap: Snapshot = {
    fonts: fonts.map((f) => ({
      id: String(f.id), name: String(f.name ?? ''), slug: String(f.slug ?? ''), status: String(f.status ?? 'draft'), year: typeof f.year === 'number' ? f.year : null,
      weights: typeof f.weights === 'number' ? f.weights : null, is_variable: f.is_variable === true, license: s(f.license), cover: s(f.cover),
      images: Array.isArray(f.images) ? f.images.map(String) : [], purchase_links: Array.isArray(f.purchase_links) ? f.purchase_links.map(String) : [],
      case_studies: Array.isArray(f.case_studies) ? f.case_studies.map(String) : [], source_url: s(f.source_url),
      language_group: Array.isArray(f.language_group) ? f.language_group.map(String) : [], description: s(f.description), description_ar: s(f.description_ar),
      created_at: String(f.created_at ?? ''), updated_at: s(f.updated_at),
    })),
    people: people.map((p) => ({
      id: String(p.id), name: String(p.name ?? ''), slug: String(p.slug ?? ''), type: String(p.type ?? 'designer'), country: s(p.country), logo: s(p.logo),
      bio: s(p.bio), bio_ar: s(p.bio_ar), social_links: p.social_links && typeof p.social_links === 'object' ? (p.social_links as Record<string, string | null>) : {},
      created_at: String(p.created_at ?? ''), updated_at: s(p.updated_at),
    })),
    links: {
      designers: ld.map((r) => ({ font_id: String(r.font_id), designer_id: String(r.designer_id) })),
      scripts: toL(ls, 'script_id'), genres: toL(lg, 'genre_id'), styles: toL(lst, 'style_id'), types: toL(lt, 'type_id'), languages: toL(ll, 'lang_id'),
      awards: la.map((r) => ({ font_id: String(r.font_id), tag_id: String(r.award_id), url: s(r.url) })),
    },
    tags: { scripts: toT(scripts), genres: toT(genres), styles: toT(styles), types: toT(types), awards: toT(awards), language_groups: toT(groups) },
    arabicFields,
  };
  if (cache.size > 50) cache.clear();
  cache.set(userId, { at: Date.now(), snap });
  return snap;
}
