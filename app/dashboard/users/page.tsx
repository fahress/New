'use client';
import { useMemo, useState } from 'react';
import { ConfirmButton, MultiPicker, timeAgo, useToast } from '@/components/dashboard/ui';
import { db } from '@/lib/admin/db';
import { img, useData } from '@/lib/admin/store';

const pick = (r: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (r[k]) return String(r[k]); return ''; };

export default function Users() {
  const { data, reload } = useData();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [newRole, setNewRole] = useState<'editor' | 'admin'>('editor');
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

  const profileOf = (uid: string) => data.profiles?.find((p) => String(p.id) === uid);
  const nameOf = (uid: string) => { const p = profileOf(uid); return p ? pick(p, ['full_name', 'name', 'display_name', 'username', 'email']) || uid.slice(0, 8) : uid.slice(0, 8); };
  const isAdmin = data.role === 'admin';
  async function setRole(uid: string, role: 'admin' | 'editor' | null) {
    try {
      if (role) await db.upsert('dashboard_roles', [{ user_id: uid, role }], 'user_id');
      else await db.remove('dashboard_roles', { user_id: uid });
      await db.log({ action: role ? `role:${role}` : 'role:removed', entity: 'team', entity_id: uid, label: nameOf(uid) });
      await reload();
      toast(role ? `${nameOf(uid)} is now ${role === 'admin' ? 'an admin' : 'an editor'}` : `${nameOf(uid)} removed from the team`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); }
  }

  return (
    <>
      {data.team !== null && (
        <section className="dz-panel" style={{ marginBottom: 28 }}>
          <h2 className="dz-h2">Dashboard team</h2>
          <p className="dz-hint" style={{ marginTop: -6 }}><b>Admins</b> can publish, delete, merge and manage the team. <b>Editors</b> can add and edit fonts and profiles, and send fonts for review.</p>
          <div className="dz-taglist">
            {data.team.map((t) => (
              <div key={String(t.user_id)} className="dz-tagrow" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
                <span>{nameOf(String(t.user_id))} <span className="dz-muted">{pick(profileOf(String(t.user_id)) ?? {}, ['email'])}</span></span>
                {isAdmin ? (
                  <select className="dz-select" style={{ width: 'auto', minHeight: 36 }} value={String(t.role)} onChange={(e) => setRole(String(t.user_id), e.target.value as 'admin' | 'editor')}>
                    <option value="admin">Admin</option><option value="editor">Editor</option>
                  </select>
                ) : <span>{String(t.role)}</span>}
                {isAdmin ? <ConfirmButton className="dz-btn dz-btn--sm dz-btn--danger" label="Remove?" onConfirm={() => setRole(String(t.user_id), null)}>Remove</ConfirmButton> : <span />}
              </div>
            ))}
          </div>
          {isAdmin && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, marginTop: 16, alignItems: 'start' }}>
              <MultiPicker single options={(data.profiles ?? []).filter((p) => !data.team!.some((t) => String(t.user_id) === String(p.id))).map((p) => ({ id: String(p.id), label: pick(p, ['full_name', 'name', 'display_name', 'username', 'email']) || String(p.id).slice(0, 8), meta: pick(p, ['email']) }))} value={chosen} onChange={setChosen} placeholder="Add someone who has a Fahress account…" />
              <select className="dz-select" style={{ width: 'auto' }} value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'editor')}><option value="editor">Editor</option><option value="admin">Admin</option></select>
              <button type="button" className="dz-btn dz-btn--primary" disabled={!chosen.length} onClick={async () => { await setRole(chosen[0], newRole); setChosen([]); }}>Add</button>
            </div>
          )}
        </section>
      )}
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
