// Searching and sorting any table (tableRows.ts does the work): a table hands its rows and how to read its columns to
// useTableView, puts SortHeader in its head row and TableSearch above it, and renders `view.rows`. The sort and the
// search are kept per table while the tab is open (sessionStorage). Also in the plugin contract (plugin.ts).
import { useMemo, useState, type ReactNode } from 'react';
import { InputAdornment, TableCell, TableSortLabel, TextField, type TableCellProps } from '@mui/material';
import { useI18n } from './i18n';
import { SearchIcon } from './icons';
import { swissLocale } from './localeFormat';
import { filterRows, nextSort, sortRows, type TableColumn, type TableSort } from './tableRows';

export type { TableColumn, TableSort } from './tableRows';

export interface TableViewState<R> {
  /** The rows to render: searched and sorted. */
  rows: R[];
  /** How many rows there are before the search. */
  total: number;
  search: string;
  setSearch: (search: string) => void;
  sort: TableSort | null;
  toggleSort: (key: string) => void;
}

const stored = (id: string): { search: string; sort: TableSort | null } => {
  try {
    const v = JSON.parse(sessionStorage.getItem(`table:${id}`) ?? 'null');
    return { search: typeof v?.search === 'string' ? v.search : '', sort: v?.sort?.key ? v.sort : null };
  } catch {
    return { search: '', sort: null };
  }
};

/**
 * A table's rows searched and sorted. `id` names the table (unique in the app, e.g. `hr.people`); `columns` say how to
 * read each sortable or searchable column; `initial` is the sort before anybody clicks (none = the rows' own order).
 */
export function useTableView<R>(id: string, rows: readonly R[] | null | undefined, columns: readonly TableColumn<R>[], initial: TableSort | null = null): TableViewState<R> {
  const { locale } = useI18n();
  const [state, setState] = useState(() => {
    const s = stored(id);
    return { search: s.search, sort: s.sort ?? initial };
  });
  const save = (next: { search: string; sort: TableSort | null }) => {
    setState(next);
    try {
      sessionStorage.setItem(`table:${id}`, JSON.stringify(next));
    } catch {
      /* private window: kept until the page changes */
    }
  };
  const all = rows ?? [];
  const shown = useMemo(
    () => sortRows(filterRows(all, state.search, columns), state.sort, columns, swissLocale(locale)),
    // columns are read through their keys; a new array each render must not resort for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, state.search, state.sort, locale, columns.map((c) => c.key).join('|')],
  );
  return {
    rows: shown,
    total: all.length,
    search: state.search,
    setSearch: (search) => save({ ...state, search }),
    sort: state.sort,
    toggleSort: (key) => save({ ...state, sort: nextSort(state.sort, key) }),
  };
}

/** A head cell that sorts by its column on a click (ascending, descending, the table's own order). */
export function SortHeader<R>({ view, column, children, ...cell }: { view: TableViewState<R>; column: string; children: ReactNode } & TableCellProps) {
  const active = view.sort?.key === column;
  return (
    <TableCell {...cell} sortDirection={active ? view.sort!.dir : false}>
      <TableSortLabel active={active} direction={active ? view.sort!.dir : 'asc'} onClick={() => view.toggleSort(column)}>
        {children}
      </TableSortLabel>
    </TableCell>
  );
}

/** The search field above a table, with "3 of 12" while it filters. */
export function TableSearch<R>({ view, placeholder, sx }: { view: TableViewState<R>; placeholder?: string; sx?: object }) {
  const { t } = useI18n();
  const filtering = view.search.trim() !== '';
  return (
    <TextField
      size="small"
      value={view.search}
      onChange={(e) => view.setSearch(e.target.value)}
      placeholder={placeholder ?? t('table.search')}
      sx={{ minWidth: { xs: '100%', sm: 260 }, ...sx }}
      slotProps={{
        input: {
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>,
          endAdornment: filtering ? <InputAdornment position="end">{t('table.count', { shown: String(view.rows.length), total: String(view.total) })}</InputAdornment> : undefined,
        },
        htmlInput: { 'aria-label': placeholder ?? t('table.search') },
      }}
    />
  );
}
