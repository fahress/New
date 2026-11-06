/**
 * The agent's settings: the shape stored in agent_settings.config, defaults, limits and validation.
 * Used by the settings page (to show units, defaults and limits) and by the server (to run).
 * No secrets live here — keys are in Supabase Vault and only the gateway can read them.
 */
import { validate, type Schema } from './schema';

export const PERMISSIONS = {
  use: { label: 'Use the agent', group: 'Access' },
  read_drafts: { label: 'See drafts and fonts in review in agent results', group: 'Access' },
  read_history: { label: 'Read the change history through the agent', group: 'Access' },
  propose: { label: 'Let the agent prepare change proposals', group: 'Access' },
  start_jobs: { label: 'Start long batch jobs (research many records)', group: 'Access' },
  approve_font_draft: { label: 'Approve: create drafts and edit draft / in-review fonts', group: 'Approve' },
  approve_font_published: { label: 'Approve: edit published fonts', group: 'Approve', adminOnly: true },
  approve_publish: { label: 'Approve: publish, feature, unpublish', group: 'Approve', adminOnly: true },
  approve_people: { label: 'Approve: create and edit designers & foundries', group: 'Approve' },
  approve_taxonomy: { label: 'Approve: add scripts, styles, types, genres, awards', group: 'Approve' },
  approve_images: { label: 'Approve: add, remove, reorder images and change covers', group: 'Approve' },
  approve_merge: { label: 'Approve: merge duplicates', group: 'Approve', adminOnly: true },
  approve_delete: { label: 'Approve: delete records', group: 'Approve', adminOnly: true },
  approve_restore: { label: 'Approve: restore deleted records / revert agent edits', group: 'Approve', adminOnly: true },
  approve_bulk: { label: 'Approve more than 20 changes at once', group: 'Approve' },
  manage_settings: { label: 'Change these settings', group: 'Manage' },
  manage_secrets: { label: 'Add, replace, delete and test API keys', group: 'Manage', adminOnly: true },
  manage_permissions: { label: 'Change this permission table', group: 'Manage', adminOnly: true },
  view_team_usage: { label: 'See the whole team’s usage', group: 'Manage' },
} as const;
export type Perm = keyof typeof PERMISSIONS;
export type Role = 'admin' | 'editor';
export const PERM_KEYS = Object.keys(PERMISSIONS) as Perm[];

/** Must match agent_private.default_permissions() in supabase/agent-setup.sql (a test checks it). */
export const DEFAULT_PERMISSIONS: Record<Perm, Role[]> = {
  use: ['admin', 'editor'], read_drafts: ['admin', 'editor'], read_history: ['admin', 'editor'], propose: ['admin', 'editor'], start_jobs: ['admin'],
  approve_font_draft: ['admin', 'editor'], approve_font_published: ['admin'], approve_publish: ['admin'], approve_people: ['admin', 'editor'],
  approve_taxonomy: ['admin'], approve_images: ['admin', 'editor'], approve_merge: ['admin'], approve_delete: ['admin'], approve_restore: ['admin'],
  approve_bulk: ['admin'], manage_settings: ['admin'], manage_secrets: ['admin'], manage_permissions: ['admin'], view_team_usage: ['admin'],
};

