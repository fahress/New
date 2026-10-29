const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

/** Public URL of a file in the Supabase "studio" storage bucket. */
export function storageUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  const clean = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/studio/${clean}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Display fixes for tag names stored with typos or trailing spaces. */
const LABELS: Record<string, string> = { Condescend: 'Condensed' };
export const label = (name: string) => LABELS[name.trim()] ?? name.trim();

export const licenseLabel = (l: string) =>
  ({ paid: 'Paid', free: 'Free', custom: 'Custom' } as Record<string, string>)[l] ?? l;

export function weightsLabel(w: number | null, variable: boolean): string {
  const parts: string[] = [];
  if (w) parts.push(`${w} ${w === 1 ? 'weight' : 'weights'}`);
  if (variable) parts.push('Variable');
  return parts.join(' · ');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function excerpt(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

export const SCRIPT_ARABIC: Record<string, string> = {
  naskh: 'نسخ',
  kufi: 'كوفي',
  ruqa: 'رقعة',
  thulut: 'ثلث',
  thuluth: 'ثلث',
  diwani: 'ديواني',
  nastaliq: 'نستعليق',
  maghribi: 'مغربي',
};
