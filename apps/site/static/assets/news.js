// The News page's posts (src/pages.mjs news): public product news written in the app, loaded from
// the API's public/news when the page opens, so a new post is here without a deploy. Without
// `?post=` the list; with it one post. The post's HTML comes from the API's Markdown renderer
// (packages/shared/src/markdown.ts), which escapes everything it is given.
(() => {
  const box = document.getElementById('news-posts');
  if (!box) return;
  const d = box.dataset;
  const id = new URLSearchParams(location.search).get('post');
  const date = (iso) => {
    try {
      return new Intl.DateTimeFormat(d.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
    } catch {
      return iso;
    }
  };
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  };
  const say = (text) => box.replaceChildren(el('p', { class: 'muted' }, text));
  const load = async (url) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!data || !data.ok) throw new Error(data && data.error);
    return data;
  };
  const other = (lang) => (lang && lang !== d.lang ? { lang } : {});

  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    load(`${d.api}/${encodeURIComponent(id)}?lang=${encodeURIComponent(d.lang)}`)
      .then(({ post }) => {
        const body = el('div', { class: 'prose post-body', ...other(post.lang) });
        body.innerHTML = post.html;
        box.replaceChildren(
          el(
            'article',
            { class: 'news-post' },
            el('p', { class: 'muted small' }, el('a', { href: location.pathname }, d.back), ' · ', el('time', { datetime: post.date }, date(post.date))),
            el('h2', { class: 'post-title', ...other(post.lang) }, post.title),
            post.lang === 'de' && d.lang !== 'de' ? el('p', { class: 'muted small' }, d.onlyGerman) : null,
            body,
          ),
        );
        document.title = `${post.title} – Apensum`;
        // The language menu stays on this post.
        for (const a of document.querySelectorAll('.langs a')) a.search = `?post=${encodeURIComponent(post.id)}`;
      })
      .catch(() => say(d.failed));
    return;
  }

  load(`${d.api}?lang=${encodeURIComponent(d.lang)}`)
    .then(({ posts }) => {
      if (!posts.length) return say(d.empty);
      const items = posts.map((p) =>
        el(
          'li',
          { class: 'card' },
          el('p', { class: 'muted small' }, el('time', { datetime: p.date }, date(p.date))),
          el('h2', { class: 'h3', ...other(p.lang) }, el('a', { href: `${location.pathname}?post=${encodeURIComponent(p.id)}` }, p.title)),
          p.summary ? el('p', other(p.lang), p.summary) : null,
          el('p', { class: 'small' }, el('a', { href: `${location.pathname}?post=${encodeURIComponent(p.id)}` }, d.read)),
        ),
      );
      box.replaceChildren(el('ul', { class: 'post-list' }, ...items));
    })
    .catch(() => say(d.failed));
})();
