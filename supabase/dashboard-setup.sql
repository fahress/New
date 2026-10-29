-- ============================================================================
-- Fahress dashboard — one-time database update
-- Safe to run more than once. It only ADDS things: new tables, new columns,
-- new permission rules and helper functions. It does not delete or change any
-- existing data, tables or rules, so admin.fahress.com keeps working as before.
-- ============================================================================

-- 1. Country for designers & foundries -----------------------------------------
alter table public.designers add column if not exists country text;

update public.designers d
set country = v.country
from (values
  ('29lt', 'Spain'),
  ('aamir-arsalan-ahmadi', 'Iran'),
  ('abbas-seyed-ebrahimi', 'Iran'),
  ('abdelrahman-farahat', 'Egypt'),
  ('abdo-mohamed', 'Egypt'),
  ('abdoaroof-aburzizh', 'Libya'),
  ('abdullah-aref', 'Egypt'),
  ('abdurrahman-hanif', 'Indonesia'),
  ('abjad-type-foundry', 'Jordan'),
  ('abolfazl-rahrovan', 'Iran'),
  ('adel-banfeel', 'Saudi Arabia'),
  ('afra-al-sammahi', 'Saudi Arabia'),
  ('ahad-hashemzadeh', 'Iran'),
  ('ahmadreza-rahimi-pour', 'Iran'),
  ('alaa-el-hadidy', 'Egypt'),
  ('albert-jan-pool', 'Netherlands'),
  ('alef-type-foundry', 'France'),
  ('ali-moshref', 'Syria'),
  ('ali-pezeshk', 'Iran'),
  ('ali-sajjadieh', 'Iran'),
  ('alif-type', 'Egypt'),
  ('alireza-nematollahi', 'Iran'),
  ('amin-abedi', 'Iran'),
  ('amir-hosein-rouf', 'Iran'),
  ('amir-hossein-saadatfar', 'Iran'),
  ('amir-mahdi-moslehi', 'Iran'),
  ('amir-mesbahi', 'Iran'),
  ('ammar-bouras', 'Algeria'),
  ('arman-khorramak', 'Iran'),
  ('artur-schmal', 'Netherlands'),
  ('atefeh-mohammadi', 'Iran'),
  ('azza-alameddine', 'Lebanon'),
  ('babelfont', 'France'),
  ('bahman-eslami', 'Iran'),
  ('blackfoundry', 'France'),
  ('boharat-type-foundry', 'Egypt'),
  ('borna-izadpanah', 'Iran'),
  ('brahim-boucheikha', 'Morocco'),
  ('canadatype', 'Canada'),
  ('cosimo-lorenzo-pancini', 'Italy'),
  ('dalton-maag', 'United Kingdom'),
  ('damoon-khanjanzadeh', 'Iran'),
  ('eduardo-tunni', 'Argentina'),
  ('ehsan-roudi', 'Iran'),
  ('elena-schneider', 'Germany'),
  ('elman-taqidoust', 'Iran'),
  ('f37', 'United Kingdom'),
  ('fadhl-haqq', 'Indonesia'),
  ('fahd-al-fraikh', 'Saudi Arabia'),
  ('farhood-moghaddam', 'Iran'),
  ('fereshte-iranshahi', 'Iran'),
  ('fereydoun-nematpour', 'Iran'),
  ('foundry5', 'United Kingdom'),
  ('greta-khoury', 'Lebanon'),
  ('hasan-abu-afash', 'Palestine'),
  ('hassan-manzoori', 'Iran'),
  ('hermann-zapf', 'Germany'),
  ('hind', 'Algeria'),
  ('hirbod-lotfian', 'Iran'),
  ('hoda-kaspoor', 'Iran'),
  ('hojat-nourolahi', 'Iran'),
  ('hossein-badzohreh', 'Iran'),
  ('hossein-heidari', 'Iran'),
  ('hossein-karimzadeh', 'Iran'),
  ('ibrahim-hamdi', 'Egypt'),
  ('iliya-salimi', 'Iran'),
  ('javad-jalilian', 'Iran'),
  ('jawaher-alali', 'Bahrain'),
  ('joe-hatem', 'Lebanon'),
  ('jovanny-lemonad', 'Russia'),
  ('juan-luis-blanco', 'Spain'),
  ('kamal-mansour', 'Egypt'),
  ('kameel-hawa', 'Lebanon'),
  ('kamyab-jafari', 'Iran'),
  ('karim-ameri', 'Iran'),
  ('khajag-apelian', 'Lebanon'),
  ('khaled-hosny', 'Egypt'),
  ('ko-type', 'United Arab Emirates'),
  ('kostas-bartsokas', 'Greece'),
  ('kourosh-beigpour', 'Iran'),
  ('kristyan-sarkis', 'Lebanon'),
  ('lara-assouad', 'Lebanon'),
  ('lara-captan', 'Lebanon'),
  ('latinotype', 'Chile'),
  ('laura-garcia-mut', 'Spain'),
  ('letterjuice', 'Spain'),
  ('lettersoup', 'Germany'),
  ('maha-akl', 'Egypt'),
  ('mahan-jafarzadeh', 'Iran'),
  ('mahdi-ershadi', 'Iran'),
  ('mahmoud-abdelghany', 'Egypt'),
  ('majid-halakoyei', 'Iran'),
  ('majid-shoarai-nejati', 'Iran'),
  ('mamoun-sakkal', 'Syria'),
  ('manchester-type', 'United Kingdom'),
  ('matype', 'Egypt'),
  ('mazdak-kiani', 'Iran'),
  ('mehdi-qassemi', 'Iran'),
  ('mehrdad-notash', 'Iran'),
  ('mhrf', 'Saudi Arabia'),
  ('mohamad-dakak', 'Syria'),
  ('mohamed-gaber', 'Egypt'),
  ('mohamed-gallah', 'Tunisia'),
  ('mohammad-darvishi', 'Iran'),
  ('mohammad-reza-chitsaz', 'Iran'),
  ('mohhamad-amouei', 'Iran'),
  ('mohtaraf', 'Lebanon'),
  ('monocotype', 'Indonesia'),
  ('monotype', 'United States'),
  ('moshen-shirsavaar-shamami', 'Iran'),
  ('moslem-ebrahimi', 'Iran'),
  ('mostafa-abasiry', 'Egypt'),
  ('nadine-chahine', 'Lebanon'),
  ('naghi-naghachian', 'Iran'),
  ('naghi-naghashian', 'Iran'),
  ('naima-ben-ayed', 'France'),
  ('naji-el-mir', 'Lebanon'),
  ('namelatype', 'Indonesia'),
  ('nan', 'Germany'),
  ('naser-khadem', 'Iran'),
  ('omaima-dajani', 'Palestine'),
  ('omid-emamian', 'Iran'),
  ('original-type', 'Netherlands'),
  ('pampatype', 'Argentina'),
  ('parachute', 'Greece'),
  ('parnian-kashefi', 'Iran'),
  ('pascal-zoghbi', 'Lebanon'),
  ('peter-bilak', 'Slovakia'),
  ('protype', 'Egypt'),
  ('rania-azmi', 'Lebanon'),
  ('rasool-kamali', 'Iran'),
  ('reza-bakhtiarifard', 'Iran'),
  ('reza-bohlul', 'Iran'),
  ('reza-ghaffari', 'Iran'),
  ('reza-salarifar', 'Iran'),
  ('rosettatype', 'Czech Republic'),
  ('rui-abreu', 'Portugal'),
  ('saeed-haqiqat', 'Iran'),
  ('santiago-orozco', 'Mexico'),
  ('seyed-mahdi-seyedinia', 'Iran'),
  ('shahrzad-akbari', 'Iran'),
  ('shaqa-bovand', 'Iran'),
  ('siavash-mousavi', 'Iran'),
  ('sil-international', 'United States'),
  ('sina-fakour', 'Iran'),
  ('studio-daftar', 'Iran'),
  ('sultan-alonazi', 'Saudi Arabia'),
  ('sultan-fonts', 'Yemen'),
  ('tarek-atrissi', 'Lebanon'),
  ('titus-nemeth', 'Austria'),
  ('toshi-omagari', 'Japan'),
  ('tptq', 'Netherlands'),
  ('ts-fonts', 'Turkey'),
  ('typetogether', 'Czech Republic'),
  ('vahid-yaghoblo', 'Iran'),
  ('vitoria-neves', 'Portugal'),
  ('wael-morcos', 'Lebanon'),
  ('yanone', 'Germany'),
  ('yara-khoury', 'Lebanon'),
  ('younes-dehghani', 'Iran'),
  ('zakariya-saleh', 'Palestine'),
  ('zetafonts', 'Italy')
) as v(slug, country)
where d.slug = v.slug and (d.country is null or d.country = '');

