-- ============================================================================
-- Fahress — Claims update ("Claim this font", "Claim this account", owners edit their fonts)
-- Run once in Supabase → SQL Editor. Safe to run more than once.
-- (Also included in dashboard-setup.sql as section 12.)
-- ============================================================================

-- 12. Font claims and font edits from designers / foundries ------------------------
-- Two new kinds of inbox items:
--   font_claim — a signed-in member says a font is theirs (name, email, comment)
--   font_edit  — the owner of a claimed profile sends changes to one of its fonts;
--                nothing changes on the site until an admin approves it.
alter table public.submissions drop constraint if exists submissions_kind_check;
alter table public.submissions add constraint submissions_kind_check
  check (kind in ('font', 'correction', 'claim', 'profile_edit', 'message', 'font_claim', 'font_edit'));

-- the reason an admin gives when declining (the sender sees it in their account)
alter table public.submissions add column if not exists reply text check (char_length(reply) <= 2000);

drop policy if exists "members claim and edit fonts" on public.submissions;
create policy "members claim and edit fonts" on public.submissions for insert to authenticated
  with check (
    status = 'new' and handled_at is null and reply is null and user_id = auth.uid() and font_id is not null and (
      kind = 'font_claim'
      or (kind = 'font_edit' and designer_id is not null and exists (
        select 1 from public.font_designers fd join public.designers d on d.id = fd.designer_id
        where fd.font_id = submissions.font_id and d.id = submissions.designer_id and d.user_id = auth.uid()
      ))
    )
  );

-- the fonts credited to the caller's claimed profiles, drafts included (read-only)
create or replace function public.my_fonts()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg((to_jsonb(f) - 'user_id') || jsonb_build_object('designer_id', d.id, 'status', f.status::text) order by f.name), '[]'::jsonb)
  from public.designers d
  join public.font_designers fd on fd.designer_id = d.id
  join public.fonts f on f.id = fd.font_id
  where d.user_id = auth.uid() and auth.uid() is not null
$$;
revoke all on function public.my_fonts() from public, anon;
grant execute on function public.my_fonts() to authenticated;
