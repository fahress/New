/** Reads a font's page text and guesses its classification. Used by "Fill draft details". Every guess carries the words it was based on. */

export type Page = { title: string; description: string; text: string; ld: string };
export type Guess = {
  scripts: string[]; styles: string[]; types: string[]; genres: string[]; groups: string[];
  year: number | null; weights: number | null; variable: boolean;
  /** where each value came from: 'head' = title/description (strong), 'body' = page text */
  from: Record<string, 'head' | 'body'>;
};

/** headOnly: the word is too common in page text ("extended" language support, "pixel-perfect"…) to trust unless the title or description says it */
type Rule = { name: string; re: RegExp; minBody?: number; headOnly?: boolean };

// matched against the taxonomy names in the database (case-insensitive)
const SCRIPT_RULES: Rule[] = [
  { name: 'naskh', re: /\bnaskh(i)?\b|نسخ/gi },
  { name: 'ruqa', re: /\bruq[ʿ'’`]?a{1,2}h?\b|\briq[ʿ'’`]?a{1,2}\b|رقعة|رقعه/gi },
  { name: 'nastaliq', re: /\bnasta[ʿ'’`]?l[ie]{1,2}q\b|\bnastaleeq\b|نستعليق/gi },
  { name: 'kufi', re: /\bkuf(i|y|ic)\b|كوفي/gi },
  { name: 'maghribi', re: /\bmaghrib(i|y)\b|مغربي/gi },
  { name: 'thuluth', re: /\bthul?uth\b|\bthulth\b|ثلث/gi },
  { name: 'diwani', re: /\bd[iy]wani\b|ديواني/gi },
];
const STYLE_RULES: Rule[] = [
  { name: 'sans serif', re: /\bsans[\s-]?serif\b|\bsans\b|\bgrotesk|\bgrotesque\b/gi },
  { name: 'serif', re: /(?<!sans[\s-]?)\bserif(ed)?\b|\bmodern serif\b/gi },
  { name: 'slab', re: /\bslab\b/gi },
  { name: 'rounded', re: /\brounded\b/gi },
  { name: 'condescend', headOnly: true, re: /\bcondensed\b|\bcompressed\b|\bnarrow\b/gi },
  { name: 'extended', headOnly: true, re: /(?<!latin\s)\b(extended|expanded)\b(?!\s+(latin|additional|character|set|language|support))/gi },
  { name: 'script', headOnly: true, re: /\bscript (font|typeface)\b|\bbrush script\b|\bcursive\b/gi },
];
const TYPE_RULES: Rule[] = [
  { name: 'pixel', headOnly: true, re: /\bpixel(ated)?\b|\bbitmap\b/gi },
  { name: 'hand written', headOnly: true, re: /\bhand[\s-]?(written|writing|drawn|lettered|made)\b|\bhandwriting\b|\bbrush\b/gi },
  { name: 'stencil', re: /\bstencil\b/gi },
  { name: 'geometric', re: /\bgeometric(al)?\b/gi },
  { name: 'inline', headOnly: true, re: /\binline\b/gi },
  { name: 'shadow', headOnly: true, re: /\bshadow(ed)?\b/gi },
  { name: 'color', re: /\bcolou?r font\b|\bcolr\b|\bchromatic\b|\bopentype[\s-]svg\b/gi },
  { name: 'inktrap', re: /\bink[\s-]?traps?\b/gi },
  { name: 'rough', headOnly: true, re: /\brough\b|\bdistressed\b|\bgrunge\b|\btextured\b/gi },
  { name: 'high contrast', re: /\bhigh[\s-]contrast\b/gi },
];
const GENRE_RULES: Rule[] = [
  { name: 'display', re: /\bdisplay\b/gi },
  { name: 'headline', re: /\bheadlines?\b|\bheadings?\b/gi },
  { name: 'body text', re: /\bbody[\s-]?(text|copy)\b|\btext sizes?\b|\brunning text\b|\blong[\s-](form|texts?|reading)\b|\bsmall sizes\b|\beditorial\b|\bimmersive reading\b/gi },
];
const GROUP_RULES: Rule[] = [
  { name: 'arabic', re: /\barabic\b|عربي|العربية/gi },
  { name: 'persian', re: /\bpersian\b|\bfarsi\b|فارسی/gi },
  { name: 'urdu', re: /\burdu\b|اردو/gi },
  { name: 'kurdish', re: /\bkurdish\b|\bsorani\b|\bkurmanji\b|کوردی/gi },
  { name: 'pashto', re: /\bpasht(o|u)\b|پښتو/gi },
  { name: 'basic latin', re: /\blatin\b|\benglish\b|\bbilingual\b/gi },
  { name: 'western european languages', re: /\bwestern european\b|\bfrench\b.*\bgerman\b/gi },
  { name: 'central european languages', re: /\bcentral european\b/gi },
  { name: 'cyrillic languages', re: /\bcyrillic\b/gi },
  { name: 'tifinagh', re: /\btifinagh\b|\bamazigh\b|\bberber\b/gi },
];

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20 };
const WEIGHT_NAMES: [string, RegExp][] = [
  ['hairline', /\bhairline\b/i], ['thin', /\bthin\b/i], ['extralight', /\b(extra|ultra)[\s-]?light\b/i], ['light', /(?<!(extra|ultra|semi|demi)[\s-]?)\blight\b/i],
  ['regular', /\bregular\b|\bbook\b/i], ['medium', /\bmedium\b/i], ['semibold', /\b(semi|demi)[\s-]?bold\b/i], ['bold', /(?<!(extra|ultra|semi|demi)[\s-]?)\bbold\b/i],
  ['extrabold', /\b(extra|ultra)[\s-]?bold\b/i], ['black', /\bblack\b|\bheavy\b/i], ['extrablack', /\b(extra|ultra)[\s-]?black\b/i],
];

