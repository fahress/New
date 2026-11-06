/**
 * Text normalisation for matching names across Arabic, Persian and Latin spellings
 * ("29LT Zawi", "زاوي", "Zaawi"), shared by the archive search and the duplicate finder.
 */

const AR_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g; // harakat, Quranic marks, tatweel

/** Arabic/Persian letter variants folded together, diacritics and tatweel removed. */
export function foldArabic(s: string): string {
  return s
    .replace(AR_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ی/g, 'ي').replace(/ې|ۍ/g, 'ي')
    .replace(/ک/g, 'ك').replace(/گ/g, 'ك')
    .replace(/ة/g, 'ه').replace(/ۀ/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/** Lower-case, accents removed, Arabic folded, punctuation turned into spaces. */
export function normalize(s: unknown): string {
  return foldArabic(String(s ?? ''))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`ʿʾ]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();
}

const MAP: Record<string, string> = {
  ا: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: '', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y', پ: 'p', چ: 'ch', ژ: 'zh', ڤ: 'v',
};

/** A rough Latin skeleton of an Arabic name, to compare with Latin spellings. */
export function transliterate(s: string): string {
  return [...foldArabic(s)].map((c) => (c in MAP ? MAP[c] : /[a-z0-9 ]/i.test(c) ? c.toLowerCase() : c === ' ' ? ' ' : '')).join('');
}

/** Consonant skeleton used for loose matching: vowels and doubled letters dropped, common digraphs unified. */
export function skeleton(s: string): string {
  const latin = /[؀-ۿ]/.test(s) ? transliterate(s) : normalize(s);
  return latin
    .replace(/ph/g, 'f').replace(/ou|oo|uu/g, 'u').replace(/ee|ii/g, 'i').replace(/q/g, 'k').replace(/c(?=[aou])/g, 'k')
    .replace(/(kh|gh|sh|th|dh)/g, (m) => m[0])
    .replace(/[aeiouyw\s]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const NOISE = /\b(font|fonts|typeface|type|arabic|family|pro|std|vf|variable|regular|the|خط|فونت)\b/g;

/** Keys used to match a query against a name: exact normalised, without generic words, and skeleton. */
export function nameKeys(s: string): { norm: string; core: string; skel: string } {
  const norm = normalize(s);
  const core = norm.replace(NOISE, ' ').replace(/\s+/g, ' ').trim() || norm;
  return { norm, core, skel: skeleton(core) };
}

/** Bounded edit distance (returns max+1 when over the bound). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export type Match = { score: number; why: string };

/**
 * How well a name (and its other spellings) matches a query. Higher is better; 0 means no match.
 * 100 exact · 90 exact without generic words · 80 starts with · 70 word match · 60 contains · 50 same skeleton · 40 close spelling
 */
export function matchName(query: string, names: string[]): Match {
  const q = nameKeys(query);
  if (!q.norm) return { score: 0, why: '' };
  let best: Match = { score: 0, why: '' };
  const take = (score: number, why: string) => { if (score > best.score) best = { score, why }; };
  for (const name of names) {
    if (!name) continue;
    const n = nameKeys(name);
    if (!n.norm) continue;
    if (n.norm === q.norm) take(100, 'exact name');
    else if (n.core === q.core && q.core) take(90, 'same name without generic words');
    else if (n.norm.startsWith(q.norm) || (q.core && n.core.startsWith(q.core))) take(80, 'name starts with the search');
    else if (n.norm.split(' ').includes(q.core) || q.core.split(' ').every((w) => w.length > 1 && n.norm.split(' ').includes(w))) take(70, 'all words match');
    else if (q.norm.length >= 3 && n.norm.includes(q.norm)) take(60, 'name contains the search');
    else if (q.skel.length >= 3 && n.skel === q.skel) take(50, /[؀-ۿ]/.test(query) !== /[؀-ۿ]/.test(name) ? 'same name in another script' : 'same consonants (other spelling)');
    else if (q.core.length >= 5 && editDistance(n.core, q.core, 2) <= (q.core.length >= 9 ? 2 : 1)) take(40, 'very close spelling');
  }
  return best;
}

/** Host of a link without "www.", or '' for anything that isn't a web address. */
export function hostOf(url: unknown): string {
  try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** Social sites where a shared host says nothing about being the same profile. */
export const SHARED_HOSTS = new Set(['instagram.com', 'behance.net', 'linkedin.com', 'x.com', 'twitter.com', 'facebook.com', 'dribbble.com', 'myfonts.com', 'youtube.com', 'github.com', 'fonts.google.com', 'creativemarket.com', 'payhip.com', 'gumroad.com']);

/** The identifying part of a profile link: the domain for own sites, domain + first path part for social sites. */
export function profileKey(url: unknown): string {
  const h = hostOf(url);
  if (!h) return '';
  if (!SHARED_HOSTS.has(h)) return h;
  try {
    const first = new URL(String(url)).pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
    return first ? `${h}/${first}` : '';
  } catch { return ''; }
}
