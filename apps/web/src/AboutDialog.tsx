import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Button } from './Button';
import type { Session } from './Login';
import { infoUrl } from './infoUrl';
import { useI18n } from './i18n';
import { swissLocale } from './localeFormat';
import { VISIBLE_SCROLLBAR } from './scrollbars';
import { InfoOutlinedIcon, ExtensionIcon, CopyrightIcon, MemoryIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Build {
  release: string | null;
  commit: string | null;
  date: string | null;
}

interface AboutInfo {
  build: Build;
  /** hostname, environment, nodeVersion and the last changeset: operators only (about.controller.ts). */
  server: {
    hostname?: string;
    environment?: string | null;
    nodeVersion?: string;
    timeZone: string;
    startedAt: string;
    time: string;
  };
  database: { status: string; lastChangeset?: string | null };
  /** Installed plugins: version and the commit they were built from. */
  plugins?: { id: string; caption: string | null; version: string | null; commit: string | null; date: string | null }[];
}

/** Where the core's source code is (AGPL-3.0: offered to everyone who uses it over the network). */
const SOURCE_URL = 'https://github.com/fporoli/apensum';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
/** The year the project began: the copyright reads from it to the current one. */
const FIRST_YEAR = 2026;

type AboutTab = 'general' | 'plugins' | 'about' | 'support';

/** Baked in at image build time (see apps/web/Dockerfile) — empty or unset on a local build. */
const WEB_BUILD: Build = {
  release: import.meta.env.VITE_BUILD_RELEASE || null,
  commit: import.meta.env.VITE_BUILD_COMMIT || null,
  date: import.meta.env.VITE_BUILD_DATE || null,
};

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  session: Session;
  authHeaders: () => Promise<Record<string, string>>;
  currentOrgId: string | null;
}