export const TOOLS = {
  search_archive: { label: 'Search Fahress', does: 'Finds fonts, designers and foundries by name in Arabic or Latin spelling, including other spellings.' },
  get_record: { label: 'Open a record', does: 'Reads one font, designer or foundry with its credits, classification, links and images — fresh from the database.' },
  find_incomplete: { label: 'Find missing data', does: 'Lists records missing a year, description, credit, image and so on, with exact counts.' },
  archive_stats: { label: 'Archive statistics', does: 'Counts fonts, designers, foundries and statuses straight from the data.' },
  find_duplicates: { label: 'Find possible duplicates', does: 'Compares names, type, websites and shared work to spot records that may be the same.' },
  list_taxonomy: { label: 'Classification lists', does: 'Reads the scripts, styles, types, genres, awards and language groups with their ids.' },
  read_history: { label: 'Change history', does: 'Reads recent changes to a record (needs the history permission).' },
  web_search: { label: 'Web search', does: 'Searches the web through Tavily, with your preferred and excluded sites.' },
  read_page: { label: 'Read a web page', does: 'Opens a page safely and keeps its text, dates and images as a source.' },
  read_pdf: { label: 'Read a PDF', does: 'Reads the text of a PDF (e.g. a specimen) page by page.' },
  find_images: { label: 'Find images', does: 'Collects candidate images from a page, checks them and keeps them privately for review.' },
  analyze_image: { label: 'Look at an image', does: 'Uses the vision model to describe a specimen (suggestions only — never proof of designer, year or license).' },
  record_findings: { label: 'Compare with sources', does: 'Records what each source says next to what Fahress has, marking supported, conflicting or unverified.' },
  propose_changes: { label: 'Prepare changes', does: 'Prepares an exact change proposal for a person to approve. It can’t save anything by itself.' },
  select_changes: { label: 'Pre-tick changes', does: 'When you say “only the description”, it pre-ticks those changes in the proposal card. You still press Approve.' },
  remember_preference: { label: 'Remember a preference', does: 'Saves a preference you ask it to remember (only when memory is on).' },
  start_batch_research: { label: 'Batch research', does: 'Starts a resumable job that researches many records and prepares proposals.' },
} as const;
export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export type LlmProviderId = 'fireworks' | 'openrouter';
export type FallbackError = 'rate_limited' | 'upstream' | 'network';

export type AgentSettings = {
  runtime: { enabled: boolean; name: string; description: string; language: 'ar' | 'en' | 'auto' };
  providers: { fireworks: { price_in: number | null; price_out: number | null }; openrouter: { enabled: boolean } };
  models: {
    chat_provider: LlmProviderId; chat: string;
    vision_provider: LlmProviderId; vision: string;
    summary_provider: LlmProviderId; summary: string;
    temperature: number; max_output_tokens: number;
    fallback: { enabled: boolean; provider: LlmProviderId; model: string; on_errors: FallbackError[] };
  };
  search: { provider: 'tavily' | 'none'; depth: 'basic' | 'advanced'; max_results: number; max_searches_per_run: number };
  sources: { preferred_domains: string[]; excluded_domains: string[]; prefer_original: boolean; retention_days: number; max_page_chars: number };
  behavior: { tone: 'concise' | 'friendly' | 'formal'; length: 'short' | 'medium' | 'detailed'; editorial_instructions: string };
  limits: {
    request_timeout_seconds: number; run_timeout_seconds: number; max_tool_steps: number; context_tokens: number;
    user_concurrent_runs: number; team_concurrent_runs: number; run_token_budget: number; job_max_items: number;
  };
  usage: { user_daily_tokens: number; team_daily_tokens: number; warn_at_percent: number };
  memory: { enabled: boolean; scope: 'conversation' | 'user'; retention_days: number };
  proposals: { ttl_hours: number };
  tools: Record<ToolName, boolean>;
  permissions: Record<Perm, Role[]>;
};

