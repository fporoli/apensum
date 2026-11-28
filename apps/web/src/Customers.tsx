import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Chip, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip } from '@mui/material';
import { CUSTOMER_TERMS, type CustomerTerm } from '@worktime3/shared/customers';
import { Button } from './Button';
import { PageHeader, TableEmptyRow } from './components';
import { DeleteIcon, EditIcon } from './icons';
import { SortHeader, TableSearch, useTableView, type TableColumn } from './TableView';
import { apiRequest } from './apiRequest';
import { CustomerDialog, customerErrorText, EMPTY_CUSTOMER, loadCustomers, type Customer, type CustomerDraft } from './CustomerDialog';
import { setCustomerTerm, useCustomerTerm, useTermT } from './customerTerm';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/**
 * Customers (127): whom the organization works for (Kunde, Auftraggeber or Mandant, its term), with address and
 * contact people. A project names its customer in Projects & Teams; plugins build on them (billing invoices them).
 */
export default function Customers({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const t = useTermT();
  const term = useCustomerTerm();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [editable, setEditable] = useState(false);
  const [editing, setEditing] = useState<CustomerDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await loadCustomers(orgId, authHeaders);
    if (!r.ok) { setError(customerErrorText(t, r.error)); return; }
    setCustomers(r.customers);
    setEditable(r.editable);
  }, [orgId, authHeaders]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const columns: TableColumn<Customer>[] = [
    { key: 'name', value: (c) => c.name },
    { key: 'place', value: (c) => [c.zip, c.city].filter(Boolean).join(' ') || null },
    { key: 'contacts', value: (c) => c.contacts.map((k) => k.name).join(', ') || null },
    { key: 'email', value: (c) => c.email },
  ];
  const view = useTableView('core.customers', customers, columns);

  const saveTerm = async (next: CustomerTerm) => {
    setError(null);
    const r = await apiRequest(`${API}/organizations/${orgId}/customers-term`, { method: 'PUT', body: { term: next }, headers: await authHeaders() });
    if (!r.ok) { setError(customerErrorText(t, r.error)); return; }
    setCustomerTerm(next);
  };

  const remove = async (c: Customer) => {
    if (!confirm(t('customers.deleteConfirm', { name: c.name }))) return;
    setError(null);
    const r = await apiRequest(`${API}/organizations/${orgId}/customers/${c.id}`, { method: 'DELETE', headers: await authHeaders() });
    if (!r.ok) { setError(customerErrorText(t, r.error)); return; }
    setNotice(t('customers.deleted', { name: c.name }));
    await load();
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')}
        end={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {editable && (
              <TextField select size="small" label={t('customers.term')} value={term} sx={{ minWidth: 180 }} onChange={(e) => void saveTerm(e.target.value as CustomerTerm)}>
                {CUSTOMER_TERMS.map((x) => <MenuItem key={x} value={x}>{t(`customers.termOption.${x}`)}</MenuItem>)}
              </TextField>
            )}
            {editable && <Button variant="contained" onClick={() => setEditing(EMPTY_CUSTOMER)}>{t('customers.add')}</Button>}
          </Stack>
        } />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      <Box sx={{ mb: 1.5 }}><TableSearch view={view} /></Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortHeader view={view} column="name">{t('customers.name')}</SortHeader>
              <SortHeader view={view} column="place">{t('customers.city')}</SortHeader>
              <SortHeader view={view} column="contacts">{t('customers.contacts')}</SortHeader>
              <SortHeader view={view} column="email">{t('customers.email')}</SortHeader>
              {editable && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {customers && view.rows.length === 0 && <TableEmptyRow colSpan={editable ? 5 : 4} title={t("customers.empty")} />}
            {view.rows.map((c) => (
              <TableRow key={c.id} hover sx={{ opacity: c.active ? 1 : 0.6 }}>
                <TableCell>
                  {c.name} {!c.active && <Chip size="small" label={t('customers.inactive')} sx={{ ml: 1 }} />}
                </TableCell>
                <TableCell>{[c.zip, c.city].filter(Boolean).join(' ')}</TableCell>
                <TableCell>{c.contacts.map((k) => k.name).join(', ')}</TableCell>
                <TableCell>{c.email}</TableCell>
                {editable && (
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={t('customers.edit')}>
                      <IconButton size="small" aria-label={t('customers.edit')} onClick={() => setEditing(c)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <Tooltip title={t('customers.delete')}>
                      <IconButton size="small" aria-label={t('customers.delete')} onClick={() => void remove(c)}><DeleteIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {editing && (
        <CustomerDialog orgId={orgId} authHeaders={authHeaders} initial={editing} onClose={() => setEditing(null)}
          onSaved={async (c) => { setEditing(null); setNotice(t('customers.saved', { name: c.name })); await load(); }} />
      )}
    </Box>
  );
}
