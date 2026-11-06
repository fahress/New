-- Behaviour tests for supabase/agent-setup.sql. Run on a database prepared with supabase-stub.sql,
-- dashboard-setup.sql and agent-setup.sql (tests/sql.test.ts does this). Any failed assert stops the run.
\set ON_ERROR_STOP 1
\set QUIET 1

-- people ------------------------------------------------------------------------------
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000e', 'editor@test'),
  ('00000000-0000-0000-0000-0000000000e2', 'editor2@test'),
  ('00000000-0000-0000-0000-00000000000b', 'outsider@test');
insert into public.dashboard_roles values
  ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000e', 'editor'), ('00000000-0000-0000-0000-0000000000e2', 'editor');
update public.agent_settings set config = '{"runtime":{"enabled":true},"limits":{"user_concurrent_runs":2,"team_concurrent_runs":3}}';

-- archive -------------------------------------------------------------------------------
insert into public.scripts (id, name) values (1, 'Naskh'), (2, 'Kufi');
insert into public.genres (id, name) values (1, 'Display');
insert into public.language_groups (id, name) values (1, 'Arabic');
insert into public.designers (id, name, slug, type) values
  ('11111111-0000-0000-0000-000000000001', 'Sara Studio', 'sara-studio', 'foundry'),
  ('11111111-0000-0000-0000-000000000002', 'Sara Studio Type', 'sara-studio-type', 'foundry');
insert into public.fonts (id, name, slug, status, year, weights, images, user_id) values
  ('22222222-0000-0000-0000-000000000001', 'Draft Kufi', 'draft-kufi', 'draft', null, null, '{a.jpg}', '00000000-0000-0000-0000-00000000000a'),
  ('22222222-0000-0000-0000-000000000002', 'Live Naskh', 'live-naskh', 'published', 2019, 4, '{b.jpg,c.jpg}', '00000000-0000-0000-0000-00000000000a'),
  ('22222222-0000-0000-0000-000000000003', 'Live Naskh 2', 'live-naskh-2', 'draft', null, null, '{d.jpg}', '00000000-0000-0000-0000-00000000000a');
insert into public.font_designers (font_id, designer_id) values ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001');
insert into public.font_scripts values ('22222222-0000-0000-0000-000000000002', 1);

create table pg_temp.people as select * from auth.users;
grant select on pg_temp.people to authenticated;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'email', (select email from pg_temp.people where id = p), 'role', 'authenticated')::text, false);
end $$;
create table pg_temp.ids (k text primary key, v uuid);
grant all on pg_temp.ids to authenticated;

\echo '1. permissions: ceilings and defaults'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin
  assert public.agent_can('use'), 'editor can use';
  assert public.agent_can('approve_font_draft'), 'editor approves drafts by default';
  assert not public.agent_can('approve_publish'), 'editor cannot publish';
  assert not public.agent_can('manage_secrets'), 'editor cannot manage keys';
end $$;
reset role;
-- even when the settings list editors, the ceiling wins
update public.agent_settings set config = config || '{"permissions":{"approve_publish":["admin","editor"],"manage_secrets":["editor"],"use":["admin","editor"],"approve_font_draft":["admin","editor"],"propose":["admin","editor"],"approve_people":["admin","editor"],"approve_images":["admin","editor"],"manage_settings":["admin","editor"]}}';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin
  assert not public.agent_can('approve_publish'), 'ceiling: editor never publishes';
  assert not public.agent_can('manage_secrets'), 'ceiling: editor never manages keys';
  assert public.agent_can('manage_settings'), 'editor was given manage_settings';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin assert public.agent_can('manage_secrets'), 'admin always manages keys (no lock-out)'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin assert not public.agent_can('use'), 'outsider cannot use the agent'; end $$;

