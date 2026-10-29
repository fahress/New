import type { Archive, Font, Person } from './types';
import type { CardFont, CardPerson } from '@/components/FontCard';
import { label, licenseLabel } from './format';

export function creditOf(a: Archive, f: Font): string {
  const people = f.people.map((id) => a.personById.get(id)).filter(Boolean);
  const designers = people.filter((p) => p!.type === 'designer').map((p) => p!.name);
  const foundries = people.filter((p) => p!.type === 'foundry').map((p) => p!.name);
  return [...designers, ...foundries].join(' · ');
}

export function tagNames(list: { id: number; name: string }[], ids: number[]): string[] {
  return ids.map((id) => list.find((t) => t.id === id)?.name).filter((x): x is string => !!x).map(label);
}

export function toCard(a: Archive, f: Font): CardFont {
  const award = f.awards.length ? a.awards.find((w) => w.id === f.awards[0].awardId)?.name ?? null : null;
  return {
    slug: f.slug,
    name: f.name,
    cover: f.cover,
    credit: creditOf(a, f),
    people: peopleOf(a, f).map(toCardPerson),
    script: shortList(tagNames(a.scripts, f.scripts)),
    license: licenseLabel(f.license),
    award,
    badges: tagNames(a.types, f.types).slice(0, 2),
  };
}

export function shortList(names: string[], max = 2): string {
  if (!names.length) return '—';
  return names.length > max ? `${names.slice(0, max).join(' / ')} +${names.length - max}` : names.join(' / ');
}

/** Designers first, then foundries — the order used in every credit line. */
export function peopleOf(a: Archive, f: Font): Person[] {
  const people = f.people.map((id) => a.personById.get(id)).filter((p): p is Person => !!p);
  return [...people.filter((p) => p.type === 'designer'), ...people.filter((p) => p.type === 'foundry')];
}

export const toCardPerson = (p: Person): CardPerson => ({
  slug: p.slug,
  name: p.name,
  type: p.type,
  logo: p.logo,
  from: p.from,
  count: p.fontIds.length,
});
