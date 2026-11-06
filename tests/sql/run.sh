#!/usr/bin/env bash
# Runs the SQL behaviour tests on a throw-away local Postgres database.
# Usage: PGHOST=/tmp PGPORT=5433 PGUSER=postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${AGENT_TEST_DB:-agent_test}
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
for f in tests/sql/supabase-stub.sql supabase/dashboard-setup.sql supabase/messages-update.sql supabase/claims-update.sql supabase/agent-setup.sql supabase/agent-setup.sql; do
  $P -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "failed applying $f"; $P -d "$DB" -f "$f" 2>&1 | grep -v NOTICE | tail -5; exit 1; }
done
out=$($P -tA -d "$DB" -f tests/sql/agent.test.sql 2>&1 | grep -v -e NOTICE -e "^$") || true
echo "$out" | grep -v -e '^race_id' -e '^[0-9a-f-]\{36\}$'
echo "$out" | grep -q 'All agent SQL tests passed.' || exit 1
# 19 (continued): two sessions approve the same proposal at once, with different request ids
RACE=$($P -tA -d "$DB" -c "select id from public.agent_proposals where title = 'Race'")
CLAIMS='{"sub":"00000000-0000-0000-0000-00000000000a","email":"admin@test","role":"authenticated"}'
race() { $P -tA -d "$DB" -c "set role authenticated; select set_config('request.jwt.claims', '$CLAIMS', false); select public.agent_execute_proposal('$RACE', 1, array['w'], '$1')" | tail -1; }
race race-request-1 > /tmp/agent-race-1 & race race-request-2 > /tmp/agent-race-2 & wait
executed=$(grep -l '"already"' /tmp/agent-race-1 /tmp/agent-race-2 | wc -l)
approvals=$($P -tA -d "$DB" -c "select count(*) from public.agent_approvals where proposal_id = '$RACE'")
logs=$($P -tA -d "$DB" -c "select count(*) from public.activity_log where action = 'agent:set' and after->'agent'->>'proposal' = '$RACE'")
if [ "$executed" = "1" ] && [ "$approvals" = "1" ] && [ "$logs" = "1" ]; then echo "19. concurrent approvals: executed once, the other got the first result"; else echo "concurrency test FAILED (already=$executed approvals=$approvals logs=$logs)"; cat /tmp/agent-race-1 /tmp/agent-race-2; exit 1; fi
