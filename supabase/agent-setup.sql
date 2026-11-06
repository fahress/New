-- ============================================================================
-- Fahress — "Fahress Agent" database update
-- Run once in Supabase → SQL Editor (safe to run again). Requires dashboard-setup.sql.
--
-- What this adds
--   * agent settings, integrations status (never the keys themselves)
--   * API keys in Supabase Vault (encrypted with a root key Supabase keeps outside the
--     database); only the `agent-gateway` Edge Function (service role) can read them
--   * conversations, messages, runs, tool calls, sources & evidence, memory, usage, jobs,
--     image staging, change proposals and approvals
--   * agent_execute_proposal(): runs an approved proposal inside one transaction, under the
--     caller's own row-level security, with version, permission and conflict checks
--   * tighter rules on the font ↔ tag / designer link tables (section 12)
--
-- It does not delete existing data. Section 12 replaces the "dashboard staff write" rules
-- on the seven font link tables so editors can only change links of draft / in-review fonts
-- (the same limit the fonts table already has).
-- ============================================================================

create schema if not exists agent_private;
revoke all on schema agent_private from public, anon;
grant usage on schema agent_private to authenticated, service_role;

-- 0. Arabic text fields (optional, nullable) -----------------------------------
alter table public.fonts add column if not exists description_ar text;
alter table public.designers add column if not exists bio_ar text;

-- 1. Permissions ----------------------------------------------------------------
-- Permission keys. Admins always keep use / manage_settings / manage_secrets / manage_permissions
-- (so nobody can lock the team out). Editors can never be given the keys in editor_denied().
create or replace function agent_private.default_permissions() returns jsonb
language sql immutable as $$
  select '{
    "use": ["admin", "editor"],
    "read_drafts": ["admin", "editor"],
    "read_history": ["admin", "editor"],
    "propose": ["admin", "editor"],
    "start_jobs": ["admin"],
    "approve_font_draft": ["admin", "editor"],
    "approve_font_published": ["admin"],
    "approve_publish": ["admin"],
    "approve_people": ["admin", "editor"],
    "approve_taxonomy": ["admin"],
    "approve_images": ["admin", "editor"],
    "approve_merge": ["admin"],
    "approve_delete": ["admin"],
    "approve_restore": ["admin"],
    "approve_bulk": ["admin"],
    "manage_settings": ["admin"],
    "manage_secrets": ["admin"],
    "manage_permissions": ["admin"],
    "view_team_usage": ["admin"]
  }'::jsonb
$$;

create or replace function agent_private.editor_denied() returns text[]
language sql immutable as $$
  select array['approve_font_published', 'approve_publish', 'approve_merge', 'approve_delete', 'approve_restore', 'manage_secrets', 'manage_permissions']
$$;

create table if not exists public.agent_settings (
  id smallint primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 200000),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.agent_settings enable row level security;
insert into public.agent_settings (id, config) values (1, '{}'::jsonb) on conflict (id) do nothing;

create or replace function public.agent_can_for(p_user uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_list jsonb;
begin
  if p_user is null or p_perm is null then return false; end if;
  select role into v_role from public.dashboard_roles where user_id = p_user;
  if v_role is null then return false; end if;
  if not (agent_private.default_permissions() ? p_perm) then return false; end if;
  if v_role = 'admin' and p_perm in ('use', 'manage_settings', 'manage_secrets', 'manage_permissions') then return true; end if;
  if v_role <> 'admin' and p_perm = any (agent_private.editor_denied()) then return false; end if;
  select s.config -> 'permissions' -> p_perm into v_list from public.agent_settings s where s.id = 1;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then v_list := agent_private.default_permissions() -> p_perm; end if;
  return coalesce(v_list ? v_role, false);
end $$;

create or replace function public.agent_can(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.agent_can_for(auth.uid(), p_perm)
$$;

/** Everything the caller may do, for the dashboard to show and hide buttons (the database still checks each action). */
create or replace function public.agent_my_permissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', (select role from public.dashboard_roles where user_id = auth.uid()),
    'permissions', coalesce((select jsonb_object_agg(k, public.agent_can_for(auth.uid(), k)) from jsonb_object_keys(agent_private.default_permissions()) k), '{}'::jsonb)
  )
$$;

create or replace function agent_private.require(p_perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agent_can_for(auth.uid(), p_perm) then
    raise exception 'Your account is not allowed to do this through the agent (needs “%”).', p_perm using errcode = 'AG403';
  end if;
end $$;

drop policy if exists "team reads agent settings" on public.agent_settings;
create policy "team reads agent settings" on public.agent_settings for select to authenticated using (public.is_dashboard_staff());

-- 2. Settings changes -----------------------------------------------------------
create table if not exists public.agent_settings_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  section text not null,
  changes jsonb not null default '{}'::jsonb
);
alter table public.agent_settings_log enable row level security;
create index if not exists agent_settings_log_at_idx on public.agent_settings_log (at desc);
drop policy if exists "settings managers read the settings log" on public.agent_settings_log;
create policy "settings managers read the settings log" on public.agent_settings_log for select to authenticated
  using (public.agent_can('manage_settings') or public.agent_can('manage_secrets'));

/** Saves the agent settings. The dashboard validates the shape first; this checks permissions, the
 *  version (no silent overwrite of someone else's save) and records which keys changed. */
create or replace function public.agent_save_settings(p_config jsonb, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur public.agent_settings;
  v_changed jsonb := '{}'::jsonb;
  k text;
begin
  if not public.agent_can('manage_settings') then raise exception 'Only people allowed to manage the agent can change its settings.' using errcode = 'AG403'; end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then raise exception 'Settings must be an object.' using errcode = 'AG422'; end if;
  select * into v_cur from public.agent_settings where id = 1 for update;
  if v_cur.version <> p_expected_version then
    raise exception 'Someone else saved the settings in the meantime. Reload the page to see their changes.' using errcode = 'AG409';
  end if;
  if (v_cur.config -> 'permissions') is distinct from (p_config -> 'permissions') and not public.agent_can('manage_permissions') then
    raise exception 'Only admins can change who may use or approve with the agent.' using errcode = 'AG403';
  end if;
  for k in select distinct x from (select jsonb_object_keys(v_cur.config) x union select jsonb_object_keys(p_config)) s loop
    if (v_cur.config -> k) is distinct from (p_config -> k) then
      v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('before', v_cur.config -> k, 'after', p_config -> k));
    end if;
  end loop;
  update public.agent_settings set config = p_config, version = version + 1, updated_at = now(), updated_by = auth.uid() where id = 1;
  if v_changed <> '{}'::jsonb then
    insert into public.agent_settings_log (user_id, user_email, section, changes)
    values (auth.uid(), auth.jwt() ->> 'email', 'settings', v_changed);
  end if;
  return jsonb_build_object('version', v_cur.version + 1, 'changed', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_object_keys(v_changed) x));
end $$;

-- 3. Integrations & keys (Supabase Vault) ---------------------------------------
-- The key itself is only ever in vault.secrets. This table holds status for the dashboard.
create table if not exists public.agent_integrations (
  provider text primary key check (provider in ('fireworks', 'openrouter', 'tavily')),
  vault_secret_id uuid,
  configured boolean not null default false,
  hint text check (char_length(hint) <= 16),
  status text not null default 'untested' check (status in ('untested', 'ok', 'error')),
  last_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) < 200000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.agent_integrations enable row level security;
revoke insert, update, delete on public.agent_integrations from anon, authenticated;
drop policy if exists "team reads integration status" on public.agent_integrations;
create policy "team reads integration status" on public.agent_integrations for select to authenticated using (public.is_dashboard_staff());

-- Only the gateway (service role) calls these three. Nobody signed in to the dashboard can read a key back.
create or replace function public.agent_vault_put(p_provider text, p_secret text, p_hint text, p_user uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid; v_name text := 'fahress_agent_' || p_provider;
begin
  if p_provider not in ('fireworks', 'openrouter', 'tavily') then raise exception 'Unknown provider' using errcode = 'AG422'; end if;
  if p_secret is null or char_length(p_secret) < 8 or char_length(p_secret) > 400 then raise exception 'Invalid key' using errcode = 'AG422'; end if;
  if not public.agent_can_for(p_user, 'manage_secrets') then raise exception 'Not allowed' using errcode = 'AG403'; end if;
  select vault_secret_id into v_id from public.agent_integrations where provider = p_provider;
  if v_id is null or not exists (select 1 from vault.secrets where id = v_id) then
    select id into v_id from vault.secrets where name = v_name;
  end if;
  if v_id is null then
    v_id := vault.create_secret(p_secret, v_name, 'Fahress agent API key: ' || p_provider);
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
  insert into public.agent_integrations (provider, vault_secret_id, configured, hint, status, last_error, updated_at, updated_by)
  values (p_provider, v_id, true, p_hint, 'untested', null, now(), p_user)
  on conflict (provider) do update set vault_secret_id = excluded.vault_secret_id, configured = true, hint = excluded.hint,
    status = 'untested', last_error = null, updated_at = now(), updated_by = p_user;
  insert into public.agent_settings_log (user_id, user_email, section, changes)
  values (p_user, (select email from auth.users where id = p_user), 'secrets', jsonb_build_object(p_provider, 'key saved (ending ' || coalesce(p_hint, '') || ')'));
end $$;

create or replace function public.agent_vault_delete(p_provider text, p_user uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if not public.agent_can_for(p_user, 'manage_secrets') then raise exception 'Not allowed' using errcode = 'AG403'; end if;
  select vault_secret_id into v_id from public.agent_integrations where provider = p_provider;
  if v_id is not null then delete from vault.secrets where id = v_id; end if;
  delete from vault.secrets where name = 'fahress_agent_' || p_provider;
  update public.agent_integrations set vault_secret_id = null, configured = false, hint = null, status = 'untested', last_error = null,
    details = '{}'::jsonb, updated_at = now(), updated_by = p_user where provider = p_provider;
  insert into public.agent_settings_log (user_id, user_email, section, changes)
  values (p_user, (select email from auth.users where id = p_user), 'secrets', jsonb_build_object(p_provider, 'key deleted'));
end $$;

create or replace function public.agent_vault_read(p_provider text) returns text
language sql stable security definer set search_path = public, vault as $$
  select d.decrypted_secret from vault.decrypted_secrets d
  join public.agent_integrations i on i.vault_secret_id = d.id
  where i.provider = p_provider and i.configured
$$;

create or replace function public.agent_integration_status(p_provider text, p_status text, p_error text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  update public.agent_integrations set status = p_status, last_error = left(p_error, 500), last_checked_at = now(),
    details = case when p_details is null then details else details || p_details end
  where provider = p_provider
$$;

-- 4. Conversations, messages, runs, tool calls ----------------------------------
create table if not exists public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 200),
  title_auto boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  head_message_id uuid,
  context_type text check (context_type in ('font', 'designer', 'foundry')),
  context_id uuid,
  summary text check (char_length(summary) <= 8000),
  summary_upto uuid,
  focus jsonb not null default '[]'::jsonb check (jsonb_typeof(focus) = 'array' and pg_column_size(focus) < 20000),
  decisions jsonb not null default '[]'::jsonb check (jsonb_typeof(decisions) = 'array' and pg_column_size(decisions) < 20000)
);
alter table public.agent_conversations enable row level security;
create index if not exists agent_conversations_owner_idx on public.agent_conversations (owner_id, updated_at desc);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.agent_messages(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (char_length(content) <= 60000),
  status text not null default 'complete' check (status in ('complete', 'streaming', 'error', 'stopped')),
  run_id uuid,
  client_request_id text check (char_length(client_request_id) <= 80),
  cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array' and pg_column_size(cards) < 100000),
  progress jsonb not null default '[]'::jsonb check (jsonb_typeof(progress) = 'array' and pg_column_size(progress) < 20000),
  error text check (char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, client_request_id)
);
alter table public.agent_messages enable row level security;
create index if not exists agent_messages_conv_idx on public.agent_messages (conversation_id, created_at);
create index if not exists agent_messages_parent_idx on public.agent_messages (parent_id);
create index if not exists agent_messages_search_idx on public.agent_messages using gin (to_tsvector('simple', content));

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete cascade,
  job_item_id uuid,
  user_message_id uuid,
  assistant_message_id uuid,
  kind text not null default 'chat' check (kind in ('chat', 'job')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'stopped', 'limit', 'interrupted')),
  idempotency_key text check (char_length(idempotency_key) <= 120),
  provider text,
  model text,
  fallback_used boolean not null default false,
  steps int not null default 0,
  max_steps int not null default 8,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  search_credits numeric not null default 0,
  estimated_cost_usd numeric not null default 0,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  error text check (char_length(error) <= 1000),
  unique (owner_id, idempotency_key)
);
alter table public.agent_runs enable row level security;
create index if not exists agent_runs_status_idx on public.agent_runs (status, heartbeat_at);
create index if not exists agent_runs_owner_idx on public.agent_runs (owner_id, started_at desc);
-- the engine (signed in as the person) may update progress fields only; usage is written by the gateway
revoke insert, update, delete on public.agent_runs from anon, authenticated;
grant update (status, steps, provider, model, fallback_used, heartbeat_at, finished_at, error, assistant_message_id) on public.agent_runs to authenticated;

