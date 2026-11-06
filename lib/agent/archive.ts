/**
 * Reading the Fahress archive for the agent: search, records, missing data, statistics and possible duplicates.
 * Works on a snapshot of the tables (loaded with the person's own permissions) and returns only
 * the fields each answer needs, a page at a time — never the whole database.
 */
import { SHARED_HOSTS, hostOf, matchName, normalize, profileKey, skeleton } from './text';

export type FontRow = {
  id: string; name: string; slug: string; status: string; year: number | null; weights: number | null; is_variable: boolean | null; license: string | null;
  cover: string | null; images: string[] | null; purchase_links: string[] | null; case_studies: string[] | null; source_url: string | null;
  language_group: string[] | null; description: string | null; description_ar?: string | null; created_at: string; updated_at: string | null;
};
export type PersonRow = {
  id: string; name: string; slug: string; type: string; country: string | null; logo: string | null; bio: string | null; bio_ar?: string | null;
  social_links: Record<string, string | null> | null; created_at: string; updated_at: string | null;
};
export type Tag = { id: string; name: string };
export type Snapshot = {
  fonts: FontRow[];
  people: PersonRow[];
  links: { designers: { font_id: string; designer_id: string }[]; scripts: L[]; genres: L[]; styles: L[]; types: L[]; languages: L[]; awards: (L & { url: string | null })[] };
  tags: { scripts: Tag[]; genres: Tag[]; styles: Tag[]; types: Tag[]; awards: Tag[]; language_groups: Tag[] };
  arabicFields: boolean;
};
type L = { font_id: string; tag_id: string };
export type EntityType = 'font' | 'designer' | 'foundry';
export const LIVE = new Set(['published', 'featured']);

export class Index {
  fontById = new Map<string, FontRow>();
  personById = new Map<string, PersonRow>();
  creditsOf = new Map<string, string[]>(); // font → people
  worksOf = new Map<string, string[]>(); // person → fonts
  tagsOf = new Map<string, Map<string, string[]>>(); // kind → font → tag ids
  tagName = new Map<string, Map<string, string>>();
  constructor(public s: Snapshot, public seeDrafts: boolean) {
    for (const f of s.fonts) this.fontById.set(f.id, f);
    for (const p of s.people) this.personById.set(p.id, p);
    for (const l of s.links.designers) {
      push(this.creditsOf, l.font_id, l.designer_id);
      push(this.worksOf, l.designer_id, l.font_id);
    }
    for (const kind of ['scripts', 'genres', 'styles', 'types', 'languages', 'awards'] as const) {
      const m = new Map<string, string[]>();
      for (const l of s.links[kind]) push(m, l.font_id, String(l.tag_id));
      this.tagsOf.set(kind, m);
    }
    for (const [kind, list] of Object.entries(s.tags)) this.tagName.set(kind, new Map(list.map((t) => [String(t.id), t.name])));
  }
  visible(f: FontRow) { return this.seeDrafts || LIVE.has(f.status); }
  fonts() { return this.s.fonts.filter((f) => this.visible(f)); }
  kindOf(p: PersonRow): EntityType { return p.type === 'foundry' ? 'foundry' : 'designer'; }
  tags(kind: string, fontId: string) { return (this.tagsOf.get(kind)?.get(fontId) ?? []).map((id) => ({ id, name: this.tagName.get(kind === 'languages' ? 'language_groups' : kind)?.get(id) ?? id })); }
  credits(fontId: string) { return (this.creditsOf.get(fontId) ?? []).map((id) => this.personById.get(id)).filter(Boolean) as PersonRow[]; }
  works(personId: string) { return (this.worksOf.get(personId) ?? []).map((id) => this.fontById.get(id)).filter((f): f is FontRow => !!f && this.visible(f)); }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) { const l = m.get(k); if (l) { if (!l.includes(v)) l.push(v); } else m.set(k, [v]); }
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const clip = (s: unknown, n: number) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const year = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/* ---------- search ---------- */
export type SearchHit = { type: EntityType; id: string; name: string; status?: string; year?: number | null; credits?: string[]; fonts?: number; country?: string | null; match: string; score: number };

