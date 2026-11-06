'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { agentApi, ApiError } from './api';
import { ConfirmButton, Field, Loading, timeAgo, useToast } from '@/components/dashboard/ui';
import {
  DEFAULT_SETTINGS, LIMITS, PERMISSIONS, PERM_KEYS, TOOLS, TOOL_NAMES, changedSections, settingsProblems,
  type AgentSettings, type LlmProviderId, type Perm,
} from '@/lib/agent/settings';

type ModelInfo = { id: string; name: string; context: number | null; tools: boolean | null; vision: boolean | null; structured: boolean | null };
type Integration = { provider: string; configured: boolean; hint: string | null; status: string; last_checked_at: string | null; last_error: string | null; models: ModelInfo[]; models_at: string | null; probes: Record<string, { tools?: boolean; stream?: boolean; streamUsage?: boolean; error?: string; at?: string }> };
type Payload = {
  settings: AgentSettings; version: number; perms: Record<Perm, boolean>; role: string; gateway: { installed: boolean; version?: string; error?: string };
  usage: { user_today: number; team_today: number; user_month: number; team_month: number; search_today: number; cost_month_estimate: number; errors_today: number; user_limit: number; team_limit: number } | null;
  log: { id: number; at: string; user_email: string | null; section: string; changes: Record<string, unknown> }[]; errors: { at: string; provider: string; model: string | null; kind: string; error: string | null }[];
  integrations: Integration[];
};

type Path = keyof typeof LIMITS;
const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
const setIn = <T,>(o: T, path: string, v: unknown): T => {
  const copy = structuredClone(o) as Record<string, unknown>;
  const keys = path.split('.');
  let cur = copy;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = v;
  return copy as T;
};
const PROVIDER_NAME: Record<string, string> = { fireworks: 'Fireworks AI', openrouter: 'OpenRouter', tavily: 'Tavily' };
const ENDPOINT: Record<string, string> = { fireworks: 'api.fireworks.ai/inference/v1', openrouter: 'openrouter.ai/api/v1', tavily: 'api.tavily.com' };
const fmt = (n: number) => n.toLocaleString('en');

