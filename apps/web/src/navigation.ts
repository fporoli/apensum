/**
 * The navbar as a tree, built the same way from the core's pages (corePages.tsx) and the plugins'
 * (plugins.ts): groups in order (a group with `after` goes behind that group), each page's entry in
 * its group (behind `nav.after`), sub-entries under their `nav.parent`. Pure, so Node tests import it.
 */

export interface NavGroupDef {
  id: string;
  /** i18n key of the heading; empty = no heading. */
  header: string;
  /** The group it follows; at the end when unknown or unset. */
  after?: string;
}

interface NavPage {
  section: string;
  nav?: { group: string; after?: string; parent?: string };
}

export interface NavTreeItem<P> {
  page: P;
  children: P[];
}

export interface NavTreeGroup<P> {
  id: string;
  header: string;
  items: NavTreeItem<P>[];
}

function insertAfter<T>(list: T[], value: T, index: number): void {
  if (index >= 0) list.splice(index + 1, 0, value);
  else list.push(value);
}

export function buildNavTree<P extends NavPage>(groups: readonly NavGroupDef[], pages: readonly P[]): NavTreeGroup<P>[] {
  const tree: NavTreeGroup<P>[] = [];
  for (const g of groups) {
    if (tree.some((x) => x.id === g.id)) continue;
    const group: NavTreeGroup<P> = { id: g.id, header: g.header, items: [] };
    insertAfter(tree, group, g.after ? tree.findIndex((x) => x.id === g.after) : -1);
  }
  for (const page of pages) {
    if (!page.nav || page.nav.parent) continue;
    const group = tree.find((x) => x.id === page.nav!.group);
    if (!group) continue;
    const after = page.nav.after;
    insertAfter(group.items, { page, children: [] }, after ? group.items.findIndex((i) => i.page.section === after) : -1);
  }
  for (const page of pages) {
    const parent = page.nav?.parent;
    if (!parent) continue;
    const item = tree.flatMap((g) => g.items).find((i) => i.page.section === parent);
    if (!item) continue;
    const after = page.nav!.after;
    insertAfter(item.children, page, after ? item.children.findIndex((c) => c.section === after) : -1);
  }
  return tree;
}

/** Section -> location hash and back, over all pages. */
export function sectionHashes(pages: readonly { section: string; hash: string }[]): {
  toHash: Record<string, string>;
  toSection: Record<string, string>;
} {
  const toHash: Record<string, string> = {};
  const toSection: Record<string, string> = {};
  for (const p of pages) {
    toHash[p.section] = p.hash;
    toSection[p.hash] = p.section;
  }
  return { toHash, toSection };
}
