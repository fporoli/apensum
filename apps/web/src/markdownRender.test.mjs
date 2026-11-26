import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownHtml } from './markdownRender.ts';

test('editors\' Markdown: headings, lists right after text, tables, code, strikethrough, line breaks', () => {
  assert.match(markdownHtml('# Titel\nText'), /<h1>Titel<\/h1>\s*<p>Text<\/p>/);
  assert.match(markdownHtml('Einkaufen:\n- Milch\n- Brot'), /<p>Einkaufen:<\/p>\s*<ul>\s*<li>Milch<\/li>\s*<li>Brot<\/li>\s*<\/ul>/);
  assert.match(markdownHtml('| A | B |\n|---|---|\n| 1 | 2 |'), /<table>[\s\S]*<td>1<\/td>/);
  assert.match(markdownHtml('```\na < b\n```'), /<pre><code>a &lt; b\n<\/code><\/pre>/);
  assert.match(markdownHtml('~~weg~~'), /<s>weg<\/s>/);
  assert.match(markdownHtml('Zeile 1\nZeile 2'), /Zeile 1<br>\s*Zeile 2/);
  assert.match(markdownHtml('- [ ] offen\n- [x] erledigt'), /<li class="task"><input type="checkbox" disabled> offen<\/li>\s*<li class="task"><input type="checkbox" disabled checked> erledigt/);
});

test('safe: no HTML, only safe links (in a new tab), pictures as text', () => {
  assert.doesNotMatch(markdownHtml('<script>alert(1)</script>'), /<script>/);
  assert.match(markdownHtml('<b>x</b>'), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(markdownHtml('[a](https://a.ch)'), /<a href="https:\/\/a.ch" target="_blank" rel="noopener noreferrer">a<\/a>/);
  assert.doesNotMatch(markdownHtml('[a](javascript:alert(1))'), /<a /);
  assert.doesNotMatch(markdownHtml('[a](data:text/html,x)'), /<a /);
  assert.match(markdownHtml('www.apensum.ch'), /<a href="http:\/\/www.apensum.ch"/);
  assert.equal(markdownHtml('![Ein Bild](https://x.ch/a.png)').trim(), '<p>Ein Bild</p>');
});