export function searchArchive(ix: Index, q: { query: string; kind?: 'font' | 'designer' | 'foundry' | 'any'; status?: string[]; limit?: number; offset?: number }) {
  const kind = q.kind ?? 'any';
  const hits: SearchHit[] = [];
  if (kind === 'any' || kind === 'font') {
    for (const f of ix.fonts()) {
      if (q.status?.length && !q.status.includes(f.status)) continue;
      const m = matchName(q.query, [f.name, f.slug.replace(/-/g, ' ')]);
      if (!m.score) continue;
      hits.push({ type: 'font', id: f.id, name: f.name, status: f.status, year: f.year, credits: ix.credits(f.id).map((p) => p.name), match: m.why, score: m.score + (LIVE.has(f.status) ? 1 : 0) });
    }
  }
  if (kind !== 'font') {
    for (const p of ix.s.people) {
      const t = ix.kindOf(p);
      if (kind !== 'any' && kind !== t) continue;
      const m = matchName(q.query, [p.name, p.slug.replace(/-/g, ' ')]);
      if (!m.score) continue;
      hits.push({ type: t, id: p.id, name: p.name, country: p.country, fonts: ix.works(p.id).length, match: m.why, score: m.score });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const limit = Math.min(q.limit ?? 10, 25), offset = q.offset ?? 0;
  // more than one strong match of different records = say so, so the agent asks which one
  const strong = hits.filter((h) => h.score >= 80);
  return { total: hits.length, offset, results: hits.slice(offset, offset + limit), ambiguous: strong.length > 1 && strong[0].score === strong[1].score };
}

/* ---------- one record ---------- */
export function getRecord(ix: Index, type: EntityType, id: string, imageUrl: (p: string) => string) {
  if (type === 'font') {
    const f = ix.fontById.get(id);
    if (!f || !ix.visible(f)) return null;
    const images = arr(f.images);
    return {
      type: 'font', id: f.id, name: f.name, slug: f.slug, status: f.status, site_url: LIVE.has(f.status) ? `https://fahress.com/fonts/${f.slug}` : null,
      year: f.year, weights: f.weights, is_variable: f.is_variable, license: f.license,
      description: clip(f.description, 3000) || null, ...(ix.s.arabicFields ? { description_ar: clip(f.description_ar, 3000) || null } : {}),
      credits: ix.credits(f.id).map((p) => ({ id: p.id, name: p.name, type: ix.kindOf(p) })),
      scripts: ix.tags('scripts', f.id), styles: ix.tags('styles', f.id), types: ix.tags('types', f.id), genres: ix.tags('genres', f.id),
      language_groups: arr(f.language_group).map((g) => ({ id: g, name: ix.tagName.get('language_groups')?.get(g) ?? g })),
      awards: ix.s.links.awards.filter((a) => a.font_id === f.id).map((a) => ({ id: a.tag_id, name: ix.tagName.get('awards')?.get(String(a.tag_id)) ?? a.tag_id, url: a.url })),
      purchase_links: arr(f.purchase_links), case_studies: arr(f.case_studies), source_url: f.source_url,
      cover: f.cover, images: images.slice(0, 24).map((p) => ({ path: p, url: imageUrl(p) })), image_count: images.length,
      added_to_fahress: year(f.created_at), last_edited: year(f.updated_at),
    };
  }
  const p = ix.personById.get(id);
  if (!p) return null;
  const works = ix.works(p.id);
  return {
    type: ix.kindOf(p), id: p.id, name: p.name, slug: p.slug, site_url: `https://fahress.com/${p.type === 'foundry' ? 'foundries' : 'designers'}/${p.slug}`,
    country: p.country, bio: clip(p.bio, 3000) || null, ...(ix.s.arabicFields ? { bio_ar: clip(p.bio_ar, 3000) || null } : {}),
    links: Object.fromEntries(Object.entries(p.social_links ?? {}).filter(([, v]) => v)), photo: p.logo ? { path: p.logo, url: imageUrl(p.logo) } : null,
    fonts: works.slice(0, 40).map((f) => ({ id: f.id, name: f.name, status: f.status, year: f.year })), font_count: works.length,
    collaborators: [...new Set(works.flatMap((f) => ix.credits(f.id).filter((x) => x.id !== p.id).map((x) => x.name)))].slice(0, 20),
    added_to_fahress: year(p.created_at),
  };
}

/* ---------- missing data ---------- */
export const MISSING_FIELDS = ['year', 'description', 'description_ar', 'credit', 'cover', 'weights', 'script', 'genre', 'buy_link', 'languages', 'bio', 'bio_ar', 'photo', 'country'] as const;
export type MissingField = (typeof MISSING_FIELDS)[number];
const PERSON_FIELDS = new Set<MissingField>(['bio', 'bio_ar', 'photo', 'country']);

export function findIncomplete(ix: Index, q: { field: MissingField; scope?: 'live' | 'all' | 'drafts'; kind?: 'designer' | 'foundry' | 'any'; limit?: number; offset?: number }) {
  const limit = Math.min(q.limit ?? 20, 50), offset = q.offset ?? 0;
  if (PERSON_FIELDS.has(q.field)) {
    if ((q.field === 'bio_ar') && !ix.s.arabicFields) return { field: q.field, total: 0, note: 'The Arabic bio field isn’t in the database yet.', results: [] };
    const missing = ix.s.people.filter((p) => (q.kind ?? 'any') === 'any' || ix.kindOf(p) === q.kind).filter((p) =>
      q.field === 'bio' ? !String(p.bio ?? '').trim() : q.field === 'bio_ar' ? !String(p.bio_ar ?? '').trim() : q.field === 'photo' ? !p.logo : !p.country);
    return { field: q.field, total: missing.length, offset, results: missing.slice(offset, offset + limit).map((p) => ({ type: ix.kindOf(p), id: p.id, name: p.name, fonts: ix.works(p.id).length })) };
  }
  if (q.field === 'description_ar' && !ix.s.arabicFields) return { field: q.field, total: 0, note: 'The Arabic description field isn’t in the database yet.', results: [] };
  const scope = q.scope ?? 'live';
  const pool = ix.fonts().filter((f) => scope === 'all' || (scope === 'live' ? LIVE.has(f.status) : !LIVE.has(f.status)));
  const has = (f: FontRow): boolean => {
    switch (q.field) {
      case 'year': return !!f.year;
      case 'description': return !!String(f.description ?? '').trim();
      case 'description_ar': return !!String(f.description_ar ?? '').trim();
      case 'credit': return ix.credits(f.id).length > 0;
      case 'cover': return !!(f.cover || arr(f.images)[0]);
      case 'weights': return !!f.weights;
      case 'script': return ix.tags('scripts', f.id).length > 0;
      case 'genre': return ix.tags('genres', f.id).length > 0;
      case 'buy_link': return f.license === 'custom' || arr(f.purchase_links).length > 0;
      case 'languages': return arr(f.language_group).length > 0;
      default: return true;
    }
  };
  const missing = pool.filter((f) => !has(f));
  return {
    field: q.field, scope, total: missing.length, out_of: pool.length, offset,
    results: missing.slice(offset, offset + limit).map((f) => ({ type: 'font', id: f.id, name: f.name, status: f.status, credits: ix.credits(f.id).map((p) => p.name), source_url: f.source_url })),
  };
}

/* ---------- statistics ---------- */
export function archiveStats(ix: Index) {
  const by = (list: string[]) => list.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const fonts = ix.fonts();
  const years = fonts.map((f) => f.year).filter((y): y is number => !!y);
  return {
    fonts: { total: fonts.length, by_status: by(fonts.map((f) => f.status)), by_license: by(fonts.map((f) => String(f.license ?? 'unknown'))), variable: fonts.filter((f) => f.is_variable).length,
      with_year: years.length, earliest_year: years.length ? Math.min(...years) : null, latest_year: years.length ? Math.max(...years) : null },
    designers: ix.s.people.filter((p) => ix.kindOf(p) === 'designer').length,
    foundries: ix.s.people.filter((p) => ix.kindOf(p) === 'foundry').length,
    awards: ix.s.tags.awards.length, awarded_fonts: new Set(ix.s.links.awards.map((a) => a.font_id).filter((id) => ix.fontById.has(id) && ix.visible(ix.fontById.get(id)!))).size,
    scripts: ix.s.tags.scripts.map((t) => ({ name: t.name, fonts: fonts.filter((f) => ix.tags('scripts', f.id).some((x) => x.id === String(t.id))).length })),
    note: ix.seeDrafts ? 'Counts include drafts and fonts in review.' : 'Counts include only published fonts.',
  };
}

/* ---------- duplicates ---------- */
export type DupGroup = { type: EntityType; records: { id: string; name: string; status?: string; detail: string }[]; signals: string[]; against: string[]; strength: 'strong' | 'possible' };

/** Possible duplicates. A similar name alone is only "possible"; the same website, shared works or credits make it "strong";
 *  a different type (designer vs foundry) or different websites count against. */
export function findDuplicates(ix: Index, q: { type: 'font' | 'person'; id?: string; limit?: number }): DupGroup[] {
  const groups: DupGroup[] = [];
  if (q.type === 'person') {
    const people = ix.s.people;
    const bySkel = new Map<string, PersonRow[]>();
    for (const p of people) {
      // the name without generic words ("studio", "type"…); long names also match by consonants (other spellings)
      const core = normalize(p.name).replace(/\b(studio|foundry|type|types|design|designs|lt|fonts?|typefaces?|co)\b/g, '').replace(/\s+/g, '');
      if (core.length < 3) continue;
      push(bySkel, core.length >= 6 ? `s:${skeleton(core)}` : `c:${core}`, p);
    }
    for (const list of bySkel.values()) {
      if (list.length < 2) continue;
      if (q.id && !list.some((p) => p.id === q.id)) continue;
      const signals: string[] = ['similar names'];
      const against: string[] = [];
      const keys = list.map((p) => new Set(Object.values(p.social_links ?? {}).map(profileKey).filter(Boolean)));
      const shared = [...keys[0]].filter((k) => keys.slice(1).every((s) => s.has(k)));
      if (shared.length) signals.push(`same profile link (${shared.join(', ')})`);
      const sites = keys.map((s) => [...s].filter((k) => !k.includes('/') && !SHARED_HOSTS.has(k)));
      if (sites.every((s) => s.length) && !sites.slice(1).every((s) => s.some((x) => sites[0].includes(x)))) against.push('different own websites');
      if (new Set(list.map((p) => ix.kindOf(p))).size > 1) against.push('one is a designer and the other a foundry');
      const works = list.map((p) => new Set(ix.worksOf.get(p.id) ?? []));
      if ([...works[0]].some((f) => works.slice(1).some((w) => w.has(f)))) signals.push('credited on the same font');
      if (list.every((p) => p.country) && new Set(list.map((p) => p.country)).size > 1) against.push('different countries');
      groups.push({ type: ix.kindOf(list[0]), records: list.map((p) => ({ id: p.id, name: p.name, detail: `${ix.kindOf(p)} · ${ix.works(p.id).length} fonts${p.country ? ` · ${p.country}` : ''}` })), signals, against,
        strength: signals.length >= 2 && !against.length ? 'strong' : 'possible' });
    }
  } else {
    const byKey = new Map<string, FontRow[]>();
    for (const f of ix.fonts()) { const k = normalize(f.name).replace(/\b(font|typeface|arabic|family|pro|std|vf|variable)\b/g, '').replace(/\s+\d+$/, '').replace(/\s+/g, ''); if (k.length >= 2) push(byKey, k, f); }
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      if (q.id && !list.some((f) => f.id === q.id)) continue;
      const signals = ['same name'];
      const against: string[] = [];
      const credits = list.map((f) => new Set(ix.creditsOf.get(f.id) ?? []));
      if ([...credits[0]].some((c) => credits.slice(1).every((s) => s.has(c)))) signals.push('same designer or foundry');
      else if (credits.every((c) => c.size) ) against.push('different designers/foundries');
      const hosts = list.map((f) => new Set([f.source_url, ...arr(f.purchase_links)].map(hostOf).filter(Boolean)));
      if ([...hosts[0]].some((h) => !SHARED_HOSTS.has(h) && hosts.slice(1).every((s) => s.has(h)))) signals.push('same shop or website');
      if (list.some((f) => /-\d+$/.test(f.slug))) signals.push('a copy has a numbered address (-1, -2)');
      groups.push({ type: 'font', records: list.map((f) => ({ id: f.id, name: f.name, status: f.status, detail: `${f.status} · ${ix.credits(f.id).map((p) => p.name).join(', ') || 'no credit'} · /${f.slug}` })), signals, against,
        strength: signals.length >= 2 && !against.length ? 'strong' : 'possible' });
    }
  }
  return groups.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'strong' ? -1 : 1)).slice(0, Math.min(q.limit ?? 10, 30));
}

export function listTaxonomy(ix: Index, kind: keyof Snapshot['tags']) {
  return ix.s.tags[kind].map((t) => ({ id: String(t.id), name: t.name }));
}
