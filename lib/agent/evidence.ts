/**
 * Rules for what may be proposed and on what evidence. A model can claim anything; these checks make sure
 * a proposed fact points at a source the agent really opened (or at words the person really wrote), and that
 * the quoted words are really in it. Dates must be release dates to fill a release year.
 */
import { normalize } from './text';
import type { EvidenceItem, SourceRow } from './types';

export type EvidenceInput = { change_id: string; source: string; quote: string; status: 'supported' | 'inferred' | 'conflicting' | 'unverified'; date_kind?: string; precision?: string };
export type KnownSource = SourceRow & { text?: string };

/** Facts: need a supported quote from an opened source (or the person's own words). */
const FACT_FIELDS = new Set(['name', 'year', 'weights', 'is_variable', 'license', 'purchase_links', 'source_url', 'country', 'social_links', 'type', 'language_group', 'case_studies']);
/** Written text: needs at least one real source it is based on (inferred is fine). */
const TEXT_FIELDS = new Set(['description', 'description_ar', 'bio', 'bio_ar']);
/** Credits and awards are facts; classification may be inferred from a source. */
const FACT_LINKS = new Set(['designers', 'awards']);
const NEEDS_NOTHING = new Set(['status', 'merge', 'delete', 'restore', 'revert', 'taxonomy_create', 'cover', 'image_order', 'image_remove', 'image_add']);

/** Is the quote really in the text? Exact after normalising, or nearly all of its words in order-insensitive form. */
export function quoteFound(quote: string, text: string): boolean {
  const q = normalize(quote), t = normalize(text);
  if (!q || !t) return false;
  if (t.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length > 1);
  if (words.length < 4) return false;
  const have = new Set(t.split(' '));
  return words.filter((w) => have.has(w)).length / words.length >= 0.85;
}

export const sourceRef = (id: string) => `src:${id.slice(0, 8)}`;
export const refPrefix = (ref: string) => (/^src:[0-9a-f]{8}$/i.test(ref) ? ref.slice(4).toLowerCase() : null);

export type EvidenceCheck = { accepted: string[]; rejected: { id: string; reason: string }[]; items: EvidenceItem[]; notes: string[] };

export function checkEvidence(
  changes: { id: string; op: string; field?: string; link?: string; to?: unknown; values?: Record<string, unknown> }[],
  evidence: EvidenceInput[],
  sources: Map<string, KnownSource>,
  userText: string,
): EvidenceCheck {
  const items: EvidenceItem[] = [];
  const notes: string[] = [];
  const byChange = new Map<string, EvidenceItem[]>();
  for (const e of evidence) {
    let item: EvidenceItem;
    if (e.source === 'user') {
      const ok = quoteFound(e.quote, userText);
      item = { change_id: e.change_id, source_id: null, url: null, title: 'Said in this conversation', publisher: null, quote: e.quote.slice(0, 500), status: ok ? 'user_provided' : 'unverified', date_kind: e.date_kind ?? null, precision: e.precision ?? null, published_at: null, retrieved_at: null };
      if (!ok) notes.push(`The quote for ${e.change_id} isn’t in anything the person wrote.`);
    } else {
      const p = refPrefix(e.source);
      const src = p ? sources.get(p) : undefined;
      if (!src) {
        notes.push(`${e.source} isn’t a source the agent opened in this conversation, so it can’t back ${e.change_id}.`);
        item = { change_id: e.change_id, source_id: null, url: null, title: null, publisher: null, quote: e.quote.slice(0, 500), status: 'unverified', date_kind: e.date_kind ?? null, precision: e.precision ?? null, published_at: null, retrieved_at: null };
      } else {
        const found = quoteFound(e.quote, `${src.text ?? ''}\n${src.excerpt ?? ''}\n${src.title ?? ''}`);
        if (!found) notes.push(`The quote for ${e.change_id} wasn’t found in ${e.source}.`);
        const status = found ? e.status : 'unverified';
        item = {
          change_id: e.change_id, source_id: src.id, url: src.url, title: src.title, publisher: src.publisher, quote: e.quote.slice(0, 500), status,
          date_kind: e.date_kind ?? null, precision: e.precision ?? null, published_at: src.published_at, retrieved_at: src.retrieved_at,
        };
        if (status === 'supported' && src.kind === 'search_result') {
          // a search snippet alone isn't enough for a fact: the page must have been opened
          item.status = 'inferred';
          notes.push(`${e.source} is only a search snippet; open the page to confirm ${e.change_id}.`);
        }
      }
    }
    items.push(item);
    byChange.set(e.change_id, [...(byChange.get(e.change_id) ?? []), item]);
  }

  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  for (const c of changes) {
    const ev = byChange.get(c.id) ?? [];
    const solid = ev.filter((e) => e.status === 'supported' || e.status === 'user_provided');
    const any = ev.filter((e) => e.status !== 'unverified' && e.status !== 'conflicting');
    if (ev.some((e) => e.status === 'conflicting')) { rejected.push({ id: c.id, reason: 'Sources disagree about this. Show both to the person instead of choosing.' }); continue; }
    if (NEEDS_NOTHING.has(c.op)) { accepted.push(c.id); continue; }
    if (c.op === 'set' && c.field && TEXT_FIELDS.has(c.field)) {
      if (!any.length) { rejected.push({ id: c.id, reason: `Written text (${c.field}) must name the sources it is based on.` }); continue; }
      accepted.push(c.id); continue;
    }
    if (c.op === 'set' && c.field && FACT_FIELDS.has(c.field)) {
      if (!solid.length) { rejected.push({ id: c.id, reason: `No opened source (or the person’s own words) confirms ${c.field}. Leave it empty or ask.` }); continue; }
      if (c.field === 'year') {
        const release = solid.filter((e) => e.status === 'user_provided' || e.date_kind === 'release');
        if (!release.length) {
          const kinds = [...new Set(solid.map((e) => e.date_kind ?? 'unknown'))].join(', ');
          rejected.push({ id: c.id, reason: `The year needs evidence of the release itself; what was found is: ${kinds}. Report it as “the earliest dated mention found”, don’t fill the year.` });
          continue;
        }
        if (!release.some((e) => String(e.quote ?? '').includes(String(c.to)) || e.status === 'user_provided')) {
          rejected.push({ id: c.id, reason: `The quote doesn’t contain the year ${String(c.to)}.` }); continue;
        }
      }
      accepted.push(c.id); continue;
    }
    if (c.op === 'link') {
      const need = c.link && FACT_LINKS.has(c.link) ? solid : any;
      if (!need.length) { rejected.push({ id: c.id, reason: c.link && FACT_LINKS.has(c.link) ? `A ${c.link === 'designers' ? 'credit' : 'award'} needs a confirmed source.` : 'Classification needs at least one source it is based on.' }); continue; }
      accepted.push(c.id); continue;
    }
    if (c.op === 'create') {
      if (!any.length) { rejected.push({ id: c.id, reason: 'A new record needs at least one source showing it exists.' }); continue; }
      accepted.push(c.id); continue;
    }
    accepted.push(c.id);
  }
  return { accepted, rejected, items, notes };
}