\echo '2. settings: versioned saves; editors cannot change permissions'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ declare v int; c jsonb; begin
  select version, config into v, c from public.agent_settings;
  perform public.agent_save_settings(c || '{"behavior":{"tone":"friendly"}}', v);
  begin
    perform public.agent_save_settings(c || '{"behavior":{"tone":"x"}}', v); -- stale
    assert false, 'stale settings save must fail';
  exception when sqlstate 'AG409' then null; end;
  begin
    perform public.agent_save_settings(jsonb_set(c, '{permissions,approve_delete}', '["admin","editor"]'), v + 1);
    assert false, 'editor must not change permissions';
  exception when sqlstate 'AG403' then null; end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.agent_settings_log) = 1, 'one settings change logged';
  assert (select changes ? 'behavior' from public.agent_settings_log limit 1), 'log names the changed section';
end $$;

\echo '3. keys: nobody signed in can read or write them through the API'
do $$ begin
  begin perform public.agent_vault_read('fireworks'); assert false, 'vault read must be refused';
  exception when insufficient_privilege then null; end;
  begin perform public.agent_vault_put('fireworks', 'fw_secret_value', '••••alue', auth.uid()); assert false, 'vault put must be refused';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select public.agent_vault_put('fireworks', 'fw_test_1234567890', '••••7890', '00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert public.agent_vault_read('fireworks') = 'fw_test_1234567890', 'gateway reads the key';
  begin perform public.agent_vault_put('tavily', 'tvly-xxxxxxxxxxxx', '••••xxxx', '00000000-0000-0000-0000-00000000000e'); assert false, 'editor id cannot store keys';
  exception when sqlstate 'AG403' then null; end;
end $$;
select public.agent_vault_put('fireworks', 'fw_rotated_abcdefgh', '••••efgh', '00000000-0000-0000-0000-00000000000a');
do $$ begin assert public.agent_vault_read('fireworks') = 'fw_rotated_abcdefgh', 'rotation replaces the key'; end $$;
reset role;
do $$ begin
  assert (select count(*) from vault.secrets where name = 'fahress_agent_fireworks') = 1, 'rotation keeps one vault secret';
  assert not exists (select 1 from public.agent_settings_log where changes::text like '%fw_%'), 'key values never logged';
  assert not exists (select 1 from public.agent_integrations where hint like '%fw_%'), 'only a masked hint is kept';
end $$;

\echo '4. runs: idempotency and concurrency limits'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
insert into public.agent_conversations (id, title) values ('33333333-0000-0000-0000-000000000001', 'Editor chat');
do $$ declare r1 jsonb; r2 jsonb; begin
  r1 := public.agent_start_run('33333333-0000-0000-0000-000000000001', null, 'chat', 'req-1');
  r2 := public.agent_start_run('33333333-0000-0000-0000-000000000001', null, 'chat', 'req-1');
  assert r1 ->> 'id' = r2 ->> 'id' and (r2 ->> 'existing')::boolean, 'same request → same run';
  insert into pg_temp.ids values ('run_e', (r1 ->> 'id')::uuid);
  perform public.agent_start_run('33333333-0000-0000-0000-000000000001', null, 'chat', 'req-2');
  begin perform public.agent_start_run('33333333-0000-0000-0000-000000000001', null, 'chat', 'req-3'); assert false, 'third concurrent run must be refused';
  exception when sqlstate 'AG429' then null; end;
end $$;
update public.agent_runs set status = 'completed' where idempotency_key = 'req-2';

do $$ begin
  -- a source is saved while its tool is still running (before the tool call row exists)
  insert into public.agent_sources (run_id, conversation_id, tool_call_id, kind, url, title, published_at, published_precision)
  values ((select v from pg_temp.ids where k = 'run_e'), '33333333-0000-0000-0000-000000000001', gen_random_uuid(), 'web', 'https://x.example', 'X', '2019-03', 'month');
  insert into public.agent_tool_calls (run_id, idx, name, input, status) values ((select v from pg_temp.ids where k = 'run_e'), 0, 'read_page', '{}', 'ok');
end $$;

\echo '5. conversations are private to their owner'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.agent_conversations) = 0, 'admin does not see the editor''s conversations';
  assert (select count(*) from public.agent_runs) = 0, 'or their runs';
