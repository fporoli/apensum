// Searching and sorting a table's rows in the browser (TableView.tsx: useTableView, SortHeader, TableSearch). Plain
// TypeScript so Node tests import it (tableRows.test.mjs).

/** What a column sorts and searches by: a number, a text or an ISO date; null/undefined = empty (always last). */
export type CellValue = string | number | boolean | null | undefined;

export interface TableColumn<R> {
  key: string;
  value: (row: R) => CellValue;
  /** Searched by the search field (default true); a column of numbers may say false. */
  search?: boolean;
}

export type SortDir = 'asc' | 'desc';
export interface TableSort {
  key: string;
  dir: SortDir;
}

/** Lower case, without accents: "Müller" finds "muller", "Zürich" "zurich". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The rows every word of the query is found in (in any searched column), in their order. */
export function filterRows<R>(rows: readonly R[], query: string, columns: readonly TableColumn<R>[]): R[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  const searched = columns.filter((c) => c.search !== false);
  return rows.filter((row) => {
    const text = fold(searched.map((c) => {
      const v = c.value(row);
      return v === null || v === undefined ? '' : String(v);
    }).join(' '));
    return words.every((w) => text.includes(w));
  });
}

/**
 * The rows sorted by a column: numbers as numbers, texts by the language's order with numbers in them as numbers
 * ("Projekt 2" before "Projekt 10"; ISO dates in date order), empty cells last either way; equal ones keep their order.
 */
export function sortRows<R>(rows: readonly R[], sort: TableSort | null, columns: readonly TableColumn<R>[], locale = 'de-CH'): R[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !column) return [...rows];
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: column.value(row) }))
    .sort((a, b) => {
      const ae = a.v === null || a.v === undefined || a.v === '';
      const be = b.v === null || b.v === undefined || b.v === '';
      if (ae || be) return ae && be ? a.index - b.index : ae ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v
        : typeof a.v === 'boolean' && typeof b.v === 'boolean' ? Number(a.v) - Number(b.v)
          : collator.compare(String(a.v), String(b.v));
      return c !== 0 ? c * sign : a.index - b.index;
    })
    .map((x) => x.row);
}

/** A click on a column's head: sorts by it ascending, then descending, then not at all (the table's own order). */
export function nextSort(current: TableSort | null, key: string): TableSort | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}
