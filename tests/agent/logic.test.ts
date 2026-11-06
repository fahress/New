import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../lib/agent/schema';
import { DEFAULT_PERMISSIONS, DEFAULT_SETTINGS, PERM_KEYS, PERMISSIONS, settingsProblems, withDefaults } from '../../lib/agent/settings';
import { matchName, normalize, skeleton } from '../../lib/agent/text';
import { datesInMeta, datesInText, parseDate } from '../../lib/agent/dates';
import { checkEvidence, quoteFound } from '../../lib/agent/evidence';
import { Index, findDuplicates, findIncomplete, searchArchive, archiveStats } from '../../lib/agent/archive';
import { ThinkFilter, StreamCollector } from '../../lib/agent/providers';
import { chatBody, keyProblem, maskKey, normalizeModels, scrub, tavilySearchBody } from '../../supabase/functions/agent-gateway/lib';
import { fixtureSnapshot } from './fakes';

/* ---------- settings ---------- */
test('default settings are valid once a model is chosen', () => {
  const s = withDefaults({ models: { chat: 'accounts/fireworks/models/x' } });
  assert.deepEqual(settingsProblems(s), []);
});

test('settings keep unknown keys out and fill new ones with defaults', () => {
  const s = withDefaults({ runtime: { enabled: true, surprise: 1 }, limits: { max_tool_steps: 3 } });
  assert.equal(s.limits.max_tool_steps, 3);
  assert.equal(s.limits.context_tokens, DEFAULT_SETTINGS.limits.context_tokens);
  assert.equal((s.runtime as Record<string, unknown>).surprise, undefined);
});

test('editors can’t be given admin-only permissions, even if stored', () => {
  const s = withDefaults({ permissions: { ...DEFAULT_PERMISSIONS, approve_publish: ['admin', 'editor'], manage_secrets: ['editor'] } });
  assert.deepEqual(s.permissions.approve_publish, ['admin']);
  assert.deepEqual(s.permissions.manage_secrets, []);
});

test('settings validation catches out-of-range values and contradictions', () => {
  const s = withDefaults({ models: { chat: 'm' } });
  s.limits.max_tool_steps = 999;
  s.sources.preferred_domains = ['myfonts.com'];
  s.sources.excluded_domains = ['myfonts.com'];
  const p = settingsProblems(s);
  assert.ok(p.some((x) => /max_tool_steps/.test(x)));
  s.limits.max_tool_steps = 5;
  assert.ok(settingsProblems(s).some((x) => /preferred and excluded/.test(x)));
});