-- 2. Dashboard team (admins & editors) ------------------------------------------
create table if not exists public.dashboard_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'editor')),
  created_at timestamptz not null default now()
);
alter table public.dashboard_roles enable row level security;

-- Everyone who has already added fonts through the current admin dashboard starts as an admin.
insert into public.dashboard_roles (user_id, role)
select distinct f.user_id, 'admin' from public.fonts f
join auth.users u on u.id = f.user_id
where f.user_id is not null
on conflict (user_id) do nothing;

-- If profiles has a role column, anyone marked admin there is an admin here too.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'role') then
    execute $q$insert into public.dashboard_roles (user_id, role)
      select p.id, 'admin' from public.profiles p join auth.users u on u.id = p.id
      where lower(p.role::text) in ('admin', 'super_admin', 'superadmin')
      on conflict (user_id) do nothing$q$;
  end if;
end $$;

create or replace function public.dashboard_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.dashboard_roles where user_id = auth.uid()
$$;
create or replace function public.is_dashboard_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dashboard_roles where user_id = auth.uid())
$$;
create or replace function public.is_dashboard_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dashboard_roles where user_id = auth.uid() and role = 'admin')
$$;
grant execute on function public.dashboard_role(), public.is_dashboard_staff(), public.is_dashboard_admin() to anon, authenticated;

