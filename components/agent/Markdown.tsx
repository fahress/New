'use client';
import { Fragment, type ReactNode } from 'react';

/**
 * A small, safe Markdown renderer for the agent's replies: no raw HTML is ever inserted, links must be
 * http(s), and every block chooses its own direction (Arabic, English or mixed). Latin names, links and
 * code inside Arabic text are isolated with <bdi> so their order isn't scrambled.
 */
export type CiteRender = (ref: string) => ReactNode;

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;

function inline(text: string, cite: CiteRender | undefined, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code, links, citations, bold, italic, bare links
  const re = /(`[^`\n]+`)|\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|\[(src:[0-9a-f]{8})\]|\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(https?:\/\/[^\s<>()]+[^\s<>().,،؛!?:])/gi;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<bdi key={k}><code>{m[1].slice(1, -1)}</code></bdi>);
    else if (m[2] && m[3]) out.push(SAFE_URL.test(m[3]) ? <a key={k} href={m[3]} target="_blank" rel="noopener noreferrer nofollow"><bdi>{m[2]}</bdi></a> : m[2]);
    else if (m[4]) out.push(cite ? <Fragment key={k}>{cite(m[4].toLowerCase())}</Fragment> : null);
    else if (m[5]) out.push(<strong key={k}>{inline(m[5], cite, k)}</strong>);
    else if (m[6]) out.push(<em key={k}>{inline(m[6], cite, k)}</em>);
    else if (m[7]) out.push(SAFE_URL.test(m[7]) ? <a key={k} href={m[7]} target="_blank" rel="noopener noreferrer nofollow"><bdi>{m[7].replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</bdi></a> : m[7]);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, cite }: { text: string; cite?: CiteRender }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  const key = () => `b${b++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key()} dir="ltr"><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { const k = key(); const Tag = (h[1].length <= 2 ? 'h3' : 'h4') as 'h3'; blocks.push(<Tag key={k} dir="auto">{inline(h[2], cite, k)}</Tag>); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      const k = key();
      blocks.push(
        <div key={k} className="ag-tablewrap"><table className="ag-table" dir="auto">
          <thead><tr>{head.map((c, x) => <th key={x} dir="auto">{inline(c, cite, `${k}h${x}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, y) => <tr key={y}>{r.map((c, x) => <td key={x} dir="auto">{inline(c, cite, `${k}${y}${x}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      const k = key();
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={k} dir="auto">{items.map((it, x) => <li key={x} dir="auto">{inline(it, cite, `${k}${x}`)}</li>)}</List>);
      continue;
    }
    if (line.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      const k = key();
      blocks.push(<blockquote key={k} dir="auto">{inline(q.join(' '), cite, k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*•]|\d+[.)])\s+)/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    const k = key();
    blocks.push(<p key={k} dir="auto">{para.map((l, x) => <Fragment key={x}>{x ? <br /> : null}{inline(l, cite, `${k}${x}`)}</Fragment>)}</p>);
  }
  return <div className="ag-md">{blocks}</div>;
}