end $$;
insert into public.agent_conversations (id, title) values ('33333333-0000-0000-0000-00000000000a', 'Admin chat');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  begin
    insert into public.agent_messages (conversation_id, role, content) values ('33333333-0000-0000-0000-000000000001', 'user', 'sneaky');
    assert false, 'cannot write into someone else''s conversation';
  exception when insufficient_privilege then null; end;
end $$;

\echo '6. proposals: "from" values come from the database, not the model'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ declare p jsonb; begin
  p := public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.update', 'Fill Draft Kufi', 'From the foundry page', null,
    '[{"type":"font","id":"22222222-0000-0000-0000-000000000001"}]',
    '[{"id":"desc","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"description","from":"MODEL SAYS","to":"A geometric Kufi."},
      {"id":"year","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"year","to":2021},
      {"id":"kufi","op":"link","link":"scripts","font":"22222222-0000-0000-0000-000000000001","value":"2","action":"add"}]', '[]');
  assert p -> 'changes' -> 0 -> 'from' = 'null'::jsonb, 'from replaced with the real current value';
  assert (p ->> 'version')::int = 1;
  insert into pg_temp.ids values ('p1', (p ->> 'id')::uuid);
  begin
    perform public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.update', 'bad', null, null, '[]',
      '[{"id":"x","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"slug","to":"hijack"}]', '[]');
    assert false, 'slug is not editable';
  exception when sqlstate 'AG422' then null; end;
  begin
    perform public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.update', 'bad', null, null, '[]',
      '[{"id":"x","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"year","to":1066}]', '[]');
    assert false, 'year range is checked';
  exception when sqlstate 'AG422' then null; end;
end $$;
do $$ begin
  begin update public.agent_proposals set status = 'executed'; exception when insufficient_privilege then null; end;
  assert (select status from public.agent_proposals where id = (select v from pg_temp.ids where k = 'p1')) = 'pending', 'status can''t be forged';
end $$;

\echo '7. approving only some changes'
do $$ declare r jsonb; begin
  r := public.agent_execute_proposal((select v from pg_temp.ids where k = 'p1'), 1, array['desc', 'kufi'], 'approve-0001');
  assert (r ->> 'ok')::boolean, 'executes: ' || r::text;
  assert (select description from public.fonts where id = '22222222-0000-0000-0000-000000000001') = 'A geometric Kufi.';
  assert (select year from public.fonts where id = '22222222-0000-0000-0000-000000000001') is null, 'unticked change not applied';
  assert exists (select 1 from public.font_scripts where font_id = '22222222-0000-0000-0000-000000000001' and script_id = 2), 'link added';
  assert (select count(*) from public.activity_log where action like 'agent:%') = 2, 'each applied change is in the history';
end $$;

\echo '8. the approval is used once'
do $$ declare r jsonb; begin
  r := public.agent_execute_proposal((select v from pg_temp.ids where k = 'p1'), 1, array['desc', 'kufi'], 'approve-0001');
  assert (r ->> 'already')::boolean, 'same request returns the first result';
  r := public.agent_execute_proposal((select v from pg_temp.ids where k = 'p1'), 1, array['year'], 'approve-0002');
  assert (r ->> 'already')::boolean and r ->> 'status' = 'executed', 'a second approval does not run again';
  assert (select year from public.fonts where id = '22222222-0000-0000-0000-000000000001') is null;
  assert (select count(*) from public.agent_approvals) = 1;
end $$;