export function classify(page: Page, names: { scripts: Map<string, string>; styles: Map<string, string>; types: Map<string, string>; genres: Map<string, string>; groups: Map<string, string> }): Guess {
  const head = `${page.title}\n${page.description}`;
  const body = page.text;
  const from: Guess['from'] = {};
  const pick = (rules: Rule[], ids: Map<string, string>, field: string, minBody = 1) => {
    const out: string[] = [];
    for (const r of rules) {
      const id = ids.get(r.name);
      if (!id) continue;
      if (count(r.re, head)) { out.push(id); from[`${field}:${id}`] = 'head'; } else if (!r.headOnly && count(r.re, body) >= (r.minBody ?? minBody)) { out.push(id); from[`${field}:${id}`] = 'body'; }
    }
    return out;
  };
  const scripts = pick(SCRIPT_RULES, names.scripts, 'scripts', 1);
  let styles = pick(STYLE_RULES, names.styles, 'styles');
  // "serif" found only because "sans serif" was mentioned is handled by the lookbehind; drop serif when sans is in the title
  if (styles.includes(names.styles.get('serif') ?? '-') && styles.includes(names.styles.get('sans serif') ?? '-') && from[`styles:${names.styles.get('sans serif')}`] === 'head' && from[`styles:${names.styles.get('serif')}`] === 'body') styles = styles.filter((x) => x !== names.styles.get('serif'));
  const types = pick(TYPE_RULES, names.types, 'types');
  const genres = pick(GENRE_RULES, names.genres, 'genres');
  const groups = pick(GROUP_RULES, names.groups, 'groups');
  // an Arabic-script typeface supports Arabic
  const arabic = names.groups.get('arabic');
  if (arabic && scripts.length && !groups.includes(arabic)) { groups.push(arabic); from[`groups:${arabic}`] = 'body'; }

  // release year: structured data first, then a stated date in the text
  const all = `${head}\n${body}`;
  const nowY = new Date().getFullYear();
  const yearOk = (y: number) => y >= 1950 && y <= nowY;
  let year: number | null = null;
  const ldYear = /"(?:datePublished|dateCreated|releaseDate)"\s*:\s*"((?:19|20)\d\d)/i.exec(page.ld)?.[1];
  if (ldYear && yearOk(+ldYear)) { year = +ldYear; from.year = 'head'; }
  if (!year) {
    const m = /\b(?:released?|release date|release year|year of release|publication date|published(?: in| on)?|first published|launched(?: in| on)?|designed in|created in|date)\b\s*(?:in|on)?\s*[:\-–]?\s*(?:[A-Za-z]{3,9}\.?\s+)?(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?((?:19|20)\d\d)\b/i.exec(all);
    if (m && yearOk(+m[1])) { year = +m[1]; from.year = 'body'; }
  }

  // weights: a stated number first, then the weight names listed on the page
  let weights: number | null = null;
  const stated = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|eighteen|twenty)\s+(weights|font weights)\b/i.exec(all)
    ?? null;
  if (stated) { const n = Number(stated[1]) || NUM[stated[1].toLowerCase()] || 0; if (n >= 1 && n <= 20) { weights = n; from.weights = 'body'; } }
  if (!weights) {
    const found = WEIGHT_NAMES.filter(([, re]) => re.test(body)).map(([n]) => n);
    if (found.includes('regular') && found.length >= 4) { weights = found.length; from.weights = 'body'; }
  }
  const variable = /\bvariable (font|typeface|version|axis|axes)\b|\bvariable\b[^.]{0,40}\baxis\b|\bwght axis\b/i.test(all);
  return { scripts, styles, types, genres, groups, year, weights, variable, from };
}
