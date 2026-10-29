'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmButton, timeAgo, useToast } from '@/components/dashboard/ui';
import { duplicateFonts } from '@/lib/admin/checks';
import { db } from '@/lib/admin/db';
import { LINK_TABLES, coverOf, img, useData } from '@/lib/admin/store';

export default function Review() {
  const { data, peopleOf, linked, reload } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;

  const queue = data.fonts.filter((f) => f.status === 'pending').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const dupGroups = duplicateFonts(data);
  const tagNames = (id: string, kind: 'scripts' | 'genres' | 'styles' | 'types') => {
    const src = data[kind];
    return linked(id, kind).map((x) => src.find((t) => String(t.id) === x)?.name).filter(Boolean).join(', ');
  };

  async function act(id: string, status: string | null, msg: string) {
    setBusy(id);
    try {
      if (status) await db.update('fonts', { id }, { status, updated_at: new Date().toISOString() });
      else {
        for (const { table } of Object.values(LINK_TABLES)) await db.remove(table, { font_id: id });
        await db.remove('fonts', { id });
      }
      await db.refreshSite();
      await reload();
      toast(msg);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'err');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="dz-head">
        <div>
          <p className="dz-eyebrow">Review queue</p>
          <h1 className="display">{queue.length ? `${queue.length} waiting` : 'All caught up'}</h1>
          <p>Fonts sent for review — by you, a teammate or the weekly discovery. Oldest first.</p>
        </div>
      </div>
      {queue.length === 0 ? <div className="dz-empty">Nothing to review right now.</div> : queue.map((f) => {
        const id = String(f.id);
        const people = peopleOf(id);
        const links = Array.isArray(f.purchase_links) ? f.purchase_links.filter(Boolean) : [];
        const dup = dupGroups.find((g) => g.some((x) => String(x.id) === id))?.filter((x) => String(x.id) !== id) ?? [];
        const missing = [
          !coverOf(f) && 'images', !people.length && 'credit', !linked(id, 'scripts').length && 'script', !linked(id, 'genres').length && 'genre', !f.weights && 'weights',
        ].filter(Boolean) as string[];
        return (
          <article key={id} className="dz-review">
            <div className="dz-review__img">{coverOf(f) ? <img src={img(coverOf(f), 640)} alt="" loading="lazy" /> : null}</div>
            <div className="dz-review__body">
              <h3>{String(f.name)}</h3>
              <dl className="dz-kv">
                <dt>Credit</dt><dd>{people.length ? people.map((p) => String(p.name)).join(', ') : <span className="dz-tag dz-tag--warn">None</span>}</dd>
                <dt>Year</dt><dd>{f.year ? String(f.year) : '—'} · {String(f.weights ?? '?')} weights · <span style={{ textTransform: 'capitalize' }}>{String(f.license)}</span></dd>
                <dt>Scripts</dt><dd>{tagNames(id, 'scripts') || '—'}</dd>
                <dt>Genre</dt><dd>{tagNames(id, 'genres') || '—'}</dd>
                <dt>Link</dt><dd>{links.length ? <a href={String(links[0])} target="_blank" rel="noreferrer">{String(links[0]).replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a> : '—'}</dd>
                {f.source_url ? <><dt>Found at</dt><dd><a href={String(f.source_url)} target="_blank" rel="noreferrer">{String(f.source_url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a></dd></> : null}
                <dt>Submitted</dt><dd>{timeAgo(String(f.created_at))}</dd>
              </dl>
              {dup.length > 0 && <div className="dz-warn"><b>Looks like a duplicate of</b>{dup.map((d) => <span key={String(d.id)}><Link href={`/dashboard/fonts/${d.id}`}>{String(d.name)}</Link> <span className="dz-muted">· {String(d.status)}</span></span>)}</div>}
              {missing.length > 0 && <p className="dz-error">Missing before it can go live: {missing.join(', ')}</p>}
              <div className="dz-review__actions">
                <button type="button" className="dz-btn dz-btn--primary" disabled={busy === id || missing.length > 0} onClick={() => act(id, 'published', `${f.name} is live`)}>Approve &amp; publish</button>
                <button type="button" className="dz-btn" disabled={busy === id || missing.length > 0} onClick={() => act(id, 'featured', `${f.name} is live and featured`)}>Publish as featured</button>
                <Link href={`/dashboard/fonts/${id}`} className="dz-btn">Edit first</Link>
                <button type="button" className="dz-btn" disabled={busy === id} onClick={() => act(id, 'draft', `${f.name} moved to drafts`)}>Back to draft</button>
                <ConfirmButton onConfirm={() => act(id, null, `${f.name} rejected and deleted`)} label="Click again to delete">Reject</ConfirmButton>
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
}
