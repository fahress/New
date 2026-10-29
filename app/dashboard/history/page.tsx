'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmButton, timeAgo, useToast } from '@/components/dashboard/ui';
import { db, type Row } from '@/lib/admin/db';
import { LINK_TABLES, useData } from '@/lib/admin/store';

const VERB: Record<string, string> = {
  create: 'added', update: 'edited', delete: 'deleted', merge: 'merged', undo: 'undid a change to',
  'status:published': 'published', 'status:featured': 'featured', 'status:pending': 'sent for review', 'status:draft': 'moved to drafts',
};

const strip = (r: Row) => { const { id: _id, created_at: _c, ...rest } = r; void _id; void _c; return rest; };

export default function History() {
  const { data, fontById, personById, reload } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;
  if (data.activity === null) return (
    <>
      <div className="dz-head"><div><p className="dz-eyebrow">History</p><h1 className="display">History</h1></div></div>
      <div className="dz-empty">History starts recording after the one-time database update.</div>
    </>
  );

  const canUndo = (e: Row) => data.role === 'admin' && e.before && (e.entity === 'font' || e.entity === 'designer') && e.action !== 'create' && e.action !== 'undo';

  async function undo(e: Row) {
    const b = e.before as Row;
    const id = String(e.entity_id);
    setBusy(String(e.id));
    try {
      if (e.entity === 'font') {
        const row = b.row as Row;
        const links = (b.links as Record<string, Row[]>) ?? {};
        if (fontById.has(id)) await db.update('fonts', { id }, strip(row));
        else await db.insert('fonts', row);
        for (const { table } of Object.values(LINK_TABLES)) {
          if (!(table in links)) continue;
          await db.remove(table, { font_id: id });
          if (links[table].length) await db.insert(table, links[table]);
        }
        if (e.action === 'merge' && data!.redirects !== null && row.slug) await db.remove('font_redirects', { from_slug: String(row.slug) });
      } else {
        const row = b.row as Row;
        if (personById.has(id)) await db.update('designers', { id }, strip(row));
        else await db.insert('designers', row);
        const credits = (b.credits as Row[]) ?? [];
        const have = new Set(data!.links.designers.filter((r) => String(r.designer_id) === id).map((r) => String(r.font_id)));
        const add = credits.filter((c) => !have.has(String(c.font_id)) && fontById.has(String(c.font_id)));
        if (add.length) await db.insert('font_designers', add);
        if (e.action === 'merge' && data!.redirects !== null && row.slug) await db.remove('font_redirects', { from_slug: String(row.slug) });
      }
      await db.log({ action: 'undo', entity: String(e.entity), entity_id: id, label: String(e.label ?? '') });
      await db.refreshSite();
      await reload();
      toast(`Restored ${e.label ?? ''}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Undo failed', 'err');
    } finally {
      setBusy(null);
    }
  }

  const hrefOf = (e: Row) => {
    const id = String(e.entity_id ?? '');
    if (e.entity === 'font' && fontById.has(id)) return `/dashboard/fonts/${id}`;
    if (e.entity === 'designer' && personById.has(id)) { const p = personById.get(id)!; return `/dashboard/${p.type === 'foundry' ? 'foundries' : 'designers'}/${id}`; }
    if (e.entity === 'submission') return '/dashboard/inbox';
    return null;
  };

  return (
    <>
      <div className="dz-head">
        <div><p className="dz-eyebrow">History</p><h1 className="display">Recent changes</h1><p>Who changed what. Admins can undo edits, deletes and merges of fonts and profiles.</p></div>
      </div>
      {data.activity.length === 0 ? <div className="dz-empty">Nothing yet — changes appear here as soon as someone saves.</div> : (
        <div className="dz-tablewrap">
          <table className="dz-table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th /></tr></thead>
            <tbody>
              {data.activity.map((e) => {
                const href = hrefOf(e);
                const verb = VERB[String(e.action)] ?? String(e.action).replace(/[_:]/g, ' ');
                return (
                  <tr key={String(e.id)}>
                    <td style={{ whiteSpace: 'nowrap' }} title={String(e.at)}>{timeAgo(String(e.at))}</td>
                    <td>{String(e.user_email ?? '—')}</td>
                    <td>{verb} {e.entity === 'designer' ? 'profile' : e.entity === 'submission' ? 'submission' : 'font'} {href ? <Link className="dz-row-link" href={href}>{String(e.label ?? '')}</Link> : <b style={{ fontWeight: 500 }}>{String(e.label ?? '')}</b>}</td>
                    <td style={{ textAlign: 'right' }}>{canUndo(e) ? <ConfirmButton className="dz-btn dz-btn--sm" label="Click to restore" onConfirm={() => undo(e)}>{busy === String(e.id) ? 'Restoring…' : 'Undo'}</ConfirmButton> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