drop policy if exists "team can see the team" on public.dashboard_roles;
create policy "team can see the team" on public.dashboard_roles for select to authenticated using (public.is_dashboard_staff());
drop policy if exists "admins manage the team" on public.dashboard_roles;
create policy "admins manage the team" on public.dashboard_roles for all to authenticated using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

-- 3. The team can edit the archive (added alongside the existing rules) -----------
-- Fonts: admins can do anything; editors can add/edit drafts and fonts in review, but not publish or delete.
drop policy if exists "dashboard admins write fonts" on public.fonts;
create policy "dashboard admins write fonts" on public.fonts for all to authenticated using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());
drop policy if exists "dashboard editors read fonts" on public.fonts;
create policy "dashboard editors read fonts" on public.fonts for select to authenticated using (public.is_dashboard_staff());
drop policy if exists "dashboard editors add fonts" on public.fonts;
create policy "dashboard editors add fonts" on public.fonts for insert to authenticated with check (public.is_dashboard_staff() and status in ('draft', 'pending'));
drop policy if exists "dashboard editors edit unpublished fonts" on public.fonts;
create policy "dashboard editors edit unpublished fonts" on public.fonts for update to authenticated
  using (public.is_dashboard_staff() and status in ('draft', 'pending'))
  with check (public.is_dashboard_staff() and status in ('draft', 'pending'));

