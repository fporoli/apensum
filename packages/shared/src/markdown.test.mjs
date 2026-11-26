import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownPlain, renderMarkdown } from './markdown.ts';

const opts = { image: (src, alt) => `<img src="${src}" alt="${alt}">`, link: (href, label) => `<a href="${href}">${label}</a>` };
const md = (text) => renderMarkdown(text, opts);

test('headings, lists and quotes start with their line, also right after text (as editors show them)', () => {
  assert.equal(md('# Titel\nText'), '<h2>Titel</h2>\n<p>Text</p>');
  assert.equal(md('### Klein'), '<h3>Klein</h3>');
  assert.equal(md('Einkaufen:\n- Milch\n- Brot\nDanach'), '<p>Einkaufen:</p>\n<ul><li>Milch</li><li>Brot</li></ul>\n<p>Danach</p>');
  assert.equal(md('1) eins\n2. zwei'), '<ol><li>eins</li><li>zwei</li></ol>');
  assert.equal(md('- eins\n  geht weiter\n- zwei'), '<ul><li>eins geht weiter</li><li>zwei</li></ul>');
  assert.equal(md('> Zitat\n> zwei\nText'), '<blockquote><p>Zitat zwei</p></blockquote>\n<p>Text</p>');
});

test('paragraphs keep their line breaks; empty lines separate them; texts with empty lines render as before', () => {
  assert.equal(md('Zeile 1\nZeile 2\n\nNeu'), '<p>Zeile 1<br>Zeile 2</p>\n<p>Neu</p>');
  assert.equal(md('## Titel\n\nText\n\n- a\n- b'), '<h2>Titel</h2>\n<p>Text</p>\n<ul><li>a</li><li>b</li></ul>');
  assert.equal(md('![Bild](doc:1)'), '<figure><img src="doc:1" alt="Bild"></figure>');
});

test('inline marks and escaping', () => {
  assert.equal(md('**fett** *kursiv* ~~weg~~ `a<b`'), '<p><strong>fett</strong> <em>kursiv</em> <del>weg</del> <code>a&lt;b</code></p>');
  assert.equal(md('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(markdownPlain('## T\n- **a** ~~b~~\n1) c'), 'T a b c');
});
