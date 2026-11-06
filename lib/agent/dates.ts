/**
 * Finding dates on a page and saying what each one is.
 * A page's publication date is not a font's release date, an update is not the first release,
 * an award year is not a release year and a copyright line is not a design date — so every date
 * comes with its kind, its precision (year / month / day) and the words around it.
 */

export type DateKind = 'release' | 'first_seen' | 'update' | 'design' | 'page_published' | 'page_updated' | 'award' | 'copyright' | 'other';
export type Precision = 'year' | 'month' | 'day';
export type FoundDate = { value: string; precision: Precision; kind: DateKind; from: 'structured' | 'meta' | 'text'; evidence: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  'كانون الثاني': 1, شباط: 2, آذار: 3, نيسان: 4, أيار: 5, حزيران: 6, تموز: 7, آب: 8, أيلول: 9, 'تشرين الأول': 10, 'تشرين الثاني': 11, 'كانون الأول': 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const yearOk = (y: number) => y >= 1900 && y <= new Date().getFullYear() + 1;

/** Parses an ISO-like or written date, keeping only the precision the text really has. */
export function parseDate(raw: string): { value: string; precision: Precision } | null {
  const s = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && yearOk(+m[1]) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return { value: `${m[1]}-${m[2]}-${m[3]}`, precision: 'day' };
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && yearOk(+m[1]) && +m[2] >= 1 && +m[2] <= 12) return { value: `${m[1]}-${m[2]}`, precision: 'month' };
  const lower = s.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const monthName = Object.keys(MONTHS).sort((a, b) => b.length - a.length).find((k) => new RegExp(`(^|[^\\p{L}])${k}\\.?($|[^\\p{L}])`, 'u').test(lower));
  const year = /\b(19\d\d|20\d\d)\b/.exec(lower)?.[1];
  if (!year || !yearOk(+year)) return null;
  if (monthName) {
    const month = MONTHS[monthName];
    const day = /\b([0-3]?\d)(st|nd|rd|th)?\b/.exec(lower.replace(year, ''))?.[1];
    if (day && +day >= 1 && +day <= 31) return { value: `${year}-${pad(month)}-${pad(+day)}`, precision: 'day' };
    return { value: `${year}-${pad(month)}`, precision: 'month' };
  }
  m = /\b(\d{1,2})\/(19\d\d|20\d\d)\b/.exec(lower);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { value: `${m[2]}-${pad(+m[1])}`, precision: 'month' };
  return { value: year, precision: 'year' };
}

const MONTH_WORDS = Object.keys(MONTHS).filter((k) => !k.includes(' ')).join('|');
const DATE_TEXT = `(?:(?:[0-3]?\\d(?:st|nd|rd|th)?\\s+)?(?:${MONTH_WORDS})\\.?,?\\s+(?:[0-3]?\\d(?:st|nd|rd|th)?,?\\s+)?(?:19|20)\\d\\d|(?:19|20)\\d\\d-\\d\\d(?:-\\d\\d)?|\\d{1,2}/(?:19|20)\\d\\d|(?:19|20)\\d\\d)`;

const CUES: { kind: DateKind; re: RegExp }[] = [
  { kind: 'award', re: /\b(award(?:ed)?|winner|won|prize|shortlist(?:ed)?|honou?rable mention|selected (?:for|in)|tdc|granshan|morisawa)\b|جائز[ةه]|فائز|فاز/i },
  { kind: 'update', re: /\b(updated?|update[ds]? (?:in|on)|last updated|version\s+\d+(?:\.\d+)*|v\d+\.\d+|revised|new version|re-?released?|expanded in)\b|تحديث|إصدار جديد|نسخة/i },
  { kind: 'design', re: /\b(designed|design(?:ing)? (?:began|started)|created|drawn|developed|started (?:in|on)|began)\b|صمم|صُمم|تصميم|رسم/i },
  { kind: 'release', re: /\b(released?|release (?:date|year)|launch(?:ed)?|available since|first published|publication date|published by \S+ in|introduced|debut(?:ed)?)\b|صدر|أصدر|إصدار|أطلق|إطلاق|طرح|نُشر/i },
  { kind: 'copyright', re: /©|\(c\)|\bcopyright\b|حقوق/i },
];

/** Dates stated in the page's text, each with the cue that tells what kind of date it is. */
export function datesInText(text: string, max = 25): FoundDate[] {
  const out: FoundDate[] = [];
  const re = new RegExp(DATE_TEXT, 'giu');
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 70), at);
    const after = text.slice(at + m[0].length, at + m[0].length + 25);
    const parsed = parseDate(m[0]);
    if (!parsed) continue;
    // the cue closest to the date (in the same sentence) decides
    const sentence = before.split(/[.!?\n؟]/).pop() ?? before;
    let kind: DateKind = 'other';
    let bestPos = -1;
    for (const c of CUES) {
      const all = [...sentence.matchAll(new RegExp(c.re.source, c.re.flags.includes('g') ? c.re.flags : c.re.flags + 'g'))];
      const last = all[all.length - 1];
      if (last && (last.index ?? -1) > bestPos) { bestPos = last.index ?? 0; kind = c.kind; }
    }
    if (kind === 'other' && /^\s*[-–]\s*(19|20)\d\d/.test(after)) continue; // ranges such as 2010–2015 are usually lists, skip
    out.push({ ...parsed, kind, from: 'text', evidence: `${sentence.trim().slice(-60)} ${m[0]}${after.split(/[.!?\n]/)[0]}`.trim().slice(0, 160) });
    if (out.length >= max) break;
  }
  return out;
}

type Ld = Record<string, unknown>;

/** Dates from meta tags and structured data. These describe the page, not necessarily the font. */
export function datesInMeta(meta: Record<string, string[]>, ld: Ld[], html = ''): FoundDate[] {
  const out: FoundDate[] = [];
  const add = (raw: unknown, kind: DateKind, from: FoundDate['from'], label: string) => {
    if (typeof raw !== 'string') return;
    const p = parseDate(raw);
    if (p) out.push({ ...p, kind, from, evidence: `${label}: ${raw}`.slice(0, 160) });
  };
  for (const k of ['article:published_time', 'og:published_time', 'datepublished', 'date', 'dc.date', 'pubdate']) for (const v of meta[k] ?? []) add(v, 'page_published', 'meta', k);
  for (const k of ['article:modified_time', 'og:updated_time', 'datemodified', 'last-modified']) for (const v of meta[k] ?? []) add(v, 'page_updated', 'meta', k);
  for (const x of ld) {
    const type = String(x['@type'] ?? 'Thing');
    add(x.datePublished, 'page_published', 'structured', `${type}.datePublished`);
    add(x.dateCreated, 'page_published', 'structured', `${type}.dateCreated`);
    add(x.dateModified, 'page_updated', 'structured', `${type}.dateModified`);
    add(x.releaseDate, 'release', 'structured', `${type}.releaseDate`);
  }
  for (const m of html.matchAll(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/gi)) add(m[1], 'page_published', 'meta', '<time>');
  const seen = new Set<string>();
  return out.filter((d) => { const k = `${d.kind}:${d.value}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

export const DATE_KIND_HELP: Record<DateKind, string> = {
  release: 'the text says the font was released/launched then',
  first_seen: 'earliest dated mention found — not proof of first release',
  update: 'an update or new version, not the first release',
  design: 'when it was designed/drawn — not the release',
  page_published: 'when this page was published — not necessarily the font’s release',
  page_updated: 'when this page was last changed',
  award: 'an award year — not the release year',
  copyright: 'a copyright line — not a release or design date',
  other: 'a date without a clear meaning',
};