export default function AboutDialog({ open, onClose, session, authHeaders, currentOrgId }: AboutDialogProps) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AboutTab>('general');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInfo(null);
    setError(null);
    setTab('general');
    setCopied(false);
    (async () => {
      try {
        const res = await fetch(`${API}/about`, { headers: await authHeaders() });
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) setInfo(data);
        else setError(t('about.loadError', { error: data.error ?? data.message ?? res.status }));
      } catch {
        if (!cancelled) setError(t('about.unreachable'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per opening: authHeaders is a new function on every App render, and a notification
    // arriving must not blank a dialog someone is reading.
  }, [open]);

  const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(swissLocale(locale)) : '—');
  const releaseLabel = (build: Build) => build.release ?? t(build.commit ? 'about.untagged' : 'about.localBuild');
  const shortCommit = (build: Build) => build.commit?.slice(0, 7) ?? '—';

  const membership = session.memberships.find((m) => m.organizationId === currentOrgId);
  const databaseStatus = info ? t(`about.database.${info.database.status}`) : '—';

  // The server's name, versions and the last changeset come for operators only: the rows go when they do not.
  const operatorView = !info || info.server.hostname !== undefined;
  const serverRows: [string, string][] = [
    [t('about.apiUrl'), API],
    ...(operatorView ? ([
      [t('about.hostname'), info?.server.hostname ?? '—'],
      [t('about.environment'), info?.server.environment ?? '—'],
      [t('about.nodeVersion'), info?.server.nodeVersion ?? '—'],
    ] as [string, string][]) : []),
    [t('about.startedAt'), formatDate(info?.server.startedAt)],
    [t('about.serverTime'), formatDate(info?.server.time)],
    [t('about.timeZone'), info?.server.timeZone ?? '—'],
    [t('about.database'), databaseStatus],
    ...(operatorView ? ([[t('about.lastChangeset'), info?.database.lastChangeset ?? '—']] as [string, string][]) : []),
  ];

  const userRows: [string, string][] = [
    [t('about.name'), session.displayName],
    [t('about.email'), session.email],
    [t('about.userId'), session.userId],
    [t('about.organization'), membership?.name ?? '—'],
    [t('about.roles'), membership?.roles?.join(', ') || '—'],
    [t('about.signIn'), t(session.sso ? 'about.signInSso' : 'about.signInPassword')],
  ];

  const pluginName = (p: NonNullable<AboutInfo['plugins']>[number]) => (p.caption ? t(p.caption) : p.id);
  const year = new Date().getFullYear();
  // The source of exactly this version when the API knows its commit, else the repository.
  const sourceUrl = info?.build.commit ? `${SOURCE_URL}/tree/${info.build.commit}` : SOURCE_URL;

  /** Everything support asks for, as text (versions, plugins, server, user). */
  const supportText = () => [
    `${t('about.web')}: ${releaseLabel(WEB_BUILD)} ${shortCommit(WEB_BUILD)} ${formatDate(WEB_BUILD.date)}`,
    `${t('about.api')}: ${info ? `${releaseLabel(info.build)} ${shortCommit(info.build)} ${formatDate(info.build.date)}` : '—'}`,
    ...(info?.plugins ?? []).map((p) => `${pluginName(p)}: ${p.version ?? '—'} ${p.commit?.slice(0, 7) ?? '—'}`),
    ...serverRows.map(([label, value]) => `${label}: ${value}`),
    ...userRows.map(([label, value]) => `${label}: ${value}`),
  ].join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(supportText());
      setCopied(true);
    } catch {
      setError(t('about.copyFailed'));
    }
  };

  const rowsTable = (rows: [string, string][]) => (
    <Table size="small">
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell component="th" scope="row" sx={{ width: '40%' }}>{label}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    // One size for every tab (no jumping between them): title, tabs and buttons stay, the tab's content scrolls.
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { height: 'min(640px, calc(100% - 64px))' } } }}>
      <DialogTitle sx={{ pb: 0 }}>{t('about.title')}</DialogTitle>
      <Tabs value={tab} onChange={(_, v: AboutTab) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="general" icon={<InfoOutlinedIcon />} label={t('about.tab.general')} />
        <Tab value="plugins" icon={<ExtensionIcon />} label={t('about.plugins')} />
        <Tab value="about" icon={<CopyrightIcon />} label={t('about.tab.about')} />
        <Tab value="support" icon={<MemoryIcon />} label={t('about.tab.support')} />
      </Tabs>
      <DialogContent sx={{ display: 'grid', gap: 2, alignContent: 'start', overflowY: 'auto', pt: '16px !important', ...VISIBLE_SCROLLBAR }}>
        {error && <Alert severity="error">{error}</Alert>}

        {tab === 'general' && (
          <section>
            <Typography variant="subtitle2" gutterBottom>{t('about.software')}</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>{t('about.web')}</TableCell>
                  <TableCell>{t('about.api')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell component="th" scope="row">{t('about.release')}</TableCell>
                  <TableCell>{releaseLabel(WEB_BUILD)}</TableCell>
                  <TableCell>{info ? releaseLabel(info.build) : '—'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell component="th" scope="row">{t('about.commit')}</TableCell>
                  <TableCell>{shortCommit(WEB_BUILD)}</TableCell>
                  <TableCell>{info ? shortCommit(info.build) : '—'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell component="th" scope="row">{t('about.date')}</TableCell>
                  <TableCell>{formatDate(WEB_BUILD.date)}</TableCell>
                  <TableCell>{formatDate(info?.build.date)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>
        )}

        {tab === 'plugins' && (
          info?.plugins?.length ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>{t('about.version')}</TableCell>
                  <TableCell>{t('about.commit')}</TableCell>
                  <TableCell>{t('about.date')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {info.plugins.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell component="th" scope="row">{pluginName(p)}</TableCell>
                    <TableCell>{p.version ?? '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{p.commit?.slice(0, 7) ?? '—'}</TableCell>
                    <TableCell>{formatDate(p.date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography color="text.secondary">{info ? t('about.noPlugins') : '—'}</Typography>
          )
        )}

        {tab === 'about' && (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <Typography variant="h6">Apensum</Typography>
            <Typography>© {year > FIRST_YEAR ? `${FIRST_YEAR}–${year}` : FIRST_YEAR} Fabio Poroli</Typography>
            <Typography variant="subtitle2">{t('about.license')}</Typography>
            <Typography>GNU Affero General Public License v3.0 (AGPL-3.0-only)</Typography>
            <Typography variant="body2" color="text.secondary">{t('about.licenseText')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button component="a" href={LICENSE_URL} target="_blank" rel="noopener" variant="outlined">{t('about.licenseLink')}</Button>
              <Button component="a" href={sourceUrl} target="_blank" rel="noopener" variant="outlined">{t('about.sourceLink')}</Button>
            </Box>
          </Box>
        )}

        {tab === 'support' && (
          <>
            {[
              { title: t('about.server'), rows: serverRows },
              { title: t('about.user'), rows: userRows },
            ].map(({ title, rows }) => (
              <section key={title}>
                <Typography variant="subtitle2" gutterBottom>{title}</Typography>
                {rowsTable(rows)}
              </section>
            ))}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="outlined" onClick={() => void copy()}>{t('about.copy')}</Button>
              {copied && <Typography variant="body2" color="success.main">{t('about.copied')}</Typography>}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button component="a" href={infoUrl(locale)} target="_blank" rel="noopener">{t('app.moreInfo')}</Button>
        <Button onClick={onClose}>{t('about.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
