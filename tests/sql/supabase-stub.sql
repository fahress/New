-- A minimal stand-in for the parts of Supabase the dashboard SQL relies on, so the migrations
-- and the agent executor can be tested on a plain local Postgres. NOT for production.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Vault: real Supabase encrypts with a root key held outside the database; here it is only base64.
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text not null, created_at timestamptz default now());
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid
language sql as $$ insert into vault.secrets (name, description, secret) values (new_name, new_description, encode(convert_to(new_secret, 'utf8'), 'base64')) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void
language sql as $$ update vault.secrets set secret = coalesce(encode(convert_to(new_secret, 'utf8'), 'base64'), secret), name = coalesce(new_name, name) where id = secret_id $$;
create or replace view vault.decrypted_secrets as select id, name, description, convert_from(decode(secret, 'base64'), 'utf8') as decrypted_secret from vault.secrets;
revoke all on schema vault from public;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to authenticated, service_role;
insert into storage.buckets (id, name, public) values ('studio', 'studio', true) on conflict do nothing;

-- The existing Fahress tables (shape as the dashboard code uses them; production may have more columns)
create type public.font_status as enum ('draft', 'pending', 'published', 'featured');
create table public.profiles (id uuid primary key references auth.users(id), role text);
create table public.designers (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, type text not null default 'designer',
  logo text, bio text, social_links jsonb default '{}'::jsonb, user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.fonts (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, description text, year int, weights int,
  is_variable boolean default false, license text default 'paid', status public.font_status not null default 'draft', cover text, images text[] default '{}',
  purchase_links text[] default '{}', case_studies text[] default '{}', language_group text[] default '{}', source_url text, user_id uuid references auth.users(id),
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.scripts (id serial primary key, name text, slug text);
create table public.genres (id serial primary key, name text, slug text);
create table public.styles (id serial primary key, name text, slug text);
create table public.types (id serial primary key, name text, slug text);
create table public.languages (id serial primary key, name text, native_name text);
create table public.language_groups (id serial primary key, name text);
create table public.language_group_languages (language_group_id int references public.language_groups(id), language_id int references public.languages(id));
create table public.awards (id uuid primary key default gen_random_uuid(), name text, image text);
create table public.font_scripts (font_id uuid references public.fonts(id), script_id int references public.scripts(id), primary key (font_id, script_id));
create table public.font_genres (font_id uuid references public.fonts(id), genre_id int references public.genres(id), primary key (font_id, genre_id));
create table public.font_styles (font_id uuid references public.fonts(id), style_id int references public.styles(id), primary key (font_id, style_id));
create table public.font_types (font_id uuid references public.fonts(id), type_id int references public.types(id), primary key (font_id, type_id));
create table public.font_languages (font_id uuid references public.fonts(id), lang_id int references public.languages(id), primary key (font_id, lang_id));
create table public.font_designers (font_id uuid references public.fonts(id), designer_id uuid references public.designers(id), created_at timestamptz default now(), primary key (font_id, designer_id));
create table public.font_awards (font_id uuid references public.fonts(id), award_id uuid references public.awards(id), url text, primary key (font_id, award_id));
do $$ declare t text; begin
  foreach t in array array['profiles','designers','fonts','scripts','genres','styles','types','languages','language_groups','language_group_languages','awards',
    'font_scripts','font_genres','font_styles','font_types','font_languages','font_designers','font_awards'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on public.%I to anon, authenticated, service_role', t);
    if t <> 'profiles' and t <> 'fonts' then execute format('create policy "Public read" on public.%I for select to anon, authenticated using (true)', t); end if;
  end loop;
end $$;
create policy "Public read" on public.fonts for select to anon, authenticated using (status in ('published', 'featured'));
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