export const DEFAULT_SETTINGS: AgentSettings = {
  runtime: { enabled: false, name: 'Fahress Agent', description: 'Searches Fahress and the web, compares sources and prepares changes for you to approve.', language: 'auto' },
  providers: { fireworks: { price_in: null, price_out: null }, openrouter: { enabled: false } },
  models: {
    chat_provider: 'fireworks', chat: '', vision_provider: 'fireworks', vision: '', summary_provider: 'fireworks', summary: '',
    temperature: 0.3, max_output_tokens: 2048,
    fallback: { enabled: false, provider: 'openrouter', model: '', on_errors: ['rate_limited', 'upstream', 'network'] },
  },
  search: { provider: 'tavily', depth: 'basic', max_results: 6, max_searches_per_run: 6 },
  sources: { preferred_domains: [], excluded_domains: [], prefer_original: true, retention_days: 90, max_page_chars: 12000 },
  behavior: { tone: 'friendly', length: 'medium', editorial_instructions: '' },
  limits: {
    request_timeout_seconds: 90, run_timeout_seconds: 240, max_tool_steps: 8, context_tokens: 24000,
    user_concurrent_runs: 2, team_concurrent_runs: 6, run_token_budget: 400000, job_max_items: 200,
  },
  usage: { user_daily_tokens: 2_000_000, team_daily_tokens: 10_000_000, warn_at_percent: 80 },
  memory: { enabled: true, scope: 'user', retention_days: 180 },
  proposals: { ttl_hours: 72 },
  tools: Object.fromEntries(TOOL_NAMES.map((t) => [t, true])) as Record<ToolName, boolean>,
  permissions: DEFAULT_PERMISSIONS,
};

/** Field limits shown next to each setting and enforced on save. Units are in the labels. */
export const LIMITS = {
  'models.temperature': { min: 0, max: 1.5, step: 0.1, unit: '' },
  'models.max_output_tokens': { min: 256, max: 16384, step: 256, unit: 'tokens' },
  'search.max_results': { min: 1, max: 20, step: 1, unit: 'results' },
  'search.max_searches_per_run': { min: 0, max: 20, step: 1, unit: 'searches' },
  'sources.retention_days': { min: 1, max: 730, step: 1, unit: 'days' },
  'sources.max_page_chars': { min: 2000, max: 60000, step: 1000, unit: 'characters' },
  'limits.request_timeout_seconds': { min: 10, max: 280, step: 5, unit: 'seconds' },
  'limits.run_timeout_seconds': { min: 30, max: 290, step: 10, unit: 'seconds' },
  'limits.max_tool_steps': { min: 1, max: 20, step: 1, unit: 'steps' },
  'limits.context_tokens': { min: 4000, max: 200000, step: 1000, unit: 'tokens' },
  'limits.user_concurrent_runs': { min: 1, max: 10, step: 1, unit: 'replies' },
  'limits.team_concurrent_runs': { min: 1, max: 50, step: 1, unit: 'replies' },
  'limits.run_token_budget': { min: 10000, max: 5_000_000, step: 10000, unit: 'tokens' },
  'limits.job_max_items': { min: 1, max: 1000, step: 1, unit: 'records' },
  'usage.user_daily_tokens': { min: 10000, max: 100_000_000, step: 10000, unit: 'tokens / day' },
  'usage.team_daily_tokens': { min: 10000, max: 1_000_000_000, step: 10000, unit: 'tokens / day' },
  'usage.warn_at_percent': { min: 10, max: 100, step: 5, unit: '%' },
  'memory.retention_days': { min: 1, max: 3650, step: 1, unit: 'days' },
  'proposals.ttl_hours': { min: 1, max: 720, step: 1, unit: 'hours' },
  'providers.fireworks.price_in': { min: 0, max: 1000, step: 0.01, unit: 'USD / 1M input tokens' },
  'providers.fireworks.price_out': { min: 0, max: 1000, step: 0.01, unit: 'USD / 1M output tokens' },
} as const;

