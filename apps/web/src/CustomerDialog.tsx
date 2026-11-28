import { useState } from 'react';
import {
  Alert, Box, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, TextField, Tooltip, Typography,
} from '@mui/material';
import { CUSTOMER_LANGUAGES, type CustomerContact } from '@worktime3/shared/customers';
import { Button } from './Button';
import { DeleteIcon } from './icons';
import { apiRequest } from './apiRequest';
import { useTermT } from './customerTerm';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** A customer as the API gives it (customers.controller.ts). */
export interface Customer {
  id: string; name: string; street: string | null; houseNumber: string | null; zip: string | null; city: string | null; country: string;
  email: string | null; phone: string | null; language: string; active: boolean; contacts: CustomerContact[];
}

export type CustomerDraft = Omit<Customer, 'id'> & { id?: string };

export const EMPTY_CUSTOMER: CustomerDraft = {
  name: '', street: '', houseNumber: '', zip: '', city: '', country: 'CH', email: '', phone: '', language: 'de', active: true, contacts: [],
};

/** The text for a customers API error (`customers.error.<code>`), else the generic one. */
export function customerErrorText(t: (key: string) => string, code: string): string {
  const key = `customers.error.${code}`;
  const text = t(key);
  return text === key ? t('customers.error.generic') : text;
}

/**
 * A customer (Kunde, Auftraggeber or Mandant, as the organization calls them): its address, e-mail, phone, the
 * language of what goes to it, and its contact people ("z. H."). The Customers page and the project dialog's "New…".
 */
export function CustomerDialog({ orgId, authHeaders, initial, onClose, onSaved }: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  initial: CustomerDraft;
  onClose: () => void;
  onSaved: (customer: Customer) => void | Promise<void>;
}) {
  const t = useTermT();
  const [edit, setEdit] = useState<CustomerDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await apiRequest<{ ok?: boolean; error?: string; customer: Customer }>(
      `${API}/organizations/${orgId}/customers${edit.id ? `/${edit.id}` : ''}`,
      { method: edit.id ? 'PUT' : 'POST', body: edit, headers: await authHeaders() },
    );
    setBusy(false);
    if (!r.ok) { setError(customerErrorText(t, r.error)); return; }
    await onSaved(r.data.customer);
  }

  const field = (k: keyof CustomerDraft, label: string, extra: Record<string, unknown> = {}) => (
    <TextField size="small" label={label} value={edit[k] == null ? '' : String(edit[k])}
      onChange={(e) => setEdit((p) => ({ ...p, [k]: e.target.value }))} {...extra} />
  );
  const setContact = (i: number, patch: Partial<CustomerContact>) => setEdit((p) => ({ ...p, contacts: p.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{edit.id ? t('customers.edit') : t('customers.add')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {field('name', t('customers.name'), { required: true, autoFocus: true, inputProps: { maxLength: 70 } })}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '3fr 1fr' }}>
          {field('street', t('customers.street'))}
          {field('houseNumber', t('customers.houseNumber'))}
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 2fr 1fr' }}>
          {field('zip', t('customers.zip'))}
          {field('city', t('customers.city'))}
          {field('country', t('customers.country'), { inputProps: { maxLength: 2 } })}
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
          {field('email', t('customers.email'))}
          {field('phone', t('customers.phone'))}
        </Box>
        <TextField select size="small" label={t('customers.language')} value={edit.language} sx={{ maxWidth: 260 }}
          onChange={(e) => setEdit((p) => ({ ...p, language: e.target.value }))}>
          {CUSTOMER_LANGUAGES.map((l) => <MenuItem key={l} value={l}>{t(`customers.language.${l}`)}</MenuItem>)}
        </TextField>

        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="subtitle2">{t('customers.contacts')}</Typography>
          {edit.contacts.length === 0 && <Typography variant="body2" color="text.secondary">{t('customers.noContacts')}</Typography>}
          {edit.contacts.map((c, i) => (
            <Box key={c.id ?? `new-${i}`} sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1.3fr 1fr 1.3fr 1fr auto' }, alignItems: 'center' }}>
              <TextField size="small" label={t('customers.contactName')} value={c.name} required onChange={(e) => setContact(i, { name: e.target.value })} />
              <TextField size="small" label={t('customers.contactRole')} value={c.role ?? ''} onChange={(e) => setContact(i, { role: e.target.value })} />
              <TextField size="small" label={t('customers.email')} value={c.email ?? ''} onChange={(e) => setContact(i, { email: e.target.value })} />
              <TextField size="small" label={t('customers.phone')} value={c.phone ?? ''} onChange={(e) => setContact(i, { phone: e.target.value })} />
              <Tooltip title={t('customers.removeContact')}>
                <IconButton size="small" aria-label={t('customers.removeContact')} onClick={() => setEdit((p) => ({ ...p, contacts: p.contacts.filter((_, j) => j !== i) }))}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
          <Box>
            <Button size="small" onClick={() => setEdit((p) => ({ ...p, contacts: [...p.contacts, { id: null, name: '', role: null, email: null, phone: null }] }))}>
              {t('customers.addContact')}
            </Button>
          </Box>
        </Box>

        <FormControlLabel control={<Checkbox checked={edit.active} onChange={(e) => setEdit((p) => ({ ...p, active: e.target.checked }))} />} label={t('customers.active')} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !edit.name.trim() || edit.contacts.some((c) => !c.name.trim())}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** The organization's customers (for whoever may see or pick them), and whether the caller may edit them. */
export async function loadCustomers(orgId: string, authHeaders: () => Promise<Record<string, string>>):
  Promise<{ ok: true; customers: Customer[]; editable: boolean } | { ok: false; error: string }> {
  const r = await apiRequest<{ customers?: Customer[]; editable?: boolean }>(`${API}/organizations/${orgId}/customers`, { headers: await authHeaders() });
  return r.ok ? { ok: true, customers: r.data.customers ?? [], editable: r.data.editable === true } : r;
}