\echo '9. an approval of an older version is refused'
do $$ declare p jsonb; r jsonb; begin
  p := public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.update', 'Year', null, null, '[]',
    '[{"id":"year","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"year","to":2020}]', '[]');
  insert into pg_temp.ids values ('p2', (p ->> 'id')::uuid);
  p := public.agent_update_proposal((p ->> 'id')::uuid, 1, '[{"id":"year","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"year","to":2022}]');
  assert (p ->> 'version')::int = 2;
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['year'], 'approve-0003');
  assert r ->> 'code' = 'stale_version', 'old version refused: ' || r::text;
  assert (select year from public.fonts where id = '22222222-0000-0000-0000-000000000001') is null;
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 2, array['year'], 'approve-0004');
  assert (r ->> 'ok')::boolean and (select year from public.fonts where id = '22222222-0000-0000-0000-000000000001') = 2022, 'current version executes';
end $$;

\echo '10. an editor cannot change a published font through the agent'
do $$ declare p jsonb; r jsonb; begin
  p := public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.update', 'Live', null, null, '[]',
    '[{"id":"w","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000002","field":"weights","to":9},
      {"id":"pub","op":"status","target":"22222222-0000-0000-0000-000000000001","to":"published"}]', '[]');
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['w', 'pub'], 'approve-0005');
  assert not (r ->> 'ok')::boolean and r ->> 'code' = 'forbidden', 'refused: ' || r::text;
  assert (select weights from public.fonts where id = '22222222-0000-0000-0000-000000000002') = 4, 'nothing changed';
  assert (select status from public.agent_proposals where id = (p ->> 'id')::uuid) = 'failed';
end $$;
-- and not by editing the link tables directly either (section 12)
do $$ begin
  delete from public.font_scripts where font_id = '22222222-0000-0000-0000-000000000002';
  insert into public.font_scripts values ('22222222-0000-0000-0000-000000000002', 2) on conflict do nothing;
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.font_scripts where font_id = '22222222-0000-0000-0000-000000000002') = 1 and
    exists (select 1 from public.font_scripts where font_id = '22222222-0000-0000-0000-000000000002' and script_id = 1), 'editor could not touch a published font''s links';
end $$;

\echo '11. newer data is never overwritten, and a failed part undoes the rest'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ declare p jsonb; begin
  p := public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.update', 'Two fields', null, null, '[]',
    '[{"id":"lic","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"license","to":"free"},
      {"id":"desc","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000001","field":"description","to":"Agent text"}]', '[]');
  insert into pg_temp.ids values ('p3', (p ->> 'id')::uuid);
end $$;
-- someone edits the description in the dashboard meanwhile
update public.fonts set description = 'Edited by hand' where id = '22222222-0000-0000-0000-000000000001';
do $$ declare r jsonb; begin
  r := public.agent_execute_proposal((select v from pg_temp.ids where k = 'p3'), 1, array['lic', 'desc'], 'approve-0006');
  assert r ->> 'status' = 'conflict', 'conflict detected: ' || r::text;
  assert r -> 'detail' ->> 'field' = 'description';
  assert (select license from public.fonts where id = '22222222-0000-0000-0000-000000000001') = 'paid', 'the license change was rolled back too';
  assert (select description from public.fonts where id = '22222222-0000-0000-0000-000000000001') = 'Edited by hand', 'hand edit kept';
  -- refreshing the proposal (new version) picks up the current value as the new starting point
  perform public.agent_update_proposal((select v from pg_temp.ids where k = 'p3'), 1, null);
  assert (select changes -> 1 ->> 'from' from public.agent_proposals where id = (select v from pg_temp.ids where k = 'p3')) = 'Edited by hand';
end $$;

\echo '12. a person removed from the team can no longer approve'
do $$ declare p jsonb; begin
  p := public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.update', 'W', null, null, '[]',
    '[{"id":"w","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000003","field":"weights","to":3}]', '[]');
  insert into pg_temp.ids values ('p4', (p ->> 'id')::uuid);
