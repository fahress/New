// Browser test of the agent chat and settings pages, with the agent API mocked (no Supabase, no providers).
// Run the app in demo mode first:
//   NEXT_PUBLIC_DASHBOARD_DEMO=1 FAHRESS_FIXTURE=$PWD/tests/fixtures/archive.json npx next dev -p 3100
//   BASE=http://localhost:3100 node tests/ui/agent-ui.e2e.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // the preinstalled Playwright (not a project dependency)
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const SHOTS = process.env.SHOTS ?? '';
const FONT = '00000000-0000-4000-8000-000000000003';
const settings = {
  runtime: { enabled: true, name: 'Fahress Agent', description: 'Searches Fahress and the web.', language: 'auto' },
  providers: { fireworks: { price_in: null, price_out: null }, openrouter: { enabled: false } },
  models: { chat_provider: 'fireworks', chat: 'accounts/fireworks/models/test', vision_provider: 'fireworks', vision: '', summary_provider: 'fireworks', summary: '', temperature: 0.3, max_output_tokens: 2048, fallback: { enabled: false, provider: 'openrouter', model: '', on_errors: ['rate_limited'] } },
  search: { provider: 'tavily', depth: 'basic', max_results: 6, max_searches_per_run: 6 },
  sources: { preferred_domains: [], excluded_domains: [], prefer_original: true, retention_days: 90, max_page_chars: 12000 },
  behavior: { tone: 'friendly', length: 'medium', editorial_instructions: '' },
  limits: { request_timeout_seconds: 90, run_timeout_seconds: 240, max_tool_steps: 8, context_tokens: 24000, user_concurrent_runs: 2, team_concurrent_runs: 6, run_token_budget: 400000, job_max_items: 200 },
  usage: { user_daily_tokens: 2000000, team_daily_tokens: 10000000, warn_at_percent: 80 },
  memory: { enabled: true, scope: 'user', retention_days: 180 }, proposals: { ttl_hours: 72 },
  tools: Object.fromEntries(['search_archive', 'get_record', 'find_incomplete', 'archive_stats', 'find_duplicates', 'list_taxonomy', 'read_history', 'web_search', 'read_page', 'read_pdf', 'find_images', 'analyze_image', 'record_findings', 'propose_changes', 'select_changes', 'remember_preference', 'start_batch_research'].map((t) => [t, true])),
  permissions: { use: ['admin', 'editor'], read_drafts: ['admin', 'editor'], read_history: ['admin', 'editor'], propose: ['admin', 'editor'], start_jobs: ['admin'], approve_font_draft: ['admin', 'editor'], approve_font_published: ['admin'], approve_publish: ['admin'], approve_people: ['admin', 'editor'], approve_taxonomy: ['admin'], approve_images: ['admin', 'editor'], approve_merge: ['admin'], approve_delete: ['admin'], approve_restore: ['admin'], approve_bulk: ['admin'], manage_settings: ['admin'], manage_secrets: ['admin'], manage_permissions: ['admin'], view_team_usage: ['admin'] },
};
const perms = Object.fromEntries(Object.keys(settings.permissions).map((k) => [k, true]));
const SRC = '1a2b3c4d-0000-4000-8000-000000000001';
const now = new Date().toISOString();
const proposal = {
  id: 'p0000000-0000-4000-8000-000000000001', owner_id: 'u', conversation_id: 'c1', message_id: 'a1', run_id: 'r1', version: 1, status: 'pending', kind: 'mixed',
  title: 'Complete Zawi 2', reason: 'From the foundry page (Sara Studio).', impact: 'Draft font only.', targets: [{ type: 'font', id: FONT }],
  changes: [
    { id: 'year', op: 'set', entity: 'font', target: FONT, field: 'year', from: null, to: 2019 },
    { id: 'desc', op: 'set', entity: 'font', target: FONT, field: 'description_ar', from: null, to: 'خط كوفي هندسي للعناوين.' },
  ],
  base: {}, evidence: [{ change_id: 'year', source_id: SRC, url: 'https://sarastudio.example/zawi', title: 'Zawi', publisher: 'Sara Studio', quote: 'Zawi was released in March 2019', status: 'supported', date_kind: 'release', precision: 'month', published_at: null, retrieved_at: now }],
  submitted_for_review: false, expires_at: new Date(Date.now() + 72 * 3600e3).toISOString(), created_at: now, updated_at: now, executed_at: null, executed_by: null, result: null, error: null,
};
const source = { id: SRC, kind: 'web', url: 'https://sarastudio.example/zawi', title: 'Zawi — Sara Studio', publisher: 'Sara Studio', excerpt: 'Zawi was released in March 2019.', page: null, published_at: '2023-01-10', published_precision: 'day', modified_at: null, retrieved_at: now, opened: true };
const reply = 'وجدت صفحة المسبك: **Zawi** أُطلق في مارس 2019 [src:1a2b3c4d]. جهزت لك مقترحًا بالسنة والوصف العربي.';
const asstFinal = { id: 'a1', conversation_id: 'c1', parent_id: 'm1', role: 'assistant', content: reply, status: 'complete', run_id: 'r1', client_request_id: null,
  cards: [{ kind: 'sources', ids: [SRC] }, { kind: 'proposal', id: proposal.id }], progress: [{ label: 'Searching Fahress for “Zawi”', state: 'done', at: now }, { label: 'Reading sarastudio.example', state: 'done', at: now }], error: null, created_at: now, updated_at: now };
