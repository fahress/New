'use client';
import { useMemo, useState } from 'react';
import { timeAgo } from '@/components/dashboard/ui';
import { img, useData } from '@/lib/admin/store';

const pick = (r: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (r[k]) return String(r[k]); return ''; };

export default function Users() {
  const { data } = useData();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const list = (data?.profiles ?? []).slice().sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    const n = q.trim().toLowerCase();
    return n ? list.filter((r) => JSON.stringify(r).toLowerCase().includes(n)) : list;
  }, [data, q]);
  if (!data) return null;
  if (!data.profiles) return (
    <>
      <div className="dz-head"><div><p className="dz-eyebrow">Users</p><h1 className="display">Users</h1></div></div>
      <div className="dz-empty">Your account can&apos;t read the user list from here. This is controlled by the database&apos;s security rules.</div>
    </>
  );
  const week = Date.now() - 7 * 864e5;
  const fresh = data.profiles.filter((p) => new Date(String(p.created_at ?? 0)).getTime() > week).length;

  return (
    <>
      <div className="dz-head"><div><p className="dz-eyebrow">Users</p><h1 className="display">{data.profiles.length} people</h1><p>{fresh} joined this week. People who signed up on fahress.com.</p></div></div>
      <div className="dz-toolbar"><input className="dz-input" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="dz-tablewrap">
        <table className="dz-table">
          <thead><tr><th style={{ width: 56 }} /><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const avatar = pick(r, ['avatar_url', 'avatar', 'image']);
              return (
                <tr key={String(r.id ?? i)}>
                  <td>{avatar ? <img className="dz-av is-grey" src={img(avatar, 256)} alt="" loading="lazy" /> : <span className="dz-mono-av" style={{ width: 40, height: 40 }}>{(pick(r, ['full_name', 'name', 'username', 'email']) || '?')[0]}</span>}</td>
                  <td>{pick(r, ['full_name', 'name', 'display_name', 'username']) || <span className="dz-muted">—</span>}</td>
                  <td>{pick(r, ['email']) || <span className="dz-muted">—</span>}</td>
                  <td>{pick(r, ['role', 'user_role']) || 'member'}</td>
                  <td>{r.created_at ? timeAgo(String(r.created_at)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