test('the permission defaults match the database migration exactly', () => {
  const sql = readFileSync(new URL('../../supabase/agent-setup.sql', import.meta.url), 'utf8');
  const block = /default_permissions\(\) returns jsonb[\s\S]*?select '(\{[\s\S]*?\})'::jsonb/.exec(sql)![1];
  assert.deepEqual(JSON.parse(block), DEFAULT_PERMISSIONS);
  const denied = /editor_denied\(\) returns text\[\][\s\S]*?array\[([^\]]+)\]/.exec(sql)![1].split(',').map((x) => x.trim().replace(/'/g, ''));
  const adminOnly = PERM_KEYS.filter((p) => (PERMISSIONS[p] as { adminOnly?: boolean }).adminOnly);
  assert.deepEqual([...denied].sort(), [...adminOnly].sort());
});

/* ---------- schema ---------- */
test('schema validation reports wrong types, extra keys and formats', () => {
  const schema = { type: 'object' as const, additionalProperties: false, required: ['id'], properties: { id: { type: 'string' as const, format: 'uuid' as const }, n: { type: 'integer' as const, maximum: 3 } } };
  assert.deepEqual(validate(schema, { id: '00000000-0000-4000-8000-000000000001' }), []);
  const errs = validate(schema, { id: 'x', n: 4.5, extra: true });
  assert.equal(errs.length, 3);
});

/* ---------- names in Arabic and Latin ---------- */
test('Arabic spelling variants fold together', () => {
  assert.equal(normalize('إِبْرَاهِيمُ'), normalize('ابراهيم'));
  assert.equal(normalize('مكتبة'), normalize('مكتبه'));
  assert.equal(normalize('فارسی'), normalize('فارسي'));
  assert.equal(normalize('Café Naskh'), 'cafe naskh');
});

test('matching names across spellings and scripts', () => {
  assert.equal(matchName('zawi', ['Zawi']).score, 100);
  assert.ok(matchName('29LT Zawi', ['Zawi']).score > 0 || matchName('Zawi', ['29LT Zawi']).score > 0);
  assert.ok(matchName('نسيم', ['Naseem']).score >= 50, 'Arabic query finds the Latin name');
  assert.ok(matchName('Nassim', ['Naseem']).score >= 40, 'close Latin spellings');
  assert.equal(matchName('Amiri', ['Zawi']).score, 0);
  assert.equal(skeleton('Kufi'), skeleton('Koufi'));
});

/* ---------- dates ---------- */
test('dates keep only the precision the source gives', () => {
  assert.deepEqual(parseDate('2019'), { value: '2019', precision: 'year' });
  assert.deepEqual(parseDate('March 2019'), { value: '2019-03', precision: 'month' });
  assert.deepEqual(parseDate('12 March 2019'), { value: '2019-03-12', precision: 'day' });
  assert.deepEqual(parseDate('2020-05-01T10:00:00Z'), { value: '2020-05-01', precision: 'day' });
  assert.deepEqual(parseDate('مارس ٢٠٢١'), { value: '2021-03', precision: 'month' });
});

test('release, design, update, award and copyright dates are told apart', () => {
  const t = 'Zawi was designed in 2015. It was released in March 2017 by Sara Studio. Version 2.0 was updated in 2020. Winner of the Granshan award 2018. © 2023 Sara Studio.';
  const kinds = Object.fromEntries(datesInText(t).map((d) => [d.value, d.kind]));
  assert.equal(kinds['2015'], 'design');
  assert.equal(kinds['2017-03'], 'release');
  assert.equal(kinds['2020'], 'update');
  assert.equal(kinds['2018'], 'award');
  assert.equal(kinds['2023'], 'copyright');
});

test('Arabic cues are understood', () => {
  const kinds = datesInText('صدر الخط في عام 2016، وفاز بجائزة في 2019.').map((d) => d.kind);
  assert.deepEqual(kinds, ['release', 'award']);
});

test('a page’s own dates are page dates, not release dates', () => {
  const d = datesInMeta({ 'article:published_time': ['2021-04-02T00:00:00Z'], 'article:modified_time': ['2022-01-01'] }, [{ '@type': 'Product', datePublished: '2020' }]);
  assert.ok(d.every((x) => x.kind === 'page_published' || x.kind === 'page_updated'));
});

/* ---------- evidence ---------- */
const src = (id: string, text: string, kind: 'web' | 'search_result' = 'web') => [id.slice(0, 8), { id, kind, url: 'https://x.example', title: 't', publisher: 'x', excerpt: text.slice(0, 100), page: null, published_at: null, published_precision: null, modified_at: null, retrieved_at: '', opened: kind === 'web', text }] as const;

test('quotes must really be in the source', () => {
  assert.ok(quoteFound('released in March 2019', 'Zawi was Released in March, 2019 by Sara.'));
  assert.ok(!quoteFound('released in 2018', 'Zawi was released in March 2019.'));
});

test('facts need an opened source with the quote; search snippets aren’t enough', () => {
  const sources = new Map([src('11111111-a', 'Designed by Sara Studio, released 2019.'), src('22222222-b', 'Designed by Sara Studio', 'search_result')]);
  const changes = [{ id: 'credit', op: 'link', link: 'designers', to: undefined }, { id: 'credit2', op: 'link', link: 'designers' }, { id: 'made_up', op: 'set', field: 'license', to: 'free' }];
  const r = checkEvidence(changes, [
    { change_id: 'credit', source: 'src:11111111', quote: 'Designed by Sara Studio', status: 'supported' },
    { change_id: 'credit2', source: 'src:22222222', quote: 'Designed by Sara Studio', status: 'supported' },
    { change_id: 'made_up', source: 'src:99999999', quote: 'free for commercial use', status: 'supported' },
  ], sources as never, '');
  assert.deepEqual(r.accepted, ['credit']);
  assert.deepEqual(r.rejected.map((x) => x.id).sort(), ['credit2', 'made_up']);
});

test('conflicting sources block a change; the person’s own words count when really written', () => {
  const sources = new Map([src('11111111-a', 'Released in 2019.')]);
  const r = checkEvidence([{ id: 'y', op: 'set', field: 'year', to: 2019 }, { id: 'w', op: 'set', field: 'weights', to: 8 }], [
    { change_id: 'y', source: 'src:11111111', quote: 'Released in 2019', status: 'conflicting', date_kind: 'release' },
    { change_id: 'w', source: 'user', quote: 'it has 8 weights', status: 'supported' },
  ], sources as never, 'Please note: it has 8 weights and a variable version.');
  assert.deepEqual(r.accepted, ['w']);
  assert.match(r.rejected[0].reason, /disagree/);
});

/* ---------- archive ---------- */
test('archive search, incomplete counts and stats come from the data', () => {
  const ix = new Index(fixtureSnapshot(), true);
  const s = searchArchive(ix, { query: 'Zawi' });
  assert.ok(s.ambiguous, 'two different fonts called Zawi');
  const missing = findIncomplete(ix, { field: 'year', scope: 'live' });
  assert.equal(missing.total, 2); // Amiri and Naseem (live, no year)
  const stats = archiveStats(ix);
  assert.equal(stats.fonts.total, 5);
  assert.equal(stats.foundries, 3);
  const hidden = new Index(fixtureSnapshot(), false);
  assert.equal(archiveStats(hidden).fonts.total, 4, 'drafts hidden without the permission');
});

test('same name is not enough to call two records the same', () => {
  const ix = new Index(fixtureSnapshot(), true);
  const fonts = findDuplicates(ix, { type: 'font' });
  const zawi = fonts.find((g) => g.records.some((r) => r.name === 'Zawi'))!;
  assert.equal(zawi.strength, 'possible');
  assert.ok(zawi.against.includes('different designers/foundries'));
  const people = findDuplicates(ix, { type: 'person' });
  const sara = people.find((g) => g.records.some((r) => r.name === 'Sara Studio'))!;
  assert.equal(sara.strength, 'strong', 'same website → strong');
});

/* ---------- streaming ---------- */
test('private reasoning is hidden even when split across chunks', () => {
  const f = new ThinkFilter();
  const out = ['Hi <thi', 'nk>secret plan', ' more</th', 'ink> there', ' <b>ok</b>'].map((c) => f.push(c)).join('') + f.flush();
  assert.equal(out, 'Hi  there <b>ok</b>');
});

test('streamed tool-call fragments are assembled; reasoning fields are dropped', () => {
  const col = new StreamCollector();
  const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
  col.push(ev({ choices: [{ delta: { reasoning_content: 'hidden', content: 'Let me check.' } }] }));
  col.push(ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_', arguments: '{"que' } }] } }] }));
  col.push(ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'archive', arguments: 'ry":"zawi"}' } }] }, finish_reason: 'tool_calls' }] }));
  col.push(ev({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
  col.push('data: [DONE]\n\n');
  const r = col.end();
  assert.equal(r.content, 'Let me check.');
  assert.deepEqual(r.toolCalls, [{ id: 'c1', type: 'function', function: { name: 'search_archive', arguments: '{"query":"zawi"}' } }]);
  assert.deepEqual(col.usage, { input: 12, output: 3 });
});

/* ---------- gateway helpers (keys) ---------- */
test('keys are masked and scrubbed from anything leaving the gateway', () => {
  const key = 'fw_3ZxQe9rT5yU7iO1pA2sD4fG6';
  assert.equal(maskKey(key), '••••fG6'.replace('••••fG6', `••••${key.slice(-4)}`));
  const text = scrub(`Invalid key ${key} (Authorization: Bearer ${key}) sk-or-v1-abcdefghijklmnop tvly-dev-ABCDEFGHIJKL`, [key]);
  assert.doesNotMatch(text, /3ZxQe9|abcdefghijklmnop|ABCDEFGHIJKL/);
  assert.equal(keyProblem('tavily', 'sk-wrong-provider-key-123'), 'Tavily keys start with “tvly-”.');
  assert.equal(keyProblem('fireworks', 'short'), 'That doesn’t look like a complete key (too short or too long).');
  assert.equal(keyProblem('fireworks', key), null);
});

test('only whitelisted fields reach the provider', () => {
  const body = chatBody('fireworks', { model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 999999, ...( { webhook: 'https://evil.example' } as object) } as never, true);
  assert.equal((body as Record<string, unknown>).webhook, undefined);
  assert.equal(body.max_tokens, 16384);
  assert.deepEqual(body.stream_options, { include_usage: true });
  const search = tavilySearchBody({ query: 'zawi', include_domains: ['myfonts.com', 'http://169.254.169.254/x', 'evil'], max_results: 99 }) as Record<string, unknown>;
  assert.deepEqual(search.include_domains, ['myfonts.com']);
  assert.equal(search.max_results, 20);
});

test('model capability lists are normalised; unknown stays unknown', () => {
  const or = normalizeModels('openrouter', { data: [{ id: 'a/b', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0.000001', completion: '0.000002' } }, { id: 'c/d' }] });
  assert.equal(or[0].tools, true); assert.equal(or[0].vision, true); assert.equal(or[0].pricePerMIn, 1);
  assert.equal(or[1].tools, null);
  const fw = normalizeModels('fireworks', { data: [{ id: 'accounts/fireworks/models/x', supports_tools: false, supports_image_input: true }, { id: 'y', supports_chat: false }] });
  assert.equal(fw.length, 1); assert.equal(fw[0].tools, false);
});
