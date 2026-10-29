import type { Row } from './db';
import { coverOf, dupKey, type Data } from './store';

export type Issue = { id: string; label: string; items: { href: string; label: string; note?: string }[] };

const fontHref = (f: Row) => `/dashboard/fonts/${f.id}`;
const personHref = (p: Row) => `/dashboard/${p.type === 'foundry' ? 'foundries' : 'designers'}/${p.id}`;

/** Groups of fonts whose names look like the same typeface (e.g. "Elize" and "elize-1"). */
export function duplicateFonts(data: Data): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const f of data.fonts) {
    const k = dupKey(String(f.name));
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export function duplicatePeople(data: Data): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const p of data.people) {
    const k = dupKey(String(p.name)).replace(/(studio|foundry|type|design|lt)$/g, '');
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Everything in the archive that's incomplete, grouped for the overview. */
export function issues(data: Data, linked: (id: string, k: keyof Data['links']) => string[], fontsOf: (id: string) => Row[]): Issue[] {
  const live = data.fonts.filter((f) => f.status === 'published' || f.status === 'featured');
  const fontItem = (f: Row) => ({ href: fontHref(f), label: String(f.name) });
  const personItem = (p: Row) => ({ href: personHref(p), label: String(p.name), note: p.type === 'foundry' ? 'Foundry' : 'Designer' });

  const broken = new Set((data.linkChecks ?? []).filter((l) => l.verdict === 'broken').map((l) => String(l.url)));
  const list: Issue[] = [
    {
      id: 'inbox',
      label: 'New in the inbox (submissions, corrections, claims)',
      items: (data.submissions ?? []).filter((x) => x.status === 'new').map((x) => ({ href: '/dashboard/inbox', label: String((x.payload as Row)?.name ?? x.kind), note: String(x.kind).replace('_', ' ') })),
    },
    {
      id: 'broken',
      label: 'Broken buy links (from the last link check)',
      items: data.fonts.filter((f) => ((f.purchase_links as string[]) ?? []).some((u) => broken.has(u))).map(fontItem),
    },
    {
      id: 'dups',
      label: 'Possible duplicate fonts',
      items: duplicateFonts(data).flatMap((g) => g.map((f) => ({ href: '/dashboard/duplicates', label: String(f.name), note: `${f.slug} · ${f.status}` }))),
    },
    {
      id: 'dup-people',
      label: 'Possible duplicate designers or foundries',
      items: duplicatePeople(data).flatMap((g) => g.map((p) => ({ ...personItem(p), href: '/dashboard/duplicates' }))),
    },
    { id: 'no-credit', label: 'Live fonts with no designer or foundry credited', items: live.filter((f) => !linked(String(f.id), 'designers').length).map(fontItem) },
    { id: 'no-cover', label: 'Fonts without a presentation image', items: data.fonts.filter((f) => !coverOf(f)).map(fontItem) },
    { id: 'no-link', label: 'Live fonts without a link to buy or download', items: live.filter((f) => !(Array.isArray(f.purchase_links) && f.purchase_links.filter(Boolean).length)).map(fontItem) },
    { id: 'no-year', label: 'Live fonts without a release year', items: live.filter((f) => !f.year).map(fontItem) },
    { id: 'no-script', label: 'Live fonts without a script', items: live.filter((f) => !linked(String(f.id), 'scripts').length).map(fontItem) },
  ];
  if (data.hasCountry) {
    list.push({ id: 'no-country', label: 'Designers and foundries without a country', items: data.people.filter((p) => !p.country).map(personItem) });
  }
  list.push(
    { id: 'no-photo', label: 'Designers and foundries without a photo or logo', items: data.people.filter((p) => !p.logo).map(personItem) },
    { id: 'no-bio', label: 'Designers and foundries without a bio', items: data.people.filter((p) => !String(p.bio ?? '').trim()).map(personItem) },
    { id: 'no-fonts', label: 'Designers and foundries with no fonts', items: data.people.filter((p) => !fontsOf(String(p.id)).length).map(personItem) },
  );
  return list;
}
