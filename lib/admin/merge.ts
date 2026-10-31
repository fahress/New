'use client';
import { db, type Row } from './db';
import { LINK_TABLES, type Data } from './store';

const RANK: Record<string, number> = { featured: 3, published: 2, pending: 1, draft: 0 };
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const union = (a: unknown, b: unknown) => [...new Set([...arr(a), ...arr(b)])];

/** The copy to keep: the most complete, then the one without "-1" in its address, then the oldest. */
export function pickKeeper(rows: Row[], score: (r: Row) => number): Row {
  return rows.slice().sort((a, b) =>
    score(b) - score(a) ||
    Number(/-\d+$/.test(String(a.slug))) - Number(/-\d+$/.test(String(b.slug))) ||
    String(a.created_at).localeCompare(String(b.created_at)),
  )[0];
}

/** Folds `losers` into `keeper`: credits, classification, awards, images and links move over; the duplicates are deleted and their addresses redirect. */
export async function mergeFonts(data: Data, keeper: Row, losers: Row[]) {
  const kid = String(keeper.id);
  const patch: Row = {};
  let images = arr(keeper.images);
  let purchase = arr(keeper.purchase_links);
  let cases = arr(keeper.case_studies);
  let groups = arr(keeper.language_group);
  let status = String(keeper.status);

  for (const loser of losers) {
    const lid = String(loser.id);
    const before = { row: loser, links: Object.fromEntries(Object.entries(LINK_TABLES).map(([k, { table }]) => [table, data.links[k as keyof Data['links']].filter((r) => String(r.font_id) === lid)])) };
    for (const [kind, { table, key }] of Object.entries(LINK_TABLES)) {
      const rows = data.links[kind as keyof Data['links']];
      const have = new Set(rows.filter((r) => String(r.font_id) === kid).map((r) => String(r[key])));
      const add = rows.filter((r) => String(r.font_id) === lid && !have.has(String(r[key])));
      if (add.length) await db.link(table, add.map((r) => ({ font_id: kid, [key]: r[key], ...(kind === 'awards' ? { url: r.url ?? null } : {}) })));
      await db.remove(table, { font_id: lid });
    }
    images = union(images, [loser.cover, ...arr(loser.images)]);
    purchase = union(purchase, loser.purchase_links);
    cases = union(cases, loser.case_studies);
    groups = union(groups, loser.language_group);
    for (const f of ['description', 'year', 'weights', 'cover', 'source_url'] as const) if (!keeper[f] && !patch[f] && loser[f]) patch[f] = loser[f];
    if ((RANK[String(loser.status)] ?? 0) > (RANK[status] ?? 0)) status = String(loser.status);
    await db.remove('fonts', { id: lid });
    if (data.redirects !== null && loser.slug && loser.slug !== keeper.slug) await db.upsert('font_redirects', [{ from_slug: loser.slug, to_slug: keeper.slug, kind: 'font' }], 'from_slug');
    await db.log({ action: 'merge', entity: 'font', entity_id: lid, label: `${loser.name} → ${keeper.name}`, before, after: { into: kid } });
  }
  await db.update('fonts', { id: kid }, { ...patch, images, purchase_links: purchase, case_studies: cases, language_group: groups, status, updated_at: new Date().toISOString() });
}

/** How much profile information a designer/foundry has: photo or logo, bio, country and links. Fonts only break ties. */
export function profileScore(p: Row, fontCount = 0) {
  const social = Object.values((p.social_links as Row) ?? {}).filter((v) => String(v ?? '').trim()).length;
  return (p.logo ? 4 : 0) + (String(p.bio ?? '').trim() ? 3 : 0) + (p.country ? 1 : 0) + social + Math.min(fontCount, 50) / 100;
}

/** Folds `losers` into `keeper`. Only the font credits move over — the keeper's name, photo, bio, country and links stay exactly as they are. The duplicates are deleted and their addresses redirect. */
export async function mergePeople(data: Data, keeper: Row, losers: Row[]) {
  const kid = String(keeper.id);
  for (const loser of losers) {
    const lid = String(loser.id);
    const credits = data.links.designers.filter((r) => String(r.designer_id) === lid);
    const have = new Set(data.links.designers.filter((r) => String(r.designer_id) === kid).map((r) => String(r.font_id)));
    const add = credits.filter((r) => !have.has(String(r.font_id)));
    if (add.length) await db.link('font_designers', add.map((r) => ({ font_id: r.font_id, designer_id: kid })));
    await db.remove('font_designers', { designer_id: lid });
    await db.remove('designers', { id: lid });
    if (data.redirects !== null && loser.slug && loser.slug !== keeper.slug) await db.upsert('font_redirects', [{ from_slug: loser.slug, to_slug: keeper.slug, kind: loser.type === 'foundry' ? 'foundry' : 'designer' }], 'from_slug');
    await db.log({ action: 'merge', entity: 'designer', entity_id: lid, label: `${loser.name} → ${keeper.name}`, before: { row: loser, credits }, after: { into: kid } });
  }
  await db.update('designers', { id: kid }, { updated_at: new Date().toISOString() });
}
