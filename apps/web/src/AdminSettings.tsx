import { useEffect, useRef, useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Radio,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { LOCALES, useI18n, useT, type Locale } from './i18n';
import RolesPermissions from './RolesPermissions';
import { PROPERTIES_LIST, attributeTextValid, attributeValue, keepLabels, propertiesOf, withAttribute, type StaticAttribute } from '@worktime3/shared/staticData';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { AddIcon, BusinessIcon, ContentCopyIcon, DeleteIcon, EditIcon, PublicIcon, SearchIcon, TuneIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const MAX_PREVIEW_VALUES = 15;


interface StaticDataRow {
  id: string;
  organization_id: string | null;
  /** Default lists: the keys operators added (the others came from migrations, 103). */
  operator_keys?: string[];
  entity: string;
  entity_uuid: string | null;
  enum_name: string;
  values: Record<string, unknown>;
  translation: Record<string, Record<string, string>>;
}

interface KV {
  rowId: number;
  key: string;
  label: string;
  /** Set when the value is an attribute object (e.g. absence types: `{"approval": false}`) instead of a label. */
  attrs: Record<string, unknown> | null;
  /** Default lists (operators): a value from a migration, which stays as it is. */
  builtIn?: boolean;
}

type Attributes = Record<string, unknown>;

function isAttributes(value: unknown): value is Attributes {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}


/** `attributeRow`: every value is an attribute object; otherwise each value is its label. */
function kvListToValues(list: KV[], attributeRow: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, label, attrs } of list) {
    if (key.trim()) out[key.trim()] = attributeRow ? (attrs ?? {}) : label;
  }
  return out;
}

function rowKey(entity: string, enumName: string): string {
  return `${entity}\0${enumName}`;
}

interface AdminSettingsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  /**
   * Which page: static data (`#/admin`) or roles & permissions (`#/admin/roles`, its own navbar
   * entry under Admin settings, shown only with `section.admin.roles`).
   */
  tab: 'staticData' | 'roles';
}

export default function AdminSettings({ orgId, authHeaders, tab }: AdminSettingsProps) {
  return tab === 'roles' ? (
    <RolesPermissions orgId={orgId} authHeaders={authHeaders} />
  ) : (
    <StaticDataSettings orgId={orgId} authHeaders={authHeaders} />
  );
}

/**
 * The static data editor: an organization's lists (Admin settings), or with `operator` the default lists every
 * organization starts from (Super Admin -> Default lists, `operator/static-data`): operators add values and lists and
 * change translations, while the values migrations put there stay as they are.
 */
