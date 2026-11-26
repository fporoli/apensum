// The documentation the website's chatbot may search (site-chat.controller.ts, its tool `search_docs`): the public
// repository's README and docs, as they are in the image (the version that runs), cut into sections and ranked by
// BM25 for a query the model writes in English (the documentation's language). Not CLAUDE.md (instructions for
// development), not docs/BUILD_PROMPT.md or docs/SYSTEM_REVIEW.md (internal), not code. Pure, tested in site-chat.test.ts.

/** The files, relative to the repository's root. */
export const CHAT_DOCS = ['README.md', 'docs/PLUGINS.md', 'docs/CASES_ENCRYPTION.md', 'docs/SERVER_SETUP.md', 'docs/FIELD_CONFIG.md', 'docs/DATABASE_SCHEMA.md'];

export interface DocChunk {
  source: string;
  /** The headings above it, e.g. `Backups › Restore`. */
  heading: string;
  text: string;
}

const STOP = new Set(('the and for with that this from are was were has have not but you your can will its into than then also only when what which who how does there their they them our out all any per via about other more most such each may must should could would been being over under use used using '
  + 'der die das und oder mit von für ist sind ein eine einer nicht auch wie was wer den dem des auf aus bei').split(' '));

/** Lower-case words of three or more letters or digits, without common words. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9äöüàéèêç]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));
}

/** A Markdown file as sections under their headings, long ones split at blank lines (at most `max` characters each). */
export function chunkMarkdown(source: string, markdown: string, max = 1600): DocChunk[] {
  const chunks: DocChunk[] = [];
  const path: string[] = [];
  let lines: string[] = [];
  let inCode = false;
  const flush = () => {
    const body = lines.join('\n').trim();
    lines = [];
    if (!body) return;
    const heading = path.filter(Boolean).join(' › ') || source;
    let part = '';
    for (const para of body.split(/\n\s*\n/)) {
      if (part && part.length + para.length > max) {
        chunks.push({ source, heading, text: part.trim() });
        part = '';
      }
      part += `${para.slice(0, max)}\n\n`;
    }
    if (part.trim()) chunks.push({ source, heading, text: part.trim() });
  };
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const h = !inCode && /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      path.length = level - 1;
      path[level - 1] = h[2].replace(/[`*]/g, '').trim();
    } else lines.push(line);
  }
  flush();
  return chunks;
}

/** BM25 over the sections. */
export class DocIndex {
  private readonly docs: { chunk: DocChunk; tf: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avg: number;

  constructor(chunks: DocChunk[]) {
    this.docs = chunks.map((chunk) => {
      const terms = tokenize(`${chunk.heading} ${chunk.heading} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { chunk, tf, length: terms.length };
    });
    this.avg = this.docs.reduce((n, d) => n + d.length, 0) / Math.max(1, this.docs.length);
  }

  get size(): number {
    return this.docs.length;
  }

  /** The best sections for the query, at most `k` and `maxChars` together; [] when nothing matches. */
  search(query: string, k = 6, maxChars = 8000): DocChunk[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const n = this.docs.length;
    const scored = this.docs
      .map((d) => {
        let score = 0;
        for (const t of terms) {
          const f = d.tf.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (n - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
          score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / this.avg))));
        }
        return { chunk: d.chunk, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const out: DocChunk[] = [];
    let chars = 0;
    for (const { chunk } of scored) {
      if (out.length >= k || chars + chunk.text.length > maxChars) break;
      out.push(chunk);
      chars += chunk.text.length;
    }
    return out;
  }
}

/** The search's answer for the model: each section with where it is from. */
export function docsPayload(chunks: DocChunk[]): string {
  if (!chunks.length) return 'No matching documentation.';
  return chunks.map((c) => `[${c.source} — ${c.heading}]\n${c.text}`).join('\n\n---\n\n');
}
