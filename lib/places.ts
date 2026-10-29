import places from '@/data/places.json';

/**
 * Where each designer is from, and where they are based when that differs.
 * Researched from Fahress biographies, the designers' public profiles and type-industry sources.
 * Edit data/places.json to correct or add an entry (key = designer or foundry slug).
 */
export type Place = { from?: string; based?: string };

const PLACES = places as Record<string, Place>;

export const placeOf = (slug: string): Place => PLACES[slug] ?? {};

/** One-line label, e.g. "Egypt · based in Latvia", "Iran", "Based in Turkey". */
export function placeLabel(p: Place): string {
  if (p.from && p.based && p.based !== p.from) return `${p.from} · based in ${p.based}`;
  if (p.from) return p.from;
  if (p.based) return `Based in ${p.based}`;
  return '';
}

/** The single country used for filtering: origin first, otherwise where they work. */
export const countryOf = (p: Place) => p.from ?? p.based ?? '';
