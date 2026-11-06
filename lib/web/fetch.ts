import 'server-only';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as ufetch, type Response as UResponse } from 'undici';

/**
 * Fetching pages and files from other sites without letting a link reach inside a network (SSRF):
 *  - only http(s) on ports 80, 443, 8080 and 8443; no user:password@ in links
 *  - names like localhost/*.internal refused; IP addresses checked against private, loopback,
 *    link-local, carrier-grade NAT, multicast and reserved ranges (IPv4 and IPv6, incl. mapped)
 *  - the check runs on the address the connection really uses (DNS lookup inside the connector),
 *    so a name can't resolve to a public address for the check and a private one for the request
 *  - every redirect is checked again; at most 5 redirects; one total time limit
 *  - downloads are cut off at a size limit while they stream
 */

const PORTS = new Set(['', '80', '443', '8080', '8443']);

function v4Private(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 192 && b === 0 && p[2] === 2) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && p[2] === 100) || (a === 203 && b === 0 && p[2] === 113) || a >= 224;
}

function expand6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  let tail: number[] = [];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    s = s.slice(0, -v4[1].length).replace(/:$/, '') || ':';
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':').filter(Boolean).map((x) => parseInt(x, 16)) : [];
  const r = rest !== undefined ? (rest ? rest.split(':').filter(Boolean).map((x) => parseInt(x, 16)) : []) : null;
  const total = 8 - tail.length;
  let words: number[];
  if (r === null) words = h;
  else { const fill = total - h.length - r.length; if (fill < 0) return null; words = [...h, ...Array(fill).fill(0), ...r]; }
  words = [...words, ...tail];
  return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}

function v6Private(ip: string): boolean {
  const w = expand6(ip);
  if (!w) return true;
  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return v4Private(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`); // mapped / compatible
  if (w[0] === 0x64 && w[1] === 0xff9b) return v4Private(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`); // NAT64
  if (w[0] === 0x2002) return v4Private(`${w[1] >> 8}.${w[1] & 255}.${w[2] >> 8}.${w[2] & 255}`); // 6to4
  if ((w[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  if (w[0] === 0x2001 && w[1] === 0xdb8) return true; // documentation
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ''));
  if (kind === 4) return v4Private(ip);
  if (kind === 6) return v6Private(ip);
  return true;
}

/** Checks the link's form (protocol, port, credentials, obvious internal names). The address itself is checked when connecting. */
export function checkUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (!PORTS.has(u.port)) return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa') || h === 'metadata' || !h.includes('.') && !isIP(h)) return null;
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return null; // 2130706433 / 0x7f000001 style
  const bare = h.replace(/^\[|\]$/g, '');
  if (isIP(bare) && isPrivateAddress(bare)) return null;
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/** DNS lookup that refuses private answers; used by the connector itself. */
export function guardedLookup(hostname: string, options: { all?: boolean } & Record<string, unknown>, cb: LookupCb): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '' as never);
    const list = addresses as { address: string; family: number }[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      const e = new Error(`Blocked address for ${hostname}`) as NodeJS.ErrnoException;
      e.code = 'EBLOCKED';
      return cb(e, '' as never);
    }
    if (options.all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: guardedLookup as never, timeout: 10_000 }, headersTimeout: 20_000, bodyTimeout: 30_000, maxRedirections: 0 } as never);

export const BOT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 FahressBot/1.0 (+https://fahress.com)';
const BROWSER: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
  'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'upgrade-insecure-requests': '1',
};

export class FetchBlocked extends Error {}

async function once(raw: string, init: RequestInit, deadline: number, browser: boolean): Promise<Response> {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= 5; hop++) {
    if (!url) throw new FetchBlocked('Blocked address');
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('Timed out');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), left);
    const outer = init.signal;
    if (outer) outer.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
      const headers = browser ? { ...BROWSER, ...(init.headers as Record<string, string> | undefined), 'user-agent': BROWSER['user-agent'] } : { 'user-agent': BOT_UA, accept: '*/*', ...(init.headers as Record<string, string> | undefined) };
      const res = (await ufetch(url.toString(), { method: init.method ?? 'GET', headers, redirect: 'manual', signal: ctrl.signal, dispatcher: agent } as never)) as unknown as UResponse;
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        url = checkUrl(new URL(loc, url).toString());
        continue;
      }
      // keep the abort timer alive while the caller reads the body: clear it only on completion of reading
      const body = res.body;
      const final = url.toString();
      const wrapped = body ? (body as unknown as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush() { clearTimeout(t); } })) : null;
      const out = new Response(wrapped as unknown as BodyInit, { status: res.status, statusText: res.statusText, headers: res.headers as unknown as HeadersInit });
      Object.defineProperty(out, 'url', { value: final });
      if (!body) clearTimeout(t);
      return out;
    } catch (e) {
      clearTimeout(t);
      const cause = (e as { cause?: { code?: string } }).cause;
      if (cause?.code === 'EBLOCKED') throw new FetchBlocked('Blocked address');
      throw e;
    }
  }
  throw new Error('Too many redirects');
}

/** fetch for other sites' pages and files: SSRF-safe, one total time limit; stores that refuse bots get one retry with browser headers. */
export async function safeFetch(raw: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  const res = await once(raw, init, deadline, false);
  if (![401, 403, 429, 503].includes(res.status)) return res;
  try { await res.body?.cancel(); } catch { /* ignore */ }
  return once(raw, init, deadline, true);
}

/** Reads a body up to `max` bytes; stops downloading beyond that. */
export async function readCapped(res: Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max * 4) { try { await res.body?.cancel(); } catch { /* ignore */ } return { bytes: new Uint8Array(), truncated: true }; }
  const reader = res.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), truncated: false };
  const parts: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) { parts.push(value.subarray(0, max - size)); size = max; truncated = true; try { await reader.cancel(); } catch { /* ignore */ } break; }
    parts.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.byteLength; }
  return { bytes, truncated };
}

/** Text of a response (decoded by its charset, default UTF-8), capped. */
export async function readText(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  const { bytes, truncated } = await readCapped(res, max);
  const cs = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'utf-8';
  let text: string;
  try { text = new TextDecoder(cs, { fatal: false }).decode(bytes); } catch { text = new TextDecoder().decode(bytes); }
  return { text, truncated };
}
