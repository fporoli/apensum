import { Suspense, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { Button } from './Button';
import { useI18n } from './i18n';
import { currencyOptions, type CurrencyOption } from './currencyOptions';
import { PageHeader, TableEmptyRow } from './components';
import { setSetupDismissed, useSetupStatus } from './SetupChecklist';
import { SettingsIcon } from './icons';
import BrandingSettings from './BrandingSettings';
import WorkTimeSettings from './WorkTimeSettings';
import ModuleSettings from './ModuleSettings';
import { PLUGIN_ORG_SETTINGS } from './plugins';
import { AiSettingsPanel } from './AiSettingsPanel';
import { VaultSettingsPanel } from './VaultSettingsPanel';
import ExchangeRateSettings from './ExchangeRateSettings';
import { TwoFactorPolicyPanel } from './TwoFactor';
import { SettingsSection } from './SettingsSection';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface OrgDetails {
  id: string;
  slug: string;
  name: string;
  type: string;
  default_currency: string;
}

interface DomainItem {
  id: string;
  domain: string;
  verified_at: string | null;
  auto_join_enabled: boolean;
}

interface SsoConfig {
  protocol: 'saml2' | 'oidc';
  idp_entity_id: string;
  idp_sso_url: string;
  is_active: boolean;
}

interface OrganizationSettingsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  /** A module was switched on or off: the caller's permissions (and navbar) need reloading. */
  onModulesChanged?: () => void;
}