end $$;
reset role;
delete from public.dashboard_roles where user_id = '00000000-0000-0000-0000-00000000000e';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin
  perform public.agent_execute_proposal((select v from pg_temp.ids where k = 'p4'), 1, array['w'], 'approve-0007');
  assert false, 'must refuse';
exception when sqlstate 'AG403' then null; when sqlstate 'AG404' then null;
end $$;
reset role;
do $$ begin assert (select weights from public.fonts where id = '22222222-0000-0000-0000-000000000003') is null; end $$;
insert into public.dashboard_roles values ('00000000-0000-0000-0000-00000000000e', 'editor');

\echo '13. sharing for review: an admin approves an editor''s proposal; publishing checks'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ declare p jsonb; begin
  p := public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), null, 'font.publish', 'Publish Draft Kufi', null, null, '[]',
    '[{"id":"pub","op":"status","target":"22222222-0000-0000-0000-000000000001","to":"published"}]', '[]');
  insert into pg_temp.ids values ('p5', (p ->> 'id')::uuid);
  perform public.agent_decide_proposal((p ->> 'id')::uuid, 'submit', null);
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb; begin
  assert exists (select 1 from public.agent_proposals where id = (select v from pg_temp.ids where k = 'p5')), 'admin sees the shared proposal';
  assert not exists (select 1 from public.agent_proposals where id = (select v from pg_temp.ids where k = 'p4')), 'but not unshared ones';
  r := public.agent_execute_proposal((select v from pg_temp.ids where k = 'p5'), 1, array['pub'], 'approve-0008');
  assert r ->> 'code' = 'invalid' and r ->> 'message' like '%missing%', 'publish requirements enforced: ' || r::text;
  assert (select status::text from public.fonts where id = '22222222-0000-0000-0000-000000000001') = 'draft';
end $$;

\echo '14. admin: merge duplicates, delete, then restore from history'
do $$ declare p jsonb; r jsonb; v_log bigint; begin
  insert into public.agent_runs (owner_id, kind, status) values (auth.uid(), 'chat', 'running') returning id into p; -- not allowed: should fail
exception when insufficient_privilege then null;
end $$;
do $$ declare run jsonb; p jsonb; r jsonb; v_log bigint; begin
  run := public.agent_start_run('33333333-0000-0000-0000-00000000000a', null, 'chat', 'admin-req-1');
  p := public.agent_create_proposal((run ->> 'id')::uuid, gen_random_uuid(), null, 'designer.merge', 'Merge Sara Studio', null, null, '[]',
    '[{"id":"m","op":"merge","entity":"designer","keeper":"11111111-0000-0000-0000-000000000001","losers":["11111111-0000-0000-0000-000000000002"]}]', '[]');
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['m'], 'approve-0009');
  assert (r ->> 'ok')::boolean, 'merge: ' || r::text;
  assert not exists (select 1 from public.designers where slug = 'sara-studio-type');
  assert exists (select 1 from public.font_redirects where from_slug = 'sara-studio-type' and to_slug = 'sara-studio');
  p := public.agent_create_proposal((run ->> 'id')::uuid, gen_random_uuid(), null, 'font.delete', 'Delete Live Naskh 2', null, null, '[]',
    '[{"id":"d","op":"delete","entity":"font","target":"22222222-0000-0000-0000-000000000003"}]', '[]');
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['d'], 'approve-0010');
  assert (r ->> 'ok')::boolean and not exists (select 1 from public.fonts where id = '22222222-0000-0000-0000-000000000003');
  select id into v_log from public.activity_log where action = 'agent:delete' order by id desc limit 1;
  p := public.agent_create_proposal((run ->> 'id')::uuid, gen_random_uuid(), null, 'font.restore', 'Restore', null, null, '[]',
    jsonb_build_array(jsonb_build_object('id', 'r', 'op', 'restore', 'activity_id', v_log)), '[]');
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['r'], 'approve-0011');
  assert (r ->> 'ok')::boolean and exists (select 1 from public.fonts where id = '22222222-0000-0000-0000-000000000003'), 'restored: ' || r::text;
  -- creating a draft and crediting a new foundry in one approval
  p := public.agent_create_proposal((run ->> 'id')::uuid, gen_random_uuid(), null, 'font.create', 'New', null, null, '[]',
    '[{"id":"f","op":"create","entity":"font","ref":"f1","values":{"name":"Brand New Sans","year":2024}},
      {"id":"d","op":"create","entity":"designer","ref":"d1","values":{"name":"New Foundry","type":"foundry"}},
      {"id":"l","op":"link","link":"designers","font":"$new:f1","value":"$new:d1","action":"add"}]', '[]');
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['l'], 'approve-0012');
  assert r ->> 'code' = 'bad_selection', 'link without its new records refused';
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['f', 'd', 'l'], 'approve-0013');
  assert (r ->> 'ok')::boolean, 'create: ' || r::text;
  assert (select status::text from public.fonts where slug = 'brand-new-sans') = 'draft', 'new fonts start as drafts';
  assert exists (select 1 from public.font_designers fd join public.designers d on d.id = fd.designer_id join public.fonts f on f.id = fd.font_id
    where f.slug = 'brand-new-sans' and d.slug = 'new-foundry');
