import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from '../../components/agent/Markdown';

test('agent replies can’t inject HTML or script links', () => {
  const html = renderToStaticMarkup(<Markdown text={'<img src=x onerror=alert(1)> [click](javascript:alert(1)) <script>alert(2)</script>'} />);
  assert.doesNotMatch(html, /<img|<script|href="javascript/);
  assert.match(html, /&lt;img/);
});

test('mixed Arabic and Latin text gets per-block direction and isolated Latin names', () => {
  const html = renderToStaticMarkup(<Markdown text={'صمم **Khaled Hosny** خط [Amiri](https://www.amirifont.org) عام 2011.\n\n- أول\n- second'} />);
  assert.match(html, /<p dir="auto">/);
  assert.match(html, /<a href="https:\/\/www.amirifont.org" target="_blank" rel="noopener noreferrer nofollow"><bdi>Amiri<\/bdi><\/a>/);
  assert.match(html, /<ul dir="auto">/);
});

test('citations render through the given component; tables and code are kept', () => {
  const html = renderToStaticMarkup(<Markdown text={'Released 2019 [src:1a2b3c4d].\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\ncode <b>\n```'} cite={(r) => <sup>{r}</sup>} />);
  assert.match(html, /<sup>src:1a2b3c4d<\/sup>/);
  assert.match(html, /<table/);
  assert.match(html, /code &lt;b&gt;/);
});