export default function OrganizationSettings({ orgId, authHeaders, onModulesChanged }: OrganizationSettingsProps) {
  const { t, locale } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [org, setOrg] = useState<OrgDetails | null>(null);
  // The setup checklist on Home, once hidden, can be brought back from here.
  const [setup, setSetup] = useSetupStatus(orgId, authHeaders);
  const [orgName, setOrgName] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('');
  // The org's currency list (static_data expenses/currency), edited in Admin settings.
  const [currencyRow, setCurrencyRow] = useState<{ values: Record<string, string>; translation: Record<string, Record<string, string>> } | null>(null);
  const [savedCurrency, setSavedCurrency] = useState('');
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newDomainAutoJoin, setNewDomainAutoJoin] = useState(false);
  const [sso, setSso] = useState<SsoConfig | null>(null);
  const [ssoProtocol, setSsoProtocol] = useState<'saml2' | 'oidc'>('saml2');
  const [ssoEntityId, setSsoEntityId] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');

  async function reloadOrg() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) {
        setOrg(data);
        setOrgName(data.name ?? '');
        setDefaultCurrency(data.default_currency ?? '');
        setSavedCurrency(data.default_currency ?? '');
      }
    } catch { /* offline fallback */ }
  }

  async function reloadCurrencies() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers: await authHeaders() });
      const data = await res.json();
      const row = Array.isArray(data) ? data.find((r: { enum_name?: string }) => r.enum_name === 'currency') : null;
      setCurrencyRow(row ? { values: row.values ?? {}, translation: row.translation ?? {} } : null);
    } catch { /* offline fallback */ }
  }

  async function reloadDomains() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/domains`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setDomains(data);
    } catch { /* offline fallback */ }
  }

  async function reloadSso() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/sso`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) {
        setSso(data);
        setSsoProtocol(data.protocol ?? 'saml2');
        setSsoEntityId(data.idp_entity_id ?? '');
        setSsoUrl(data.idp_sso_url ?? '');
      }
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([reloadOrg(), reloadDomains(), reloadSso(), reloadCurrencies()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);


  async function handleSaveOrg() {
    if (!orgName.trim() || !/^[A-Za-z]{3}$/.test(defaultCurrency)) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: orgName.trim(), defaultCurrency: defaultCurrency.toUpperCase() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('orgSettings.forbiddenProfile') : t('orgSettings.saveFailed'));
        return;
      }
      setSuccess(t('orgSettings.saved'));
      await reloadOrg();
    } catch {
      setError(t('orgSettings.saveFailed'));
    }
  }

  async function handleAddDomain() {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ domain, autoJoin: newDomainAutoJoin }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('orgSettings.forbiddenDomains') : t('orgSettings.addDomainFailed'));
        return;
      }
      setNewDomain('');
      setNewDomainAutoJoin(false);
      setSuccess(t('orgSettings.domainSaved', { domain }));
      await reloadDomains();
    } catch {
      setError(t('orgSettings.addDomainFailed'));
    }
  }

  async function handleSaveSso() {
    if (!ssoEntityId.trim() || !ssoUrl.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ protocol: ssoProtocol, idpEntityId: ssoEntityId.trim(), idpSsoUrl: ssoUrl.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('orgSettings.forbiddenSso') : t('orgSettings.ssoSaveFailed'));
        return;
      }
      setSuccess(t('orgSettings.ssoSaved'));
      await reloadSso();
    } catch {
      setError(t('orgSettings.ssoSaveFailed'));
    }
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('orgSettings.title')}
        subtitle={t('orgSettings.subtitle')}
        end={
          <>
            {setup?.dismissed && !setup.complete && (
              <Button
                size="small"
                onClick={async () => {
                  if (await setSetupDismissed(orgId, authHeaders, false)) {
                    setSetup((s) => (s ? { ...s, dismissed: false } : s));
                    setSuccess(t('setup.shownAgain'));
                  } else setError(t('setup.hideFailed'));
                }}
              >
                {t('setup.showAgain')}
              </Button>
            )}
            <Chip label={t('staticdata.adminAccess')} color="secondary" size="small" variant="outlined" />
          </>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <SettingsSection id="org.profile" title={t('orgSettings.profile')} defaultExpanded
        end={org && <Chip label={t('orgSettings.slugLabel', { slug: org.slug })} size="small" variant="outlined" />}>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSaveOrg();
        }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start', pt: 1 }}>
          <TextField label={t('orgSettings.name')} value={orgName} onChange={(e) => setOrgName(e.target.value)} size="small" sx={{ minWidth: 220 }} />
          <TextField
            select
            label={t('orgSettings.defaultCurrency')}
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            size="small"
            sx={{ minWidth: 220 }}
            helperText={t('orgSettings.defaultCurrencyHelper')}
          >
            {currencyOptions(currencyRow?.values ?? {}, currencyRow?.translation ?? {}, locale, savedCurrency).map((o: CurrencyOption) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" sx={{ height: 40 }} disabled={!orgName.trim() || !/^[A-Za-z]{3}$/.test(defaultCurrency)}>
            {t('common.save')}
          </Button>
        </Box>
      </Box>
      </SettingsSection>

      <SettingsSection id="org.modules" title={t('modules.title')} subtitle={t('modules.subtitle')}>
        <ModuleSettings orgId={orgId} authHeaders={authHeaders} onChanged={onModulesChanged} />
      </SettingsSection>

      <SettingsSection id="org.branding" title={t('branding.title')} subtitle={t('branding.subtitle')}>
        <BrandingSettings orgId={orgId} authHeaders={authHeaders} />
      </SettingsSection>

      <SettingsSection id="org.workTime" title={t('workTimeSettings.title')} subtitle={t('workTimeSettings.subtitle')}>
        <WorkTimeSettings orgId={orgId} authHeaders={authHeaders} />
      </SettingsSection>

      <SettingsSection id="org.exchangeRates" title={t('exchangeRates.title')} subtitle={t('exchangeRates.subtitle', { currency: savedCurrency || 'CHF' })}>
        <ExchangeRateSettings orgId={orgId} authHeaders={authHeaders} />
      </SettingsSection>

      {PLUGIN_ORG_SETTINGS.filter((section) => !section.within).map((section) => (
        <SettingsSection key={section.id} id={section.id} title={section.title(t)} subtitle={section.subtitle?.(t, { defaultCurrency: savedCurrency })}>
          <Suspense fallback={<LinearProgress />}>{section.render({ orgId, authHeaders })}</Suspense>
        </SettingsSection>
      ))}

      <SettingsSection id="org.ai" title={t('ai.settings.title')} subtitle={t('ai.settings.intro')}>
        <AiSettingsPanel orgId={orgId} authHeaders={authHeaders} />
        {PLUGIN_ORG_SETTINGS.filter((section) => section.within === 'org.ai').map((section) => (
          <Suspense key={section.id} fallback={<LinearProgress />}>{section.render({ orgId, authHeaders })}</Suspense>
        ))}
      </SettingsSection>

      <SettingsSection id="org.security" title={t('twoFactor.policy.title')} subtitle={t('twoFactor.policy.subtitle')}>
        <TwoFactorPolicyPanel orgId={orgId} authHeaders={authHeaders} />
      </SettingsSection>

      <SettingsSection id="org.vault" title={t('vault.settings.title')} subtitle={t('vault.settings.idleHint')}>
        <VaultSettingsPanel orgId={orgId} authHeaders={authHeaders} />
        {PLUGIN_ORG_SETTINGS.filter((section) => section.within === 'org.vault').map((section) => (
          <Suspense key={section.id} fallback={<LinearProgress />}>{section.render({ orgId, authHeaders })}</Suspense>
        ))}
      </SettingsSection>

      <SettingsSection id="org.domains" title={t('orgSettings.domains')}>
      <Box>
        <TableContainer sx={{ mb: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('orgSettings.domain')}</TableCell>
                <TableCell>{t('orgSettings.verified')}</TableCell>
                <TableCell>{t('orgSettings.autoJoin')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.domain}</TableCell>
                  <TableCell>{d.verified_at ? t('orgSettings.yes') : t('orgSettings.pending')}</TableCell>
                  <TableCell>{d.auto_join_enabled ? t('orgSettings.enabled') : t('orgSettings.disabled')}</TableCell>
                </TableRow>
              ))}
              {domains.length === 0 && (
                <TableEmptyRow colSpan={3} icon={<SettingsIcon fontSize="inherit" />} title={t('orgSettings.noDomains')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddDomain();
          }}
          sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <TextField label={t('orgSettings.addDomain')} value={newDomain} onChange={(e) => setNewDomain(e.target.value)} size="small" placeholder="example.com" />
          <FormControlLabel
            control={<Checkbox checked={newDomainAutoJoin} onChange={(e) => setNewDomainAutoJoin(e.target.checked)} size="small" />}
            label={t('orgSettings.autoJoin')}
          />
          <Button type="submit" variant="outlined" size="small" disabled={!newDomain.trim()}>{t('common.add')}</Button>
        </Box>
      </Box>
      </SettingsSection>

      <SettingsSection id="org.sso" title={t('orgSettings.sso')}
        end={sso && <Chip label={sso.is_active ? t('orgSettings.active') : t('orgSettings.inactive')} size="small" color={sso.is_active ? 'success' : 'default'} />}>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSaveSso();
        }}
      >
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', pt: 1 }}>
          <TextField select label={t('orgSettings.protocol')} value={ssoProtocol} onChange={(e) => setSsoProtocol(e.target.value as 'saml2' | 'oidc')} size="small" sx={{ minWidth: 120 }}>
            <MenuItem value="saml2">SAML 2.0</MenuItem>
            <MenuItem value="oidc">OIDC</MenuItem>
          </TextField>
          <TextField label={t('orgSettings.idpEntityId')} value={ssoEntityId} onChange={(e) => setSsoEntityId(e.target.value)} size="small" sx={{ minWidth: 220 }} />
          <TextField label={t('orgSettings.idpSsoUrl')} value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} />
          <Button type="submit" variant="outlined" size="small" disabled={!ssoEntityId.trim() || !ssoUrl.trim()}>{t('common.save')}</Button>
        </Box>
      </Box>
      </SettingsSection>
    </Box>
  );
}
