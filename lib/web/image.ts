import 'server-only';
import crypto from 'node:crypto';

/** What a file really is, from its first bytes (servers often send the wrong type). */
export function sniff(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif';
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

/** An SVG made inert before it is drawn: no scripts, no outside references, no entities. Returns null if it can't be made safe. */
export function inertSvg(text: string): string | null {
  if (/<!ENTITY|<!DOCTYPE/i.test(text)) return null;
  const cleaned = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/<(image|use|feImage)\b[^>]*>/gi, '');
  return /<svg\b/i.test(cleaned) ? cleaned : null;
}

export type Prepared = { webp: Uint8Array; width: number; height: number; sha256: string; dhash: string; sourceType: string };

/**
 * Turns any accepted image into a clean WebP (metadata dropped; SVG and GIF drawn as a still image),
 * with its size, a content hash (exact duplicates) and a difference hash (near duplicates).
 * Throws with a readable reason if the file isn't a usable image.
 */
export async function prepareImage(bytes: Uint8Array, opts: { maxPixels?: number; minWidth?: number; minHeight?: number } = {}): Promise<Prepared> {
  const sharp = (await import('sharp')).default;
  const type = sniff(bytes);
  if (!type || type === 'application/pdf') throw new Error('Not an image');
  let input: Buffer = Buffer.from(bytes);
  if (type === 'image/svg+xml') {
    const svg = inertSvg(new TextDecoder().decode(bytes));
    if (!svg) throw new Error('This SVG has content that isn’t safe to open');
    input = Buffer.from(svg);
  }
  const limitInputPixels = opts.maxPixels ?? 60_000_000;
  const img = sharp(input, { limitInputPixels, animated: false, failOn: 'error', density: type === 'image/svg+xml' ? 144 : undefined });
  const meta = await img.metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (!width || !height) throw new Error('Couldn’t read the image size');
  if (width < (opts.minWidth ?? 1) || height < (opts.minHeight ?? 1)) throw new Error(`Too small (${width}×${height})`);
  const resized = img.rotate().resize({ width: Math.min(width, 3200), withoutEnlargement: true });
  const webp = new Uint8Array(await resized.webp({ quality: 86 }).toBuffer());
  const out = await sharp(Buffer.from(webp)).metadata();
  const grey = await sharp(input, { limitInputPixels, density: type === 'image/svg+xml' ? 72 : undefined }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey[y * 9 + x] > grey[y * 9 + x + 1] ? '1' : '0';
  const dhash = BigInt(`0b${bits}`).toString(16).padStart(16, '0');
  return { webp, width: out.width ?? width, height: out.height ?? height, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), dhash, sourceType: type };
}

/** Number of differing bits between two difference hashes (0 = same picture, ≤ 6 = very likely the same). */
export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & BigInt(1)); x >>= BigInt(1); }
  return n;
}

/** Image addresses that are almost never the font's own pictures. */
export const NOT_CONTENT = /(logo|icon|avatar|sprite|favicon|badge|emoji|pixel|tracking|placeholder|blank|spinner|loader|banner-ad|advert|doubleclick|googlesyndication|facebook\.com\/tr|gravatar|payment|paypal|visa|mastercard|flag-|social|share)/i;
