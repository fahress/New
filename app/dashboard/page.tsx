'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { StatusPill, timeAgo } from '@/components/dashboard/ui';
import { issues } from '@/lib/admin/checks';
import { coverOf, img, useData } from '@/lib/admin/store';

export default function Overview() {
  const { data, linked, fontsOf, peopleOf } = useData();
  const list = useMemo(() => (data ? issues(data, linked, fontsOf) : []), [data, linked, fontsOf]);
  if (!data) return null;

  const pending = data.fonts.filter((f) => f.status === 'pending');
  const live = data.fonts.filter((f) => f.status === 'published' || f.status === 'featured').length;
  const designers = data.people.filter((p) => p.type !== 'foundry').length;
  const foundries = data.people.length - designers;
  const awarded = new Set(data.links.awards.map((a) => String(a.font_id))).size;
  const recent = data.fonts.slice(0, 8);
  const weekAgo = Date.now() - 7 * 86400e3;
  const thisWeek = data.fonts.filter((f) => new Date(String(f.created_at)).getTime() > weekAgo).length;
  const open = list.filter((i) => i.items.length);

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Overview</p>
          <h1 className="display">The archive at a glance.</h1>
          <p>{thisWeek ? `${thisWeek} font${thisWeek === 1 ? '' : 's'} added this week.` : 'No fonts added this week yet.'}</p>
        </div>
        <Link href="/dashboard/fonts/new" className="dz-btn dz-btn--primary">+ New font</Link>
      </div>

      {pending.length > 0 && (
        <div className="dz-callout">
          <div>
            <h2>{pending.length} font{pending.length === 1 ? ' is' : 's are'} waiting for review</h2>
            <p>The oldest was submitted {timeAgo(String(pending[pending.length - 1].created_at))}.</p>
          </div>
          <Link href="/dashboard/review" className="dz-btn">Open review queue →</Link>
        </div>
      )}

      <div className="dz-stats">
        <Link className="dz-stat" href="/dashboard/fonts"><small>Fonts</small><b>{data.fonts.length}</b><small>{live} live on the site</small></Link>
        <Link className="dz-stat" href="/dashboard/designers"><small>Designers</small><b>{designers}</b></Link>
        <Link className="dz-stat" href="/dashboard/foundries"><small>Foundries</small><b>{foundries}</b></Link>
        <Link className="dz-stat" href="/dashboard/awards"><small>Awarded fonts</small><b>{awarded}</b><small>{data.awards.length} awards</small></Link>
        <Link className="dz-stat" href="/dashboard/users"><small>Users</small><b>{data.profiles ? data.profiles.length : '—'}</b></Link>
      </div>

      <div className="dz-cols">
        <section className="dz-panel">
          <h2 className="dz-h2">Needs attention</h2>
          {open.length === 0 ? <p className="dz-muted">Everything is complete. Nice.</p> : (
            <div className="dz-todo">
              {list.map((i) => (
                <div key={i.id} className={i.items.length ? '' : 'is-done'}>
                  <details>
                    <summary><b>{i.items.length}</b><span>{i.label}</span></summary>
                    {i.items.length ? (
                      <ul>
                        {i.items.slice(0, 200).map((it, n) => (
                          <li key={it.href + n}><Link href={it.href}>{it.label}</Link>{it.note ? <span className="dz-muted"> · {it.note}</span> : null}</li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dz-panel">
          <h2 className="dz-h2">Recently added</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {recent.map((f) => (
              <Link key={String(f.id)} href={`/dashboard/fonts/${f.id}`} style={{ display: 'grid', gridTemplateColumns: '84px 1fr auto', gap: 12, alignItems: 'center', textDecoration: 'none' }}>
                {coverOf(f) ? <img className="dz-thumb" src={img(coverOf(f), 256)} alt="" loading="lazy" /> : <span className="dz-thumb" />}
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontWeight: 500 }}>{String(f.name)}</b><br />
                  <small className="dz-muted">{peopleOf(String(f.id)).map((p) => p.name).join(', ') || 'No credit'} · {timeAgo(String(f.created_at))}</small>
                </span>
                <StatusPill status={String(f.status)} />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