end $$;

\echo '15. editing a message supersedes proposals on the replaced branch'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ declare m1 uuid; m2 uuid; m3 uuid; p jsonb; begin
  insert into public.agent_messages (conversation_id, role, content) values ('33333333-0000-0000-0000-000000000001', 'user', 'first') returning id into m1;
  insert into public.agent_messages (conversation_id, parent_id, role, content) values ('33333333-0000-0000-0000-000000000001', m1, 'assistant', 'answer') returning id into m2;
  p := public.agent_create_proposal((select v from pg_temp.ids where k = 'run_e'), gen_random_uuid(), m2, 'font.update', 'On branch A', null, null, '[]',
    '[{"id":"w","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000003","field":"weights","to":2}]', '[]');
  insert into public.agent_messages (conversation_id, role, content) values ('33333333-0000-0000-0000-000000000001', 'user', 'first, edited') returning id into m3;
  assert public.agent_set_head('33333333-0000-0000-0000-000000000001', m3) = 1;
  assert (select status from public.agent_proposals where id = (p ->> 'id')::uuid) = 'superseded';
end $$;

\echo '16. expired proposals do not execute'
reset role;
update public.agent_proposals set expires_at = now() - interval '1 minute' where id = (select v from pg_temp.ids where k = 'p4');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ declare r jsonb; begin
  r := public.agent_execute_proposal((select v from pg_temp.ids where k = 'p4'), 1, array['w'], 'approve-0014');
  assert r ->> 'status' = 'expired', r::text;
end $$;

\echo '17. jobs: one worker at a time, resumable, cancellable'
reset role;
update public.agent_settings set config = jsonb_set(config, '{permissions,start_jobs}', '["admin","editor"]');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ declare j uuid; a jsonb; b jsonb; t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); begin
  j := public.agent_job_create('Years', 'Find the release year', '[{"type":"font","id":"22222222-0000-0000-0000-000000000001"},{"type":"font","id":"22222222-0000-0000-0000-000000000003"}]', null);
  a := public.agent_job_next(j, t1);
  assert a ->> 'state' = 'item';
  b := public.agent_job_next(j, t2);
  assert b ->> 'state' = 'busy', 'second worker waits';
  perform public.agent_job_item_done((a -> 'item' ->> 'id')::uuid, t1, true, 'done', null, '{}', null);
  begin perform public.agent_job_item_done((a -> 'item' ->> 'id')::uuid, t2, true, 'x', null, '{}', null); assert false, 'foreign worker refused';
  exception when sqlstate 'AG409' then null; end;
  perform public.agent_job_control(j, 'cancel');
  assert public.agent_job_next(j, t1) ->> 'state' = 'cancelled';
  assert (select count(*) from public.agent_job_items where job_id = j and status = 'skipped') = 1;
