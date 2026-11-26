// Markdown to HTML in the app (MarkdownView.tsx): markdown-it, CommonMark with tables and strikethrough, set up to be
// safe for text people type: no HTML at all (`html: false`, everything else is escaped), links only to http(s), mailto,
// the app's own paths or anchors and in a new tab, pictures as their text (a note has no files), a line break kept as
// one (as people type), web addresses made links, `- [ ]` / `- [x]` as checkboxes. The website and the mails keep the
// shared renderer (packages/shared/src/markdown.ts). Plain TypeScript so Node tests import it (markdownRender.test.mjs).
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

/** Only these links are made; anything else (javascript:, data:, file:, ...) stays text. */
md.validateLink = (url: string) => /^(https?:\/\/|mailto:|\/|#)/i.test(url.trim());

const escape = md.utils.escapeHtml;
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, idx, options);
};
// A picture shows as its description.
md.renderer.rules.image = (tokens, idx) => escape(tokens[idx].content);

// Task lists: an item starting with [ ] or [x] gets a checkbox (shown, not clickable).
md.core.ruler.after('inline', 'task-lists', (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
    const first = inline.children?.[0];
    const m = first?.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null;
    if (!first || !m) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `;
    inline.children!.unshift(box);
    tokens[i - 2].attrJoin('class', 'task');
  }
});

/** The HTML of `text`; safe to put into the page (see above). */
export function markdownHtml(text: string): string {
  return md.render(text ?? '');
}