drop policy if exists "dashboard staff write" on public.designers;
create policy "dashboard staff write" on public.designers for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.awards;
create policy "dashboard staff write" on public.awards for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.genres;
create policy "dashboard staff write" on public.genres for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.scripts;
create policy "dashboard staff write" on public.scripts for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.styles;
create policy "dashboard staff write" on public.styles for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.types;
create policy "dashboard staff write" on public.types for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.languages;
create policy "dashboard staff write" on public.languages for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.language_groups;
create policy "dashboard staff write" on public.language_groups for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.language_group_languages;
create policy "dashboard staff write" on public.language_group_languages for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.font_awards;
create policy "dashboard staff write" on public.font_awards for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.font_designers;
create policy "dashboard staff write" on public.font_designers for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.font_genres;
create policy "dashboard staff write" on public.font_genres for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.font_languages;
create policy "dashboard staff write" on public.font_languages for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.font_scripts;
create policy "dashboard staff write" on public.font_scripts for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.font_styles;
create policy "dashboard staff write" on public.font_styles for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "dashboard staff write" on public.font_types;
create policy "dashboard staff write" on public.font_types for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());

-- the team can read user profiles (names / emails on the Users page)
drop policy if exists "dashboard staff read profiles" on public.profiles;
create policy "dashboard staff read profiles" on public.profiles for select to authenticated using (public.is_dashboard_staff());

-- 4. Inbox: font submissions, corrections, profile claims & profile edits --------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('font', 'correction', 'claim', 'profile_edit')),
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  user_id uuid references auth.users(id) on delete set null,
  font_id uuid references public.fonts(id) on delete set null,
  designer_id uuid references public.designers(id) on delete set null,
  name text check (char_length(name) <= 200),
  email text check (char_length(email) <= 320),
  message text check (char_length(message) <= 5000),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) < 20000),
  handled_at timestamptz,
  handled_by uuid default null
);
alter table public.submissions enable row level security;
create index if not exists submissions_status_idx on public.submissions (status, created_at desc);

drop policy if exists "anyone can send fonts and corrections" on public.submissions;
create policy "anyone can send fonts and corrections" on public.submissions for insert to anon, authenticated
  with check (status = 'new' and handled_at is null and kind in ('font', 'correction') and (user_id is null or user_id = auth.uid()));
drop policy if exists "members can claim and edit their profile" on public.submissions;
create policy "members can claim and edit their profile" on public.submissions for insert to authenticated
  with check (
    status = 'new' and handled_at is null and user_id = auth.uid() and designer_id is not null and (
      (kind = 'claim' and exists (select 1 from public.designers d where d.id = designer_id and d.user_id is null))
      or (kind = 'profile_edit' and exists (select 1 from public.designers d where d.id = designer_id and d.user_id = auth.uid()))
    )
  );
drop policy if exists "members see what they sent" on public.submissions;
create policy "members see what they sent" on public.submissions for select to authenticated using (user_id = auth.uid() or public.is_dashboard_staff());
drop policy if exists "team handles submissions" on public.submissions;
create policy "team handles submissions" on public.submissions for update to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
drop policy if exists "admins delete submissions" on public.submissions;
create policy "admins delete submissions" on public.submissions for delete to authenticated using (public.is_dashboard_admin());

-- 5. Old addresses of merged duplicates keep working --------------------------------
create table if not exists public.font_redirects (
  from_slug text primary key,
  to_slug text not null,
  kind text not null default 'font' check (kind in ('font', 'designer', 'foundry')),
  created_at timestamptz not null default now()
);
alter table public.font_redirects enable row level security;
drop policy if exists "public read redirects" on public.font_redirects;
create policy "public read redirects" on public.font_redirects for select to anon, authenticated using (true);
drop policy if exists "team writes redirects" on public.font_redirects;
create policy "team writes redirects" on public.font_redirects for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());

-- 6. Link health results ----------------------------------------------------------
create table if not exists public.link_checks (
  url text primary key,
  status int,
  verdict text check (verdict in ('ok', 'broken', 'unknown')),
  ok boolean,
  error text,
  checked_at timestamptz not null default now()
);
alter table public.link_checks enable row level security;
drop policy if exists "team uses link checks" on public.link_checks;
create policy "team uses link checks" on public.link_checks for all to authenticated using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());

