/**
 * The navbar as a tree, built the same way from the core's pages (corePages.tsx) and the plugins'
 * (plugins.ts): groups in order (a group with `after` goes behind that group), each page's entry in
 * its group (behind `nav.after`, wherever that page is listed; entries without one in list order first),
 * sub-entries under their `nav.parent`; `nav.last` puts an entry at the end of its group, behind the plugins' too.
 * Pure, so Node tests import it.
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
  nav?: { group: string; after?: string; parent?: string; last?: boolean; label?: string; ownOnly?: OwnOnlyPlace };
}

/** Where an entry sits, and what it is called, for someone who holds its page only for themselves (scope `own`). */
export interface OwnOnlyPlace {
  /** The entry it goes under instead (e.g. 'myData'). */
  parent?: string;
  /** Its label there (an i18n key, e.g. "My performance reviews"). */
  label?: string;
  /** The sub-entry it follows there. */
  after?: string;
}

/**
 * The pages as the caller's navbar places them: a page with `nav.ownOnly` that the caller holds only for themselves
 * moves there (parent, label, after), the others stay as they are. Pure; `ownOnly(page)` says whom it applies to.
 */
export function placeForCaller<P extends NavPage>(pages: readonly P[], ownOnly: (page: P) => boolean): P[] {
  return pages.map((p) => {
    const o = p.nav?.ownOnly;
    if (!o || !ownOnly(p)) return p;
    const { after: _after, last: _last, ...rest } = p.nav!;
    return { ...p, nav: { ...rest, ...(o.parent ? { parent: o.parent } : {}), ...(o.label ? { label: o.label } : {}), ...(o.after ? { after: o.after } : {}) } };
  });
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
  const top = pages.filter((p) => p.nav && !p.nav.parent && !p.nav.last);
  const groupOf = (page: P) => tree.find((x) => x.id === page.nav!.group);
  for (const page of top) if (!page.nav!.after) groupOf(page)?.items.push({ page, children: [] });
  // Entries behind another one: placed as soon as that one is, the rest (missing target) at the end.
  let pending = top.filter((p) => p.nav!.after);
  for (let placed = true; placed && pending.length; ) {
    placed = false;
    pending = pending.filter((page) => {
      const group = groupOf(page);
      if (!group) return false;
      const index = group.items.findIndex((i) => i.page.section === page.nav!.after);
      if (index < 0) return true;
      insertAfter(group.items, { page, children: [] }, index);
      placed = true;
      return false;
    });
  }
  for (const page of pending) groupOf(page)?.items.push({ page, children: [] });
  for (const page of pages) if (page.nav?.last && !page.nav.parent) groupOf(page)?.items.push({ page, children: [] });
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
