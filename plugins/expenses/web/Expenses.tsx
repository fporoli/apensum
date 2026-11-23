import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Checkbox,
  FormControlLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import { validateFields } from '@worktime3/shared/fields';
import { EXPENSE_FORM } from '../shared/form';
import { ALLOWANCE_CATEGORY, MILEAGE_CATEGORY, allowanceTypesOn, bookExpense, isRateCategory, isUnconverted, type ExchangeRate } from '../shared/booking';
import {
  useI18n, formatLocaleDate, formatLocaleNumber, formatMoney, parseLocaleNumber, ConfigFieldGroup, useGroupTitle, type FieldOption, FieldDesignScope, useFormTemplate, DESIGN_PANEL_WIDTH, FormDesignPanel, ConfirmDialog, PageHeader, TableEmptyRow, DeleteIcon, DownloadIcon, EditIcon, ExpandLessIcon, ExpandMoreIcon, ReceiptLongIcon, AttachmentView, DropZone, useAttachmentDraft, type Attachment, currencyOptions,
} from '@worktime3/web/plugin';
import type { ExpenseRow } from './expenseRows';
import { ReceiptCaptureButtons } from './receiptCapture';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Option {
  id: string;
  name: string;
}

interface StaticDataRow {
  enum_name: string;
  values: Record<string, string>;
  translation: Record<string, Record<string, string>>;
}

function subCategoryOptions(subCategories: Record<string, string>, category: string): Array<{ key: string; label: string }> {
  const prefix = `${category}$`;
  return Object.entries(subCategories)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, label]) => ({ key: k.slice(prefix.length), label }));
}

export function subCategoryLabel(subCategories: Record<string, string>, category: string, subCategory: string | null): string | null {
  if (!subCategory) return null;
  return subCategories[`${category}$${subCategory}`] ?? subCategory;
}

export type { ExpenseRow };

type ExpenseValues = Record<string, unknown>;

function emptyForm(defaultCurrency: string): ExpenseValues {
  return {
    expenseDate: dayjs().format('YYYY-MM-DD'),
    category: '',
    subCategory: '',
    projectId: '',
    subprojectId: '',
    value: 0,
    currency: defaultCurrency,
    comment: '',
    originalValue: null,
    originalCurrency: defaultCurrency,
    quantity: null,
  };
}