export default function AgentSettingsPage() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const load = async () => {
    try {
      const d = await agentApi<Payload>('settings');
      setData(d); setForm(d.settings); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load the settings'); }
  };
  useEffect(() => { load(); }, []);

  const changed = useMemo(() => (data && form ? changedSections(data.settings, form) : []), [data, form]);
  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed.length]);

  if (error) return <div className="dz-panel dz-panel--err"><b>Couldn’t open the agent settings.</b><p>{error}</p><p className="dz-hint">If the agent was just installed, run <code>supabase/agent-setup.sql</code> in the Supabase SQL editor first.</p></div>;
  if (!data || !form) return <Loading text="Loading the agent settings…" />;
  const canEdit = data.perms.manage_settings;
  const canKeys = data.perms.manage_secrets;
  const canPerms = data.perms.manage_permissions;
  const set = (path: string, v: unknown) => setForm((f) => (f ? setIn(f, path, v) : f));

  const save = async () => {
    const p = settingsProblems(form);
    setProblems(p);
    if (p.length) { toast('Fix the highlighted settings first.', 'err'); return; }
    setSaving(true);
    try {
      const r = await agentApi<{ version: number; settings: AgentSettings; changed: string[] }>('settings', { settings: form, version: data.version }, 'PUT');
      toast(`Saved (${r.changed.join(', ') || 'no changes'}). The agent uses the new settings from the next message.`);
      await load();
    } catch (e) {
      const body = e instanceof ApiError ? e.body : undefined;
      if (Array.isArray(body?.problems)) setProblems(body!.problems as string[]);
      toast(e instanceof Error ? e.message : 'Saving failed', 'err');
    } finally { setSaving(false); }
  };

  const num = (path: Path, label: string, hint?: string) => {
    const l = LIMITS[path];
    const def = get(DEFAULT_SETTINGS, path);
    const v = get(form, path) as number | null;
    return (
      <Field label={`${label}${l.unit ? ` (${l.unit})` : ''}`} hint={`${hint ? `${hint} ` : ''}Default ${def === null ? 'empty' : fmt(def as number)} · ${fmt(l.min)}–${fmt(l.max)}`}>
        <input className="dz-input" type="number" min={l.min} max={l.max} step={l.step} value={v ?? ''} disabled={!canEdit}
          onChange={(e) => set(path, e.target.value === '' ? (def === null ? null : l.min) : Number(e.target.value))} />
      </Field>
    );
  };
  const toggle = (path: string, label: string, hint?: string) => (
    <label className="dz-check" title={hint}><input type="checkbox" checked={!!get(form, path)} disabled={!canEdit} onChange={(e) => set(path, e.target.checked)} /> {label}</label>
  );
  const select = (path: string, label: string, opts: [string, string][], hint?: string) => (
    <Field label={label} hint={hint}>
      <select className="dz-select" value={String(get(form, path))} disabled={!canEdit} onChange={(e) => set(path, e.target.value)}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
    </Field>
  );
  const domains = (path: string, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <textarea className="dz-textarea" style={{ minHeight: 90 }} dir="ltr" disabled={!canEdit} value={(get(form, path) as string[]).join('\n')}
        onChange={(e) => set(path, [...new Set(e.target.value.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean))])} />
    </Field>
  );
  const integ = (p: string) => data.integrations.find((i) => i.provider === p);

  return (
    <>
      <div className="dz-head">
        <div>
          <Link href="/dashboard/agent" className="dz-crumb">← {data.settings.runtime.name}</Link>
          <h1 className="display" style={{ marginTop: 10 }}>Agent settings</h1>
          <p>Everything here is stored in the database and used from the next message. Keys are kept in Supabase Vault — never in the page, the browser or the code.</p>
        </div>
      </div>
      {!canEdit ? <div className="dz-panel dz-panel--note" style={{ marginBottom: 18 }}>You can see these settings but not change them. Ask an admin.</div> : null}

      <div className="ag-settings">
        <Section title="Status" note="Diagnostics">
          <dl className="dz-kv">
            <dt>Agent</dt><dd>{data.settings.runtime.enabled ? 'On' : 'Off'}</dd>
            <dt>Gateway</dt><dd>{data.gateway.installed ? `Installed (v${data.gateway.version})` : <span className="dz-error">Not reachable — {data.gateway.error}. Deploy the agent-gateway Edge Function (setup guide, step 2).</span>}</dd>
            {(['fireworks', 'openrouter', 'tavily'] as const).map((p) => { const i = integ(p); return [
              <dt key={`${p}t`}>{PROVIDER_NAME[p]}</dt>,
              <dd key={`${p}d`}>{i?.configured ? <>Key {i.hint} · {i.status === 'ok' ? 'working' : i.status === 'error' ? <span className="dz-error">{i.last_error ?? 'error'}</span> : 'not tested'}{i.last_checked_at ? ` · checked ${timeAgo(i.last_checked_at)}` : ''}</> : 'No key'}</dd>,
            ]; })}
            {data.usage ? <><dt>Usage today</dt><dd>You {fmt(data.usage.user_today)} / {fmt(data.usage.user_limit)} tokens · team {fmt(data.usage.team_today)} / {fmt(data.usage.team_limit)} · {fmt(Number(data.usage.search_today))} search credits · {data.usage.errors_today} errors</dd>
              <dt>This month</dt><dd>You {fmt(data.usage.user_month)} tokens · team {fmt(data.usage.team_month)} tokens · estimated cost ${Number(data.usage.cost_month_estimate).toFixed(2)} <small className="dz-muted">(an estimate: reported by OpenRouter, or from the prices you enter below for Fireworks — not a bill)</small></dd></> : null}
          </dl>
          {data.errors.length ? <details style={{ marginTop: 12 }}><summary>Recent provider errors ({data.errors.length})</summary><ul>{data.errors.map((e, i) => <li key={i}><small>{timeAgo(e.at)} · {e.provider} {e.model ?? ''} · {e.kind}: {e.error}</small></li>)}</ul></details> : null}
        </Section>

        <Section title="Running" note="On / off, name, language">
          <div className="dz-grid">
            <Field label="Agent" hint="Off: nobody can start a reply. Saved conversations stay.">{toggle('runtime.enabled', 'The agent is on')}</Field>
            {select('runtime.language', 'Default reply language', [['auto', 'The language of each message'], ['ar', 'Arabic'], ['en', 'English']])}
            <Field label="Name" hint="1–60 characters. Shown in the chat and used by the agent for itself."><input className="dz-input" dir="auto" maxLength={60} value={form.runtime.name} disabled={!canEdit} onChange={(e) => set('runtime.name', e.target.value)} /></Field>
            <Field label="Description" hint="Up to 300 characters, shown on an empty chat."><input className="dz-input" dir="auto" maxLength={300} value={form.runtime.description} disabled={!canEdit} onChange={(e) => set('runtime.description', e.target.value)} /></Field>
          </div>
        </Section>

        <Section title="Connections" note="Keys and providers">
          <p className="dz-hint">Keys go from this page to the server over HTTPS, are tested, then stored encrypted in Supabase Vault. Only the agent gateway can read them; this page only ever shows the last four characters. The addresses are fixed — keys can’t be sent anywhere else.</p>
          {(['fireworks', 'openrouter', 'tavily'] as const).map((p) => <KeyRow key={p} provider={p} i={integ(p)} canKeys={canKeys} onDone={load} />)}
          <div className="dz-grid" style={{ marginTop: 16 }}>
            <Field label="OpenRouter" hint="Optional second provider. Needed to choose OpenRouter models below.">{toggle('providers.openrouter.enabled', 'Allow OpenRouter models')}</Field>
            {num('limits.request_timeout_seconds', 'Time limit for one model or search request')}
            {num('providers.fireworks.price_in', 'Fireworks price, input', 'Optional, for cost estimates only (Fireworks doesn’t report cost).')}
            {num('providers.fireworks.price_out', 'Fireworks price, output', 'Optional, for cost estimates only.')}
          </div>
        </Section>

        <Section title="Models" note="Which model does what">
          <ModelPick label="Chat model" hint="Answers and uses the tools. It must support tool calling and streaming." form={form} canEdit={canEdit} set={set} pPath="models.chat_provider" mPath="models.chat" integrations={data.integrations} need="tools" onProbed={load} />
          <ModelPick label="Vision model (optional)" hint="Looks at specimen images. Leave empty to switch image description off." form={form} canEdit={canEdit} set={set} pPath="models.vision_provider" mPath="models.vision" integrations={data.integrations} need="vision" onProbed={load} />
          <ModelPick label="Summary model (optional)" hint="Summarises long conversations. Empty = the chat model. A smaller, cheaper model is fine." form={form} canEdit={canEdit} set={set} pPath="models.summary_provider" mPath="models.summary" integrations={data.integrations} need={null} onProbed={load} />
          <div className="dz-grid">
            {num('models.temperature', 'Temperature', 'Lower = more consistent.')}
            {num('models.max_output_tokens', 'Longest reply')}
          </div>
          <div className="ag-subsection">
            <b>Fallback model</b>
            <p className="dz-hint">Used only when the chat model fails before writing anything, for the errors you tick. A change that was already approved is never run again — the fallback only answers. Every run records which model answered.</p>
            {toggle('models.fallback.enabled', 'Use a fallback model')}
            {form.models.fallback.enabled ? <>
              <ModelPick label="Fallback" hint="Should support tools like the chat model." form={form} canEdit={canEdit} set={set} pPath="models.fallback.provider" mPath="models.fallback.model" integrations={data.integrations} need="tools" onProbed={load} />
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {([['rate_limited', 'Rate limited'], ['upstream', 'Provider error'], ['network', 'Network / timeout']] as const).map(([k, t]) => (
                  <label key={k} className="dz-check"><input type="checkbox" disabled={!canEdit} checked={form.models.fallback.on_errors.includes(k)} onChange={(e) => set('models.fallback.on_errors', e.target.checked ? [...form.models.fallback.on_errors, k] : form.models.fallback.on_errors.filter((x) => x !== k))} /> {t}</label>
                ))}
              </div>
            </> : null}
          </div>
        </Section>

        <Section title="Web search" note="Tavily">
          <div className="dz-grid">
            {select('search.provider', 'Search provider', [['tavily', 'Tavily'], ['none', 'None (no web search)']])}
            {select('search.depth', 'Search depth', [['basic', 'Basic (1 credit per search)'], ['advanced', 'Advanced (2 credits, better for hard questions)']])}
            {num('search.max_results', 'Results per search')}
            {num('search.max_searches_per_run', 'Searches per reply', '0 = no web searches.')}
          </div>
        </Section>

        <Section title="Sources" note="Where to look">
          <div className="dz-grid">
            {domains('sources.preferred_domains', 'Preferred sites', 'One per line (e.g. myfonts.com). Shown first in results.')}
            {domains('sources.excluded_domains', 'Excluded sites', 'One per line. Never searched or opened.')}
            <Field label="Original sources" hint="Read the foundry’s or designer’s own site and the official shop first.">{toggle('sources.prefer_original', 'Prefer original sources')}</Field>
            {num('sources.max_page_chars', 'Text kept from one page')}
            {num('sources.retention_days', 'Keep sources and evidence for', 'Evidence attached to proposals is kept with the proposal.')}
          </div>
        </Section>

        <Section title="How it talks" note="Tone and team guidance">
          <div className="dz-grid">
            {select('behavior.tone', 'Tone', [['friendly', 'Friendly'], ['concise', 'Concise'], ['formal', 'Formal']])}
            {select('behavior.length', 'Reply length', [['short', 'Short'], ['medium', 'Medium'], ['detailed', 'Detailed']])}
            <Field label="Team editorial guidance" wide hint="Up to 4000 characters — style for descriptions, terms, spelling. It can’t switch off permissions, approvals, evidence rules or key protection.">
              <textarea className="dz-textarea" dir="auto" maxLength={4000} value={form.behavior.editorial_instructions} disabled={!canEdit} onChange={(e) => set('behavior.editorial_instructions', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Limits" note="Per reply and concurrency">
          <div className="dz-grid dz-grid--3">
            {num('limits.run_timeout_seconds', 'Time limit for a whole reply')}
            {num('limits.max_tool_steps', 'Tool steps per reply')}
            {num('limits.context_tokens', 'Conversation context')}
            {num('limits.run_token_budget', 'Token budget per reply')}
            {num('limits.user_concurrent_runs', 'Replies at once, per person')}
            {num('limits.team_concurrent_runs', 'Replies at once, whole team')}
            {num('limits.job_max_items', 'Records per batch job')}
            {num('proposals.ttl_hours', 'Proposals expire after')}
          </div>
        </Section>

        <Section title="Usage limits" note="Tokens per day">
          <div className="dz-grid dz-grid--3">
            {num('usage.user_daily_tokens', 'Per person')}
            {num('usage.team_daily_tokens', 'Whole team')}
            {num('usage.warn_at_percent', 'Warn in the chat at')}
          </div>
          <p className="dz-hint">Counted from what the provider reports for each request. Resets at midnight UTC.</p>
        </Section>

        <Section title="Memory" note="What it remembers">
          <div className="dz-grid">
            <Field label="Memory" hint="Off: no saved preferences are used or created. Conversations still have their own summary.">{toggle('memory.enabled', 'Remember preferences people ask it to remember')}</Field>
            {select('memory.scope', 'Scope', [['user', 'Each person’s preferences, in all their conversations'], ['conversation', 'Only within one conversation (no saved preferences)']])}
            {num('memory.retention_days', 'Forget preferences after')}
          </div>
          <MemoryList />
        </Section>

        <Section title="Tools" note="What the agent can do">
          <div className="ag-tools">
            {TOOL_NAMES.map((t) => (
              <label key={t} className="ag-tool"><input type="checkbox" disabled={!canEdit} checked={form.tools[t]} onChange={(e) => set(`tools.${t}`, e.target.checked)} />
                <span><b>{TOOLS[t].label}</b><small>{TOOLS[t].does}</small></span></label>
            ))}
          </div>
          <p className="dz-hint">There is no tool that saves, approves or runs database commands. Changes only happen when a person approves a proposal.</p>
        </Section>

        <Section title="Permissions" note="Who may do what">
          <p className="dz-hint">These add to the dashboard roles; they can’t give more. Rows marked “admins only” can never be given to editors, and the database checks every action again when it runs.{!canPerms ? ' Only admins can change this table.' : ''}</p>
          <div className="dz-tablewrap"><table className="dz-table">
            <thead><tr><th>Permission</th><th>Admin</th><th>Editor</th></tr></thead>
            <tbody>{PERM_KEYS.map((p) => {
              const def = PERMISSIONS[p] as { label: string; adminOnly?: boolean };
              return (
                <tr key={p}><td>{def.label}{def.adminOnly ? <small className="dz-muted"> · admins only</small> : null}</td>
                  {(['admin', 'editor'] as const).map((r) => {
                    const locked = !canPerms || (r === 'editor' && def.adminOnly) || (r === 'admin' && ['use', 'manage_settings', 'manage_secrets', 'manage_permissions'].includes(p));
                    return <td key={r}><input type="checkbox" aria-label={`${def.label} — ${r}`} disabled={locked} checked={r === 'admin' && ['use', 'manage_settings', 'manage_secrets', 'manage_permissions'].includes(p) ? true : form.permissions[p].includes(r)}
                      onChange={(e) => set(`permissions.${p}`, e.target.checked ? [...new Set([...form.permissions[p], r])] : form.permissions[p].filter((x) => x !== r))} /></td>;
                  })}
                </tr>
              );
            })}</tbody>
          </table></div>
        </Section>

        {data.log.length ? (
          <Section title="Changes to these settings" note="History">
            <ul className="ag-log">{data.log.map((l) => <li key={l.id}><small>{timeAgo(l.at)} · {l.user_email ?? 'someone'} · {l.section === 'secrets' ? Object.entries(l.changes).map(([k, v]) => `${k}: ${String(v)}`).join(', ') : `changed ${Object.keys(l.changes).join(', ')}`}</small></li>)}</ul>
          </Section>
        ) : null}
      </div>

      {canEdit ? (
        <div className="dz-savebar">
          <span className="dz-savebar__note">{problems.length ? <span className="dz-error">{problems.join(' · ')}</span> : changed.length ? `Unsaved changes: ${changed.join(', ')}` : 'All settings saved.'}</span>
          <button type="button" className="dz-btn" disabled={!changed.length || saving} onClick={() => { setForm(data.settings); setProblems([]); }}>Discard</button>
          <button type="button" className="dz-btn dz-btn--primary" disabled={!changed.length || saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      ) : null}
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="dz-section"><h2 className="dz-section__title">{title}{note ? <small>{note}</small> : null}</h2>{children}</section>;
}

function KeyRow({ provider, i, canKeys, onDone }: { provider: 'fireworks' | 'openrouter' | 'tavily'; i: Integration | undefined; canKeys: boolean; onDone: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (action: 'put' | 'test' | 'delete') => {
    setBusy(action); setMsg(null);
    try {
      const r = await agentApi<{ ok: boolean; message?: string }>('secrets', { action, provider, ...(action === 'put' ? { key } : {}) });
      setKey(''); // the key leaves the page's memory as soon as it's sent
      setMsg({ ok: r.ok !== false, text: action === 'delete' ? 'Key deleted.' : r.message ?? 'Done.' });
      onDone();
    } catch (e) { setKey(''); setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' }); toast(e instanceof Error ? e.message : 'Failed', 'err'); }
    finally { setBusy(null); }
  };
  return (
    <div className="ag-key">
      <div className="ag-key__head">
        <b>{PROVIDER_NAME[provider]}</b>
        <small className="dz-muted">{ENDPOINT[provider]} · {i?.configured ? `key ${i.hint}` : 'no key'}{provider === 'openrouter' ? ' · optional' : provider === 'tavily' ? ' · for web search' : ' · main provider'}</small>
      </div>
      {canKeys ? (
        <form className="dz-linkrow" onSubmit={(e) => { e.preventDefault(); if (key.trim()) run('put'); }} autoComplete="off">
          <input className="dz-input" type="password" autoComplete="new-password" spellCheck={false} placeholder={i?.configured ? 'Paste a new key to replace it' : 'Paste the API key'} value={key} onChange={(e) => setKey(e.target.value)} aria-label={`${PROVIDER_NAME[provider]} API key`} />
          <button type="submit" className="dz-btn dz-btn--primary dz-btn--sm" disabled={!key.trim() || !!busy}>{busy === 'put' ? 'Testing & saving…' : 'Save & test'}</button>
          {i?.configured ? <button type="button" className="dz-btn dz-btn--sm" disabled={!!busy} onClick={() => run('test')}>{busy === 'test' ? 'Testing…' : 'Test'}</button> : null}
          {i?.configured ? <ConfirmButton className="dz-btn dz-btn--sm dz-btn--danger" label="Delete the key?" onConfirm={() => run('delete')}>Delete</ConfirmButton> : null}
        </form>
      ) : <p className="dz-hint">Only admins can add or change keys.</p>}
      {msg ? <p className={msg.ok ? 'dz-hint' : 'dz-error'} role="status">{msg.text}</p> : i?.status === 'error' && i.last_error ? <p className="dz-error">{i.last_error}</p> : null}
    </div>
  );
}

function ModelPick(p: {
  label: string; hint: string; form: AgentSettings; canEdit: boolean; set: (path: string, v: unknown) => void; pPath: string; mPath: string;
  integrations: Integration[]; need: 'tools' | 'vision' | null; onProbed: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const provider = get(p.form, p.pPath) as LlmProviderId;
  const model = String(get(p.form, p.mPath) ?? '');
  const integ = p.integrations.find((i) => i.provider === provider);
  const models = integ?.models ?? [];
  const info = models.find((m) => m.id === model);
  const probe = integ?.probes?.[model];
  const tools = probe && typeof probe.tools === 'boolean' ? probe.tools : info?.tools ?? null;
  const mark = (v: boolean | null | undefined) => (v === true ? '✓' : v === false ? '✗' : '?');
  const warning = !model ? null
    : p.need === 'tools' && tools === false ? 'This model can’t call tools: the agent couldn’t search Fahress or the web with it. Choose another.'
    : p.need === 'vision' && info?.vision === false ? 'This model doesn’t accept images.'
    : p.need === 'tools' && tools === null ? 'Not verified yet: press “Check this model” to confirm it streams and calls tools.' : null;
  const check = async () => {
    setBusy(true);
    try {
      const r = await agentApi<{ probe: { tools?: boolean; stream?: boolean; error?: string } }>('models', { provider, model });
      toast(`Tools ${r.probe.tools ? 'work' : 'don’t work'} · streaming ${r.probe.stream ? 'works' : 'doesn’t work'}${r.probe.error ? ` — ${r.probe.error}` : ''}`, r.probe.tools && r.probe.stream ? 'ok' : 'err');
      p.onProbed();
    } catch (e) { toast(e instanceof Error ? e.message : 'Check failed', 'err'); } finally { setBusy(false); }
  };
  const listId = `models-${p.mPath.replace(/\./g, '-')}`;
  return (
    <div className="ag-model">
      <Field label={p.label} hint={p.hint}>
        <div className="dz-linkrow">
          <select className="dz-select" style={{ maxWidth: 160 }} value={provider} disabled={!p.canEdit} onChange={(e) => p.set(p.pPath, e.target.value)}>
            <option value="fireworks">Fireworks</option><option value="openrouter">OpenRouter</option>
          </select>
          <input className="dz-input" list={listId} dir="ltr" placeholder={models.length ? 'Choose or type a model id' : 'Save and test the key to list models'} value={model} disabled={!p.canEdit} onChange={(e) => p.set(p.mPath, e.target.value.trim())} />
          <datalist id={listId}>{models.filter((m) => p.need !== 'vision' || m.vision !== false).slice(0, 800).map((m) => <option key={m.id} value={m.id}>{`${m.name} · tools ${mark(m.tools)} · images ${mark(m.vision)}${m.context ? ` · ${Math.round(m.context / 1000)}k context` : ''}`}</option>)}</datalist>
          {model && p.need !== 'vision' ? <button type="button" className="dz-btn dz-btn--sm" disabled={busy || !integ?.configured || !p.canEdit} onClick={check}>{busy ? 'Checking…' : 'Check this model'}</button> : null}
        </div>
      </Field>
      {model ? <small className="dz-muted">Tool calling {mark(tools)} · images {mark(info?.vision)} · structured output {mark(info?.structured)}{info?.context ? ` · ${fmt(info.context)} tokens context` : ''}{probe?.at ? ` · checked ${timeAgo(probe.at)}${probe.stream === false ? ' (streaming failed)' : ''}` : ''}</small> : null}
      {warning ? <p className={tools === false || info?.vision === false ? 'dz-error' : 'dz-hint'}>{warning}</p> : null}
    </div>
  );
}

function MemoryList() {
  const toast = useToast();
  const [list, setList] = useState<{ id: string; content: string; created_at: string; expires_at: string | null }[] | null>(null);
  const load = () => agentApi<{ memories: NonNullable<typeof list> }>('memory').then((r) => setList(r.memories)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const del = async (body: Record<string, unknown>, msg: string) => { try { await agentApi('memory', body, 'DELETE'); toast(msg); load(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } };
  return (
    <div className="ag-subsection">
      <b>Your saved preferences</b> <small className="dz-muted">— private to you; nobody else on the team sees them.</small>
      {list === null ? <p className="dz-muted">Loading…</p> : list.length === 0 ? <p className="dz-muted">Nothing saved.</p> : (
        <ul className="ag-log">{list.map((m) => <li key={m.id} dir="auto">{m.content} <small className="dz-muted">· {timeAgo(m.created_at)}</small> <button type="button" className="dz-link" onClick={() => del({ id: m.id }, 'Forgotten')}>Forget</button></li>)}</ul>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ConfirmButton className="dz-btn dz-btn--sm" label="Forget all preferences?" onConfirm={() => del({ all: true }, 'All preferences forgotten')}>Forget all my preferences</ConfirmButton>
        <ConfirmButton className="dz-btn dz-btn--sm" label="Clear all summaries?" onConfirm={() => del({ summaries: true }, 'Conversation summaries cleared')}>Clear my conversation summaries</ConfirmButton>
      </div>
    </div>
  );
}
