import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  IconButton,
  MenuItem,
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
import { Button } from './Button';
import { MAX_AGE_STEPS, MAX_PROBATION_MONTHS, type VacationRule, type VacationSettings as Settings } from '@worktime3/shared/vacation';
import { useI18n } from './i18n';
import { formatLocaleDate, formatLocaleNumber, parseLocaleNumber } from './localeFormat';
import { AddIcon, DeleteIcon, EditIcon } from './icons';
import { SectionPaper } from './SettingsSection';
import { ConfirmDialog } from './components';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Draft {
  /** The rule being changed; null = a new one. */
  original: string | null;
  validFrom: string;
  base: string;
  management: string;
  steps: { age: string; days: string }[];
}

interface Props {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

/** Employees -> Vacation and probation: HR's rules with the date each applies from, and the probation months. */
export default function VacationSettings({ orgId, authHeaders }: Props) {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<VacationRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setDraft(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/vacation-settings`, { headers: await authHeaders() });
        const body = await res.json();
        if (cancelled) return;
        if (body?.ok) {
          setSettings(body.settings);
          setCanEdit(!!body.canEdit);
        } else setError(t('vacation.error.failed'));
      } catch {
        if (!cancelled) setError(t('common.cannotReachApi'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function save(next: Settings): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/vacation-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(next),
      });
      const body = await res.json();
      if (!body?.ok) {
        const key = `vacation.error.${body?.error}`;
        const text = t(key);
        setError(text === key ? t('vacation.error.failed') : text);
        return false;
      }
      setSettings(body.settings);
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return error ? <Alert severity="error">{error}</Alert> : null;

  const rules = settings.rules;
  const number = (n: number) => formatLocaleNumber(n, locale);
  const parsed = (text: string): number => {
    const n = parseLocaleNumber(text, locale);
    return typeof n === 'number' ? n : NaN;
  };
  const fromLabel = (r: VacationRule) => (r.validFrom === rules[0].validFrom ? t('vacation.fromBeginning') : formatLocaleDate(r.validFrom, locale));

  function edit(rule: VacationRule | null) {
    // A new rule starts next 1 January from the newest one, so nothing already counted moves.
    const r = rule ?? rules[rules.length - 1];
    setError(null);
    setDraft({
      original: rule?.validFrom ?? null,
      validFrom: rule?.validFrom ?? `${new Date().getFullYear() + 1}-01-01`,
      base: number(r.baseDays),
      management: r.managementDays === null ? '' : number(r.managementDays),
      steps: r.ageSteps.map((s) => ({ age: String(s.age), days: number(s.days) })),
    });
  }

  async function saveDraft() {
    if (!draft || !settings) return;
    const rule: VacationRule = {
      validFrom: draft.validFrom,
      baseDays: parsed(draft.base),
      managementDays: draft.management.trim() ? parsed(draft.management) : null,
      ageSteps: draft.steps.map((s) => ({ age: Number(s.age), days: parsed(s.days) })),
    };
    if (!Number.isFinite(rule.baseDays) || (rule.managementDays !== null && !Number.isFinite(rule.managementDays))) {
      setError(t('vacation.error.invalid-days'));
      return;
    }
    const next = [...rules.filter((r) => r.validFrom !== draft.original), rule];
    if (await save({ ...settings, rules: next })) setDraft(null);
  }

  const setStep = (index: number, patch: Partial<Draft['steps'][number]>) =>
    setDraft((d) => d && { ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  return (
    <SectionPaper title={t('vacation.title')} subtitle={t('vacation.subtitle')}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('vacation.validFrom')}</TableCell>
              <TableCell align="right">{t('vacation.base')}</TableCell>
              <TableCell align="right">{t('vacation.management')}</TableCell>
              <TableCell>{t('vacation.age')}</TableCell>
              {canEdit && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {[...rules].reverse().map((r) => (
              <TableRow key={r.validFrom}>
                <TableCell>{fromLabel(r)}</TableCell>
                <TableCell align="right">{number(r.baseDays)}</TableCell>
                <TableCell align="right">{r.managementDays === null ? '—' : number(r.managementDays)}</TableCell>
                <TableCell>{r.ageSteps.map((s) => t('vacation.ageStep', { age: String(s.age), days: number(s.days) })).join(', ') || '—'}</TableCell>
                {canEdit && (
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={t('common.edit')}>
                      <IconButton size="small" aria-label={t('common.edit')} disabled={busy} onClick={() => edit(r)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {rules.length > 1 && (
                      <Tooltip title={t('common.delete')}>
                        <IconButton size="small" aria-label={t('common.delete')} disabled={busy} onClick={() => setDeleting(r)}><DeleteIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {canEdit && !draft && (
        <Box>
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => edit(null)}>{t('vacation.add')}</Button>
        </Box>
      )}

      {draft && (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
          sx={{ display: 'grid', gap: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}
        >
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {draft.original !== rules[0].validFrom && (
              <TextField
                type="date" size="small" required label={t('vacation.validFrom')} value={draft.validFrom}
                onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
            <TextField
              size="small" required label={t('vacation.base')} value={draft.base}
              onChange={(e) => setDraft({ ...draft, base: e.target.value })}
              sx={{ width: 170 }}
            />
            <TextField
              size="small" label={t('vacation.management')} value={draft.management} helperText={t('vacation.managementHelp')}
              onChange={(e) => setDraft({ ...draft, management: e.target.value })}
              sx={{ width: 260 }}
            />
          </Box>
          {draft.steps.map((s, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" required label={t('vacation.fromAge')} value={s.age} onChange={(e) => setStep(i, { age: e.target.value })} sx={{ width: 120 }} />
              <TextField size="small" required label={t('vacation.extraDays')} value={s.days} onChange={(e) => setStep(i, { days: e.target.value })} sx={{ width: 170 }} />
              <IconButton size="small" aria-label={t('common.delete')} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          {draft.original !== null && draft.original <= new Date().toISOString().slice(0, 10) && (
            <Typography variant="caption" color="warning.main">{t('vacation.retroactive')}</Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {draft.steps.length < MAX_AGE_STEPS && (
              <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { age: '60', days: '5' }] })}>
                {t('vacation.addAgeStep')}
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
            <Button size="small" type="submit" variant="contained" disabled={busy}>{t('common.save')}</Button>
          </Box>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary">{t('vacation.legal')}</Typography>

      <TextField
        select size="small" label={t('vacation.probation')} value={settings.probationMonths} disabled={!canEdit || busy}
        helperText={t('vacation.probationHelp')}
        onChange={(e) => void save({ ...settings, probationMonths: Number(e.target.value) })}
        sx={{ maxWidth: 420 }}
      >
        {Array.from({ length: MAX_PROBATION_MONTHS + 1 }, (_, n) => (
          <MenuItem key={n} value={n}>{n === 0 ? t('vacation.noProbation') : t('vacation.months', { count: String(n) })}</MenuItem>
        ))}
      </TextField>

      <ConfirmDialog
        open={!!deleting}
        title={t('vacation.deleteTitle')}
        message={t('vacation.deleteMessage')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const rule = deleting;
          setDeleting(null);
          if (rule) await save({ ...settings, rules: rules.filter((r) => r !== rule) });
        }}
      />
    </SectionPaper>
  );
}