function toNumber(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The form from a stored expense. Older expenses have no receipt amount: their booked amount and
 * currency become the receipt amount, so saving one in another currency books it with today's
 * rates instead of reading foreign money as the reporting currency.
 */
function formFromRow(row: ExpenseRow): ExpenseValues {
  const hasOriginal = row.original_value !== null && row.original_value !== '';
  return {
    ...(row.data ?? {}),
    expenseDate: row.expense_date.slice(0, 10),
    category: row.category,
    subCategory: row.sub_category ?? '',
    projectId: row.project_id ?? '',
    subprojectId: row.subproject_id ?? '',
    value: toNumber(row.value) ?? 0,
    currency: row.currency,
    comment: row.comment ?? '',
    originalValue: isRateCategory(row.category) ? null : hasOriginal ? toNumber(row.original_value) : toNumber(row.value),
    originalCurrency: isRateCategory(row.category) ? '' : hasOriginal ? (row.original_currency ?? '') : row.currency,
    quantity: toNumber(row.quantity),
  };
}

function isRowLocked(row: ExpenseRow): boolean {
  return !!row.expense_report_id && row.expense_report_status !== 'in_preparation' && row.expense_report_status !== 'rejected';
}

const ERROR_MESSAGES: Record<string, (t: (key: string) => string) => string> = {
  'expense-mapped': (t) => t('expenses.mappedCannotDelete'),
  'forbidden': (t) => t('expenses.forbidden'),
};

/** Text for an expense API error: a known message, else `expenses.error.<code>`, else the generic one. */
function expenseErrorText(code: unknown, t: (key: string, vars?: Record<string, string>) => string): string {
  const c = typeof code === 'string' ? code : '';
  if (ERROR_MESSAGES[c]) return ERROR_MESSAGES[c](t);
  for (const key of [`expenses.error.${c}`, `cases.ai.error.${c}`]) if (c && t(key) !== key) return t(key);
  return t('expenses.saveFailed', { error: c || 'unknown error' });
}

interface ExpensesProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Expenses({ orgId, userId, authHeaders }: ExpensesProps) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<ExpenseRow[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, Option[]>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [subCategories, setSubCategories] = useState<Record<string, string>>({});
  const [categoryTranslations, setCategoryTranslations] = useState<Record<string, Record<string, string>>>({});
  const [subCategoryTranslations, setSubCategoryTranslations] = useState<Record<string, Record<string, string>>>({});
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [currencyTranslations, setCurrencyTranslations] = useState<Record<string, Record<string, string>>>({});
  const [defaultCurrency, setDefaultCurrency] = useState('');
  const [values, setValues] = useState<ExpenseValues>(emptyForm(''));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { form, savedForm, designer } = useFormTemplate(orgId, EXPENSE_FORM, authHeaders);
  const additionalTitle = useGroupTitle(form, 'additional');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdditional, setShowAdditional] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmRemoveDocId, setConfirmRemoveDocId] = useState<string | null>(null);
  // The receipt in the form: the stored one of the expense being edited, and a new file to upload on save.
  const [receipt, setReceipt] = useState<Attachment | null>(null);
  const onDraftError = useCallback((message: string) => setError(message), []);
  const draft = useAttachmentDraft(onDraftError, { max: 1 });
  const addDraftFiles = draft.add;
  const addReceiptFile = useCallback((file: File) => addDraftFiles([file]), [addDraftFiles]);
  // Booking: the org's exchange rates and rate per km (the API books with the same rules, packages/shared/src/expenses.ts).
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [mileageRates, setMileageRates] = useState<Record<string, unknown>>({});
  // Flat-rate allowances: the org's amounts {type: {validFrom: amount}} and the types' labels.
  const [allowanceRates, setAllowanceRates] = useState<Record<string, unknown>>({});
  const [allowanceLabels, setAllowanceLabels] = useState<Record<string, Record<string, string>>>({});
  // Receipt recognition (Azure, offered when the instance has it).
  const [scanAvailable, setScanAvailable] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  // Receipt in another currency (checkbox): then its currency is chosen and the booked amount may be overridden.
  const [foreign, setForeign] = useState(false);
  const [override, setOverride] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expenses?userId=${userId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data.entries)) setEntries(data.entries);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  async function reloadStaticData() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers: await authHeaders() });
      const data: StaticDataRow[] = await res.json();
      if (!Array.isArray(data)) return;
      const categoryRow = data.find((r) => r.enum_name === 'expense_category');
      const subCategoryRow = data.find((r) => r.enum_name === 'expense_subcategory');
      setCategories(categoryRow?.values ?? {});
      setCategoryTranslations(categoryRow?.translation ?? {});
      setSubCategories(subCategoryRow?.values ?? {});
      setSubCategoryTranslations(subCategoryRow?.translation ?? {});
      const currencyRow = data.find((r) => r.enum_name === 'currency');
      setCurrencies(currencyRow?.values ?? {});
      setCurrencyTranslations(currencyRow?.translation ?? {});
    } catch { /* offline fallback */ }
  }

  function categoryLabel(key: string): string {
    return categoryTranslations[locale]?.[key] ?? categories[key]
      ?? (key === MILEAGE_CATEGORY ? t('expenses.mileage') : key === ALLOWANCE_CATEGORY ? t('expenses.allowance') : key);
  }

  function allowanceLabel(type: string): string {
    return allowanceLabels[locale]?.[type] ?? allowanceLabels.en?.[type] ?? type;
  }

  function translatedSubCategoryLabel(category: string, subCategory: string | null): string | null {
    if (!subCategory) return null;
    if (category === ALLOWANCE_CATEGORY) return allowanceLabel(subCategory);
    const key = `${category}$${subCategory}`;
    return subCategoryTranslations[locale]?.[key] ?? subCategories[key] ?? subCategory;
  }

  async function loadDefaultCurrency() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      const currency = typeof data?.default_currency === 'string' ? data.default_currency : '';
      setDefaultCurrency(currency);
      if (currency) setValues((prev) => (prev.originalCurrency ? prev : { ...prev, originalCurrency: currency, currency }));
    } catch { /* offline fallback */ }
  }

  async function loadBooking() {
    try {
      const headers = await authHeaders();
      const [ratesRes, scanRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/exchange-rates`, { headers }),
        fetch(`${API}/organizations/${orgId}/expenses/scan-receipt`, { headers }),
      ]);
      const data = await ratesRes.json();
      setRates(Array.isArray(data?.rates) ? data.rates : []);
      setMileageRates(data?.mileageRates && typeof data.mileageRates === 'object' ? data.mileageRates : {});
      setAllowanceRates(data?.allowanceRates && typeof data.allowanceRates === 'object' ? data.allowanceRates : {});
      setAllowanceLabels(data?.allowanceLabels && typeof data.allowanceLabels === 'object' ? data.allowanceLabels : {});
      setScanAvailable((await scanRes.json())?.available === true);
    } catch { /* offline fallback */ }
  }

  /** Sends the attached receipt to the AI and fills the form with what it read; the person checks and saves. */
  async function scanReceipt() {
    const file = draft.files[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    setScanNotice(null);
    setScanning(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`${API}/organizations/${orgId}/expenses/scan-receipt`, { method: 'POST', headers: await authHeaders(), body });
      const data = await res.json();
      if (!data?.ok || !data.suggestion) {
        setError(expenseErrorText(data?.error, t));
        return;
      }
      const sg = data.suggestion as { expenseDate: string | null; originalValue: number | null; originalCurrency: string | null; merchant: string | null; category: string | null };
      setValues((prev) => {
        const next: ExpenseValues = { ...prev };
        if (sg.expenseDate) next.expenseDate = sg.expenseDate;
        if (sg.originalValue !== null) next.originalValue = sg.originalValue;
        if (sg.originalCurrency) next.originalCurrency = sg.originalCurrency;
        if (sg.category && sg.category !== prev.category) { next.category = sg.category; next.subCategory = ''; }
        if (sg.merchant && !String(prev.comment ?? '').trim()) next.comment = sg.merchant;
        if (isRateCategory(String(next.category ?? ''))) next.category = '';
        return next;
      });
      if (sg.originalCurrency) {
        setForeign(sg.originalCurrency !== defaultCurrency);
        setOverride(false);
      }
      setFieldErrors({});
      setScanNotice(t('expenses.scan.done'));
    } catch {
      setError(t('expenses.saveFailedOffline'));
    } finally {
      setScanning(false);
    }
  }

  async function reloadProjects() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/projects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch { /* offline fallback */ }
  }

  async function loadSubprojects(pid: string) {
    if (!pid) return;
    try {
      const res = await fetch(`${API}/projects/${pid}/subprojects`, { headers: await authHeaders() });
      const data = await res.json();
      setSubprojectsByProject((prev) => ({ ...prev, [pid]: Array.isArray(data) ? data : [] }));
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    void reload();
    void reloadStaticData();
    void reloadProjects();
    void loadDefaultCurrency();
    void loadBooking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  function updateField(key: string, value: unknown) {
    // Typing the booked amount of a foreign receipt overrides the rate (e.g. the card statement's amount).
    if (key === 'value') setOverride(true);
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'category') next.subCategory = '';
      if (key === 'projectId') next.subprojectId = '';
      return next;
    });
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
    if (key === 'projectId' && typeof value === 'string' && value) void loadSubprojects(value);
  }

  function showFieldErrors(list: { field: string; rule: string }[]) {
    setFieldErrors(Object.fromEntries(list.map((e) => [e.field, e.rule])));
    if (list.some((e) => form.fields.find((f) => f.key === e.field)?.group === 'additional')) setShowAdditional(true);
    setError(t('home.fixFieldErrors'));
  }

  function resetForm() {
    setEditingId(null);
    setReceipt(null);
    draft.clear();
    setValues(emptyForm(String(values.currency ?? '')));
    setFieldErrors({});
    setShowAdditional(false);
    setScanNotice(null);
    setForeign(false);
    setOverride(false);
  }

  /** Foreign currency on/off: off books the receipt in the reporting currency again. */
  function toggleForeign(on: boolean) {
    setForeign(on);
    setOverride(false);
    setValues((prev) => ({
      ...prev,
      originalCurrency: on ? (prev.originalCurrency && prev.originalCurrency !== defaultCurrency ? prev.originalCurrency : '') : defaultCurrency,
    }));
  }

  async function save() {
    setError(null);
    setSuccess(null);
    const checked = validateFields(savedForm, values);
    // Same rule as the API: the receipt amount (or the km) is what the booked amount comes from.
    if (computed && !hasBasis) checked.errors.push({ field: rated ? 'quantity' : 'originalValue', rule: 'required' });
    if (allowance && !values.subCategory) checked.errors.push({ field: 'subCategory', rule: 'required' });
    if (foreignReceipt && !values.originalCurrency) checked.errors.push({ field: 'originalCurrency', rule: 'required' });
    if (checked.errors.length > 0) {
      showFieldErrors(checked.errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await fetch(editingId ? `${API}/expenses/${editingId}` : `${API}/organizations/${orgId}/expenses`, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ ...checked.values, valueOverride: foreign && override }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.error === 'invalid-field' && Array.isArray(data.fields)) showFieldErrors(data.fields);
        else setError(expenseErrorText(data.error, t));
        return;
      }
      const savedId: string = editingId ?? data.id;
      const file = draft.files[0];
      if (file && savedId && !(await uploadPayslip(savedId, file, false))) {
        // The expense is saved; keep the form so the receipt can be attached again.
        setEditingId(savedId);
        await reload();
        return;
      }
      resetForm();
      setSuccess(t('expenses.saved'));
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expenses/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(ERROR_MESSAGES[data.error]?.(t) ?? t('expenses.saveFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      if (editingId === id) resetForm();
      setSuccess(t('expenses.removed'));
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    }
  }

  /** Uploads a receipt; false (with the error shown) when it failed. */
  async function uploadPayslip(id: string, file: File, announce = true): Promise<boolean> {
    setError(null);
    if (announce) setSuccess(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { method: 'POST', headers: await authHeaders(), body });
      const data = await res.json();
      if (!data.ok) {
        setError(t('expenses.uploadFailed', { error: data.error ?? 'unknown error' }));
        return false;
      }
      if (announce) {
        setSuccess(t('expenses.uploadSuccess'));
        await reload();
      }
      return true;
    } catch {
      setError(t('expenses.uploadFailed', { error: 'offline' }));
      return false;
    }
  }

  async function removePayslip(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('expenses.removePayslipFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setSuccess(t('expenses.payslipRemoved'));
      if (editingId === id) setReceipt(null);
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    }
  }

  async function downloadPayslip(id: string) {
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { headers: await authHeaders() });
      const disposition = res.headers.get('content-disposition') ?? '';
      const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
      const fileName = encoded ? decodeURIComponent(encoded) : (/filename="([^"]+)"/.exec(disposition)?.[1] ?? 'payslip');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* offline fallback */ }
  }

  async function loadReceipt(id: string) {
    try {
      const res = await fetch(`${API}/expenses/${id}/document/meta`, { headers: await authHeaders() });
      const data = await res.json();
      setReceipt(data?.id ? { id: data.id, file_name: data.file_name, mime_type: data.mime_type, size_bytes: data.size_bytes } : null);
    } catch {
      setReceipt(null);
    }
  }

  function startEdit(row: ExpenseRow) {
    setEditingId(row.id);
    draft.clear();
    setReceipt(null);
    if (row.document_id) void loadReceipt(row.id);
    const next = formFromRow(row);
    setValues(next);
    // A foreign receipt whose stored amount differs from what today's rates give was overridden by hand: keep it.
    const isForeign = !isRateCategory(row.category) && !!next.originalCurrency && next.originalCurrency !== defaultCurrency;
    setForeign(isForeign);
    const recomputed = bookExpense({
      category: row.category, expenseDate: String(next.expenseDate), originalValue: typeof next.originalValue === 'number' ? next.originalValue : null,
      originalCurrency: String(next.originalCurrency ?? '') || null, value: null, quantity: null,
    }, defaultCurrency, rates, mileageRates);
    setOverride(isForeign && (!recomputed.ok || recomputed.booking.value !== Number(row.value)));
    setFieldErrors({});
    setShowAdditional(true);
    if (row.project_id) void loadSubprojects(row.project_id);
  }

  const category = String(values.category ?? '');
  const projectId = String(values.projectId ?? '');
  const subprojects = subprojectsByProject[projectId] ?? [];
  const options = useMemo<Record<string, FieldOption[]>>(
    () => ({
      // Mileage is offered by the form itself, after the org's own categories.
      // Flat-rate allowances only when the organization has set amounts (Organization settings).
      categories: [...Object.keys(categories).filter((key) => !isRateCategory(key)).map((key) => ({ value: key, label: categoryLabel(key) })),
        { value: MILEAGE_CATEGORY, label: t('expenses.mileage') },
        ...(Object.values(allowanceRates).some((r) => r && typeof r === 'object' && Object.keys(r).length > 0) ? [{ value: ALLOWANCE_CATEGORY, label: t('expenses.allowance') }] : [])],
      subCategories: subCategoryOptions(subCategories, category).map(({ key }) => ({ value: key, label: translatedSubCategoryLabel(category, key) ?? key })),
      projects: projects.map((p) => ({ value: p.id, label: p.name })),
      subprojects: subprojects.map((sp) => ({ value: sp.id, label: sp.name })),
      currencies: currencyOptions(currencies, currencyTranslations, locale, defaultCurrency, [String(values.currency ?? ''), String(values.originalCurrency ?? '')]),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, subCategories, categoryTranslations, subCategoryTranslations, projects, subprojects, category, locale, currencies, currencyTranslations, defaultCurrency, values.currency, values.originalCurrency, allowanceRates],
  );
  const mileage = category === MILEAGE_CATEGORY;
  const allowance = category === ALLOWANCE_CATEGORY;
  // Worked out from a rate (km, or a count of allowances), without a receipt amount.
  const rated = mileage || allowance;
  const allowanceTypes = allowance ? allowanceTypesOn(allowanceRates, String(values.expenseDate ?? '')) : [];
  const originalValue = typeof values.originalValue === 'number' ? values.originalValue : null;
  // The booked amount as the API will work it out (receipt x rate in force, km x rate per km, or as entered).
  const booking = useMemo(() => bookExpense({
    category,
    expenseDate: String(values.expenseDate ?? ''),
    originalValue: rated ? null : originalValue,
    originalCurrency: rated ? null : String(values.originalCurrency ?? '') || null,
    value: typeof values.value === 'number' ? values.value : null,
    quantity: typeof values.quantity === 'number' ? values.quantity : null,
    subCategory: String(values.subCategory ?? '') || null,
    valueOverride: foreign && override,
  }, defaultCurrency, rates, mileageRates, allowanceRates), [category, rated, originalValue, values.expenseDate, values.originalCurrency, values.value, values.quantity, values.subCategory, defaultCurrency, rates, mileageRates, allowanceRates, foreign, override]);
  // With the receipt amount on the form (the default) the booked amount is always worked out; only a
  // template that hides the receipt amount lets people enter the booked amount directly.
  const receiptAmountShown = form.fields.some((f) => f.key === 'originalValue' && !f.hidden && !f.retired);
  const computed = rated || receiptAmountShown;
  const hasBasis = rated ? typeof values.quantity === 'number' : originalValue !== null;
  const foreignReceipt = foreign && !rated && receiptAmountShown;
  const shownValues = computed && !(foreignReceipt && override)
    ? { ...values, value: booking.ok && hasBasis ? booking.booking.value : null, currency: defaultCurrency || values.currency }
    : { ...values, currency: defaultCurrency || values.currency };
  // Fewer fields: sub-lists only when there is something to choose; receipt currency and booked amount only
  // for a foreign receipt (or when a template hides the receipt amount); mileage shows km instead.
  const hiddenKeys = [
    ...(rated || options.subCategories.length === 0 ? ['subCategory'] : []),
    ...(subprojects.length === 0 ? ['subprojectId'] : []),
    ...(rated ? ['originalValue', 'originalCurrency', 'value'] : receiptAmountShown && !foreign ? ['originalCurrency', 'value'] : []),
  ];
  const disabledKeys = [
    ...(defaultCurrency ? ['currency'] : []),
    ...(computed && !foreignReceipt ? ['value'] : []),
  ];
  const foreignBox = !rated && receiptAmountShown ? (
    <FormControlLabel
      sx={{ alignSelf: 'center', ml: 0 }}
      control={<Checkbox size="small" checked={foreign} onChange={(e) => toggleForeign(e.target.checked)} />}
      label={t('expenses.foreignCurrency')}
    />
  ) : null;
  const groupProps = { form, values: shownValues, editing: true, onChange: updateField, options, errors: fieldErrors, disabledKeys, hiddenKeys, after: { currency: foreignBox } };
  const kmText = typeof values.quantity === 'number' ? String(values.quantity) : '';
  const [kmInput, setKmInput] = useState('');
  useEffect(() => { setKmInput(kmText); }, [kmText, editingId]);
  const editingRow = editingId ? entries.find((e) => e.id === editingId) : undefined;
  // The same allowance on the same day once more (a hint: it may be meant, e.g. for two trips).
  const duplicateAllowance = allowance && !!values.subCategory && entries.some((e) =>
    e.id !== editingId && e.category === ALLOWANCE_CATEGORY && e.sub_category === values.subCategory && e.expense_date.slice(0, 10) === String(values.expenseDate ?? ''));
  const editingLocked = editingRow ? isRowLocked(editingRow) : false;
  // Newest first: the expense just added appears at the top.
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.id.localeCompare(a.id)),
    [entries],
  );

  return (
    <FieldDesignScope designer={designer}>
      {designer && <FormDesignPanel designer={designer} />}
      <Box sx={{ display: 'grid', gap: 2, mr: designer ? { md: `${DESIGN_PANEL_WIDTH}px` } : 0 }}>
        <PageHeader title={t('expenses.title')} />

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

        <Paper
          component="form"
          onPaste={(e) => draft.onPaste(e)}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          sx={{ p: 2 }}
        >
          <Typography variant="h6">{editingId ? t('expenses.editExpense') : t('expenses.logExpense')}</Typography>
          <Box sx={{ mt: 1.5 }}>
            <ConfigFieldGroup group="expense" {...groupProps} />
          </Box>
          {mileage && (
            <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField id="expense-km" size="small" label={t('expenses.km')} value={kmInput} sx={{ width: 140 }} inputProps={{ inputMode: 'decimal' }}
                error={!!fieldErrors.quantity}
                onChange={(e) => {
                  setKmInput(e.target.value);
                  const n = parseLocaleNumber(e.target.value, locale);
                  updateField('quantity', typeof n === 'number' && Number.isFinite(n) ? n : null);
                }} />
              {booking.ok && booking.booking.unitRate !== null && (
                <Typography variant="body2" color="text.secondary">
                  {t('expenses.mileageCalc', {
                    km: formatLocaleNumber(Number(values.quantity), locale),
                    rate: formatMoney(booking.booking.unitRate, locale),
                    value: formatMoney(booking.booking.value, locale),
                    currency: defaultCurrency,
                  })}
                </Typography>
              )}
            </Box>
          )}
          {allowance && (
            <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                select
                size="small"
                label={t('expenses.allowances.type')}
                value={allowanceTypes.includes(String(values.subCategory ?? '')) ? String(values.subCategory) : ''}
                onChange={(e) => updateField('subCategory', e.target.value)}
                error={!!fieldErrors.subCategory}
                sx={{ minWidth: 220 }}
              >
                {allowanceTypes.map((type) => <MenuItem key={type} value={type}>{allowanceLabel(type)}</MenuItem>)}
              </TextField>
              <TextField
                size="small"
                type="number"
                label={t('expenses.allowances.count')}
                value={typeof values.quantity === 'number' ? values.quantity : ''}
                onChange={(e) => updateField('quantity', e.target.value === '' ? null : Math.round(Number(e.target.value)))}
                error={!!fieldErrors.quantity}
                inputProps={{ min: 1, step: 1 }}
                sx={{ width: 110 }}
              />
              {booking.ok && booking.booking.unitRate !== null && (
                <Typography variant="body2" color="text.secondary">
                  {t('expenses.allowanceCalc', {
                    count: String(values.quantity),
                    type: allowanceLabel(String(values.subCategory)),
                    rate: formatMoney(booking.booking.unitRate, locale),
                    value: formatMoney(booking.booking.value, locale),
                    currency: defaultCurrency,
                  })}
                </Typography>
              )}
              {allowanceTypes.length === 0 && (
                <Typography variant="body2" color="warning.main">{t('expenses.allowances.noneOnDate')}</Typography>
              )}
            </Box>
          )}
          {allowance && duplicateAllowance && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>{t('expenses.allowances.duplicate')}</Alert>
          )}
          {foreignReceipt && booking.ok && booking.booking.exchangeRate !== null && (
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                {t(override ? 'expenses.conversionManual' : 'expenses.conversion', {
                  original: `${formatMoney(originalValue ?? 0, locale)} ${String(values.originalCurrency ?? '')}`,
                  rate: formatLocaleNumber(booking.booking.exchangeRate, locale),
                  value: `${formatMoney(booking.booking.value, locale)} ${defaultCurrency}`,
                })}
              </Typography>
              {override && <Button size="small" onClick={() => setOverride(false)}>{t('expenses.useRate')}</Button>}
            </Box>
          )}
          {!booking.ok && (booking.error === 'exchange-rate-missing' || booking.error === 'mileage-rate-missing') && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {t(`expenses.error.${booking.error}`, { currency: String(values.originalCurrency ?? ''), date: formatLocaleDate(String(values.expenseDate ?? ''), locale) })}
              {booking.error === 'exchange-rate-missing' && ` ${t('expenses.orEnterBooked', { currency: defaultCurrency })}`}
            </Alert>
          )}

          <Button
            type="button"
            size="small"
            onClick={() => setShowAdditional((v) => !v)}
            aria-expanded={showAdditional}
            startIcon={showAdditional || designer ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            sx={{ mt: 1.5, px: 0 }}
          >
            {additionalTitle}
          </Button>
          <Collapse in={showAdditional || !!designer}>
            <Box sx={{ mt: 1.5 }}>
              <ConfigFieldGroup group="additional" {...groupProps} />
            </Box>
          </Collapse>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{t('expenses.receipt')}</Typography>
            <DropZone dragging={draft.dragging} dropProps={draft.dropProps}>
              <Box sx={{ display: 'grid', gap: 1, p: 1.25, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1 }}>
                {receipt && draft.files.length === 0 && editingId && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <AttachmentView attachment={receipt} url={`${API}/expenses/${editingId}/document`} authHeaders={authHeaders} />
                    {!editingLocked && (
                      <Tooltip title={t('expenses.removePayslip')}>
                        <IconButton size="small" color="error" aria-label={t('expenses.removePayslip')} onClick={() => setConfirmRemoveDocId(editingId)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                )}
                {draft.chips}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ display: 'flex', flexShrink: 0 }}>
                    {draft.button}
                    <ReceiptCaptureButtons orgId={orgId} authHeaders={authHeaders} onFile={addReceiptFile} onError={onDraftError} />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {receipt && editingId ? t('expenses.receipt.replaceHint') : t('expenses.receipt.hint')}
                  </Typography>
                </Box>
                {scanAvailable && draft.files.length > 0 && !mileage && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" disabled={scanning || saving} onClick={() => void scanReceipt()}>
                      {scanning ? t('expenses.scan.running') : t('expenses.scan.button')}
                    </Button>
                    <Typography variant="caption" color="text.secondary">{t('expenses.scan.hint')}</Typography>
                  </Box>
                )}
                {scanNotice && <Alert severity="info" onClose={() => setScanNotice(null)}>{scanNotice}</Alert>}
              </Box>
            </DropZone>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button type="submit" variant="contained" disabled={saving}>{editingId ? t('expenses.save') : t('time.add')}</Button>
            {editingId && <Button onClick={resetForm} disabled={saving}>{t('expenses.cancel')}</Button>}
          </Box>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('expenses.entries')}</Typography>
          {loading && <LinearProgress sx={{ mb: 1 }} />}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('time.date')}</TableCell>
                  <TableCell>{t('expenses.category')}</TableCell>
                  <TableCell align="right">{t('expenses.value')}</TableCell>
                  <TableCell>{t('time.project')}</TableCell>
                  <TableCell>{t('time.subproject')}</TableCell>
                  <TableCell>{t('expenses.report')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedEntries.map((row) => {
                  const locked = isRowLocked(row);
                  const numVal = Number(row.value);
                  const formattedVal = Number.isFinite(numVal) ? formatMoney(numVal, locale) : row.value;
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>{formatLocaleDate(row.expense_date, locale)}</TableCell>
                      <TableCell>{categoryLabel(row.category)}{row.sub_category ? ` / ${translatedSubCategoryLabel(row.category, row.sub_category) ?? row.sub_category}` : ''}</TableCell>
                      <TableCell align="right">
                        {formattedVal} {row.currency}
                        {row.original_value && row.original_currency && row.original_currency !== row.currency && (
                          <Typography variant="caption" color="text.secondary" component="div">
                            {formatMoney(Number(row.original_value), locale)} {row.original_currency}
                          </Typography>
                        )}
                        {row.category === MILEAGE_CATEGORY && row.quantity && (
                          <Typography variant="caption" color="text.secondary" component="div">
                            {formatLocaleNumber(Number(row.quantity), locale)} km
                          </Typography>
                        )}
                        {row.category === ALLOWANCE_CATEGORY && row.quantity && (
                          <Typography variant="caption" color="text.secondary" component="div">
                            {t('expenses.allowances.times', { count: formatLocaleNumber(Number(row.quantity), locale) })}
                          </Typography>
                        )}
                        {isUnconverted(row, defaultCurrency) && (
                          <Tooltip title={t('expenses.unconvertedHint')}>
                            <Chip size="small" color="warning" variant="outlined" label={t('expenses.unconverted')} sx={{ ml: 0.5 }} />
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>{row.project_name ?? '—'}</TableCell>
                      <TableCell>{row.subproject_name ?? '—'}</TableCell>
                      <TableCell>
                        {row.expense_report_id ? (
                          <Chip
                            size="small"
                            color={row.expense_report_status === 'approved' || row.expense_report_status === 'finished' ? 'success' : row.expense_report_status === 'rejected' ? 'error' : 'default'}
                            label={t('expenses.inReport', {
                              status: row.expense_report_status ? t(`expenseReports.status.${row.expense_report_status}`) : '',
                            })}
                          />
                        ) : (
                          <Chip size="small" variant="outlined" label={t('expenses.unmapped')} />
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {row.document_id && (
                          <Tooltip title={t('expenses.download')}>
                            <IconButton size="small" aria-label={t('expenses.payslip')} onClick={() => void downloadPayslip(row.id)}>
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title={locked ? t('expenses.lockedTooltip') : t('time.edit')}>
                          <span>
                            <IconButton size="small" disabled={locked} aria-label={t('time.edit')} onClick={() => startEdit(row)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={row.expense_report_id ? t('expenses.mappedCannotDelete') : t('time.remove')}>
                          <span>
                            <IconButton size="small" color="error" disabled={!!row.expense_report_id} aria-label={t('time.remove')} onClick={() => setConfirmRemoveId(row.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {entries.length === 0 && (
                  <TableEmptyRow colSpan={7} icon={<ReceiptLongIcon fontSize="inherit" />} title={t('expenses.noEntries')} />
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      <ConfirmDialog
        open={!!confirmRemoveId}
        title={t('expenses.deleteTitle')}
        message={t('expenses.deleteConfirm')}
        confirmLabel={t('time.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmRemoveId(null)}
        onConfirm={() => {
          if (confirmRemoveId) return remove(confirmRemoveId);
        }}
      />

      <ConfirmDialog
        open={!!confirmRemoveDocId}
        title={t('expenses.removePayslip')}
        message={t('expenses.removePayslipConfirm')}
        confirmLabel={t('common.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmRemoveDocId(null)}
        onConfirm={() => {
          if (confirmRemoveDocId) return removePayslip(confirmRemoveDocId);
        }}
      />
    </FieldDesignScope>
  );
}