create table if not exists public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idx int not null,
  name text not null check (char_length(name) <= 64),
  input jsonb not null default '{}'::jsonb check (pg_column_size(input) < 20000),
  output jsonb check (pg_column_size(output) < 200000),
  status text not null check (status in ('ok', 'error', 'rejected')),
  error text check (char_length(error) <= 1000),
  duration_ms int,
  created_at timestamptz not null default now(),
  unique (run_id, idx)
);
alter table public.agent_tool_calls enable row level security;
create index if not exists agent_tool_calls_run_idx on public.agent_tool_calls (run_id, idx);

drop policy if exists "own conversations" on public.agent_conversations;
create policy "own conversations" on public.agent_conversations for all to authenticated
  using (owner_id = auth.uid() and public.agent_can('use')) with check (owner_id = auth.uid() and public.agent_can('use'));
drop policy if exists "own messages" on public.agent_messages;
create policy "own messages" on public.agent_messages for all to authenticated
  using (owner_id = auth.uid() and public.agent_can('use'))
  with check (owner_id = auth.uid() and public.agent_can('use') and exists (select 1 from public.agent_conversations c where c.id = conversation_id and c.owner_id = auth.uid()));
drop policy if exists "own runs" on public.agent_runs;
create policy "own runs" on public.agent_runs for select to authenticated using (owner_id = auth.uid());
drop policy if exists "own runs update" on public.agent_runs;
create policy "own runs update" on public.agent_runs for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "own tool calls" on public.agent_tool_calls;
create policy "own tool calls" on public.agent_tool_calls for select to authenticated using (owner_id = auth.uid());
drop policy if exists "own tool calls insert" on public.agent_tool_calls;
create policy "own tool calls insert" on public.agent_tool_calls for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.agent_runs r where r.id = run_id and r.owner_id = auth.uid() and r.status = 'running'));

create or replace function agent_private.cfg_int(p_path text[], p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select config #>> p_path from public.agent_settings where id = 1), '')::int, p_default)
$$;
create or replace function agent_private.cfg_bigint(p_path text[], p_default bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select config #>> p_path from public.agent_settings where id = 1), '')::bigint, p_default)
$$;

/** Starts a run after checking the agent is on, the person may use it, and the concurrency and usage limits.
 *  The same idempotency key returns the same run instead of starting a second one. */
create or replace function public.agent_start_run(p_conversation uuid, p_user_message uuid, p_kind text, p_idempotency text, p_job_item uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_run public.agent_runs;
  v_running int; v_team int; v_used bigint; v_team_used bigint;
  v_enabled text;
begin
  if not public.agent_can('use') then raise exception 'Your account is not allowed to use the agent.' using errcode = 'AG403'; end if;
  select config #>> '{runtime,enabled}' into v_enabled from public.agent_settings where id = 1;
  if coalesce(v_enabled, 'false') <> 'true' then raise exception 'The agent is switched off in its settings.' using errcode = 'AG423'; end if;
  if p_kind not in ('chat', 'job') then raise exception 'Unknown run kind' using errcode = 'AG422'; end if;
  if p_conversation is not null and not exists (select 1 from public.agent_conversations where id = p_conversation and owner_id = v_uid) then
    raise exception 'Conversation not found.' using errcode = 'AG404';
  end if;
  if p_idempotency is not null then
    select * into v_run from public.agent_runs where owner_id = v_uid and idempotency_key = p_idempotency;
    if found then return to_jsonb(v_run) || jsonb_build_object('existing', true); end if;
  end if;
  -- runs whose worker stopped answering are closed so they don't count against the limits
  update public.agent_runs set status = 'interrupted', finished_at = now(), error = 'The run stopped answering (connection or server restart).'
  where status = 'running' and heartbeat_at < now() - interval '3 minutes';
  perform pg_advisory_xact_lock(hashtext('agent_start_run'));
  select count(*) into v_running from public.agent_runs where owner_id = v_uid and status = 'running';
  select count(*) into v_team from public.agent_runs where status = 'running';
  if v_running >= agent_private.cfg_int('{limits,user_concurrent_runs}', 2) then
    raise exception 'You already have % agent replies running. Wait for one to finish or stop it.', v_running using errcode = 'AG429';
  end if;
  if v_team >= agent_private.cfg_int('{limits,team_concurrent_runs}', 6) then
    raise exception 'The team is running the maximum number of agent replies right now. Try again in a minute.' using errcode = 'AG429';
  end if;
  select coalesce(sum(input_tokens + output_tokens), 0) into v_used from public.agent_usage where owner_id = v_uid and at >= date_trunc('day', now());
  select coalesce(sum(input_tokens + output_tokens), 0) into v_team_used from public.agent_usage where at >= date_trunc('day', now());
  if v_used >= agent_private.cfg_bigint('{usage,user_daily_tokens}', 2000000) then
    raise exception 'You reached your daily agent limit. It resets at midnight (UTC), or an admin can raise it in the agent settings.' using errcode = 'AG429';
  end if;
  if v_team_used >= agent_private.cfg_bigint('{usage,team_daily_tokens}', 10000000) then
    raise exception 'The team reached its daily agent limit. It resets at midnight (UTC), or an admin can raise it in the agent settings.' using errcode = 'AG429';
  end if;
  insert into public.agent_runs (owner_id, conversation_id, user_message_id, kind, idempotency_key, max_steps, job_item_id)
  values (v_uid, p_conversation, p_user_message, p_kind, p_idempotency, agent_private.cfg_int('{limits,max_tool_steps}', 8), p_job_item)
  returning * into v_run;
  return to_jsonb(v_run) || jsonb_build_object('existing', false,
    'usage', jsonb_build_object('user_today', v_used, 'team_today', v_team_used,
      'user_limit', agent_private.cfg_bigint('{usage,user_daily_tokens}', 2000000), 'team_limit', agent_private.cfg_bigint('{usage,team_daily_tokens}', 10000000)));
end $$;

/** Moves the conversation to another branch (after editing a message or regenerating a reply).
 *  Pending proposals made on the replaced branch are superseded so they can't be approved by mistake. */
create or replace function public.agent_set_head(p_conversation uuid, p_head uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not exists (select 1 from public.agent_conversations where id = p_conversation and owner_id = auth.uid()) then
    raise exception 'Conversation not found.' using errcode = 'AG404';
  end if;
  if p_head is not null and not exists (select 1 from public.agent_messages where id = p_head and conversation_id = p_conversation) then
    raise exception 'Message not found.' using errcode = 'AG404';
  end if;
  update public.agent_conversations set head_message_id = p_head, updated_at = now() where id = p_conversation;
  with recursive path as (
    select id, parent_id from public.agent_messages where id = p_head
    union all
    select m.id, m.parent_id from public.agent_messages m join path p on m.id = p.parent_id
  )
  update public.agent_proposals pr set status = 'superseded', updated_at = now(), error = 'Replaced by an edited message or a new reply.'
  where pr.conversation_id = p_conversation and pr.status = 'pending'
    and pr.message_id is not null and pr.message_id not in (select id from path);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 5. Sources & evidence ---------------------------------------------------------
create table if not exists public.agent_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete cascade,
  tool_call_id uuid, -- the tool call that opened it (that row is written when the tool finishes)
  kind text not null check (kind in ('web', 'pdf', 'search_result', 'archive')),
  url text not null check (char_length(url) <= 2000),
  title text check (char_length(title) <= 500),
  publisher text check (char_length(publisher) <= 200),
  excerpt text check (char_length(excerpt) <= 4000),
  page int,
  published_at text check (published_at ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  published_precision text check (published_precision in ('year', 'month', 'day')),
  modified_at text check (modified_at ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  retrieved_at timestamptz not null default now(),
  opened boolean not null default false,
  content_hash text,
  expires_at timestamptz not null default now() + interval '90 days'
);
alter table public.agent_sources enable row level security;
create index if not exists agent_sources_run_idx on public.agent_sources (run_id);
create index if not exists agent_sources_conv_idx on public.agent_sources (conversation_id);

-- one row per claim (a field value and the evidence for it)
create table if not exists public.agent_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete cascade,
  entity_type text check (entity_type in ('font', 'designer', 'foundry')),
  entity_id uuid,
  field text not null check (char_length(field) <= 60),
  value jsonb,
  source_id uuid references public.agent_sources(id) on delete cascade,
  excerpt text check (char_length(excerpt) <= 1500),
  date_kind text check (date_kind in ('release', 'first_seen', 'update', 'design', 'page_published', 'page_updated', 'award', 'added_to_archive', 'other')),
  date_precision text check (date_precision in ('year', 'month', 'day')),
  status text not null check (status in ('supported', 'inferred', 'conflicting', 'unverified')),
  rationale text check (char_length(rationale) <= 1500),
  created_at timestamptz not null default now()
);
alter table public.agent_claims enable row level security;
create index if not exists agent_claims_entity_idx on public.agent_claims (entity_type, entity_id);

-- 6. Images found on the web, waiting for review --------------------------------
create table if not exists public.agent_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete set null,
  run_id uuid references public.agent_runs(id) on delete set null,
  source_url text not null check (char_length(source_url) <= 2000),
  page_url text check (char_length(page_url) <= 2000),
  staging_path text not null check (char_length(staging_path) <= 300),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  dhash text check (dhash ~ '^[0-9a-f]{16}$'),
  mime text not null check (mime in ('image/webp', 'image/png', 'image/jpeg', 'image/gif')),
  bytes int not null check (bytes > 0 and bytes <= 20000000),
  width int not null check (width > 0),
  height int not null check (height > 0),
  kind text not null default 'unknown' check (kind in ('specimen', 'designer_photo', 'foundry_logo', 'unknown')),
  status text not null default 'staged' check (status in ('staged', 'attached', 'discarded')),
  attached_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.agent_assets enable row level security;
create index if not exists agent_assets_owner_idx on public.agent_assets (owner_id, status);
revoke update on public.agent_assets from anon, authenticated;
grant update (status, kind) on public.agent_assets to authenticated;

insert into storage.buckets (id, name, public) values ('agent-staging', 'agent-staging', false) on conflict (id) do nothing;
drop policy if exists "agent staging own files" on storage.objects;
create policy "agent staging own files" on storage.objects for all to authenticated
  using (bucket_id = 'agent-staging' and (storage.foldername(name))[1] = auth.uid()::text and public.is_dashboard_staff())
  with check (bucket_id = 'agent-staging' and (storage.foldername(name))[1] = auth.uid()::text and public.is_dashboard_staff());
drop policy if exists "agent staging review" on storage.objects;
create policy "agent staging review" on storage.objects for select to authenticated
  using (bucket_id = 'agent-staging' and public.agent_can('approve_images'));

-- An approved image is copied to studio/agent/… just before the change runs. If the change is refused,
-- the dashboard removes that copy again — only while no font or profile uses it.
create or replace function public.agent_studio_unused(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.fonts f where f.cover = p_name or to_jsonb(f.images) ? p_name)
     and not exists (select 1 from public.designers d where d.logo = p_name)
$$;
grant execute on function public.agent_studio_unused(text) to authenticated;
drop policy if exists "agent removes its unused uploads" on storage.objects;
create policy "agent removes its unused uploads" on storage.objects for delete to authenticated
  using (bucket_id = 'studio' and name like 'agent/%' and public.is_dashboard_staff() and public.agent_studio_unused(name));

-- 7. Proposals & approvals ------------------------------------------------------
create table if not exists public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete set null,
  message_id uuid,
  run_id uuid references public.agent_runs(id) on delete set null,
  tool_call_id uuid unique,
  version int not null default 1,
  status text not null default 'pending' check (status in ('pending', 'executing', 'executed', 'rejected', 'cancelled', 'expired', 'conflict', 'failed', 'superseded')),
  kind text not null check (char_length(kind) <= 40),
  title text not null check (char_length(title) <= 300),
  reason text check (char_length(reason) <= 4000),
  impact text check (char_length(impact) <= 2000),
  targets jsonb not null default '[]'::jsonb check (jsonb_typeof(targets) = 'array'),
  changes jsonb not null check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) between 1 and 60 and pg_column_size(changes) < 200000),
  base jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) < 200000),
  submitted_for_review boolean not null default false,
  expires_at timestamptz not null default now() + interval '72 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_at timestamptz,
  executed_by uuid,
  result jsonb,
  error text check (char_length(error) <= 2000)
);
alter table public.agent_proposals enable row level security;
create index if not exists agent_proposals_owner_idx on public.agent_proposals (owner_id, created_at desc);
create index if not exists agent_proposals_status_idx on public.agent_proposals (status, submitted_for_review);
revoke insert, update, delete on public.agent_proposals from anon, authenticated;

