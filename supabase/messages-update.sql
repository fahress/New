-- ============================================================================
-- Fahress dashboard — Messages update (website contact form + Gmail inbox)
-- Run once in Supabase → SQL Editor. Safe to run more than once.
-- (Also included in dashboard-setup.sql as section 10.)
-- ============================================================================

-- 10. Messages: the website contact form + the connected Gmail inbox ----------------
-- Website messages are stored as submissions of kind 'message'.
alter table public.submissions drop constraint if exists submissions_kind_check;
alter table public.submissions add constraint submissions_kind_check
  check (kind in ('font', 'correction', 'claim', 'profile_edit', 'message'));

drop policy if exists "anyone can send fonts and corrections" on public.submissions;
create policy "anyone can send fonts and corrections" on public.submissions for insert to anon, authenticated
  with check (status = 'new' and handled_at is null and kind in ('font', 'correction', 'message') and (user_id is null or user_id = auth.uid()));

-- The Gmail account shown in the dashboard Inbox. One row only.
-- The Google sign-in token is stored encrypted (the key lives only on the web server),
-- and only dashboard admins can read or change this table.
create table if not exists public.mail_account (
  id smallint primary key default 1 check (id = 1),
  email text not null,
  token text not null,
  connected_by uuid default auth.uid(),
  connected_at timestamptz not null default now()
);
alter table public.mail_account enable row level security;
drop policy if exists "admins manage the mail account" on public.mail_account;
create policy "admins manage the mail account" on public.mail_account for all to authenticated
  using (public.is_dashboard_admin()) with check (public.is_dashboard_admin());

