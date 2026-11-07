import Link from 'next/link';
import { AGENT_ENABLED } from '@/lib/config';

/** While the agent is switched off (lib/config.ts), its pages show this note instead. */
export default function AgentLayout({ children }: { children: React.ReactNode }) {
  if (AGENT_ENABLED) return children;
  return (
    <div className="dz-panel" style={{ maxWidth: 620 }}>
      <h3>The Fahress Agent is switched off</h3>
      <p className="dz-muted">It&apos;s hidden for now. Nothing it set up was deleted, so it can be switched back on at any time.</p>
      <Link href="/dashboard" className="dz-btn">Back to the dashboard</Link>
    </div>
  );
}
