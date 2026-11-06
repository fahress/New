// Runs the database tests when a local Postgres is available (PGHOST/PGPORT/PGUSER), otherwise says it skipped them.
import { spawnSync } from 'node:child_process';
const have = spawnSync('psql', ['-c', 'select 1'], { stdio: 'ignore' }).status === 0;
if (!have) { console.log('# SQL tests skipped: no local Postgres (set PGHOST/PGPORT/PGUSER to run them).'); process.exit(0); }
const r = spawnSync('bash', ['tests/sql/run.sh'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
