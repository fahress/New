'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { db, demoUrls, type Row } from './db';
import { storageUrl, thumbUrl } from '@/lib/format';

export type Tag = { id: number; name: string; slug?: string; [k: string]: unknown };

export type Data = {
  fonts: Row[];
  people: Row[];
  awards: Row[];
  scripts: Tag[];
  genres: Tag[];
  styles: Tag[];
  types: Tag[];
  languages: Tag[];
  groups: Tag[];
  groupLangs: Row[];
  links: {
    designers: Row[]; scripts: Row[]; genres: Row[]; styles: Row[]; types: Row[]; awards: Row[]; languages: Row[];
  };
  profiles: Row[] | null; // null when the account can't read them
  hasCountry: boolean; // whether the designers table has the country column yet
};

export const LINK_TABLES = {
  scripts: { table: 'font_scripts', key: 'script_id' },
  genres: { table: 'font_genres', key: 'genre_id' },
  styles: { table: 'font_styles', key: 'style_id' },
  types: { table: 'font_types', key: 'type_id' },
  designers: { table: 'font_designers', key: 'designer_id' },
  awards: { table: 'font_awards', key: 'award_id' },
  languages: { table: 'font_languages', key: 'lang_id' },
} as const;

type Ctx = {
  data: Data | null;
  error: string | null;
  reload: () => Promise<void>;
  /** ids linked to a font, per link table */
  linked: (fontId: string, kind: keyof Data['links']) => string[];
  fontsOf: (personId: string) => Row[];
  peopleOf: (fontId: string) => Row[];
  personById: Map<string, Row>;
  fontById: Map<string, Row>;
};

const DataContext = createContext<Ctx | null>(null);

const byId = (rows: Row[]) => new Map(rows.map((r) => [String(r.id), r]));

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [fonts, people, awards, scripts, genres, styles, types, languages, groups, groupLangs, ld, ls, lg, lst, lt, la, ll] = await Promise.all([
        db.all('fonts'), db.all('designers'), db.all('awards'), db.all('scripts'), db.all('genres'), db.all('styles'), db.all('types'),
        db.all('languages'), db.all('language_groups'), db.all('language_group_languages'),
        db.all('font_designers'), db.all('font_scripts'), db.all('font_genres'), db.all('font_styles'), db.all('font_types'),
        db.all('font_awards'), db.all('font_languages'),
      ]);
      let profiles: Row[] | null = null;
      try { profiles = await db.all('profiles'); } catch { profiles = null; }
      const sortTags = (t: Row[]) => (t as Tag[]).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      setData({
        fonts: fonts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
        people: people.sort((a, b) => String(a.name).localeCompare(String(b.name))),
        awards: awards.sort((a, b) => String(a.name).localeCompare(String(b.name))),
        scripts: sortTags(scripts), genres: sortTags(genres), styles: sortTags(styles), types: sortTags(types),
        languages: sortTags(languages), groups: sortTags(groups), groupLangs,
        links: {
          designers: ld.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
          scripts: ls, genres: lg, styles: lst, types: lt, awards: la, languages: ll,
        },
        profiles,
        hasCountry: people.length > 0 && 'country' in people[0],
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo<Ctx>(() => {
    const personById = byId(data?.people ?? []);
    const fontById = byId(data?.fonts ?? []);
    const index = new Map<string, Map<string, string[]>>();
    if (data) {
      for (const [kind, { key }] of Object.entries(LINK_TABLES)) {
        const m = new Map<string, string[]>();
        for (const r of data.links[kind as keyof Data['links']]) {
          const list = m.get(String(r.font_id)) ?? [];
          if (!list.includes(String(r[key]))) list.push(String(r[key]));
          m.set(String(r.font_id), list);
        }
        index.set(kind, m);
      }
    }
    const fontsByPerson = new Map<string, Row[]>();
    for (const r of data?.links.designers ?? []) {
      const f = fontById.get(String(r.font_id));
      if (!f) continue;
      const list = fontsByPerson.get(String(r.designer_id)) ?? [];
      if (!list.includes(f)) list.push(f);
      fontsByPerson.set(String(r.designer_id), list);
    }
    return {
      data, error, reload, personById, fontById,
      linked: (fontId, kind) => index.get(kind)?.get(fontId) ?? [],
      fontsOf: (personId) => fontsByPerson.get(personId) ?? [],
      peopleOf: (fontId) => (index.get('designers')?.get(fontId) ?? []).map((id) => personById.get(id)).filter(Boolean) as Row[],
    };
  }, [data, error, reload]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}

/** Image URL for a stored path; small sizes go through the site's resizer. */
export function img(path: string | null | undefined, w?: 256 | 384 | 640 | 1080): string {
  if (!path) return '';
  if (demoUrls.has(path)) return demoUrls.get(path)!;
  if (/^https?:/.test(path)) return path;
  return w ? thumbUrl(path, w) : storageUrl(path);
}

/** First image to show for a font. */
export const coverOf = (f: Row): string => String(f.cover || (Array.isArray(f.images) ? f.images[0] : '') || '');

/** Normalised key used to spot duplicates: "Elize", "elize-1" and "ELIZE " all match. */
export const dupKey = (s: string) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[-_\s]*\d+$/, '').replace(/\b(font|typeface|arabic|family)\b/g, '').replace(/[^a-z0-9؀-ۿ]/g, '');
