import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkUrl, guardedLookup, isPrivateAddress, readCapped } from '../../lib/web/fetch';
import { inertSvg } from '../../lib/web/image';

test('private, loopback, link-local and mapped addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '224.0.0.1']) {
    assert.ok(isPrivateAddress(ip), `${ip} must be private`);
  }
  for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), `${ip} is public`);
});

test('links to internal names, odd ports, credentials or numeric hosts are refused before connecting', () => {
  for (const u of ['http://localhost/', 'http://metadata.google.internal/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/', 'http://169.254.169.254/latest', 'https://example.com:22/', 'https://user:pw@example.com/', 'file:///etc/passwd', 'gopher://x.example/', 'http://printer.local/']) {
    assert.equal(checkUrl(u), null, u);
  }
  assert.ok(checkUrl('https://www.myfonts.com/collections/zawi'));
});

test('the connector refuses names that resolve to private addresses', async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((ok) => guardedLookup('localhost', {}, (e) => ok(e)));
  assert.equal(err?.code, 'EBLOCKED');
});

test('downloads stop at the size limit while streaming', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); const chunk = Buffer.alloc(64 * 1024, 1); let n = 0; const t = setInterval(() => { if (n++ > 200 || res.destroyed) { clearInterval(t); res.end(); return; } res.write(chunk); }, 1); });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`); // the size limit is what's tested here, not the address check
    const r = await readCapped(res, 256 * 1024);
    assert.equal(r.truncated, true);
    assert.equal(r.bytes.byteLength, 256 * 1024);
  } finally { server.close(); }
});

test('SVG files are made inert before drawing (no scripts, outside references or entities)', () => {
  assert.equal(inertSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'), null);
  const safe = inertSvg('<svg onload="alert(1)"><script>alert(1)</script><image href="file:///etc/passwd"/><use xlink:href="https://evil.example/a.svg#x"/><path d="M0 0"/></svg>')!;
  assert.doesNotMatch(safe, /script|onload|file:|evil\.example|<image|<use/);
  assert.match(safe, /<path/);
});

test('no browser code can reach keys: client files never import server modules', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : []; });
  const root = new URL('../../', import.meta.url).pathname;
  for (const file of [...walk(join(root, 'components')), ...walk(join(root, 'app/dashboard'))]) {
    const src = readFileSync(file, 'utf8');
    if (!src.startsWith("'use client'")) continue;
    assert.doesNotMatch(src, /lib\/agent\/(gateway|supa|service|store-db|archive-db|web-reader|stage-images|jobs)|lib\/web\/(fetch|image)/, `${file} is a client file importing server code`);
    assert.doesNotMatch(src, /localStorage\.setItem\([^)]*key|sessionStorage/i, `${file} must not keep keys in browser storage`);
  }
});

test('the built browser bundle contains no secrets or vault access (when a build exists)', (t) => {
  const dir = new URL('../../.next/static', import.meta.url).pathname;
  if (!existsSync(dir)) { t.skip('no build'); return; }
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : f.endsWith('.js') ? [p] : []; });
  for (const f of walk(dir)) {
    const js = readFileSync(f, 'utf8');
    assert.doesNotMatch(js, /agent_vault_read|SUPABASE_SERVICE_ROLE_KEY|decrypted_secret|sk-or-v1-[A-Za-z0-9]{10}|tvly-[A-Za-z0-9]{10}/, f);
  }
});