const userMsg = { id: 'm1', conversation_id: 'c1', parent_id: null, role: 'user', content: 'ابحث عن هذا الخط وكمل بياناته الناقصة', status: 'complete', run_id: null, client_request_id: 'x', cards: [], progress: [], error: null, created_at: now, updated_at: now };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let approved = null;
let chatBody = null;
await page.route('**/api/dashboard/agent/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname.replace('/api/dashboard/agent/', '');
  const method = route.request().method();
  const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
  if (path === 'settings') return json({ settings, version: 3, perms, role: 'admin', gateway: { installed: true, version: '1.0.0' }, usage: { user_today: 1200, team_today: 5000, user_month: 9000, team_month: 20000, search_today: 3, cost_month_estimate: 0.12, errors_today: 0, user_limit: 2000000, team_limit: 10000000 }, log: [], errors: [],
    integrations: [{ provider: 'fireworks', configured: true, hint: '••••7Kq2', status: 'ok', last_checked_at: now, last_error: null, models: [{ id: 'accounts/fireworks/models/test', name: 'Test', context: 131072, tools: true, vision: false, structured: true }], models_at: now, probes: {} }, { provider: 'tavily', configured: false, hint: null, status: 'untested', last_checked_at: null, last_error: null, models: [], models_at: null, probes: {} }] });
  if (path.startsWith('conversations') && method === 'GET' && path === 'conversations') return json({ conversations: chatBody ? [{ id: 'c1', title: 'ابحث عن هذا الخط', updated_at: now, archived_at: null, context_type: 'font' }] : [] });
  if (path === 'conversations/c1') return json({ conversation: { id: 'c1', title: 'ابحث عن هذا الخط', context_type: 'font', context_id: FONT, focus: [], head_message_id: 'a1' }, messages: [userMsg, asstFinal], siblings: { m1: ['m1'], a1: ['a1'] }, branchHeads: {}, running: null, proposals: [approved ? { ...proposal, status: 'executed' } : proposal], sources: [source], assets: [], jobs: [] });
  if (path === 'chat') {
    chatBody = JSON.parse(route.request().postData());
    const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
    const body = ev({ type: 'meta', conversation_id: 'c1', user_message_id: 'm1', assistant_message_id: 'a1', run_id: 'r1' })
      + ev({ type: 'progress', steps: [{ label: 'Searching Fahress for “Zawi”', state: 'running', at: now }] })
      + [...reply].reduce((acc, ch, i) => (i % 9 === 0 ? [...acc, ch] : [...acc.slice(0, -1), acc[acc.length - 1] + ch]), []).map((t) => ev({ type: 'delta', text: t })).join('')
      + ev({ type: 'card', card: { kind: 'sources', ids: [SRC] } }) + ev({ type: 'card', card: { kind: 'proposal', id: proposal.id } }) + ev({ type: 'done', message: asstFinal });
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
  }
  if (path === `proposals/${proposal.id}` && method === 'GET') return json({ proposal: approved ? { ...proposal, status: 'executed' } : proposal, approvals: [] });
  if (path === `proposals/${proposal.id}` && method === 'POST') { approved = JSON.parse(route.request().postData()); return json({ ok: true, status: 'executed', applied: [{ id: 'year', status: 'applied' }] }); }
  if (path === 'sources') return json({ sources: [source] });
  if (path === 'memory') return json({ memories: [{ id: 'mem1', content: 'اكتب الأوصاف بأسلوب رسمي', kind: 'preference', created_at: now, expires_at: null }] });
  return json({ error: `unmocked ${path}` }, 404);
});

