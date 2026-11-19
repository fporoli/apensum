import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { markdownImages, markdownPlain, renderMarkdown } from '@worktime3/shared/markdown';
import { newsImageId, newsTextFor, validateNewsTexts } from '@worktime3/shared/news';
import { cleanDepartmentIds, mayEditNews, newsMail } from '../../apps/api/src/news.controller';

const opts = {
  image: (src: string, alt: string) => `<img src="${src}" alt="${alt}">`,
  link: (href: string, label: string) => `<a href="${href}">${label}</a>`,
};

test('news texts: at least one language with a title; empty languages dropped; limits', () => {
  assert.deepEqual(validateNewsTexts({ de: { title: ' Neu ', body: 'Text\r\n' }, fr: { title: '', body: '' } }), { ok: true, texts: { de: { title: 'Neu', body: 'Text' } } });
  assert.deepEqual(validateNewsTexts({ de: { title: '', body: 'x' } }), { ok: false, error: 'news-title-required' });
  assert.deepEqual(validateNewsTexts({ es: { title: 'Hola', body: '' } }), { ok: false, error: 'news-invalid-language' });
  assert.deepEqual(validateNewsTexts({}), { ok: false, error: 'news-text-required' });
  assert.deepEqual(validateNewsTexts(null), { ok: false, error: 'news-text-required' });
  assert.deepEqual(validateNewsTexts({ de: { title: 'x'.repeat(201), body: '' } }), { ok: false, error: 'news-too-long' });
});

test('news texts: the reader sees theirs, else German, else the first written', () => {
  const texts = { fr: { title: 'Bonjour', body: '' }, de: { title: 'Hallo', body: '' } };
  assert.equal(newsTextFor(texts, 'fr')?.title, 'Bonjour');
  assert.equal(newsTextFor(texts, 'it')?.lang, 'de');
  assert.equal(newsTextFor({ en: { title: 'Hi', body: '' } }, 'it')?.lang, 'en');
  assert.equal(newsTextFor({}, 'de'), null);
});

test('Markdown: everything escaped, no script links, line breaks kept, pictures found', () => {
  assert.equal(renderMarkdown('<script>x</script>', opts), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(renderMarkdown('Zeile 1\nZeile 2', opts), '<p>Zeile 1<br>Zeile 2</p>');
  assert.equal(renderMarkdown('[a](javascript:alert)', { ...opts, link: (h, l) => (/^https?:/.test(h) ? `<a href="${h}">${l}</a>` : l) }), '<p>a</p>');
  assert.equal(renderMarkdown('![x" onerror="y](doc:1)', opts), '<figure><img src="doc:1" alt="x&quot; onerror=&quot;y"></figure>');
  assert.deepEqual(markdownImages('![a](doc:1) `![b](doc:2)`'), ['doc:1']);
  assert.equal(markdownPlain('## Titel\n\n- **eins** [Link](https://x.ch)\n\n![Bild](doc:1)'), 'Titel eins Link');
  assert.equal(newsImageId('doc:0E9C8B1A-1111-2222-3333-444455556666'), '0e9c8b1a-1111-2222-3333-444455556666');
  assert.equal(newsImageId('https://evil.example/x.png'), null);
});

test('news mail: in the reader language, short preview, confirmation hint, link', () => {
  const texts = { de: { title: 'Neue Weisung', body: '## Ab Montag\n\nBitte **lesen**.' }, en: { title: 'New directive', body: 'Please read.' } };
  const de = newsMail(texts, true, 'de-CH', 'https://app.example.ch/#/news?id=1')!;
  assert.equal(de.subject, 'Neue Weisung');
  assert.match(de.text, /^Ab Montag Bitte lesen\.\n\nBitte bestätigen Sie/);
  assert.match(de.text, /Lesen in Apensum: https:\/\/app\.example\.ch\/#\/news\?id=1\n$/);
  const it = newsMail(texts, false, 'it', 'L')!;
  assert.equal(it.subject, 'Neue Weisung', 'no Italian text: German');
  assert.doesNotMatch(it.text, /confermare/);
  assert.match(it.text, /Leggere in Apensum: L/);
  const long = newsMail({ de: { title: 'T', body: 'wort '.repeat(300) } }, false, 'de', 'L')!;
  assert.ok(long.text.length < 700 && long.text.includes(' …'));
});

test('news audience: department ids are uuids, without duplicates', () => {
  const id = '0e9c8b1a-1111-2222-3333-444455556666';
  assert.deepEqual(cleanDepartmentIds(undefined), []);
  assert.deepEqual(cleanDepartmentIds([id, id.toUpperCase()]), [id]);
  assert.equal(cleanDepartmentIds(['x']), null);
  assert.equal(cleanDepartmentIds('x'), null);
});

test('who changes a post: the organization news writers its posts, a superdeveloper product news', () => {
  const hr = { id: 'u', editor: true, admin: false, superdeveloper: false };
  const dev = { id: 'd', editor: false, admin: false, superdeveloper: true };
  assert.equal(mayEditNews(hr, { organization_id: 'org' }), true);
  assert.equal(mayEditNews(hr, { organization_id: null }), false);
  assert.equal(mayEditNews(dev, { organization_id: null }), true);
  assert.equal(mayEditNews(dev, { organization_id: 'org' }), false, 'a superdeveloper is no writer of an organization by that alone');
});