const L = (k: keyof typeof LIMITS, integer = true): Schema => ({ type: integer ? 'integer' : 'number', minimum: LIMITS[k].min, maximum: LIMITS[k].max });
const provider: Schema = { type: 'string', enum: ['fireworks', 'openrouter'] };
const model: Schema = { type: 'string', maxLength: 200, pattern: '^[A-Za-z0-9._:/@-]*$' };
const domainList: Schema = { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', pattern: '^(?=.{3,120}$)[a-z0-9.-]+\\.[a-z]{2,}$' } };
const roles: Schema = { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string', enum: ['admin', 'editor'] } };

export const SETTINGS_SCHEMA: Schema = {
  type: 'object', additionalProperties: false,
  required: ['runtime', 'providers', 'models', 'search', 'sources', 'behavior', 'limits', 'usage', 'memory', 'proposals', 'tools', 'permissions'],
  properties: {
    runtime: { type: 'object', additionalProperties: false, required: ['enabled', 'name', 'description', 'language'], properties: {
      enabled: { type: 'boolean' }, name: { type: 'string', minLength: 1, maxLength: 60 }, description: { type: 'string', maxLength: 300 }, language: { type: 'string', enum: ['ar', 'en', 'auto'] } } },
    providers: { type: 'object', additionalProperties: false, required: ['fireworks', 'openrouter'], properties: {
      fireworks: { type: 'object', additionalProperties: false, required: ['price_in', 'price_out'], properties: {
        price_in: { anyOf: [{ type: 'null' }, L('providers.fireworks.price_in', false)] }, price_out: { anyOf: [{ type: 'null' }, L('providers.fireworks.price_out', false)] } } },
      openrouter: { type: 'object', additionalProperties: false, required: ['enabled'], properties: { enabled: { type: 'boolean' } } } } },
    models: { type: 'object', additionalProperties: false, required: ['chat_provider', 'chat', 'vision_provider', 'vision', 'summary_provider', 'summary', 'temperature', 'max_output_tokens', 'fallback'], properties: {
      chat_provider: provider, chat: model, vision_provider: provider, vision: model, summary_provider: provider, summary: model,
      temperature: L('models.temperature', false), max_output_tokens: L('models.max_output_tokens'),
      fallback: { type: 'object', additionalProperties: false, required: ['enabled', 'provider', 'model', 'on_errors'], properties: {
        enabled: { type: 'boolean' }, provider, model, on_errors: { type: 'array', uniqueItems: true, maxItems: 3, items: { type: 'string', enum: ['rate_limited', 'upstream', 'network'] } } } } } },
    search: { type: 'object', additionalProperties: false, required: ['provider', 'depth', 'max_results', 'max_searches_per_run'], properties: {
      provider: { type: 'string', enum: ['tavily', 'none'] }, depth: { type: 'string', enum: ['basic', 'advanced'] },
      max_results: L('search.max_results'), max_searches_per_run: L('search.max_searches_per_run') } },
    sources: { type: 'object', additionalProperties: false, required: ['preferred_domains', 'excluded_domains', 'prefer_original', 'retention_days', 'max_page_chars'], properties: {
      preferred_domains: domainList, excluded_domains: domainList, prefer_original: { type: 'boolean' },
      retention_days: L('sources.retention_days'), max_page_chars: L('sources.max_page_chars') } },
    behavior: { type: 'object', additionalProperties: false, required: ['tone', 'length', 'editorial_instructions'], properties: {
      tone: { type: 'string', enum: ['concise', 'friendly', 'formal'] }, length: { type: 'string', enum: ['short', 'medium', 'detailed'] },
      editorial_instructions: { type: 'string', maxLength: 4000 } } },
    limits: { type: 'object', additionalProperties: false, required: Object.keys(DEFAULT_SETTINGS.limits), properties: {
      request_timeout_seconds: L('limits.request_timeout_seconds'), run_timeout_seconds: L('limits.run_timeout_seconds'), max_tool_steps: L('limits.max_tool_steps'),
      context_tokens: L('limits.context_tokens'), user_concurrent_runs: L('limits.user_concurrent_runs'), team_concurrent_runs: L('limits.team_concurrent_runs'),
      run_token_budget: L('limits.run_token_budget'), job_max_items: L('limits.job_max_items') } },
    usage: { type: 'object', additionalProperties: false, required: ['user_daily_tokens', 'team_daily_tokens', 'warn_at_percent'], properties: {
      user_daily_tokens: L('usage.user_daily_tokens'), team_daily_tokens: L('usage.team_daily_tokens'), warn_at_percent: L('usage.warn_at_percent') } },
    memory: { type: 'object', additionalProperties: false, required: ['enabled', 'scope', 'retention_days'], properties: {
      enabled: { type: 'boolean' }, scope: { type: 'string', enum: ['conversation', 'user'] }, retention_days: L('memory.retention_days') } },
    proposals: { type: 'object', additionalProperties: false, required: ['ttl_hours'], properties: { ttl_hours: L('proposals.ttl_hours') } },
    tools: { type: 'object', additionalProperties: false, required: TOOL_NAMES, properties: Object.fromEntries(TOOL_NAMES.map((t) => [t, { type: 'boolean' } as Schema])) },
    permissions: { type: 'object', additionalProperties: false, required: PERM_KEYS, properties: Object.fromEntries(PERM_KEYS.map((p) => [p, roles])) },
  },
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merges stored settings over the defaults, so new settings get their default and removed ones are dropped. */
export function withDefaults(stored: unknown): AgentSettings {
  const merge = (def: unknown, cur: unknown): unknown => {
    if (isObj(def)) {
      const out: Obj = {};
      for (const k of Object.keys(def)) out[k] = merge(def[k], isObj(cur) ? cur[k] : undefined);
      return out;
    }
    if (Array.isArray(def)) return Array.isArray(cur) ? cur : def;
    if (cur === undefined || (def !== null && cur !== null && typeof cur !== typeof def)) return def;
    return cur;
  };
  const s = merge(DEFAULT_SETTINGS, stored) as AgentSettings;
  // the permission table can't grant editors what the database never allows
  for (const p of PERM_KEYS) {
    const def = PERMISSIONS[p] as { adminOnly?: boolean };
    if (def.adminOnly) s.permissions[p] = s.permissions[p].filter((r) => r === 'admin');
  }
  return s;
}

/** Checks a full settings object. Returns readable problems (empty when valid). */
export function settingsProblems(s: AgentSettings): string[] {
  const errs = validate(SETTINGS_SCHEMA, s).map((e) => e.replace(/^\$\./, ''));
  if (errs.length) return errs;
  if (s.runtime.enabled && !s.models.chat) errs.push('Choose a chat model before switching the agent on.');
  const uses = (p: LlmProviderId) => s.models.chat_provider === p || (s.models.vision && s.models.vision_provider === p) || (s.models.summary && s.models.summary_provider === p) || (s.models.fallback.enabled && s.models.fallback.provider === p);
  if (uses('openrouter') && !s.providers.openrouter.enabled) errs.push('OpenRouter is chosen for a model but switched off under Connections.');
  if (s.models.fallback.enabled && !s.models.fallback.model) errs.push('Choose the fallback model, or switch the fallback off.');
  if (s.models.fallback.enabled && s.models.fallback.provider === s.models.chat_provider && s.models.fallback.model === s.models.chat) errs.push('The fallback model is the same as the main one.');
  if (s.limits.run_timeout_seconds < s.limits.request_timeout_seconds) errs.push('The whole reply’s time limit must be at least the single request’s time limit.');
  if (s.limits.team_concurrent_runs < s.limits.user_concurrent_runs) errs.push('The team’s concurrent replies can’t be fewer than one person’s.');
  if (s.usage.team_daily_tokens < s.usage.user_daily_tokens) errs.push('The team’s daily limit can’t be lower than one person’s.');
  const overlap = s.sources.preferred_domains.filter((d) => s.sources.excluded_domains.includes(d));
  if (overlap.length) errs.push(`A site can’t be both preferred and excluded: ${overlap.join(', ')}.`);
  if (s.tools.web_search && s.search.provider === 'none') errs.push('Web search is on but no search provider is chosen.');
  if (!s.permissions.use.includes('admin')) errs.push('Admins must keep access to the agent.');
  return errs;
}

/** What changed, by section, for the confirmation and the log (values of secrets never appear here — there are none). */
export function changedSections(a: AgentSettings, b: AgentSettings): string[] {
  return (Object.keys(a) as (keyof AgentSettings)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