create or replace function agent_private.can_approve_anything() returns boolean
language sql stable security definer set search_path = public as $$
  select public.agent_can('approve_font_draft') or public.agent_can('approve_font_published') or public.agent_can('approve_people')
    or public.agent_can('approve_merge') or public.agent_can('approve_delete') or public.agent_can('approve_images')
$$;
grant execute on function agent_private.can_approve_anything() to authenticated;

drop policy if exists "own or shared proposals" on public.agent_proposals;
create policy "own or shared proposals" on public.agent_proposals for select to authenticated
  using (owner_id = auth.uid() or (submitted_for_review and agent_private.can_approve_anything()));

create table if not exists public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.agent_proposals(id) on delete cascade,
  proposal_version int not null,
  approver_id uuid not null,
  approver_email text,
  approver_role text,
  selected_ops text[] not null,
  request_id text not null unique check (char_length(request_id) <= 80),
  outcome text not null check (outcome in ('executed', 'conflict', 'failed')),
  result jsonb,
  decided_at timestamptz not null default now(),
  unique (proposal_id, proposal_version)
);
alter table public.agent_approvals enable row level security;
revoke insert, update, delete on public.agent_approvals from anon, authenticated;
drop policy if exists "approvals of visible proposals" on public.agent_approvals;
create policy "approvals of visible proposals" on public.agent_approvals for select to authenticated
  using (approver_id = auth.uid() or exists (select 1 from public.agent_proposals p where p.id = proposal_id and p.owner_id = auth.uid()) or public.is_dashboard_admin());

drop policy if exists "own sources" on public.agent_sources;
create policy "own sources" on public.agent_sources for select to authenticated
  using (owner_id = auth.uid());
drop policy if exists "own sources insert" on public.agent_sources;
create policy "own sources insert" on public.agent_sources for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.agent_runs r where r.id = run_id and r.owner_id = auth.uid()));
drop policy if exists "own claims" on public.agent_claims;
create policy "own claims" on public.agent_claims for select to authenticated using (owner_id = auth.uid());
drop policy if exists "own claims insert" on public.agent_claims;
create policy "own claims insert" on public.agent_claims for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.agent_runs r where r.id = run_id and r.owner_id = auth.uid()));
drop policy if exists "own assets" on public.agent_assets;
create policy "own assets" on public.agent_assets for select to authenticated
  using (owner_id = auth.uid() or public.agent_can('approve_images'));
drop policy if exists "own assets insert" on public.agent_assets;
create policy "own assets insert" on public.agent_assets for insert to authenticated
  with check (owner_id = auth.uid() and status = 'staged' and staging_path like auth.uid()::text || '/%' and public.agent_can('use'));
drop policy if exists "own assets update" on public.agent_assets;
create policy "own assets update" on public.agent_assets for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and status in ('staged', 'discarded'));

-- 8. Memory --------------------------------------------------------------------
create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'preference' check (kind in ('preference', 'note')),
  content text not null check (char_length(content) between 1 and 600),
  source_conversation_id uuid references public.agent_conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);
alter table public.agent_memories enable row level security;
create index if not exists agent_memories_owner_idx on public.agent_memories (owner_id, updated_at desc);
drop policy if exists "own memories" on public.agent_memories;
create policy "own memories" on public.agent_memories for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.agent_can('use'));

-- 9. Usage (written only by the gateway, from what the provider reports) ----------
create table if not exists public.agent_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  provider text not null,
  model text,
  kind text not null check (kind in ('chat', 'vision', 'summary', 'search', 'extract', 'test')),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  credits numeric not null default 0,
  estimated_cost_usd numeric not null default 0,
  reported boolean not null default true,
  ok boolean not null default true,
  error text check (char_length(error) <= 300),
  duration_ms int
);
alter table public.agent_usage enable row level security;
create index if not exists agent_usage_owner_at_idx on public.agent_usage (owner_id, at desc);
create index if not exists agent_usage_at_idx on public.agent_usage (at desc);
revoke insert, update, delete on public.agent_usage from anon, authenticated;
drop policy if exists "own usage or team usage for admins" on public.agent_usage;
create policy "own usage or team usage for admins" on public.agent_usage for select to authenticated
  using (owner_id = auth.uid() or public.agent_can('view_team_usage'));

create or replace function public.agent_usage_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.agent_can('use') then null else jsonb_build_object(
    'user_today', (select coalesce(sum(input_tokens + output_tokens), 0) from public.agent_usage where owner_id = auth.uid() and at >= date_trunc('day', now())),
    'team_today', (select coalesce(sum(input_tokens + output_tokens), 0) from public.agent_usage where at >= date_trunc('day', now())),
    'user_month', (select coalesce(sum(input_tokens + output_tokens), 0) from public.agent_usage where owner_id = auth.uid() and at >= date_trunc('month', now())),
    'team_month', (select coalesce(sum(input_tokens + output_tokens), 0) from public.agent_usage where at >= date_trunc('month', now())),
    'search_today', (select coalesce(sum(credits), 0) from public.agent_usage where at >= date_trunc('day', now()) and kind in ('search', 'extract')),
    'cost_month_estimate', (select coalesce(sum(estimated_cost_usd), 0) from public.agent_usage where at >= date_trunc('month', now())),
    'errors_today', (select count(*) from public.agent_usage where at >= date_trunc('day', now()) and not ok),
    'user_limit', agent_private.cfg_bigint('{usage,user_daily_tokens}', 2000000),
    'team_limit', agent_private.cfg_bigint('{usage,team_daily_tokens}', 10000000)
  ) end
$$;

