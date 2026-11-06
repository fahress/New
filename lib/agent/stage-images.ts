import 'server-only';
import crypto from 'node:crypto';
import { hamming, NOT_CONTENT, prepareImage } from '@/lib/web/image';
import type { ImageStager } from './tools';
import type { AgentStore } from './store';
import type { WebReader } from './web-reader';

const MIN: Record<string, { w: number; h: number }> = { specimen: { w: 400, h: 180 }, designer_photo: { w: 120, h: 120 }, foundry_logo: { w: 64, h: 64 } };
const hashCache = new Map<string, string | null>();

/**
 * Downloads candidate images, checks them (real type, size, not an icon or ad, not a duplicate of each other
 * or of the record's existing images), re-encodes them as clean WebP and keeps them in the private
 * `agent-staging` bucket under the person's folder. Nothing is attached to a record here.
 */
export function makeStager(o: { web: WebReader; store: AgentStore; runId: string; conversationId: string }): ImageStager {
  return async (cands, kind, existing, signal) => {
    const staged: Awaited<ReturnType<ImageStager>>['staged'] = [];
    const skipped: { url: string; reason: string }[] = [];
    const seen: { dhash: string; id: string }[] = [];
    const known: { dhash: string; url: string }[] = [];
    for (const url of existing.slice(0, 12)) {
      let h = hashCache.get(url);
      if (h === undefined) {
        try { const b = await o.web.fetchBytes(url, 15 * 1024 * 1024); h = (await prepareImage(b.bytes)).dhash; } catch { h = null; }
        hashCache.set(url, h);
        if (hashCache.size > 500) hashCache.clear();
      }
      if (h) known.push({ dhash: h, url });
    }
    const list = [...new Map(cands.map((c) => [c.url, c])).values()].slice(0, 12);
    for (const c of list) {
      if (signal?.aborted) break;
      if (NOT_CONTENT.test(c.url) && kind === 'specimen') { skipped.push({ url: c.url, reason: 'looks like a logo, icon or ad' }); continue; }
      try {
        const got = await o.web.fetchBytes(c.url, 15 * 1024 * 1024);
        if (!got.type || got.type === 'application/pdf') { skipped.push({ url: c.url, reason: 'not an image' }); continue; }
        const min = MIN[kind];
        const img = await prepareImage(got.bytes, { minWidth: min.w, minHeight: min.h });
        if (kind === 'specimen' && img.width / img.height < 0.5) { skipped.push({ url: c.url, reason: 'too tall to be a specimen image' }); continue; }
        const dupInBatch = seen.find((s) => hamming(s.dhash, img.dhash) <= 5);
        if (dupInBatch) { skipped.push({ url: c.url, reason: 'same picture as another candidate' }); continue; }
        const dupExisting = known.find((k) => hamming(k.dhash, img.dhash) <= 5);
        const id = crypto.randomUUID();
        const path = `${o.store.userId}/${id}.webp`;
        await o.store.uploadStaging(path, img.webp, 'image/webp');
        await o.store.saveAsset(o.runId, o.conversationId, {
          id, source_url: got.url.slice(0, 2000), page_url: c.page_url?.slice(0, 2000) ?? null, staging_path: path, sha256: img.sha256, dhash: img.dhash,
          mime: 'image/webp', bytes: img.webp.byteLength, width: img.width, height: img.height, kind,
        });
        seen.push({ dhash: img.dhash, id });
        staged.push({ id, url: got.url, width: img.width, height: img.height, duplicate_of: dupExisting ? dupExisting.url : null });
        if (staged.length >= 8) break;
      } catch (e) {
        skipped.push({ url: c.url, reason: e instanceof Error ? e.message.slice(0, 100) : 'couldn’t read' });
      }
    }
    return { staged, skipped };
  };
}
