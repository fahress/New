-- Designer of the week: one pick per week, chosen in the dashboard (Dashboard → Designer of the week).
-- Safe to run more than once.

create table if not exists public.designer_of_week (
  week_start date primary key,                     -- the Sunday the week starts on
  designer_id uuid not null references public.designers(id) on delete cascade,
  note text,                                       -- optional line shown under the name on the home page
  chosen_by uuid default auth.uid(),
  chosen_at timestamptz not null default now()
);

alter table public.designer_of_week enable row level security;

-- everyone can see the pick (the home page shows it)
drop policy if exists "anyone reads designer of the week" on public.designer_of_week;
create policy "anyone reads designer of the week" on public.designer_of_week for select to anon, authenticated using (true);

-- only the dashboard team chooses
drop policy if exists "team chooses designer of the week" on public.designer_of_week;
create policy "team chooses designer of the week" on public.designer_of_week for all to authenticated
  using (public.is_dashboard_staff()) with check (public.is_dashboard_staff());