end $$;


\echo '18. images: attached only with an approved copy; leftovers are discarded'
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare run jsonb; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); p jsonb; r jsonb; begin
  run := public.agent_start_run('33333333-0000-0000-0000-00000000000a', null, 'chat', 'admin-req-img');
  insert into public.agent_assets (id, owner_id, run_id, source_url, staging_path, sha256, mime, bytes, width, height, kind)
  values (a, auth.uid(), (run ->> 'id')::uuid, 'https://x.example/a.png', auth.uid()::text || '/' || a || '.webp', repeat('a', 64), 'image/webp', 100, 800, 400, 'specimen'),
         (b, auth.uid(), (run ->> 'id')::uuid, 'https://x.example/b.png', auth.uid()::text || '/' || b || '.webp', repeat('b', 64), 'image/webp', 100, 800, 400, 'specimen');
  begin
    insert into public.agent_assets (owner_id, source_url, staging_path, sha256, mime, bytes, width, height) values (auth.uid(), 'https://x', 'someone-else/x.webp', repeat('c', 64), 'image/webp', 1, 1, 1);
    assert false, 'staging outside one''s own folder is refused';
  exception when insufficient_privilege then null; end;
  p := public.agent_create_proposal((run ->> 'id')::uuid, gen_random_uuid(), null, 'image_add', 'Add specimen', null, null, '[]',
    jsonb_build_array(jsonb_build_object('id', 'img', 'op', 'image_add', 'entity', 'font', 'target', '22222222-0000-0000-0000-000000000003', 'asset', a)), '[]');
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['img'], 'approve-img-1', '{}');
  assert r ->> 'status' = 'failed' and r ->> 'message' like '%copied%', 'no storage copy → refused: ' || r::text;
  p := public.agent_create_proposal((run ->> 'id')::uuid, gen_random_uuid(), null, 'image_add', 'Add specimen', null, null, '[]',
    jsonb_build_array(jsonb_build_object('id', 'img', 'op', 'image_add', 'entity', 'font', 'target', '22222222-0000-0000-0000-000000000003', 'asset', a)), '[]');
  r := public.agent_execute_proposal((p ->> 'id')::uuid, 1, array['img'], 'approve-img-2', jsonb_build_object('img', 'agent/2026-11-06/' || a || '.webp'));
  assert (r ->> 'ok')::boolean, r::text;
  assert (select images[array_length(images, 1)] from public.fonts where id = '22222222-0000-0000-0000-000000000003') = 'agent/2026-11-06/' || a || '.webp';
  assert (select status from public.agent_assets where id = a) = 'attached';
  assert not public.agent_studio_unused('agent/2026-11-06/' || a || '.webp'), 'a used file can''t be removed';
  assert public.agent_studio_unused('agent/2026-11-06/' || b || '.webp');
end $$;
reset role;
update public.agent_assets set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where status = 'staged';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb; begin
  r := public.agent_cleanup();
  assert jsonb_array_length(r -> 'discard_files') = 1, 'the unused staged image is handed back for deletion: ' || r::text;
end $$;

\echo '19. two people (or two tabs) approving at the same moment: it runs once'
do $$ declare run jsonb; p jsonb; begin
  run := public.agent_start_run('33333333-0000-0000-0000-00000000000a', null, 'chat', 'admin-req-img'); -- same request → same run
  p := public.agent_create_proposal((run ->> 'id')::uuid, gen_random_uuid(), null, 'font.update', 'Race', null, null, '[]',
    '[{"id":"w","op":"set","entity":"font","target":"22222222-0000-0000-0000-000000000002","field":"weights","to":12}]', '[]');
  perform set_config('test.race', p ->> 'id', false);
end $$;
reset role;
select set_config('test.race', current_setting('test.race'), false) as race_id \gset
\echo 'All agent SQL tests passed.'
