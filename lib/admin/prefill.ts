/** A font draft handed to the editor — from a pasted link, a submission or the Font Intake page. */
export type Prefill = {
  name?: string;
  description?: string;
  year?: number | string | null;
  links?: string[];
  source?: string;
  designers?: string[];
  images?: string[];
  /** images already in Fahress storage (uploaded with a submission) */
  stored?: string[];
  license?: string;
  submissionId?: string;
};

export function encodePrefill(p: Prefill): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePrefill(s: string | null | undefined): Prefill | null {
  if (!s) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === 'object' ? (v as Prefill) : null;
  } catch {
    return null;
  }
}

export const newFontHref = (p: Prefill) => `/dashboard/fonts/new?from=${encodePrefill(p)}`;
