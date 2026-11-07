'use client';
import { SUPABASE_URL } from '@/lib/config';

const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(SUPABASE_URL)?.[1] ?? '';
const SQL_EDITOR = ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : 'https://supabase.com/dashboard';
const SQL_FILE = 'https://github.com/fahress/New/blob/main/supabase/agent-setup.sql';

/** Shown when the agent's tables don't exist yet: the one-time setup steps, with links. */
export default function SetupNeeded({ detail }: { detail?: string | null }) {
  return (
    <div className="dz-panel" style={{ maxWidth: 760 }}>
      <p className="dz-eyebrow">Setup needed</p>
      <h3>The agent isn’t installed in the database yet</h3>
      <p className="dz-muted">Fahress’s database doesn’t have the agent’s tables. An admin does this once (about a minute):</p>
      <ol style={{ display: 'grid', gap: 10, paddingLeft: 20 }}>
        <li>
          Open <a href={SQL_FILE} target="_blank" rel="noreferrer"><code>supabase/agent-setup.sql</code> ↗</a> and copy the whole file
          (the “Copy raw file” button on GitHub). Before the pull request is merged, use <a href="https://github.com/fahress/New/blob/claude/vibrant-edison-bo70ok/supabase/agent-setup.sql" target="_blank" rel="noreferrer">the file on its branch ↗</a>.
        </li>
        <li>
          Paste it into the <a href={SQL_EDITOR} target="_blank" rel="noreferrer">Supabase SQL editor ↗</a> and press <b>Run</b>.
          It only adds things and is safe to run again. The last lines should show <code>agent tables 16</code>, <code>vault available true</code> and <code>agent-staging bucket true</code>.
        </li>
        <li>Deploy the key gateway once: <code>supabase functions deploy agent-gateway --project-ref {ref || '&lt;project&gt;'}</code>, or without the CLI paste the single-file version into Supabase → Edge Functions → Deploy a new function → Via editor, named <code>agent-gateway</code> (see the guide).</li>
        <li>Reload this page, then add the keys and choose a model in <b>Agent settings</b>.</li>
      </ol>
      <p className="dz-hint">Full guide: <code>docs/agent.md</code>.{detail ? ` Database said: ${detail}` : ''}</p>
    </div>
  );
}