export function StaticDataSettings({ orgId, authHeaders, operator = false }: Omit<AdminSettingsProps, 'tab'> & { operator?: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const base = operator ? `${API}/operator/static-data` : `${API}/organizations/${orgId}/static-data`;
  /**
   * The properties of a list's values, as the list static_data/properties describes them (`@worktime3/shared/staticData`:
   * absence and request types, a plugin's lists, the description itself); such a list's labels live in the translations.
   */
  const propertiesFor = (entity: string, name: string) => propertiesOf(enums, entity, name, locale);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const nextRowId = useRef(1);

  const [enums, setEnums] = useState<StaticDataRow[]>([]);
  const [enumDialogOpen, setEnumDialogOpen] = useState(false);
  const [editingEnum, setEditingEnum] = useState<StaticDataRow | null>(null);
  const [enumEntity, setEnumEntity] = useState('');
  const [enumName, setEnumName] = useState('');
  const [deletingEnum, setDeletingEnum] = useState<StaticDataRow | null>(null);
  const [enumKvList, setEnumKvList] = useState<KV[]>([{ rowId: 0, key: '', label: '', attrs: null }]);
  const [enumTranslations, setEnumTranslations] = useState<Record<string, Record<string, string>>>({});
  const [translationLocale, setTranslationLocale] = useState<Locale>('de');
  const [kvFilter, setKvFilter] = useState('');
  // Values column: one line per list (the rest on hover) unless "show all values" is on; remembered in this browser.
  const [showAllValues, setShowAllValues] = useState(() => {
    try { return localStorage.getItem('apensum.staticData.showAll') === '1'; } catch { return false; }
  });
  const toggleShowAll = (on: boolean) => {
    setShowAllValues(on);
    try { localStorage.setItem('apensum.staticData.showAll', on ? '1' : '0'); } catch { /* not remembered */ }
  };
  const declaredAttributes = propertiesFor(enumEntity, enumName);
  const attributeRow = !!declaredAttributes || enumKvList.some((kv) => kv.attrs !== null);
  const invalidAttribute = !!declaredAttributes && enumKvList.some((kv) =>
    declaredAttributes.some((a) => a.type === 'text' && !attributeTextValid(a, String(attributeValue(kv.attrs, a)))));

  function makeKv(key = '', value: unknown = '', attributeRow = false): KV {
    nextRowId.current += 1;
    if (isAttributes(value)) return { rowId: nextRowId.current, key, label: '', attrs: value };
    return { rowId: nextRowId.current, key, label: value == null ? '' : String(value), attrs: attributeRow ? {} : null };
  }

  async function reloadEnums() {
    try {
      const headers = await authHeaders();
      const data = await (await fetch(base, { headers })).json();
      if (Array.isArray(data)) setEnums(data);
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setLoading(true);
    void reloadEnums().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function openCreateEnum() {
    setEditingEnum(null);
    setEnumEntity('');
    setEnumName('');
    setEnumKvList([makeKv()]);
    setEnumTranslations({});
    setKvFilter('');
    setDialogError(null);
    setEnumDialogOpen(true);
  }

  function openEditEnum(row: StaticDataRow) {
    setEditingEnum(row);
    setEnumEntity(row.entity);
    setEnumName(row.enum_name);
    const attributeRow = propertiesFor(row.entity, row.enum_name) !== null || Object.values(row.values).some(isAttributes);
    const operatorKeys = new Set(row.operator_keys ?? []);
    const list = Object.entries(row.values).map(([k, v]) => ({ ...makeKv(k, v, attributeRow), builtIn: operator && !operatorKeys.has(k) }));
    setEnumKvList(list.length > 0 ? list : [makeKv('', '', attributeRow)]);
    setEnumTranslations(row.translation ?? {});
    setKvFilter('');
    setDialogError(null);
    setEnumDialogOpen(true);
  }

  function openOverrideEnum(row: StaticDataRow) {
    setEditingEnum(null);
    setEnumEntity(row.entity);
    setEnumName(row.enum_name);
    const attributeRow = propertiesFor(row.entity, row.enum_name) !== null || Object.values(row.values).some(isAttributes);
    // The organization's copy of the property descriptions holds only its own: the global ones apply anyway.
    const ownOnly = row.entity === PROPERTIES_LIST.entity && row.enum_name === PROPERTIES_LIST.enumName;
    const list = ownOnly ? [] : Object.entries(row.values).map(([k, v]) => makeKv(k, v, attributeRow));
    setEnumKvList(list.length > 0 ? list : [makeKv('', '', attributeRow)]);
    setEnumTranslations(ownOnly ? {} : row.translation ?? {});
    setKvFilter('');
    setDialogError(null);
    setEnumDialogOpen(true);
  }

  function updateKv(rowId: number, field: 'key' | 'label', value: string) {
    setEnumKvList((prev) => prev.map((kv) => (kv.rowId === rowId ? { ...kv, [field]: value } : kv)));
  }

  /** A declared property of one value (a checkbox at its default and an empty field are not stored). */
  function updateAttribute(rowId: number, attribute: StaticAttribute, value: unknown) {
    setEnumKvList((prev) => {
      // One value of the list: switching it on for this value switches it off for the others.
      if (attribute.type === 'radio') {
        return prev.map((kv) => ({ ...kv, attrs: withAttribute(kv.attrs, attribute, value === true && kv.rowId === rowId) }));
      }
      return prev.map((kv) => (kv.rowId === rowId ? { ...kv, attrs: withAttribute(kv.attrs, attribute, value) } : kv));
    });
  }

  function addKvRow() {
    setKvFilter('');
    setEnumKvList((prev) => [...prev, makeKv('', '', attributeRow)]);
  }

  function removeKvRow(rowId: number) {
    setEnumKvList((prev) => prev.filter((kv) => kv.rowId !== rowId));
  }

  function updateTranslation(locale: Locale, key: string, label: string) {
    setEnumTranslations((prev) => {
      const forLocale = { ...(prev[locale] ?? {}) };
      if (label.trim()) forLocale[key] = label;
      else delete forLocale[key];
      const next = { ...prev, [locale]: forLocale };
      if (Object.keys(forLocale).length === 0) delete next[locale];
      return next;
    });
  }

  function apiErrorText(errCode: string | undefined, fallbackKey: string): string {
    if (errCode === 'forbidden') return t('staticdata.forbidden');
    if (errCode === 'duplicate-enum') return t('staticdata.duplicateEnum');
    if (errCode === 'built-in-value') return t('staticdata.builtInValue');
    if (errCode === 'built-in-list') return t('staticdata.builtInList');
    return t(fallbackKey);
  }

  async function handleSaveEnum() {
    if (!enumEntity.trim() || !enumName.trim()) return;
    if (invalidAttribute) {
      setDialogError(t('staticdata.invalidAttribute'));
      return;
    }
    setError(null);
    setSuccess(null);
    setDialogError(null);
    const values = kvListToValues(enumKvList, attributeRow);
    // A list of labels that got properties keeps its labels as English translations.
    const translation = attributeRow ? keepLabels(Object.fromEntries(enumKvList.map((kv) => [kv.key.trim(), kv.label])), enumTranslations) : enumTranslations;
    try {
      if (editingEnum) {
        const res = await fetch(`${base}/${editingEnum.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ enumName: enumName.trim(), values, translation }),
        });
        const data = await res.json();
        if (data.ok === false) {
          setDialogError(apiErrorText(data.error, 'staticdata.saveFailed'));
          return;
        }
        setSuccess(t('staticdata.updated', { name: enumName }));
      } else {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            entity: enumEntity.trim(),
            enumName: enumName.trim(),
            values,
            translation,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          setDialogError(apiErrorText(data.error, 'staticdata.createFailed'));
          return;
        }
        setSuccess(t('staticdata.created', { name: enumName }));
      }
      setEnumDialogOpen(false);
      await reloadEnums();
    } catch {
      setDialogError(t('staticdata.saveFailed'));
    }
  }

  async function handleDeleteEnum(row: StaticDataRow) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${base}/${row.id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (data.ok === false) {
        setError(apiErrorText(data.error, 'staticdata.deleteFailed'));
        return;
      }
      setEnums((prev) => prev.filter((e) => e.id !== row.id));
      setSuccess(t('staticdata.deleted'));
    } catch {
      setError(t('staticdata.deleteFailed'));
    }
  }

  const globalKeys = new Set(enums.filter((r) => r.organization_id === null).map((r) => rowKey(r.entity, r.enum_name)));
  const orgKeys = new Set(enums.filter((r) => r.organization_id !== null).map((r) => rowKey(r.entity, r.enum_name)));

  /** A table chip: `key: label`, or for attribute values the key plus what is set. */
  function valuePreview(row: StaticDataRow, key: string, value: unknown): string {
    if (!isAttributes(value)) return `${key}: ${value}`;
    const declared = propertiesFor(row.entity, row.enum_name);
    if (declared) {
      // The key plus what differs from the defaults: a checkbox by its label (crossed when switched off), the rest with their value.
      const set = declared.flatMap((a) => {
        if (!(a.key in value)) return [];
        const v = attributeValue(value, a);
        if (a.type === 'radio') return v ? [a.label] : [];
        if (a.type === 'checkbox') return [v ? a.label : `${a.label} ✗`];
        if (a.type === 'select') return [`${a.label}: ${a.options?.find((o) => o.value === v)?.label ?? String(v)}`];
        return [`${a.label}: ${v}`];
      });
      return [key, ...set].join(' · ');
    }
    return Object.keys(value).length > 0 ? `${key}: ${JSON.stringify(value)}` : key;
  }

  const normalizedKvFilter = kvFilter.trim().toLowerCase();
  const visibleKvList = normalizedKvFilter
    ? enumKvList.filter(
        (kv) =>
          kv.key.toLowerCase().includes(normalizedKvFilter) ||
          kv.label.toLowerCase().includes(normalizedKvFilter) ||
          (enumTranslations[translationLocale]?.[kv.key] ?? '').toLowerCase().includes(normalizedKvFilter),
      )
    : enumKvList;
  const visibleTranslationKvList = visibleKvList.filter((kv) => kv.key.trim());

  const isOverridingGlobal = globalKeys.has(rowKey(enumEntity.trim(), enumName.trim()));
  // The property descriptions: an organization's copy holds only its own, the built-in (global) ones are shown read-only.
  const isPropertiesList = !operator && enumEntity.trim() === PROPERTIES_LIST.entity && enumName.trim() === PROPERTIES_LIST.enumName;
  const builtInProperties = isPropertiesList ? enums.find((r) => !r.organization_id && r.entity === PROPERTIES_LIST.entity && r.enum_name === PROPERTIES_LIST.enumName) : undefined;

  // Lists that describe other lists (static_data/...: the properties, their types) come last, apart and tinted:
  // changing them changes how other lists are edited.
  const isMetaRow = (row: StaticDataRow) => row.entity === PROPERTIES_LIST.entity;
  const regularRows = enums.filter((r) => !isMetaRow(r));
  const metaRows = enums.filter(isMetaRow);

  /** A list's values as chips with the translated languages (the expanded cell, or the tooltip of the short one). */
  const valuesContent = (
    row: StaticDataRow,
    visibleEntries: [string, unknown][],
    hiddenCount: number,
    total: number,
    translatedLocales: { code: string }[],
    clickable: boolean,
  ) => (
    <>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {visibleEntries.map(([k, v]) => (
          <Chip key={k} label={valuePreview(row, k, v)} size="small" variant="outlined" />
        ))}
        {hiddenCount > 0 && (
          <Chip label={t('staticdata.moreValues', { count: hiddenCount })} size="small" onClick={clickable ? () => openEditEnum(row) : undefined} />
        )}
        {total === 0 && <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>}
      </Box>
      {translatedLocales.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {t('staticdata.translatedInto', { locales: translatedLocales.map((l) => l.code.toUpperCase()).join(', ') })}
        </Typography>
      )}
    </>
  );

  /** One list's row in the table. */
  const renderRow = (row: StaticDataRow) => {
                const isGlobal = row.organization_id === null;
                const key = rowKey(row.entity, row.enum_name);
                const hasOrgOverride = isGlobal && orgKeys.has(key);
                const overridesGlobal = !isGlobal && globalKeys.has(key);
                // Rows for all organizations are read-only; an org copies one and edits its copy. Operators edit them
                // (Default lists) and delete only a list without values from migrations.
                const canMutateRow = operator || !isGlobal;
                const canDeleteRow = !operator || Object.keys(row.values).every((k) => (row.operator_keys ?? []).includes(k));
                const translatedLocales = LOCALES.filter((l) => Object.keys(row.translation?.[l.code] ?? {}).length > 0);
                const entries = Object.entries(row.values);
                const visibleEntries = entries.slice(0, MAX_PREVIEW_VALUES);
                const hiddenCount = entries.length - visibleEntries.length;
                return (
                  <TableRow
                    key={row.id}
                    hover
                    sx={
                      isMetaRow(row)
                        ? { bgcolor: (theme) => alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.14 : 0.08) }
                        : isGlobal
                          ? { bgcolor: (theme) => alpha(theme.palette.secondary.main, theme.palette.mode === 'dark' ? 0.12 : 0.05) }
                          : undefined
                    }
                  >
                    <TableCell
                      sx={
                        isMetaRow(row)
                          ? { fontWeight: 600, borderLeft: 3, borderColor: 'warning.main' }
                          : isGlobal
                            ? { fontWeight: 600, borderLeft: 3, borderColor: 'secondary.main' }
                            : { fontWeight: 600 }
                      }
                    >
                      {row.entity}
                    </TableCell>
                    <TableCell>{row.enum_name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip
                        size="small"
                        icon={isGlobal ? <PublicIcon fontSize="small" /> : <BusinessIcon fontSize="small" />}
                        label={t(isGlobal ? 'staticdata.scope.global' : 'staticdata.scope.org')}
                        color={isGlobal ? 'secondary' : 'primary'}
                        variant={isGlobal ? 'filled' : 'outlined'}
                      />
                      {hasOrgOverride && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {t('staticdata.overriddenByOrg')}
                        </Typography>
                      )}
                      {overridesGlobal && (
                        <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.5 }}>
                          {t('staticdata.overridesGlobal')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 0, width: '55%' }}>
                      {showAllValues ? (
                        valuesContent(row, visibleEntries, hiddenCount, entries.length, translatedLocales, canMutateRow)
                      ) : (
                        // One line; the whole list on hover.
                        <Tooltip
                          placement="bottom-start"
                          slotProps={{ tooltip: { sx: { maxWidth: 640, bgcolor: 'background.paper', color: 'text.primary', boxShadow: 3, p: 1.5 } } }}
                          title={valuesContent(row, visibleEntries, hiddenCount, entries.length, translatedLocales, false)}
                        >
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap', overflow: 'hidden', alignItems: 'center', cursor: 'default' }}>
                            {entries.length === 0 && <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>}
                            {entries.slice(0, 8).map(([k, v]) => (
                              <Chip key={k} label={valuePreview(row, k, v)} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
                            ))}
                            {entries.length > 1 && (
                              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                                {t('staticdata.valueCount', { count: entries.length })}
                              </Typography>
                            )}
                          </Box>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {!operator && isGlobal && !hasOrgOverride && (
                        <Tooltip title={t('staticdata.overrideForOrg')}>
                          <IconButton size="small" color="primary" aria-label={t('staticdata.overrideForOrg')} onClick={() => openOverrideEnum(row)}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canMutateRow && (
                        <>
                          <Tooltip title={t('staticdata.edit')}>
                            <IconButton size="small" aria-label={t('staticdata.edit')} onClick={() => openEditEnum(row)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          {canDeleteRow && (
                            <Tooltip title={t('staticdata.delete')}>
                              <IconButton size="small" color="error" aria-label={t('staticdata.delete')} onClick={() => setDeletingEnum(row)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t(operator ? 'staticdata.defaultsTitle' : 'staticdata.title')}
        subtitle={operator ? t('staticdata.defaultsSubtitle', { count: enums.length }) : t('staticdata.description', { count: enums.length })}
        end={
          <>
            {!operator && <Chip label={t('staticdata.adminAccess')} color="secondary" size="small" variant="outlined" />}
            <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => openCreateEnum()}>
              {t('staticdata.newEnum').replace('+ ', '')}
            </Button>
          </>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <FormControlLabel
          sx={{ mb: 1 }}
          control={<Checkbox size="small" checked={showAllValues} onChange={(e) => toggleShowAll(e.target.checked)} />}
          label={t('staticdata.showAllValues')}
        />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('staticdata.entity')}</TableCell>
                <TableCell>{t('staticdata.enumName')}</TableCell>
                <TableCell>{t('staticdata.scope')}</TableCell>
                <TableCell>{t('staticdata.values')}</TableCell>
                <TableCell align="right">{t('staticdata.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {regularRows.map(renderRow)}
              {metaRows.length > 0 && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ bgcolor: (theme) => alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.18 : 0.12), borderLeft: 3, borderColor: 'warning.main' }}>
                    <Typography variant="subtitle2">{t('staticdata.metaTitle')}</Typography>
                    <Typography variant="caption" color="text.secondary">{t('staticdata.metaHint')}</Typography>
                  </TableCell>
                </TableRow>
              )}
              {metaRows.map(renderRow)}
              {enums.length === 0 && (
                <TableEmptyRow colSpan={5} icon={<TuneIcon fontSize="inherit" />} title={t('staticdata.noneYet')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog
        open={enumDialogOpen}
        onClose={() => setEnumDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveEnum();
          }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <span>{editingEnum ? t('staticdata.editEnum') : t('staticdata.newEnumTitle')}</span>
            {operator ? (
              <Chip size="small" icon={<PublicIcon fontSize="small" />} label={t('staticdata.scope.global')} color="secondary" />
            ) : (
              <Chip size="small" icon={<BusinessIcon fontSize="small" />} label={t('staticdata.scope.org')} color="primary" variant="outlined" />
            )}
          </DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {operator && (
              <Alert severity="info" variant="outlined">{t('staticdata.defaultsInfo')}</Alert>
            )}
            {enumEntity.trim() === PROPERTIES_LIST.entity && (
              <Alert severity="warning">{t('staticdata.metaHint')}</Alert>
            )}
            {!operator && isOverridingGlobal && (
              <Alert severity="info" variant="outlined">
                {t(isPropertiesList ? 'staticdata.propertiesOwnInfo' : 'staticdata.orgOverrideInfo')}
              </Alert>
            )}
            {dialogError && <Alert severity="error">{dialogError}</Alert>}
            <TextField
              label={t('staticdata.entity')}
              value={enumEntity}
              onChange={(e) => setEnumEntity(e.target.value)}
              size="small"
              required
              autoFocus
              disabled={!!editingEnum}
              placeholder={t('staticdata.entityPlaceholder')}
              helperText={t('staticdata.entityHelper')}
              sx={{ mt: 0.5 }}
            />
            <TextField
              label={t('staticdata.enumName')}
              value={enumName}
              onChange={(e) => setEnumName(e.target.value)}
              size="small"
              required
              placeholder={t('staticdata.enumNamePlaceholder')}
            />
            {builtInProperties && (
              <Box>
                <Typography variant="subtitle2">{t('staticdata.builtIn')}</Typography>
                <Box sx={{ display: 'grid', gap: 0.5, mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                  {Object.entries(builtInProperties.values).map(([key, value]) => (
                    <Box key={key} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{builtInProperties.translation?.[locale]?.[key] ?? builtInProperties.translation?.en?.[key] ?? key}</Typography>
                      <Typography variant="caption" color="text.secondary">{valuePreview(builtInProperties, key, value)}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
            <Typography variant="subtitle2">{t(builtInProperties ? 'staticdata.ownValues' : 'staticdata.values')}</Typography>
            {enumKvList.length > 15 && (
              <TextField
                size="small"
                placeholder={t('staticdata.filterPlaceholder')}
                value={kvFilter}
                onChange={(e) => setKvFilter(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
            {visibleKvList.map((kv) => (
              <Box key={kv.rowId} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: declaredAttributes && declaredAttributes.length > 2 ? 'wrap' : 'nowrap', pb: declaredAttributes && declaredAttributes.length > 2 ? 1 : 0, borderBottom: declaredAttributes && declaredAttributes.length > 2 ? 1 : 0, borderColor: 'divider' }}>
                <TextField label={t('staticdata.key')} value={kv.key} disabled={kv.builtIn} helperText={kv.builtIn ? t('staticdata.builtInValueShort') : undefined} onChange={(e) => updateKv(kv.rowId, 'key', e.target.value)} size="small" sx={{ flex: declaredAttributes && declaredAttributes.length > 2 ? '1 1 100%' : 1 }} />
                {declaredAttributes ? (
                  <Box sx={{ flex: 2, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                    {declaredAttributes.map((a) => {
                      const v = attributeValue(kv.attrs, a);
                      if (a.type === 'radio') {
                        return (
                          <FormControlLabel
                            key={a.key}
                            sx={{ m: 0, mr: 1 }}
                            control={<Radio size="small" checked={v === true} disabled={kv.builtIn} onClick={() => updateAttribute(kv.rowId, a, v !== true)} />}
                            label={a.label}
                          />
                        );
                      }
                      if (a.type === 'checkbox') {
                        return (
                          <FormControlLabel
                            key={a.key}
                            sx={{ m: 0, mr: 1 }}
                            control={<Checkbox size="small" checked={v === true} disabled={kv.builtIn} onChange={(e) => updateAttribute(kv.rowId, a, e.target.checked)} />}
                            label={a.label}
                          />
                        );
                      }
                      if (a.type === 'select') {
                        return (
                          <TextField key={a.key} select size="small" label={a.label} value={v} disabled={kv.builtIn} onChange={(e) => updateAttribute(kv.rowId, a, e.target.value)} sx={{ minWidth: 170 }}>
                            <MenuItem value=""><em>—</em></MenuItem>
                            {(a.options ?? []).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                          </TextField>
                        );
                      }
                      return (
                        <TextField
                          key={a.key}
                          size="small"
                          label={a.label}
                          value={v}
                          error={!attributeTextValid(a, String(v))}
                          disabled={kv.builtIn}
                          onChange={(e) => setEnumKvList((prev) => prev.map((x) => (x.rowId === kv.rowId ? { ...x, attrs: { ...(x.attrs ?? {}), [a.key]: e.target.value } } : x)))}
                          onBlur={(e) => updateAttribute(kv.rowId, a, e.target.value)}
                          sx={{ width: 140 }}
                        />
                      );
                    })}
                  </Box>
                ) : attributeRow ? (
                  <TextField label={t('staticdata.attributes')} value={JSON.stringify(kv.attrs ?? {})} size="small" disabled sx={{ flex: 1 }} />
                ) : (
                  <TextField label={t('staticdata.label')} value={kv.label} disabled={kv.builtIn} onChange={(e) => updateKv(kv.rowId, 'label', e.target.value)} size="small" sx={{ flex: 1 }} />
                )}
                <IconButton size="small" color="error" onClick={() => removeKvRow(kv.rowId)} disabled={enumKvList.length === 1 || kv.builtIn} aria-label={t('staticdata.removeValue')}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            {visibleKvList.length === 0 && (
              <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>
            )}
            <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={addKvRow} sx={{ justifySelf: 'start' }}>
              {t('staticdata.addValue').replace('+ ', '')}
            </Button>

            <Box sx={{ mt: 1, pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2">{t('staticdata.translations')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('staticdata.translationsHelper')}
              </Typography>
              <TextField
                select
                label={t('usermenu.language')}
                value={translationLocale}
                onChange={(e) => setTranslationLocale(e.target.value as Locale)}
                size="small"
                sx={{ minWidth: 160, mb: 1.5 }}
              >
                {LOCALES.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
              </TextField>
              <Box sx={{ display: 'grid', gap: 1 }}>
                {visibleTranslationKvList.map((kv) => (
                  <Box key={kv.rowId} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: 100, fontFamily: 'monospace' }}>{kv.key}</Typography>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder={kv.label || kv.key}
                      value={enumTranslations[translationLocale]?.[kv.key] ?? ''}
                      onChange={(e) => updateTranslation(translationLocale, kv.key, e.target.value)}
                    />
                  </Box>
                ))}
                {visibleTranslationKvList.length === 0 && (
                  <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>
                )}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEnumDialogOpen(false)}>{t('staticdata.cancel')}</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={!enumEntity.trim() || !enumName.trim()}
            >
              {t('staticdata.save')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={!!deletingEnum}
        title={t('staticdata.deleteTitle')}
        message={
          deletingEnum
            ? t('staticdata.deleteConfirm', {
                name: deletingEnum.enum_name,
                entity: deletingEnum.entity,
              })
            : ''
        }
        confirmLabel={t('staticdata.delete')}
        cancelLabel={t('staticdata.cancel')}
        onClose={() => setDeletingEnum(null)}
        onConfirm={() => {
          if (deletingEnum) return handleDeleteEnum(deletingEnum);
        }}
      />
    </Box>
  );
}