-- 7. History of changes -----------------------------------------------------------
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_email text,
  action text not null,
  entity text not null,
  entity_id text,
  label text,
  before jsonb,
  after jsonb
);
alter table public.activity_log enable row level security;
create index if not exists activity_log_at_idx on public.activity_log (at desc);
drop policy if exists "team reads history" on public.activity_log;
create policy "team reads history" on public.activity_log for select to authenticated using (public.is_dashboard_staff());
drop policy if exists "team writes history" on public.activity_log;
create policy "team writes history" on public.activity_log for insert to authenticated with check (public.is_dashboard_staff() and user_id = auth.uid());

-- 8. Buy-button clicks (visitors sent to designers' stores) ----------------------
create table if not exists public.link_clicks (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  font_id uuid not null references public.fonts(id) on delete cascade,
  url text not null check (char_length(url) <= 2000),
  ref text check (char_length(ref) <= 300)
);
alter table public.link_clicks enable row level security;
create index if not exists link_clicks_font_at_idx on public.link_clicks (font_id, at desc);
drop policy if exists "site counts clicks" on public.link_clicks;
create policy "site counts clicks" on public.link_clicks for insert to anon, authenticated with check (at > now() - interval '1 minute');
drop policy if exists "team reads clicks" on public.link_clicks;
create policy "team reads clicks" on public.link_clicks for select to authenticated using (public.is_dashboard_staff());

create or replace function public.dashboard_click_stats()
returns table (font_id uuid, clicks_7d bigint, clicks_30d bigint, clicks_total bigint)
language sql stable security definer set search_path = public as $$
  select c.font_id,
    count(*) filter (where c.at > now() - interval '7 days'),
    count(*) filter (where c.at > now() - interval '30 days'),
    count(*)
  from public.link_clicks c
  where public.is_dashboard_staff()
  group by c.font_id
$$;
create or replace function public.dashboard_click_daily(days int default 60)
returns table (day date, clicks bigint)
language sql stable security definer set search_path = public as $$
  select d::date, count(c.id)
  from generate_series(current_date - (least(days, 365) - 1), current_date, interval '1 day') d
  left join public.link_clicks c on c.at::date = d::date
  where public.is_dashboard_staff()
  group by d order by d
$$;
-- a designer / foundry sees the clicks on their own typefaces only
create or replace function public.my_click_stats()
returns table (designer_id uuid, font_id uuid, font_name text, clicks_30d bigint, clicks_total bigint)
language sql stable security definer set search_path = public as $$
  select d.id, f.id, f.name,
    count(c.id) filter (where c.at > now() - interval '30 days'),
    count(c.id)
  from public.designers d
  join public.font_designers fd on fd.designer_id = d.id
  join public.fonts f on f.id = fd.font_id and f.status in ('published', 'featured')
  left join public.link_clicks c on c.font_id = f.id
  where d.user_id = auth.uid()
  group by d.id, f.id, f.name
$$;
grant execute on function public.dashboard_click_stats(), public.dashboard_click_daily(int), public.my_click_stats() to authenticated;

-- 9. Image uploads ----------------------------------------------------------------
-- the team uploads to the studio bucket; members upload submission images to their own folder
drop policy if exists "dashboard staff upload" on storage.objects;
create policy "dashboard staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'studio' and public.is_dashboard_staff());
drop policy if exists "members upload submission images" on storage.objects;
create policy "members upload submission images" on storage.objects for insert to authenticated
  with check (bucket_id = 'studio' and (storage.foldername(name))[1] = 'submissions' and (storage.foldername(name))[2] = auth.uid()::text);

-- 10. Results ---------------------------------------------------------------------
select 'team' as what, r.role as detail, u.email as value from public.dashboard_roles r join auth.users u on u.id = r.user_id
union all
select 'countries', type, count(*) filter (where country is not null and country <> '')::text || ' of ' || count(*)::text from public.designers group by type;
