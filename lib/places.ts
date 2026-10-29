import places from '@/data/places.json';

/**
 * Where each designer is from, and where they are based when that differs.
 * Researched from Fahress biographies, the designers' public profiles and type-industry sources.
 * Edit data/places.json to correct or add an entry (key = designer or foundry slug).
 */
export type Place = { from?: string; based?: string };

const PLACES = places as Record<string, Place>;

export const placeOf = (slug: string): Place => PLACES[slug] ?? {};

/** The country shown on the site: where a designer is from (for foundries, their country). */
export const countryOf = (p: { from?: string }) => p.from ?? '';
