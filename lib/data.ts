import 'server-only';
import { cache } from 'react';
import type { Archive, Award, Font, Person, PersonType, Tag } from './types';
import { slugify } from './format';
import { placeOf } from './places';

import { SUPABASE_URL, SUPABASE_ANON_KEY as SUPABASE_KEY } from './config';

/** How long fetched data is reused before Next.js asks Supabase again (seconds). */
export const REVALIDATE_SECONDS = 600;

type Row = Record<string, unknown>;

async function readFixture(): Promise<Record<string, Row[]> | null> {
  const file = process.env.FAHRESS_FIXTURE;
  if (!file) return null;
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(file, 'utf8'));
}

async function table(name: string, select = '*', filter = ''): Promise<Row[]> {
  const fixture = await readFixture();
  if (fixture) return fixture[name] ?? [];
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${name}?select=${encodeURIComponent(select)}${filter}&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      next: { revalidate: REVALIDATE_SECONDS, tags: ['fahress'] },
    });
    if (!res.ok) throw new Error(`Supabase ${name}: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : null);

function tags(rows: Row[]): Tag[] {
  return rows
    .map((r) => ({ id: Number(r.id), name: str(r.name).trim(), slug: str(r.slug) || slugify(str(r.name)) }))
    .sort((a, b) => a.id - b.id);
}

function link(rows: Row[], key: string): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const id = str(r.font_id);
    const list = m.get(id) ?? [];
    list.push(Number(r[key]));
    m.set(id, list);
  }
  return m;
}

export const getArchive = cache(async (): Promise<Archive> => {
  const [
    fontRows, designerRows, awardRows, genreRows, languageRows, scriptRows, styleRows, typeRows, groupRows,
    fa, fd, fg, fl, fsc, fst, fty,
  ] = await Promise.all([
    table('fonts', 'id,name,slug,description,cover,images,purchase_links,case_studies,license,year,weights,is_variable,is_favorite,language_group,created_at,status', '&status=in.(published,featured)'),
    table('designers', 'id,name,slug,logo,bio,social_links,type'),
    table('awards', 'id,name,image'),
    table('genres'),
    table('languages', 'id,name,native_name'),
    table('scripts'),
    table('styles'),
    table('types'),
    table('language_groups'),
    table('font_awards', 'font_id,award_id,url'),
    table('font_designers', 'font_id,designer_id,created_at'),
    table('font_genres', 'font_id,genre_id'),
    table('font_languages', 'font_id,lang_id'),
    table('font_scripts', 'font_id,script_id'),
    table('font_styles', 'font_id,style_id'),
    table('font_types', 'font_id,type_id'),
  ]);

  const peopleByFont = new Map<string, string[]>();
  for (const r of [...fd].sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))) {
    const list = peopleByFont.get(str(r.font_id)) ?? [];
    if (!list.includes(str(r.designer_id))) list.push(str(r.designer_id));
    peopleByFont.set(str(r.font_id), list);
  }
  const awardsByFont = new Map<string, { awardId: string; url: string | null }[]>();
  for (const r of fa) {
    const list = awardsByFont.get(str(r.font_id)) ?? [];
    list.push({ awardId: str(r.award_id), url: str(r.url) || null });
    awardsByFont.set(str(r.font_id), list);
  }
  const genres = link(fg, 'genre_id');
  const langs = link(fl, 'lang_id');
  const scriptsL = link(fsc, 'script_id');
  const stylesL = link(fst, 'style_id');
  const typesL = link(fty, 'type_id');

  const fonts: Font[] = fontRows
    .map((r) => {
      const id = str(r.id);
      const cover = str(r.cover);
      const images = arr(r.images);
      return {
        id,
        name: str(r.name).trim(),
        slug: str(r.slug),
        description: str(r.description).trim(),
        cover: cover || images[0] || '',
        images: images.length ? images : cover ? [cover] : [],
        purchaseLinks: arr(r.purchase_links),
        caseStudies: arr(r.case_studies),
        license: str(r.license).toLowerCase() || 'paid',
        year: num(r.year),
        weights: num(r.weights),
        variable: r.is_variable === true,
        featured: r.is_favorite === true || r.status === 'featured',
        createdAt: str(r.created_at),
        people: peopleByFont.get(id) ?? [],
        scripts: scriptsL.get(id) ?? [],
        styles: stylesL.get(id) ?? [],
        types: typesL.get(id) ?? [],
        genres: genres.get(id) ?? [],
        languageGroups: arr(r.language_group).map(Number).filter((n) => !Number.isNaN(n)),
        languages: langs.get(id) ?? [],
        awards: awardsByFont.get(id) ?? [],
      } satisfies Font;
    })
    .filter((f) => f.slug && f.name)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const fontIdsByPerson = new Map<string, string[]>();
  for (const f of fonts) for (const p of f.people) fontIdsByPerson.set(p, [...(fontIdsByPerson.get(p) ?? []), f.id]);

  const people: Person[] = designerRows
    .map((r) => ({
      id: str(r.id),
      name: str(r.name).trim(),
      slug: str(r.slug) || slugify(str(r.name)),
      logo: str(r.logo) || null,
      bio: str(r.bio).trim(),
      social: (r.social_links && typeof r.social_links === 'object' ? r.social_links : {}) as Person['social'],
      type: (r.type === 'foundry' ? 'foundry' : 'designer') as PersonType,
      fontIds: fontIdsByPerson.get(str(r.id)) ?? [],
      ...placeOf(str(r.slug) || slugify(str(r.name))),
    }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const awards: Award[] = awardRows.map((r) => ({ id: str(r.id), name: str(r.name), image: str(r.image) || null }));

  return {
    fonts,
    people,
    scripts: tags(scriptRows),
    styles: tags(styleRows),
    types: tags(typeRows),
    genres: tags(genreRows),
    languageGroups: tags(groupRows).sort((a, b) => a.name.localeCompare(b.name)),
    languages: languageRows.map((r) => ({ id: Number(r.id), name: str(r.name), nativeName: str(r.native_name) })),
    awards,
    fontBySlug: new Map(fonts.map((f) => [f.slug, f])),
    fontById: new Map(fonts.map((f) => [f.id, f])),
    personBySlug: new Map(people.map((p) => [p.slug, p])),
    personById: new Map(people.map((p) => [p.id, p])),
  };
});
