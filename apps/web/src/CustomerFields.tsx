import { useEffect, useState } from 'react';
import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { Button } from './Button';
import { CustomerDialog, EMPTY_CUSTOMER, loadCustomers, type Customer } from './CustomerDialog';
import { useTermT } from './customerTerm';

/** A project's or subproject's customer fields, as Management.tsx sends them (projects.controller.ts). */
export interface CustomerFieldsValue { customerId: string | null; customerReference: string; customerContactId: string | null }

export const NO_CUSTOMER: CustomerFieldsValue = { customerId: null, customerReference: '', customerContactId: null };

/**
 * In the project dialog: the project's customer ("New…" adds one, for whoever edits customers), the customer's
 * reference and the contact it goes to ("z. H."). For a subproject (`projectCustomerId`: its project's customer) only
 * its own reference and contact; empty = the project's. Shown only to whoever may see customers.
 */
export function CustomerFields({ orgId, authHeaders, value, onChange, projectCustomerId }: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  value: CustomerFieldsValue;
  onChange: (next: CustomerFieldsValue) => void;
  /** Set for a subproject: its project's customer (its contacts are offered). */
  projectCustomerId?: string | null;
}) {
  const t = useTermT();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [editable, setEditable] = useState(false);
  const [adding, setAdding] = useState(false);
  const subproject = projectCustomerId !== undefined;

  useEffect(() => {
    let cancelled = false;
    void loadCustomers(orgId, authHeaders).then((r) => {
      if (cancelled || !r.ok) return;
      setCustomers(r.customers);
      setEditable(r.editable);
    });
    return () => { cancelled = true; };
  }, [orgId, authHeaders]);

  // Nobody to pick from and not allowed to add one: nothing to show.
  if (!customers || (!customers.length && !editable)) return null;
  const customerId = subproject ? projectCustomerId ?? null : value.customerId;
  const customer = customers.find((c) => c.id === customerId) ?? null;
  if (subproject && !customer) return null;

  return (
    <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
      <Typography variant="subtitle2">{subproject ? t('customers.subprojectSection') : t('customers.projectSection')}</Typography>
      {!subproject && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField select size="small" fullWidth label={t('customers.customer')} value={value.customerId ?? ''}
            onChange={(e) => onChange({ ...value, customerId: e.target.value || null, customerContactId: null })}>
            <MenuItem value="">{t('customers.none')}</MenuItem>
            {customers.filter((c) => c.active || c.id === value.customerId).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          {editable && <Button size="small" onClick={() => setAdding(true)}>{t('customers.new')}</Button>}
        </Box>
      )}
      {customer && (
        <>
          <TextField size="small" label={t('customers.reference')} value={value.customerReference} inputProps={{ maxLength: 70 }}
            helperText={subproject ? t('customers.subprojectHint') : t('customers.referenceHint')}
            onChange={(e) => onChange({ ...value, customerReference: e.target.value })} />
          <TextField select size="small" label={t('customers.attention')} value={value.customerContactId ?? ''}
            onChange={(e) => onChange({ ...value, customerContactId: e.target.value || null })}>
            <MenuItem value="">{subproject ? t('customers.asProject') : t('customers.noContact')}</MenuItem>
            {customer.contacts.map((k) => <MenuItem key={k.id ?? k.name} value={k.id ?? ''}>{k.name}{k.role ? ` (${k.role})` : ''}</MenuItem>)}
          </TextField>
        </>
      )}
      {adding && (
        <CustomerDialog orgId={orgId} authHeaders={authHeaders} initial={EMPTY_CUSTOMER} onClose={() => setAdding(false)}
          onSaved={(c) => {
            setCustomers((list) => [...(list ?? []), c].sort((a, b) => a.name.localeCompare(b.name)));
            onChange({ ...value, customerId: c.id, customerContactId: null });
            setAdding(false);
          }} />
      )}
    </Box>
  );
}