/** Gateway check before every provider call: the run is the caller's, still running, and within its limits. */
create or replace function public.agent_gateway_authorize(p_user uuid, p_run uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_run public.agent_runs; v_used bigint; v_team bigint; v_cfg jsonb;
begin
  select config into v_cfg from public.agent_settings where id = 1;
  if p_kind = 'test' then
    if not (public.agent_can_for(p_user, 'manage_secrets') or public.agent_can_for(p_user, 'manage_settings')) then
      return jsonb_build_object('ok', false, 'code', 403, 'message', 'Only people who manage the agent can test connections.');
    end if;
    return jsonb_build_object('ok', true, 'config', v_cfg);
  end if;
  if not public.agent_can_for(p_user, 'use') then return jsonb_build_object('ok', false, 'code', 403, 'message', 'Not allowed to use the agent.'); end if;
  if coalesce(v_cfg #>> '{runtime,enabled}', 'false') <> 'true' then return jsonb_build_object('ok', false, 'code', 423, 'message', 'The agent is switched off.'); end if;
  select * into v_run from public.agent_runs where id = p_run and owner_id = p_user for update;
  if not found or v_run.status <> 'running' then return jsonb_build_object('ok', false, 'code', 409, 'message', 'This run is not active.'); end if;
  if v_run.started_at < now() - make_interval(secs => greatest(30, coalesce((v_cfg #>> '{limits,run_timeout_seconds}')::int, 240)) + 60) then
    return jsonb_build_object('ok', false, 'code', 408, 'message', 'The run took too long.');
  end if;
  select coalesce(sum(input_tokens + output_tokens), 0) into v_used from public.agent_usage where owner_id = p_user and at >= date_trunc('day', now());
  select coalesce(sum(input_tokens + output_tokens), 0) into v_team from public.agent_usage where at >= date_trunc('day', now());
  if v_used >= coalesce((v_cfg #>> '{usage,user_daily_tokens}')::bigint, 2000000) then return jsonb_build_object('ok', false, 'code', 429, 'message', 'Daily limit reached for this person.'); end if;
  if v_team >= coalesce((v_cfg #>> '{usage,team_daily_tokens}')::bigint, 10000000) then return jsonb_build_object('ok', false, 'code', 429, 'message', 'Daily limit reached for the team.'); end if;
  if v_run.input_tokens + v_run.output_tokens >= coalesce((v_cfg #>> '{limits,run_token_budget}')::bigint, 400000) then
    return jsonb_build_object('ok', false, 'code', 429, 'message', 'This reply used its whole token budget.');
  end if;
  update public.agent_runs set heartbeat_at = now() where id = p_run;
  return jsonb_build_object('ok', true, 'config', v_cfg);
end $$;

create or replace function public.agent_record_usage(p_user uuid, p_run uuid, p_provider text, p_model text, p_kind text, p_in bigint, p_out bigint,
  p_credits numeric, p_cost numeric, p_reported boolean, p_ok boolean, p_error text, p_ms int) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.agent_usage (owner_id, run_id, provider, model, kind, input_tokens, output_tokens, credits, estimated_cost_usd, reported, ok, error, duration_ms)
  values (p_user, p_run, p_provider, left(p_model, 200), p_kind, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0), greatest(coalesce(p_credits, 0), 0),
    greatest(coalesce(p_cost, 0), 0), coalesce(p_reported, false), coalesce(p_ok, true), left(p_error, 300), p_ms);
  if p_run is not null then
    update public.agent_runs set input_tokens = input_tokens + greatest(coalesce(p_in, 0), 0), output_tokens = output_tokens + greatest(coalesce(p_out, 0), 0),
      search_credits = search_credits + greatest(coalesce(p_credits, 0), 0), estimated_cost_usd = estimated_cost_usd + greatest(coalesce(p_cost, 0), 0), heartbeat_at = now()
    where id = p_run and owner_id = p_user;
  end if;
end $$;

-- 10. Long jobs (resumable) -------------------------------------------------------
create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete set null,
  kind text not null check (kind in ('research_batch')),
  title text not null check (char_length(title) <= 300),
  instruction text not null check (char_length(instruction) <= 2000),
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'cancel_requested', 'cancelled', 'completed', 'failed')),
  total int not null default 0,
  done int not null default 0,
  failed int not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  error text check (char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.agent_jobs enable row level security;
create table if not exists public.agent_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idx int not null,
  entity_type text not null check (entity_type in ('font', 'designer', 'foundry')),
  entity_id uuid not null,
  label text,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts int not null default 0,
  run_id uuid,
  summary text check (char_length(summary) <= 4000),
  proposal_ids uuid[] not null default '{}',
  error text check (char_length(error) <= 1000),
  updated_at timestamptz not null default now(),
  unique (job_id, idx)
);
alter table public.agent_job_items enable row level security;
drop policy if exists "own jobs" on public.agent_jobs;
create policy "own jobs" on public.agent_jobs for select to authenticated using (owner_id = auth.uid());
drop policy if exists "own job items" on public.agent_job_items;
create policy "own job items" on public.agent_job_items for select to authenticated using (owner_id = auth.uid());
revoke insert, update, delete on public.agent_jobs, public.agent_job_items from anon, authenticated;

create or replace function public.agent_job_create(p_title text, p_instruction text, p_items jsonb, p_conversation uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  perform agent_private.require('start_jobs');
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > agent_private.cfg_int('{limits,job_max_items}', 200) then raise exception 'A job can have 1 to % items.', agent_private.cfg_int('{limits,job_max_items}', 200) using errcode = 'AG422'; end if;
  insert into public.agent_jobs (owner_id, conversation_id, kind, title, instruction, total) values (auth.uid(), p_conversation, 'research_batch', left(p_title, 300), left(p_instruction, 2000), v_n) returning id into v_id;
  insert into public.agent_job_items (job_id, owner_id, idx, entity_type, entity_id, label)
  select v_id, auth.uid(), (x.ord - 1)::int, x.v ->> 'type', (x.v ->> 'id')::uuid, left(x.v ->> 'label', 200)
  from jsonb_array_elements(p_items) with ordinality as x(v, ord);
  return v_id;
end $$;

/** Takes the job's lease (only one worker at a time) and returns the next item, or null when nothing is left. */
create or replace function public.agent_job_next(p_job uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_job public.agent_jobs; v_item public.agent_job_items;
begin
  select * into v_job from public.agent_jobs where id = p_job and owner_id = auth.uid() for update;
  if not found then raise exception 'Job not found.' using errcode = 'AG404'; end if;
  if v_job.status in ('cancel_requested') then
    update public.agent_jobs set status = 'cancelled', lease_token = null, lease_until = null, updated_at = now() where id = p_job;
    update public.agent_job_items set status = 'skipped', updated_at = now() where job_id = p_job and status in ('pending', 'running');
    return jsonb_build_object('state', 'cancelled');
  end if;
  if v_job.status in ('cancelled', 'completed', 'failed', 'paused') then return jsonb_build_object('state', v_job.status); end if;
  if v_job.lease_token is not null and v_job.lease_token <> p_token and v_job.lease_until > now() then
    return jsonb_build_object('state', 'busy');
  end if;
  -- an item left 'running' by a worker that died goes back in the queue (at most 3 attempts)
  update public.agent_job_items set status = case when attempts >= 3 then 'failed' else 'pending' end,
    error = case when attempts >= 3 then 'Stopped after 3 attempts.' else error end, updated_at = now()
  where job_id = p_job and status = 'running' and (v_job.lease_until is null or v_job.lease_until < now() or v_job.lease_token <> p_token);
  select * into v_item from public.agent_job_items where job_id = p_job and status = 'pending' order by idx limit 1 for update skip locked;
  if not found then
    update public.agent_jobs set status = 'completed', lease_token = null, lease_until = null, updated_at = now(),
      done = (select count(*) from public.agent_job_items where job_id = p_job and status = 'done'),
      failed = (select count(*) from public.agent_job_items where job_id = p_job and status = 'failed')
    where id = p_job;
    return jsonb_build_object('state', 'completed');
  end if;
  update public.agent_job_items set status = 'running', attempts = attempts + 1, updated_at = now() where id = v_item.id;
  update public.agent_jobs set status = 'running', lease_token = p_token, lease_until = now() + interval '5 minutes', updated_at = now() where id = p_job;
  return jsonb_build_object('state', 'item', 'item', to_jsonb(v_item), 'instruction', v_job.instruction, 'conversation_id', v_job.conversation_id);
end $$;

create or replace function public.agent_job_item_done(p_item uuid, p_token uuid, p_ok boolean, p_summary text, p_run uuid, p_proposals uuid[], p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  select i.job_id into v_job from public.agent_job_items i join public.agent_jobs j on j.id = i.job_id
  where i.id = p_item and i.owner_id = auth.uid() and j.lease_token = p_token;
  if v_job is null then raise exception 'This worker no longer holds the job.' using errcode = 'AG409'; end if;
  update public.agent_job_items set status = case when p_ok then 'done' when attempts >= 3 then 'failed' else 'pending' end,
    summary = left(p_summary, 4000), run_id = p_run, proposal_ids = coalesce(p_proposals, '{}'), error = left(p_error, 1000), updated_at = now()
  where id = p_item;
  update public.agent_jobs set updated_at = now(), lease_until = now() + interval '5 minutes',
    done = (select count(*) from public.agent_job_items where job_id = v_job and status = 'done'),
    failed = (select count(*) from public.agent_job_items where job_id = v_job and status = 'failed')
  where id = v_job;
end $$;

create or replace function public.agent_job_control(p_job uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.agent_jobs where id = p_job and owner_id = auth.uid() for update;
  if v_status is null then raise exception 'Job not found.' using errcode = 'AG404'; end if;
  if p_action = 'pause' and v_status in ('queued', 'running') then v_status := 'paused';
  elsif p_action = 'resume' and v_status in ('paused', 'failed') then v_status := 'queued';
  elsif p_action = 'cancel' and v_status in ('queued', 'running', 'paused') then v_status := case when v_status = 'running' then 'cancel_requested' else 'cancelled' end;
  else return v_status; end if;
  update public.agent_jobs set status = v_status, lease_token = case when v_status = 'cancel_requested' then lease_token else null end,
    lease_until = case when v_status = 'cancel_requested' then lease_until else null end, updated_at = now() where id = p_job;
  if v_status = 'cancelled' then update public.agent_job_items set status = 'skipped', updated_at = now() where job_id = p_job and status in ('pending', 'running'); end if;
  return v_status;
end $$;

-- 11. Proposals: preparing, editing and executing --------------------------------
create or replace function agent_private.font_status(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select status::text from public.fonts where id = p_id
$$;
create or replace function public.font_is_unpublished(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status::text in ('draft', 'pending') from public.fonts where id = p_id), true)
$$;
grant execute on function public.font_is_unpublished(uuid) to authenticated;

create or replace function agent_private.has_column(p_table text, p_col text) returns boolean
language sql stable as $$
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = p_col)
$$;

/** Fields the agent may change, per table. Images and cover have their own operations; slug, status and owners never change through a plain edit. */
create or replace function agent_private.editable_fields(p_table text) returns text[]
language sql immutable as $$
  select case p_table
    when 'fonts' then array['name', 'description', 'description_ar', 'year', 'weights', 'is_variable', 'license', 'purchase_links', 'case_studies', 'source_url', 'language_group']
    when 'designers' then array['name', 'bio', 'bio_ar', 'country', 'social_links', 'type']
    else array[]::text[] end
$$;

create or replace function agent_private.link_spec(p_kind text) returns text[]
language sql immutable as $$
  -- link table, key column, tag table
  select case p_kind
    when 'scripts' then array['font_scripts', 'script_id', 'scripts']
    when 'genres' then array['font_genres', 'genre_id', 'genres']
    when 'styles' then array['font_styles', 'style_id', 'styles']
    when 'types' then array['font_types', 'type_id', 'types']
    when 'designers' then array['font_designers', 'designer_id', 'designers']
    when 'awards' then array['font_awards', 'award_id', 'awards']
    when 'languages' then array['font_languages', 'lang_id', 'languages']
  end
$$;

create or replace function agent_private.row_json(p_table text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_table not in ('fonts', 'designers') then return null; end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1', p_table) into v using p_id;
  return v;
end $$;

create or replace function agent_private.entity_hash(p_table text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; l jsonb;
begin
  v := agent_private.row_json(p_table, p_id);
  if v is null then return null; end if;
  if p_table = 'fonts' then
    select jsonb_build_object(
      's', (select jsonb_agg(script_id order by script_id) from public.font_scripts where font_id = p_id),
      'g', (select jsonb_agg(genre_id order by genre_id) from public.font_genres where font_id = p_id),
      'st', (select jsonb_agg(style_id order by style_id) from public.font_styles where font_id = p_id),
      't', (select jsonb_agg(type_id order by type_id) from public.font_types where font_id = p_id),
      'd', (select jsonb_agg(designer_id::text order by designer_id::text) from public.font_designers where font_id = p_id),
      'a', (select jsonb_agg(award_id::text order by award_id::text) from public.font_awards where font_id = p_id)) into l;
  else
    select jsonb_build_object('f', (select jsonb_agg(font_id::text order by font_id::text) from public.font_designers where designer_id = p_id)) into l;
  end if;
  return md5((v - 'updated_at')::text || coalesce(l::text, ''));
end $$;

create or replace function agent_private.is_url_list(v jsonb, p_max int) returns boolean
language sql immutable as $$
  select jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= p_max
    and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^https?://[^\s<>"]+$' or char_length(e #>> '{}') > 2000)
$$;

/** Checks one field value has the right type and range. Raises with a clear message otherwise. */
create or replace function agent_private.check_value(p_table text, p_field text, v jsonb) returns void
language plpgsql stable set search_path = public as $$
declare t text := jsonb_typeof(v); k text; y int := extract(year from now())::int;
begin
  if not (p_field = any (agent_private.editable_fields(p_table))) then raise exception 'The field “%” can’t be changed by the agent.', p_field using errcode = 'AG422'; end if;
  if not agent_private.has_column(p_table, p_field) then raise exception 'The field “%” doesn’t exist in the database yet.', p_field using errcode = 'AG422'; end if;
  if t = 'null' then
    if p_field in ('name', 'type', 'license', 'is_variable') then raise exception '“%” can’t be empty.', p_field using errcode = 'AG422'; end if;
    return;
  end if;
  case p_field
    when 'name' then if t <> 'string' or char_length(btrim(v #>> '{}')) not between 1 and 200 then raise exception 'Name must be 1–200 characters.' using errcode = 'AG422'; end if;
    when 'description', 'description_ar', 'bio', 'bio_ar' then if t <> 'string' or char_length(v #>> '{}') > 8000 then raise exception '% must be text up to 8000 characters.', p_field using errcode = 'AG422'; end if;
    when 'year' then if t <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) or (v #>> '{}')::int not between 1900 and y + 1 then raise exception 'Year must be a whole year between 1900 and %.', y + 1 using errcode = 'AG422'; end if;
    when 'weights' then if t <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) or (v #>> '{}')::int not between 1 and 200 then raise exception 'Weights must be a whole number from 1 to 200.' using errcode = 'AG422'; end if;
    when 'is_variable' then if t <> 'boolean' then raise exception 'Variable must be true or false.' using errcode = 'AG422'; end if;
    when 'license' then if t <> 'string' or (v #>> '{}') not in ('paid', 'free', 'custom') then raise exception 'License must be paid, free or custom.' using errcode = 'AG422'; end if;
    when 'purchase_links', 'case_studies' then if not agent_private.is_url_list(v, 30) then raise exception '% must be a list of up to 30 web links.', p_field using errcode = 'AG422'; end if;
    when 'source_url' then if t <> 'string' or (v #>> '{}') !~ '^https?://[^\s<>"]+$' or char_length(v #>> '{}') > 2000 then raise exception 'Source must be a web link.' using errcode = 'AG422'; end if;
    when 'language_group' then
      if t <> 'array' or exists (select 1 from jsonb_array_elements_text(v) e where not exists (select 1 from public.language_groups g where g.id::text = e)) then
        raise exception 'Language groups must be existing language group ids.' using errcode = 'AG422';
      end if;
    when 'country' then if t <> 'string' or char_length(v #>> '{}') > 80 then raise exception 'Country must be a name up to 80 characters.' using errcode = 'AG422'; end if;
    when 'type' then if t <> 'string' or (v #>> '{}') not in ('designer', 'foundry') then raise exception 'Type must be designer or foundry.' using errcode = 'AG422'; end if;
    when 'social_links' then
      if t <> 'object' then raise exception 'Links must be an object.' using errcode = 'AG422'; end if;
      for k in select jsonb_object_keys(v) loop
        if k !~ '^[a-z_]{2,30}_url$' or jsonb_typeof(v -> k) not in ('string', 'null') or ((v ->> k) is not null and (v ->> k) <> '' and ((v ->> k) !~ '^https?://[^\s<>"]+$' or char_length(v ->> k) > 2000)) then
          raise exception 'Link “%” must be a web address.', k using errcode = 'AG422';
        end if;
      end loop;
    else null;
  end case;
end $$;

create or replace function agent_private.ref_or_uuid(p text, p_refs text[]) returns text
language plpgsql immutable as $$
begin
  if p is null then raise exception 'Missing target.' using errcode = 'AG422'; end if;
  if p like '$new:%' then
    if not (substr(p, 6) = any (p_refs)) then raise exception 'Unknown new-record reference %.', p using errcode = 'AG422'; end if;
    return p;
  end if;
  if p !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid record id %.', p using errcode = 'AG422'; end if;
  return p;
end $$;

/** Validates a list of changes and records the current values ("from") straight from the database,
 *  so what the person approves is compared with what really was there — not what the model claimed. */
create or replace function agent_private.prepare_changes(p_changes jsonb, p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb := '[]'::jsonb;
  op jsonb; v_kind text; v_id text; v_ids text[] := '{}'; v_refs text[] := '{}';
  v_table text; v_target text; v_row jsonb; v_spec text[]; v_exists boolean; v_asset public.agent_assets; v_imgs jsonb; v_log public.activity_log;
  e text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then raise exception 'A proposal needs at least one change.' using errcode = 'AG422'; end if;
  if jsonb_array_length(p_changes) > 60 then raise exception 'A proposal can hold at most 60 changes. Split it.' using errcode = 'AG422'; end if;
  for op in select value from jsonb_array_elements(p_changes) loop
    v_kind := op ->> 'op';
    v_id := op ->> 'id';
    if v_id is null or v_id !~ '^[a-z0-9_-]{1,40}$' or v_id = any (v_ids) then raise exception 'Every change needs a unique short id.' using errcode = 'AG422'; end if;
    v_ids := v_ids || v_id;
    v_table := case op ->> 'entity' when 'font' then 'fonts' when 'designer' then 'designers' else null end;
    case v_kind
      when 'create' then
        if v_table is null then raise exception 'Only fonts and designers/foundries can be created.' using errcode = 'AG422'; end if;
        if (op ->> 'ref') is null or (op ->> 'ref') !~ '^[a-z0-9_]{1,20}$' or (op ->> 'ref') = any (v_refs) then raise exception 'A new record needs a unique ref.' using errcode = 'AG422'; end if;
        if jsonb_typeof(op -> 'values') <> 'object' or coalesce(btrim(op #>> '{values,name}'), '') = '' then raise exception 'A new record needs a name.' using errcode = 'AG422'; end if;
        for e in select jsonb_object_keys(op -> 'values') loop perform agent_private.check_value(v_table, e, op -> 'values' -> e); end loop;
        if v_table = 'designers' and coalesce(op #>> '{values,type}', '') not in ('designer', 'foundry') then raise exception 'Say whether the new profile is a designer or a foundry.' using errcode = 'AG422'; end if;
        v_refs := v_refs || (op ->> 'ref');
        out := out || jsonb_build_array(op);
      when 'set' then
        if v_table is null then raise exception 'Unknown entity.' using errcode = 'AG422'; end if;
        v_target := agent_private.ref_or_uuid(op ->> 'target', v_refs);
        perform agent_private.check_value(v_table, op ->> 'field', op -> 'to');
        if v_target not like '$new:%' then
          v_row := agent_private.row_json(v_table, v_target::uuid);
          if v_row is null then raise exception 'Record % not found.', v_target using errcode = 'AG404'; end if;
          if coalesce(v_row -> (op ->> 'field'), 'null'::jsonb) = coalesce(op -> 'to', 'null'::jsonb) then continue; end if; -- nothing to change
          op := op || jsonb_build_object('from', coalesce(v_row -> (op ->> 'field'), 'null'::jsonb));
        else
          op := op - 'from';
        end if;
        out := out || jsonb_build_array(op);
      when 'link' then
        v_spec := agent_private.link_spec(op ->> 'link');
        if v_spec is null then raise exception 'Unknown link kind %.', op ->> 'link' using errcode = 'AG422'; end if;
        v_target := agent_private.ref_or_uuid(op ->> 'font', v_refs);
        if (op ->> 'action') not in ('add', 'remove') then raise exception 'Link action must be add or remove.' using errcode = 'AG422'; end if;
        if (op ->> 'value') is null or char_length(op ->> 'value') > 64 then raise exception 'Link value missing.' using errcode = 'AG422'; end if;
        if (op ->> 'link') = 'designers' and (op ->> 'value') like '$new:%' then
          perform agent_private.ref_or_uuid(op ->> 'value', v_refs);
        else
          execute format('select exists (select 1 from public.%I where id::text = $1)', v_spec[3]) into v_exists using op ->> 'value';
          if not v_exists then raise exception 'There is no % with id %.', op ->> 'link', op ->> 'value' using errcode = 'AG404'; end if;
        end if;
        if v_target not like '$new:%' and agent_private.row_json('fonts', v_target::uuid) is null then raise exception 'Font % not found.', v_target using errcode = 'AG404'; end if;
        if (op ->> 'url') is not null and ((op ->> 'url') !~ '^https?://[^\s<>"]+$' or (op ->> 'link') <> 'awards') then raise exception 'Only award links carry a web address.' using errcode = 'AG422'; end if;
        out := out || jsonb_build_array(op);
      when 'status' then
        v_target := agent_private.ref_or_uuid(op ->> 'target', '{}');
        if (op ->> 'to') not in ('draft', 'pending', 'published', 'featured') then raise exception 'Unknown status.' using errcode = 'AG422'; end if;
        op := op || jsonb_build_object('entity', 'font', 'from', agent_private.font_status(v_target::uuid));
        if op ->> 'from' is null then raise exception 'Font not found.' using errcode = 'AG404'; end if;
        out := out || jsonb_build_array(op);
      when 'image_add' then
        if v_table is null then raise exception 'Images go on a font or a designer/foundry.' using errcode = 'AG422'; end if;
        v_target := agent_private.ref_or_uuid(op ->> 'target', v_refs);
        select * into v_asset from public.agent_assets where id = (op ->> 'asset')::uuid;
        if not found or v_asset.owner_id <> p_owner or v_asset.status <> 'staged' then raise exception 'That image isn’t waiting for review any more.' using errcode = 'AG404'; end if;
        if v_target not like '$new:%' then
          v_row := agent_private.row_json(v_table, v_target::uuid);
          if v_row is null then raise exception 'Record not found.' using errcode = 'AG404'; end if;
          if v_table = 'designers' then op := op || jsonb_build_object('from', coalesce(v_row -> 'logo', 'null'::jsonb)); end if;
        end if;
        op := op || jsonb_build_object('sha256', v_asset.sha256, 'preview', v_asset.staging_path);
        out := out || jsonb_build_array(op);
      when 'image_remove', 'image_order', 'cover' then
        v_target := agent_private.ref_or_uuid(op ->> 'target', '{}');
        v_row := agent_private.row_json('fonts', v_target::uuid);
        if v_row is null then raise exception 'Font not found.' using errcode = 'AG404'; end if;
        v_imgs := coalesce(v_row -> 'images', '[]'::jsonb);
        if v_kind = 'image_remove' then
          if not (v_imgs ? (op ->> 'path')) then raise exception 'That image isn’t on the font.' using errcode = 'AG404'; end if;
          op := op || jsonb_build_object('entity', 'font', 'from', v_imgs);
        elsif v_kind = 'image_order' then
          if jsonb_typeof(op -> 'to') <> 'array' or jsonb_array_length(op -> 'to') <> jsonb_array_length(v_imgs)
            or exists (select 1 from jsonb_array_elements_text(op -> 'to') e where not (v_imgs ? e))
            or (select count(distinct e) from jsonb_array_elements_text(op -> 'to') e) <> jsonb_array_length(v_imgs) then
            raise exception 'A new order must list exactly the font’s current images.' using errcode = 'AG422';
          end if;
          op := op || jsonb_build_object('entity', 'font', 'from', v_imgs);
        else
          if not (v_imgs ? (op ->> 'to')) then raise exception 'The cover must be one of the font’s images.' using errcode = 'AG422'; end if;
          op := op || jsonb_build_object('entity', 'font', 'from', coalesce(v_row -> 'cover', 'null'::jsonb));
        end if;
        out := out || jsonb_build_array(op);
      when 'merge' then
        if v_table is null then raise exception 'Unknown entity.' using errcode = 'AG422'; end if;
        if jsonb_typeof(op -> 'losers') <> 'array' or jsonb_array_length(op -> 'losers') not between 1 and 10 or (op -> 'losers') ? (op ->> 'keeper') then
          raise exception 'A merge needs one record to keep and 1–10 others.' using errcode = 'AG422';
        end if;
        perform agent_private.ref_or_uuid(op ->> 'keeper', '{}');
        op := op || jsonb_build_object('base', (
          select jsonb_object_agg(x, agent_private.entity_hash(v_table, x::uuid)) from (select op ->> 'keeper' x union all select jsonb_array_elements_text(op -> 'losers')) s));
        if exists (select 1 from jsonb_each(op -> 'base') b where b.value = 'null'::jsonb) then raise exception 'A record in the merge no longer exists.' using errcode = 'AG404'; end if;
        out := out || jsonb_build_array(op);
      when 'delete' then
        if v_table is null then raise exception 'Unknown entity.' using errcode = 'AG422'; end if;
        v_target := agent_private.ref_or_uuid(op ->> 'target', '{}');
        op := op || jsonb_build_object('base', agent_private.entity_hash(v_table, v_target::uuid));
        if op ->> 'base' is null then raise exception 'Record not found.' using errcode = 'AG404'; end if;
        out := out || jsonb_build_array(op);
      when 'restore', 'revert' then
        select * into v_log from public.activity_log where id = (op ->> 'activity_id')::bigint;
        if not found then raise exception 'History entry not found.' using errcode = 'AG404'; end if;
        if v_kind = 'restore' and not (v_log.action in ('delete', 'merge', 'agent:delete', 'agent:merge') and v_log.before ? 'row') then raise exception 'Only deleted or merged records can be restored.' using errcode = 'AG422'; end if;
        if v_kind = 'revert' and v_log.action <> 'agent:set' then raise exception 'Only single-field changes made by the agent can be reverted.' using errcode = 'AG422'; end if;
        op := op || jsonb_build_object('entity', v_log.entity, 'label', v_log.label);
        out := out || jsonb_build_array(op);
      when 'taxonomy_create' then
        if (op ->> 'table') not in ('scripts', 'styles', 'types', 'genres', 'awards') then raise exception 'Unknown list.' using errcode = 'AG422'; end if;
        if coalesce(btrim(op ->> 'name'), '') = '' or char_length(op ->> 'name') > 120 then raise exception 'A name (up to 120 characters) is needed.' using errcode = 'AG422'; end if;
        execute format('select exists (select 1 from public.%I where lower(name) = lower($1))', op ->> 'table') into v_exists using btrim(op ->> 'name');
        if v_exists then raise exception '“%” already exists.', op ->> 'name' using errcode = 'AG409'; end if;
        out := out || jsonb_build_array(op);
      else
        raise exception 'Unknown change type %.', v_kind using errcode = 'AG422';
    end case;
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'Nothing would change: the archive already has these values.' using errcode = 'AG422'; end if;
  return out;
end $$;

create or replace function public.agent_create_proposal(p_run uuid, p_tool_call uuid, p_message uuid, p_kind text, p_title text, p_reason text, p_impact text,
  p_targets jsonb, p_changes jsonb, p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_run public.agent_runs; v_id uuid; v_changes jsonb; v_base jsonb := '{}'::jsonb; t jsonb;
begin
  perform agent_private.require('propose');
  select * into v_run from public.agent_runs where id = p_run and owner_id = auth.uid();
  if not found or v_run.status <> 'running' then raise exception 'Proposals can only be made while the agent is working.' using errcode = 'AG409'; end if;
  select id into v_id from public.agent_proposals where tool_call_id = p_tool_call;
  if v_id is not null then return (select to_jsonb(p) || jsonb_build_object('existing', true) from public.agent_proposals p where id = v_id); end if;
  v_changes := agent_private.prepare_changes(p_changes, auth.uid());
  for t in select value from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) loop
    if (t ->> 'id') ~ '^[0-9a-f-]{36}$' then
      v_base := v_base || jsonb_build_object(t ->> 'id', agent_private.entity_hash(case when t ->> 'type' = 'font' then 'fonts' else 'designers' end, (t ->> 'id')::uuid));
    end if;
  end loop;
  insert into public.agent_proposals (owner_id, conversation_id, message_id, run_id, tool_call_id, kind, title, reason, impact, targets, changes, base, evidence, expires_at)
  values (auth.uid(), v_run.conversation_id, p_message, p_run, p_tool_call, left(p_kind, 40), left(p_title, 300), left(p_reason, 4000), left(p_impact, 2000),
    coalesce(p_targets, '[]'::jsonb), v_changes, v_base, coalesce(p_evidence, '[]'::jsonb), now() + make_interval(hours => agent_private.cfg_int('{proposals,ttl_hours}', 72)))
  returning id into v_id;
  return (select to_jsonb(p) || jsonb_build_object('existing', false) from public.agent_proposals p where id = v_id);
end $$;

/** The person edits a pending proposal (values or which changes it holds). Creates a new version:
 *  an approval of an older version is no longer accepted. */
create or replace function public.agent_update_proposal(p_id uuid, p_version int, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.agent_proposals; v_changes jsonb;
begin
  select * into p from public.agent_proposals where id = p_id for update;
  if not found or p.owner_id <> auth.uid() then raise exception 'Proposal not found.' using errcode = 'AG404'; end if;
  if p.status not in ('pending', 'conflict', 'failed') then raise exception 'This proposal is % and can no longer be edited.', p.status using errcode = 'AG409'; end if;
  if p.version <> p_version then raise exception 'The proposal changed since you opened it. Reload it first.' using errcode = 'AG409'; end if;
  v_changes := agent_private.prepare_changes(coalesce(p_changes, p.changes), auth.uid());
  update public.agent_proposals set changes = v_changes, version = version + 1, status = 'pending', error = null, updated_at = now(),
    expires_at = greatest(expires_at, now() + interval '24 hours')
  where id = p_id;
  return (select to_jsonb(x) from public.agent_proposals x where id = p_id);
end $$;

create or replace function public.agent_decide_proposal(p_id uuid, p_action text, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare p public.agent_proposals;
begin
  select * into p from public.agent_proposals where id = p_id for update;
  if not found then raise exception 'Proposal not found.' using errcode = 'AG404'; end if;
  if p_action = 'submit' then
    if p.owner_id <> auth.uid() then raise exception 'Only the person who asked can share it for review.' using errcode = 'AG403'; end if;
    if p.status <> 'pending' then raise exception 'Only pending proposals can be shared.' using errcode = 'AG409'; end if;
    update public.agent_proposals set submitted_for_review = true, updated_at = now() where id = p_id;
    return 'pending';
  end if;
  if p_action not in ('reject', 'cancel') then raise exception 'Unknown action.' using errcode = 'AG422'; end if;
  if p.owner_id <> auth.uid() and not (p.submitted_for_review and agent_private.can_approve_anything()) then raise exception 'Proposal not found.' using errcode = 'AG404'; end if;
  if p.status not in ('pending', 'conflict', 'failed') then raise exception 'This proposal is already %.', p.status using errcode = 'AG409'; end if;
  update public.agent_proposals set status = case when p_action = 'reject' then 'rejected' else 'cancelled' end, error = left(p_note, 2000), updated_at = now() where id = p_id;
  return case when p_action = 'reject' then 'rejected' else 'cancelled' end;
end $$;

-- bookkeeping the executor needs; not reachable through the API (agent_private isn't exposed)
create or replace function agent_private.lock_proposal(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select to_jsonb(p) into v from public.agent_proposals p where id = p_id
    and (owner_id = auth.uid() or (submitted_for_review and agent_private.can_approve_anything())) for update;
  return v;
end $$;
create or replace function agent_private.set_proposal(p_id uuid, p_status text, p_result jsonb, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.agent_proposals set status = p_status, result = coalesce(p_result, result), error = left(p_error, 2000), updated_at = now(),
    executed_at = case when p_status = 'executed' then now() else executed_at end,
    executed_by = case when p_status = 'executed' then auth.uid() else executed_by end
  where id = p_id
$$;
create or replace function agent_private.record_approval(p_id uuid, p_version int, p_ops text[], p_request text, p_outcome text, p_result jsonb) returns uuid
language sql security definer set search_path = public as $$
  insert into public.agent_approvals (proposal_id, proposal_version, approver_id, approver_email, approver_role, selected_ops, request_id, outcome, result)
  values (p_id, p_version, auth.uid(), auth.jwt() ->> 'email', public.dashboard_role(), p_ops, p_request, p_outcome, p_result)
  returning id
$$;
create or replace function agent_private.approval_for(p_request text) returns jsonb
language sql stable security definer set search_path = public as $$
  select a.result || jsonb_build_object('already', true) from public.agent_approvals a where a.request_id = p_request and a.approver_id = auth.uid()
$$;
create or replace function agent_private.attach_asset(p_asset uuid, p_owner uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.agent_assets set status = 'attached', attached_path = p_path where id = p_asset and owner_id = p_owner and status = 'staged';
  if not found then raise exception 'That image was already used or discarded.' using errcode = 'AG409'; end if;
end $$;
create or replace function agent_private.unique_slug(p_table text, p_name text) returns text
language plpgsql stable security definer set search_path = public as $$
declare base text; s text; n int := 2; taken boolean;
begin
  base := trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
  if base = '' then base := case when p_table = 'fonts' then 'font' else 'profile' end || '-' || substr(md5(random()::text), 1, 6); end if;
  s := left(base, 80);
  loop
    execute format('select exists (select 1 from public.%I where slug = $1)', p_table) into taken using s;
    exit when not taken;
    s := left(base, 76) || '-' || n; n := n + 1;
  end loop;
  return s;
end $$;
grant execute on all functions in schema agent_private to authenticated;

create or replace function agent_private.log(p_action text, p_entity text, p_id text, p_label text, p_before jsonb, p_after jsonb) returns bigint
language sql security invoker set search_path = public as $$
  insert into public.activity_log (user_id, user_email, action, entity, entity_id, label, before, after)
  values (auth.uid(), auth.jwt() ->> 'email', p_action, p_entity, p_id, left(p_label, 300), p_before, p_after)
  returning id
$$;

/** Which permission a change to this font needs: published fonts need more. */
create or replace function agent_private.require_font(p_font text) returns void
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  if p_font like '$new:%' then perform agent_private.require('approve_font_draft'); return; end if;
  s := agent_private.font_status(p_font::uuid);
  if s is null then raise exception 'Font % not found.', p_font using errcode = 'AG404'; end if;
  if s in ('published', 'featured') then perform agent_private.require('approve_font_published'); else perform agent_private.require('approve_font_draft'); end if;
end $$;
grant execute on function agent_private.require_font(text), agent_private.log(text, text, text, text, jsonb, jsonb) to authenticated;

create or replace function agent_private.resolve(p text, p_new jsonb) returns uuid
language plpgsql immutable as $$
begin
  if p like '$new:%' then
    if p_new ->> substr(p, 6) is null then raise exception 'The new record % must be created in the same approval.', substr(p, 6) using errcode = 'AG422'; end if;
    return (p_new ->> substr(p, 6))::uuid;
  end if;
  return p::uuid;
end $$;

create or replace function agent_private.conflict(p_what text, p_detail jsonb) returns void
language plpgsql as $$
begin
  raise exception '%', p_what using errcode = 'AG409', detail = p_detail::text;
end $$;

create or replace function agent_private.check_publishable(p_font uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare f jsonb; missing text[] := '{}';
begin
  f := agent_private.row_json('fonts', p_font);
  if coalesce(btrim(f ->> 'name'), '') = '' then missing := array_append(missing, 'name'); end if;
  if coalesce(jsonb_array_length(case when jsonb_typeof(f -> 'images') = 'array' then f -> 'images' else '[]' end), 0) = 0 then missing := array_append(missing, 'images'); end if;
  if not exists (select 1 from public.font_designers where font_id = p_font) then missing := array_append(missing, 'designer or foundry'); end if;
  if not exists (select 1 from public.font_scripts where font_id = p_font) then missing := array_append(missing, 'script'); end if;
  if not exists (select 1 from public.font_genres where font_id = p_font) then missing := array_append(missing, 'genre'); end if;
  if f -> 'weights' is null or f -> 'weights' = 'null'::jsonb then missing := array_append(missing, 'weights'); end if;
  if array_length(missing, 1) > 0 then
    raise exception 'The font can’t be published yet — missing: %.', array_to_string(missing, ', ') using errcode = 'AG422';
  end if;
end $$;

/** Applies one change, as the signed-in person (their row-level security applies). */
create or replace function agent_private.apply_op(op jsonb, p_new jsonb, p_owner uuid, p_paths jsonb, p_proposal uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_kind text := op ->> 'op';
  v_table text := case op ->> 'entity' when 'font' then 'fonts' when 'designer' then 'designers' else null end;
  v_id uuid; v_row jsonb; v_cur jsonb; v_spec text[]; v_n int; v_cols text; v_vals jsonb; v_imgs jsonb; v_path text; k text;
  v_status text; v_loser uuid; v_log public.activity_log; v_tag_exists boolean; v_value text; v_meta jsonb := jsonb_build_object('proposal', p_proposal, 'op', op ->> 'id');
begin
  case v_kind
  when 'create' then
    if v_table = 'fonts' then perform agent_private.require('approve_font_draft'); else perform agent_private.require('approve_people'); end if;
    v_vals := '{}'::jsonb;
    for k in select jsonb_object_keys(op -> 'values') loop
      perform agent_private.check_value(v_table, k, op -> 'values' -> k);
      v_vals := v_vals || jsonb_build_object(k, op -> 'values' -> k);
    end loop;
    v_vals := v_vals || jsonb_build_object('slug', agent_private.unique_slug(v_table, op #>> '{values,name}'));
    if v_table = 'fonts' then v_vals := v_vals || jsonb_build_object('status', 'draft', 'user_id', auth.uid()); end if;
    select string_agg(quote_ident(c), ', ') into v_cols from jsonb_object_keys(v_vals) c;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) returning id', v_table, v_cols) into v_id using v_vals;
    perform agent_private.log('agent:create', case when v_table = 'fonts' then 'font' else 'designer' end, v_id::text, op #>> '{values,name}', null, jsonb_build_object('row', v_vals, 'agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied', 'ref', op ->> 'ref', 'new_id', v_id, 'table', v_table);

  when 'set' then
    v_id := agent_private.resolve(op ->> 'target', p_new);
    if v_table = 'fonts' then perform agent_private.require_font(op ->> 'target'); else perform agent_private.require('approve_people'); end if;
    perform agent_private.check_value(v_table, op ->> 'field', op -> 'to');
    execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table) into v_row using v_id;
    if v_row is null then raise exception 'The record isn’t there or your account can’t change it.' using errcode = 'AG403'; end if;
    v_cur := coalesce(v_row -> (op ->> 'field'), 'null'::jsonb);
    if op ? 'from' and v_cur is distinct from (op -> 'from') then
      perform agent_private.conflict(format('“%s” was changed by someone else after the proposal was made.', op ->> 'field'),
        jsonb_build_object('op', op ->> 'id', 'field', op ->> 'field', 'expected', op -> 'from', 'current', v_cur));
    end if;
    execute format('update public.%1$I t set %2$I = r.%2$I, updated_at = now() from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2', v_table, op ->> 'field')
      using jsonb_build_object(op ->> 'field', op -> 'to'), v_id;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'The database refused the change (your account may not be allowed to edit this record).' using errcode = 'AG403'; end if;
    perform agent_private.log('agent:set', case when v_table = 'fonts' then 'font' else 'designer' end, v_id::text, v_row ->> 'name',
      jsonb_build_object(op ->> 'field', v_cur), jsonb_build_object(op ->> 'field', op -> 'to', 'agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'link' then
    v_id := agent_private.resolve(op ->> 'font', p_new);
    perform agent_private.require_font(op ->> 'font');
    v_spec := agent_private.link_spec(op ->> 'link');
    v_value := case when (op ->> 'value') like '$new:%' then agent_private.resolve(op ->> 'value', p_new)::text else op ->> 'value' end;
    execute format('select exists (select 1 from public.%I where id::text = $1)', v_spec[3]) into v_tag_exists using v_value;
    if not v_tag_exists then perform agent_private.conflict(format('The %s to link no longer exists.', op ->> 'link'), jsonb_build_object('op', op ->> 'id')); end if;
    execute format('select exists (select 1 from public.%I where font_id = $1 and %I::text = $2)', v_spec[1], v_spec[2]) into v_tag_exists using v_id, v_value;
    if op ->> 'action' = 'add' then
      if v_tag_exists then return jsonb_build_object('id', op ->> 'id', 'status', 'already'); end if;
      if v_spec[1] = 'font_awards' then
        execute format('insert into public.font_awards (font_id, award_id, url) select $1, r.award_id, $3 from jsonb_populate_record(null::public.font_awards, jsonb_build_object(%L, $2)) r', 'award_id')
          using v_id, v_value, op ->> 'url';
      else
        execute format('insert into public.%1$I (font_id, %2$I) select $1, r.%2$I from jsonb_populate_record(null::public.%1$I, jsonb_build_object(%3$L, $2)) r', v_spec[1], v_spec[2], v_spec[2])
          using v_id, v_value;
      end if;
    else
      if not v_tag_exists then return jsonb_build_object('id', op ->> 'id', 'status', 'already'); end if;
      execute format('delete from public.%I where font_id = $1 and %I::text = $2', v_spec[1], v_spec[2]) using v_id, v_value;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'The database refused to remove the link (your account may not be allowed).' using errcode = 'AG403'; end if;
    end if;
    perform agent_private.log('agent:link', 'font', v_id::text, op ->> 'link', null, jsonb_build_object('link', op ->> 'link', 'action', op ->> 'action', 'value', v_value, 'agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'status' then
    v_id := (op ->> 'target')::uuid;
    if (op ->> 'to') in ('published', 'featured') or (op ->> 'from') in ('published', 'featured') then perform agent_private.require('approve_publish');
    else perform agent_private.require('approve_font_draft'); end if;
    select status::text into v_status from public.fonts where id = v_id for update;
    if v_status is null then raise exception 'The font isn’t there or your account can’t change it.' using errcode = 'AG403'; end if;
    if v_status is distinct from (op ->> 'from') then
      perform agent_private.conflict('The font’s status changed after the proposal was made.', jsonb_build_object('op', op ->> 'id', 'expected', op -> 'from', 'current', v_status));
    end if;
    if (op ->> 'to') in ('published', 'featured') then perform agent_private.check_publishable(v_id); end if;
    execute format('update public.fonts set status = %L, updated_at = now() where id = $1', op ->> 'to') using v_id;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'The database refused the status change.' using errcode = 'AG403'; end if;
    perform agent_private.log('agent:status:' || (op ->> 'to'), 'font', v_id::text, null, jsonb_build_object('status', v_status), jsonb_build_object('status', op ->> 'to', 'agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'image_add' then
    v_id := agent_private.resolve(op ->> 'target', p_new);
    perform agent_private.require('approve_images');
    if v_table = 'fonts' then perform agent_private.require_font(op ->> 'target'); else perform agent_private.require('approve_people'); end if;
    v_path := p_paths ->> (op ->> 'id');
    if v_path is null or v_path !~ ('^agent/\d{4}-\d{2}-\d{2}/' || (op ->> 'asset') || '\.(webp|png|jpg|gif)$') then
      raise exception 'The image wasn’t copied into the archive’s storage.' using errcode = 'AG422';
    end if;
    perform agent_private.attach_asset((op ->> 'asset')::uuid, p_owner, v_path);
    execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table) into v_row using v_id;
    if v_row is null then raise exception 'The record isn’t there or your account can’t change it.' using errcode = 'AG403'; end if;
    if v_table = 'fonts' then
      v_imgs := coalesce(case when jsonb_typeof(v_row -> 'images') = 'array' then v_row -> 'images' end, '[]'::jsonb);
      v_imgs := case when op ->> 'position' = 'start' then jsonb_build_array(v_path) || v_imgs else v_imgs || jsonb_build_array(v_path) end;
      update public.fonts f set images = r.images, cover = coalesce(nullif(f.cover, ''), v_path), updated_at = now()
        from jsonb_populate_record(null::public.fonts, jsonb_build_object('images', v_imgs)) r where f.id = v_id;
    else
      if op ? 'from' and coalesce(v_row -> 'logo', 'null'::jsonb) is distinct from (op -> 'from') then
        perform agent_private.conflict('The photo/logo was changed after the proposal was made.', jsonb_build_object('op', op ->> 'id'));
      end if;
      update public.designers set logo = v_path, updated_at = now() where id = v_id;
    end if;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'The database refused the image change.' using errcode = 'AG403'; end if;
    perform agent_private.log('agent:image_add', case when v_table = 'fonts' then 'font' else 'designer' end, v_id::text, v_row ->> 'name', null,
      jsonb_build_object('path', v_path, 'source', op ->> 'source_url', 'agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied', 'path', v_path);

  when 'image_remove', 'image_order', 'cover' then
    v_id := (op ->> 'target')::uuid;
    perform agent_private.require('approve_images');
    perform agent_private.require_font(op ->> 'target');
    select to_jsonb(f) into v_row from public.fonts f where id = v_id for update;
    if v_row is null then raise exception 'The font isn’t there or your account can’t change it.' using errcode = 'AG403'; end if;
    v_imgs := coalesce(case when jsonb_typeof(v_row -> 'images') = 'array' then v_row -> 'images' end, '[]'::jsonb);
    if v_kind = 'cover' then
      if coalesce(v_row -> 'cover', 'null'::jsonb) is distinct from (op -> 'from') then perform agent_private.conflict('The cover was changed after the proposal was made.', jsonb_build_object('op', op ->> 'id')); end if;
      if not (v_imgs ? (op ->> 'to')) then perform agent_private.conflict('The new cover is no longer one of the font’s images.', jsonb_build_object('op', op ->> 'id')); end if;
      update public.fonts set cover = op ->> 'to', updated_at = now() where id = v_id;
    else
      if v_imgs is distinct from (op -> 'from') then perform agent_private.conflict('The font’s images were changed after the proposal was made.', jsonb_build_object('op', op ->> 'id')); end if;
      if v_kind = 'image_remove' then
        select coalesce(jsonb_agg(e), '[]'::jsonb) into v_cur from jsonb_array_elements(v_imgs) e where e #>> '{}' <> op ->> 'path';
      else
        v_cur := op -> 'to';
      end if;
      update public.fonts f set images = r.images,
        cover = case when f.cover = (op ->> 'path') then (v_cur ->> 0) else f.cover end, updated_at = now()
        from jsonb_populate_record(null::public.fonts, jsonb_build_object('images', v_cur)) r where f.id = v_id;
    end if;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'The database refused the image change.' using errcode = 'AG403'; end if;
    perform agent_private.log('agent:' || v_kind, 'font', v_id::text, v_row ->> 'name', jsonb_build_object('images', v_imgs, 'cover', v_row -> 'cover'), jsonb_build_object('op', op, 'agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'merge' then
    perform agent_private.require('approve_merge');
    for k in select key from jsonb_each_text(op -> 'base') loop
      if agent_private.entity_hash(v_table, k::uuid) is distinct from (op -> 'base' ->> k) then
        perform agent_private.conflict('A record in the merge was changed after the proposal was made.', jsonb_build_object('op', op ->> 'id', 'record', k));
      end if;
    end loop;
    v_id := (op ->> 'keeper')::uuid;
    for v_loser in select (jsonb_array_elements_text(op -> 'losers'))::uuid loop
      v_row := agent_private.row_json(v_table, v_loser);
      if v_table = 'fonts' then
        perform agent_private.merge_font(v_id, v_loser);
      else
        perform agent_private.merge_person(v_id, v_loser);
      end if;
      perform agent_private.log('agent:merge', case when v_table = 'fonts' then 'font' else 'designer' end, v_loser::text, (v_row ->> 'name') || ' → ' || coalesce(agent_private.row_json(v_table, v_id) ->> 'name', ''),
        jsonb_build_object('row', v_row), jsonb_build_object('into', v_id, 'agent', v_meta));
    end loop;
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'delete' then
    perform agent_private.require('approve_delete');
    v_id := (op ->> 'target')::uuid;
    if agent_private.entity_hash(v_table, v_id) is distinct from (op ->> 'base') then
      perform agent_private.conflict('The record was changed after the proposal was made.', jsonb_build_object('op', op ->> 'id'));
    end if;
    v_row := agent_private.row_json(v_table, v_id);
    if v_table = 'fonts' then
      v_cur := jsonb_build_object(
        'font_scripts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_scripts x where font_id = v_id),
        'font_genres', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_genres x where font_id = v_id),
        'font_styles', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_styles x where font_id = v_id),
        'font_types', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_types x where font_id = v_id),
        'font_designers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_designers x where font_id = v_id),
        'font_awards', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_awards x where font_id = v_id),
        'font_languages', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_languages x where font_id = v_id));
      delete from public.font_scripts where font_id = v_id; delete from public.font_genres where font_id = v_id;
      delete from public.font_styles where font_id = v_id; delete from public.font_types where font_id = v_id;
      delete from public.font_designers where font_id = v_id; delete from public.font_awards where font_id = v_id;
      delete from public.font_languages where font_id = v_id;
      delete from public.fonts where id = v_id;
    else
      v_cur := jsonb_build_object('font_designers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.font_designers x where designer_id = v_id));
      delete from public.font_designers where designer_id = v_id;
      delete from public.designers where id = v_id;
    end if;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'The database refused the delete (your account may not be allowed).' using errcode = 'AG403'; end if;
    perform agent_private.log('agent:delete', case when v_table = 'fonts' then 'font' else 'designer' end, v_id::text, v_row ->> 'name',
      jsonb_build_object('row', v_row, 'links', v_cur), jsonb_build_object('agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'restore' then
    perform agent_private.require('approve_restore');
    select * into v_log from public.activity_log where id = (op ->> 'activity_id')::bigint;
    v_table := case when v_log.entity = 'font' then 'fonts' else 'designers' end;
    v_row := v_log.before -> 'row';
    if agent_private.row_json(v_table, (v_row ->> 'id')::uuid) is not null then
      perform agent_private.conflict('This record already exists again.', jsonb_build_object('op', op ->> 'id'));
    end if;
    execute format('select exists (select 1 from public.%I where slug = $1)', v_table) into v_tag_exists using v_row ->> 'slug';
    if v_tag_exists then perform agent_private.conflict(format('Another record now uses the address “%s”.', v_row ->> 'slug'), jsonb_build_object('op', op ->> 'id')); end if;
    if v_table = 'fonts' and (v_row ->> 'status') in ('published', 'featured') then perform agent_private.require('approve_publish'); end if;
    select string_agg(quote_ident(c.column_name), ', ') into v_cols from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_table and v_row ? c.column_name;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)', v_table, v_cols) using v_row;
    -- links whose other side still exists come back too
    v_cur := coalesce(v_log.before -> 'links', jsonb_build_object('font_designers', coalesce(v_log.before -> 'credits', '[]'::jsonb)));
    for k in select key from jsonb_each(v_cur) loop
      if k in ('font_scripts', 'font_genres', 'font_styles', 'font_types', 'font_designers', 'font_awards', 'font_languages') and jsonb_typeof(v_cur -> k) = 'array' then
        for v_vals in select value from jsonb_array_elements(v_cur -> k) loop
          begin
            execute format('insert into public.%1$I select r.* from jsonb_populate_record(null::public.%1$I, $1) r', k) using v_vals;
          exception when foreign_key_violation or unique_violation then null; -- the other side was deleted, or the link is already there
          end;
        end loop;
      end if;
    end loop;
    perform agent_private.log('agent:restore', v_log.entity, v_row ->> 'id', v_row ->> 'name', null, jsonb_build_object('from_history', v_log.id, 'agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'revert' then
    select * into v_log from public.activity_log where id = (op ->> 'activity_id')::bigint;
    v_table := case when v_log.entity = 'font' then 'fonts' else 'designers' end;
    v_id := v_log.entity_id::uuid;
    if v_table = 'fonts' then perform agent_private.require_font(v_id::text); else perform agent_private.require('approve_people'); end if;
    perform agent_private.require('approve_restore');
    execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table) into v_row using v_id;
    if v_row is null then perform agent_private.conflict('The record no longer exists.', jsonb_build_object('op', op ->> 'id')); end if;
    for k in select key from jsonb_each(v_log.before) loop
      if coalesce(v_row -> k, 'null'::jsonb) is distinct from coalesce(v_log.after -> k, 'null'::jsonb) then
        perform agent_private.conflict(format('“%s” was changed again after that edit, so it isn’t reverted.', k), jsonb_build_object('op', op ->> 'id', 'field', k));
      end if;
      execute format('update public.%1$I t set %2$I = r.%2$I, updated_at = now() from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2', v_table, k)
        using jsonb_build_object(k, v_log.before -> k), v_id;
    end loop;
    perform agent_private.log('agent:revert', v_log.entity, v_id::text, v_row ->> 'name', v_log.after - 'agent', v_log.before || jsonb_build_object('agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied');

  when 'taxonomy_create' then
    perform agent_private.require('approve_taxonomy');
    v_vals := jsonb_build_object('name', btrim(op ->> 'name'));
    if agent_private.has_column(op ->> 'table', 'slug') then v_vals := v_vals || jsonb_build_object('slug', agent_private.unique_slug(op ->> 'table', op ->> 'name')); end if;
    select string_agg(quote_ident(c), ', ') into v_cols from jsonb_object_keys(v_vals) c;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) returning id::text', op ->> 'table', v_cols) into v_value using v_vals;
    perform agent_private.log('agent:create', op ->> 'table', v_value, op ->> 'name', null, jsonb_build_object('agent', v_meta));
    return jsonb_build_object('id', op ->> 'id', 'status', 'applied', 'new_id', v_value);
  end case;
  raise exception 'Unknown change type.' using errcode = 'AG422';
end $$;

create or replace function agent_private.merge_font(p_keeper uuid, p_loser uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare k jsonb; l jsonb; spec text[]; kind text; rank jsonb := '{"featured":3,"published":2,"pending":1,"draft":0}';
  v_images jsonb; v_purchase jsonb; v_cases jsonb; v_groups jsonb; v_patch jsonb; f text;
begin
  k := agent_private.row_json('fonts', p_keeper); l := agent_private.row_json('fonts', p_loser);
  if k is null or l is null then perform agent_private.conflict('A font in the merge no longer exists.', '{}'); end if;
  foreach kind in array array['scripts', 'genres', 'styles', 'types', 'designers', 'awards', 'languages'] loop
    spec := agent_private.link_spec(kind);
    if kind = 'awards' then
      execute 'insert into public.font_awards (font_id, award_id, url) select $1, award_id, url from public.font_awards a where a.font_id = $2
        and not exists (select 1 from public.font_awards b where b.font_id = $1 and b.award_id = a.award_id)' using p_keeper, p_loser;
    else
      execute format('insert into public.%1$I (font_id, %2$I) select $1, a.%2$I from public.%1$I a where a.font_id = $2
        and not exists (select 1 from public.%1$I b where b.font_id = $1 and b.%2$I = a.%2$I)', spec[1], spec[2]) using p_keeper, p_loser;
    end if;
    execute format('delete from public.%I where font_id = $1', spec[1]) using p_loser;
  end loop;
  -- the keeper's images in their order, then the duplicate's cover and images that are new
  select coalesce(jsonb_agg(e order by o), '[]') into v_images from (
    select e, min(o) o from (
      select t.e, t.ord o from jsonb_array_elements_text(coalesce(case when jsonb_typeof(k -> 'images') = 'array' then k -> 'images' end, '[]')) with ordinality t(e, ord)
      union all select l ->> 'cover', 1000 where coalesce(l ->> 'cover', '') <> ''
      union all select t.e, 1000 + t.ord from jsonb_array_elements_text(coalesce(case when jsonb_typeof(l -> 'images') = 'array' then l -> 'images' end, '[]')) with ordinality t(e, ord)
    ) a group by e) b;
  select coalesce(jsonb_agg(distinct e), '[]') into v_purchase from (select jsonb_array_elements_text(coalesce(case when jsonb_typeof(k -> 'purchase_links') = 'array' then k -> 'purchase_links' end, '[]')) e
    union select jsonb_array_elements_text(coalesce(case when jsonb_typeof(l -> 'purchase_links') = 'array' then l -> 'purchase_links' end, '[]'))) s;
  select coalesce(jsonb_agg(distinct e), '[]') into v_cases from (select jsonb_array_elements_text(coalesce(case when jsonb_typeof(k -> 'case_studies') = 'array' then k -> 'case_studies' end, '[]')) e
    union select jsonb_array_elements_text(coalesce(case when jsonb_typeof(l -> 'case_studies') = 'array' then l -> 'case_studies' end, '[]'))) s;
  select coalesce(jsonb_agg(distinct e), '[]') into v_groups from (select jsonb_array_elements_text(coalesce(case when jsonb_typeof(k -> 'language_group') = 'array' then k -> 'language_group' end, '[]')) e
    union select jsonb_array_elements_text(coalesce(case when jsonb_typeof(l -> 'language_group') = 'array' then l -> 'language_group' end, '[]'))) s;
  v_patch := jsonb_build_object('images', v_images, 'purchase_links', v_purchase, 'case_studies', v_cases, 'language_group', v_groups,
    'status', case when coalesce((rank ->> (l ->> 'status'))::int, 0) > coalesce((rank ->> (k ->> 'status'))::int, 0) then l ->> 'status' else k ->> 'status' end);
  foreach f in array array['description', 'year', 'weights', 'cover', 'source_url'] loop
    if coalesce(k ->> f, '') = '' and coalesce(l ->> f, '') <> '' then v_patch := v_patch || jsonb_build_object(f, l -> f); end if;
  end loop;
  delete from public.fonts where id = p_loser;
  if not found then raise exception 'The database refused to remove the duplicate font (admins only).' using errcode = 'AG403'; end if;
  execute (select format('update public.fonts t set %s, updated_at = now() from jsonb_populate_record(null::public.fonts, $1) r where t.id = $2',
    string_agg(format('%1$I = r.%1$I', c), ', ')) from jsonb_object_keys(v_patch) c) using v_patch, p_keeper;
  if coalesce(l ->> 'slug', '') <> '' and l ->> 'slug' <> k ->> 'slug' then
    insert into public.font_redirects (from_slug, to_slug, kind) values (l ->> 'slug', k ->> 'slug', 'font')
    on conflict (from_slug) do update set to_slug = excluded.to_slug;
  end if;
end $$;

create or replace function agent_private.merge_person(p_keeper uuid, p_loser uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare k jsonb; l jsonb;
begin
  k := agent_private.row_json('designers', p_keeper); l := agent_private.row_json('designers', p_loser);
  if k is null or l is null then perform agent_private.conflict('A profile in the merge no longer exists.', '{}'); end if;
  insert into public.font_designers (font_id, designer_id)
  select a.font_id, p_keeper from public.font_designers a where a.designer_id = p_loser
    and not exists (select 1 from public.font_designers b where b.designer_id = p_keeper and b.font_id = a.font_id);
  delete from public.font_designers where designer_id = p_loser;
  delete from public.designers where id = p_loser;
  if not found then raise exception 'The database refused to remove the duplicate profile.' using errcode = 'AG403'; end if;
  update public.designers set updated_at = now() where id = p_keeper;
  if coalesce(l ->> 'slug', '') <> '' and l ->> 'slug' <> k ->> 'slug' then
    insert into public.font_redirects (from_slug, to_slug, kind) values (l ->> 'slug', k ->> 'slug', case when l ->> 'type' = 'foundry' then 'foundry' else 'designer' end)
    on conflict (from_slug) do update set to_slug = excluded.to_slug;
  end if;
end $$;
grant execute on all functions in schema agent_private to authenticated;

/**
 * Executes an approved proposal.
 *  - p_version must be the version the person saw; p_ops the change ids they ticked.
 *  - Runs as the person (their row-level security applies) and re-checks their permissions now.
 *  - Everything happens in this one transaction: if any change fails or finds newer data, none is kept.
 *  - The approval is used once: the same request id returns the first result, and a second approval of
 *    the same version is refused.
 */
create or replace function public.agent_execute_proposal(p_id uuid, p_version int, p_ops text[], p_request text, p_paths jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  p jsonb; op jsonb; v_new jsonb := '{}'::jsonb; v_res jsonb := '[]'::jsonb; r jsonb; v_out jsonb;
  v_selected text[]; v_refs_needed text[]; v_state text; v_msg text; v_detail text; v_code text; v_creates text[];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'AG401'; end if;
  if public.dashboard_role() is null then raise exception 'Your account isn’t on the dashboard team (any more).' using errcode = 'AG403'; end if;
  if p_request is null or char_length(p_request) not between 8 and 80 then raise exception 'Missing request id.' using errcode = 'AG422'; end if;
  v_out := agent_private.approval_for(p_request);
  if v_out is not null then return v_out; end if;
  p := agent_private.lock_proposal(p_id);
  if p is null then raise exception 'Proposal not found.' using errcode = 'AG404'; end if;
  if (p ->> 'status') = 'executed' then
    return coalesce(p -> 'result', '{}'::jsonb) || jsonb_build_object('ok', true, 'already', true, 'status', 'executed');
  end if;
  if (p ->> 'status') <> 'pending' then
    return jsonb_build_object('ok', false, 'status', p ->> 'status', 'code', 'not_pending', 'message', format('This proposal is %s.', p ->> 'status'));
  end if;
  if (p ->> 'version')::int <> p_version then
    return jsonb_build_object('ok', false, 'status', 'pending', 'code', 'stale_version', 'message', 'The proposal was edited after you looked at it. Review the new version and approve again.', 'version', (p ->> 'version')::int);
  end if;
  if (p ->> 'expires_at')::timestamptz < now() then
    perform agent_private.set_proposal(p_id, 'expired', null, 'The proposal expired before it was approved.');
    return jsonb_build_object('ok', false, 'status', 'expired', 'code', 'expired', 'message', 'This proposal expired. Ask the agent to prepare it again.');
  end if;
  select coalesce(array_agg(o ->> 'id'), '{}') into v_selected from jsonb_array_elements(p -> 'changes') o where (o ->> 'id') = any (coalesce(p_ops, '{}'));
  if array_length(v_selected, 1) is null or array_length(v_selected, 1) <> cardinality(array(select distinct unnest(p_ops))) then
    return jsonb_build_object('ok', false, 'status', 'pending', 'code', 'bad_selection', 'message', 'Choose at least one of the proposal’s changes.');
  end if;
  if array_length(v_selected, 1) > 20 and not public.agent_can('approve_bulk') then
    return jsonb_build_object('ok', false, 'status', 'pending', 'code', 'forbidden', 'message', 'Approving more than 20 changes at once needs the bulk-approval permission.');
  end if;
  -- changes on a new record need the change that creates it
  select coalesce(array_agg(o ->> 'ref'), '{}') into v_creates from jsonb_array_elements(p -> 'changes') o where o ->> 'op' = 'create' and (o ->> 'id') = any (v_selected);
  select coalesce(array_agg(distinct substr(x, 6)), '{}') into v_refs_needed from jsonb_array_elements(p -> 'changes') o,
    lateral (values (o ->> 'target'), (o ->> 'font'), (o ->> 'value')) t(x)
    where (o ->> 'id') = any (v_selected) and x like '$new:%';
  if not (v_refs_needed <@ v_creates) then
    return jsonb_build_object('ok', false, 'status', 'pending', 'code', 'bad_selection', 'message', 'Some chosen changes belong to a new record that isn’t chosen. Tick the change that creates it too.');
  end if;

  begin
    for op in select o from jsonb_array_elements(p -> 'changes') with ordinality t(o, n) where (o ->> 'id') = any (v_selected) order by (o ->> 'op' = 'status'), n loop
      r := agent_private.apply_op(op, v_new, (p ->> 'owner_id')::uuid, coalesce(p_paths, '{}'::jsonb), p_id);
      if r ? 'ref' then v_new := v_new || jsonb_build_object(r ->> 'ref', r ->> 'new_id'); end if;
      v_res := v_res || jsonb_build_array(r);
    end loop;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_code = returned_sqlstate;
    v_state := case when v_code = 'AG409' then 'conflict' else 'failed' end;
    v_out := jsonb_build_object('ok', false, 'status', v_state, 'code', case v_code when 'AG409' then 'conflict' when 'AG403' then 'forbidden' when '42501' then 'forbidden' when 'AG422' then 'invalid' else 'error' end,
      'message', v_msg, 'detail', case when v_code = 'AG409' and coalesce(v_detail, '') <> '' then v_detail::jsonb end);
    perform agent_private.record_approval(p_id, p_version, v_selected, p_request, v_state, v_out);
    perform agent_private.set_proposal(p_id, v_state, v_out, v_msg);
    return v_out;
  end;
  v_out := jsonb_build_object('ok', true, 'status', 'executed', 'applied', v_res, 'created', v_new, 'version', p_version,
    'skipped', (select coalesce(jsonb_agg(o ->> 'id'), '[]') from jsonb_array_elements(p -> 'changes') o where not ((o ->> 'id') = any (v_selected))));
  perform agent_private.record_approval(p_id, p_version, v_selected, p_request, 'executed', v_out);
  perform agent_private.set_proposal(p_id, 'executed', v_out, null);
  return v_out;
end $$;

-- 12. Link tables: editors can change links of draft / in-review fonts only --------
do $$
declare t text;
begin
  foreach t in array array['font_awards', 'font_designers', 'font_genres', 'font_languages', 'font_scripts', 'font_styles', 'font_types'] loop
    execute format('drop policy if exists "dashboard staff write" on public.%I', t);
    execute format('drop policy if exists "dashboard admins write links" on public.%I', t);
    execute format('create policy "dashboard admins write links" on public.%I for all to authenticated using (public.is_dashboard_admin()) with check (public.is_dashboard_admin())', t);
    execute format('drop policy if exists "dashboard editors write links of unpublished fonts" on public.%I', t);
    execute format('create policy "dashboard editors write links of unpublished fonts" on public.%I for all to authenticated using (public.is_dashboard_staff() and public.font_is_unpublished(font_id)) with check (public.is_dashboard_staff() and public.font_is_unpublished(font_id))', t);
  end loop;
end $$;

-- 13. Clean-up (called by the dashboard at most once an hour) ----------------------
create or replace function public.agent_cleanup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_paths jsonb; v_exp int; v_src int; v_mem int;
begin
  if not public.agent_can('use') then return null; end if;
  update public.agent_proposals set status = 'expired', updated_at = now() where status = 'pending' and expires_at < now();
  get diagnostics v_exp = row_count;
  delete from public.agent_sources where expires_at < now();
  get diagnostics v_src = row_count;
  delete from public.agent_memories where expires_at is not null and expires_at < now();
  get diagnostics v_mem = row_count;
  update public.agent_runs set status = 'interrupted', finished_at = now(), error = 'The run stopped answering (connection or server restart).'
    where status = 'running' and heartbeat_at < now() - interval '3 minutes';
  -- staged images of the caller that are no longer needed: the dashboard deletes the files, then the rows
  with gone as (
    update public.agent_assets a set status = 'discarded'
    where a.owner_id = auth.uid() and a.status = 'staged' and (a.expires_at < now() or not exists (
      select 1 from public.agent_proposals p where p.status in ('pending', 'conflict') and p.changes @> jsonb_build_array(jsonb_build_object('asset', a.id::text))))
      and a.created_at < now() - interval '1 day'
    returning staging_path)
  select coalesce(jsonb_agg(staging_path), '[]') into v_paths from gone;
  return jsonb_build_object('expired_proposals', v_exp, 'deleted_sources', v_src, 'deleted_memories', v_mem, 'discard_files', v_paths);
end $$;

-- 14. Who can call what ------------------------------------------------------------
revoke all on function public.agent_vault_put(text, text, text, uuid), public.agent_vault_delete(text, uuid), public.agent_vault_read(text),
  public.agent_integration_status(text, text, text, jsonb), public.agent_gateway_authorize(uuid, uuid, text),
  public.agent_record_usage(uuid, uuid, text, text, text, bigint, bigint, numeric, numeric, boolean, boolean, text, int), public.agent_can_for(uuid, text)
  from public, anon, authenticated;
grant execute on function public.agent_vault_put(text, text, text, uuid), public.agent_vault_delete(text, uuid), public.agent_vault_read(text),
  public.agent_integration_status(text, text, text, jsonb), public.agent_gateway_authorize(uuid, uuid, text),
  public.agent_record_usage(uuid, uuid, text, text, text, bigint, bigint, numeric, numeric, boolean, boolean, text, int), public.agent_can_for(uuid, text)
  to service_role;
revoke all on function public.agent_can(text), public.agent_my_permissions(), public.agent_save_settings(jsonb, int), public.agent_start_run(uuid, uuid, text, text, uuid),
  public.agent_set_head(uuid, uuid), public.agent_usage_summary(), public.agent_job_create(text, text, jsonb, uuid), public.agent_job_next(uuid, uuid),
  public.agent_job_item_done(uuid, uuid, boolean, text, uuid, uuid[], text), public.agent_job_control(uuid, text),
  public.agent_create_proposal(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb), public.agent_update_proposal(uuid, int, jsonb),
  public.agent_decide_proposal(uuid, text, text), public.agent_execute_proposal(uuid, int, text[], text, jsonb), public.agent_cleanup()
  from public, anon;
grant execute on function public.agent_can(text), public.agent_my_permissions(), public.agent_save_settings(jsonb, int), public.agent_start_run(uuid, uuid, text, text, uuid),
  public.agent_set_head(uuid, uuid), public.agent_usage_summary(), public.agent_job_create(text, text, jsonb, uuid), public.agent_job_next(uuid, uuid),
  public.agent_job_item_done(uuid, uuid, boolean, text, uuid, uuid[], text), public.agent_job_control(uuid, text),
  public.agent_create_proposal(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb), public.agent_update_proposal(uuid, int, jsonb),
  public.agent_decide_proposal(uuid, text, text), public.agent_execute_proposal(uuid, int, text[], text, jsonb), public.agent_cleanup()
  to authenticated;
-- the service role (gateway) never needs the private schema's executor helpers through the API
grant select on public.agent_settings, public.agent_integrations, public.agent_runs to service_role;

-- 15. Check -------------------------------------------------------------------------
select 'agent tables' as what, count(*)::text as value from information_schema.tables where table_schema = 'public' and table_name like 'agent\_%'
union all select 'vault available', (exists (select 1 from information_schema.views where table_schema = 'vault' and table_name = 'decrypted_secrets'))::text
union all select 'agent-staging bucket', (exists (select 1 from storage.buckets where id = 'agent-staging'))::text;