// 1. chat: send in Arabic, see the streamed reply, sources and the proposal
await page.goto(`${BASE}/dashboard/agent?context=font:${FONT}`, { waitUntil: 'networkidle' });
await page.getByRole('link', { name: 'Fahress Agent' }).first().waitFor();
await page.getByLabel('Message').fill('ابحث عن هذا الخط وكمل بياناته الناقصة');
await page.getByLabel('Message').press('Enter');
await page.getByText('Complete Zawi 2').waitFor({ timeout: 15000 });
assert.equal(chatBody.context.id, FONT, 'the record the chat was opened from is sent as context');
assert.match(chatBody.client_request_id, /^[A-Za-z0-9_-]{8,}$/);
const para = page.locator('.ag-md p').first();
assert.equal(await para.getAttribute('dir'), 'auto');
assert.equal(await para.evaluate((el) => getComputedStyle(el).direction), 'rtl', 'Arabic reply is laid out right-to-left');
assert.ok(await page.locator('.ag-cite').first().isVisible(), 'the citation shows as a source chip');
assert.ok(await page.getByText('Zawi was released in March 2019', { exact: false }).first().isVisible(), 'the quote is shown next to the change');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/agent-chat.png`, fullPage: false });

// 2. approve only one change
await page.getByLabel('Include desc').uncheck();
await page.getByRole('button', { name: 'Approve 1 selected' }).click();
await page.getByText('Saved 1 change').waitFor();
assert.deepEqual(approved.ops, ['year']);
assert.equal(approved.version, 1);
assert.match(approved.request_id, /^[A-Za-z0-9_-]{8,}$/);

// 3. settings: keys are never shown, only the masked hint; memory list
await page.goto(`${BASE}/dashboard/agent/settings`, { waitUntil: 'networkidle' });
await page.getByText('Agent settings', { exact: true }).first().waitFor();
const html = await page.content();
assert.ok(html.includes('••••7Kq2'));
assert.equal(await page.locator('input[type=password]').first().inputValue(), '');
await page.getByText('اكتب الأوصاف بأسلوب رسمي').waitFor();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/agent-settings.png`, fullPage: false });

// 4. phone width: no sideways scrolling
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/dashboard/agent?c=c1`, { waitUntil: 'networkidle' });
await page.getByText('Complete Zawi 2').waitFor();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(overflow <= 1, `no horizontal scroll on phones (${overflow}px)`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/agent-phone.png` });

assert.deepEqual(errors, [], `no page errors: ${errors.join('\n')}`);
await browser.close();
console.log('agent UI e2e: ok');
