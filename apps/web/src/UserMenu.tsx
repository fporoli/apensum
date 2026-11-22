import { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Menu,
  ListItemIcon,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import type { Session } from './Login';
import { LOCALES, useT, type Locale } from './i18n';
import AboutDialog from './AboutDialog';
import AvatarEditor from './AvatarEditor';
import { canShareScreen } from './ScreenShare';
import {
  ArrowDropDownIcon,
  CheckIcon,
  DarkModeIcon,
  DesignServicesIcon,
  InfoOutlinedIcon,
  LightModeIcon,
  LogoutIcon,
  SettingsIcon,
  VisibilityIcon,
} from './icons';
import { useThemeMode } from './theme';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface UserMenuProps {
  session: Session;
  authHeaders: () => Promise<Record<string, string>>;
  currentOrgId: string | null;
  /** The user may switch on design mode for configurable forms in the current org. */
  canDesign: boolean;
  designMode: boolean;
  onDesignModeChange: (on: boolean) => void;
  /** Opens "Show my screen"; unset without an organization. */
  onShareScreen?: () => void;
  onLogout: () => void;
  /** Called once the language change is saved, so the caller can update the session. */
  onLocaleChange: (locale: Locale) => void;
  /** Called once other settings (e.g. project time ranges) are saved, so the caller can update the session. */
  onSettingsChange: (settings: NonNullable<Session['settings']>) => void;
}

export default function UserMenu({ session, authHeaders, currentOrgId, canDesign, designMode, onDesignModeChange, onShareScreen, onLogout, onLocaleChange, onSettingsChange }: UserMenuProps) {
  const t = useT();
  const { mode, toggleMode } = useThemeMode();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState<Locale>((session.locale as Locale) ?? 'en');
  const [useProjectTimeRanges, setUseProjectTimeRanges] = useState(session.settings?.useProjectTimeMinutesRanges === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  function openSettings() {
    setSelectedLocale((session.locale as Locale) ?? 'en');
    setUseProjectTimeRanges(session.settings?.useProjectTimeMinutesRanges === true);
    setError(null);
    setSettingsOpen(true);
    setAnchorEl(null);
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    const settings = { ...session.settings, useProjectTimeMinutesRanges: useProjectTimeRanges };
    try {
      const res = await fetch(`${API}/users/${session.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ locale: selectedLocale, settings }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(t('usermenu.saveFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      onLocaleChange(selectedLocale);
      onSettingsChange(settings);
      setSettingsOpen(false);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setSaving(false);
    }
  }

  const initial = (session.displayName || session.email || '?').trim().charAt(0).toUpperCase();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // The caller's profile picture (avatars.controller.ts), again for whoever this session is.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API}/users/me/avatar`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled && data?.ok) setAvatarUrl(data.avatarUrl ?? null);
      } catch { /* initials */ }
    })();
    return () => { cancelled = true; };
  }, [authHeaders, session.userId]);

  return (
    <>
      <Button
        color="inherit"
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ textTransform: 'none', gap: 1 }}
        aria-haspopup="menu"
        aria-expanded={!!anchorEl}
      >
        <Avatar src={avatarUrl ?? undefined} sx={{ width: 24, height: 24, fontSize: 13, bgcolor: 'primary.dark' }}>{initial}</Avatar>
        <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
          {session.displayName}
        </Typography>
        <ArrowDropDownIcon fontSize="small" sx={{ opacity: 0.85, ml: -0.5 }} />
      </Button>

      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <Box sx={{ px: 2, py: 1, minWidth: 200 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{session.displayName}</Typography>
          <Typography variant="caption" color="text.secondary">{session.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={openSettings}>
          <ListItemIcon sx={{ minWidth: 32 }}><SettingsIcon fontSize="small" /></ListItemIcon>
          {t('usermenu.settings')}
        </MenuItem>
        <MenuItem onClick={() => { setAnchorEl(null); setAboutOpen(true); }}>
          <ListItemIcon sx={{ minWidth: 32 }}><InfoOutlinedIcon fontSize="small" /></ListItemIcon>
          {t('usermenu.information')}
        </MenuItem>
        <MenuItem onClick={() => { setAnchorEl(null); toggleMode(); }}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </ListItemIcon>
          {mode === 'dark' ? t('usermenu.themeLight') : t('usermenu.themeDark')}
        </MenuItem>
        {canDesign && (
          <MenuItem onClick={() => { setAnchorEl(null); onDesignModeChange(!designMode); }}>
            <ListItemIcon sx={{ minWidth: 32 }}>
              {designMode ? <CheckIcon fontSize="small" color="primary" /> : <DesignServicesIcon fontSize="small" />}
            </ListItemIcon>
            {t('design.menu')}
          </MenuItem>
        )}
        {onShareScreen && canShareScreen() && (
          <MenuItem onClick={() => { setAnchorEl(null); onShareScreen(); }}>
            <ListItemIcon sx={{ minWidth: 32 }}><VisibilityIcon fontSize="small" /></ListItemIcon>
            {t('screenShare.title')}
          </MenuItem>
        )}
        <MenuItem onClick={() => { setAnchorEl(null); onLogout(); }}>
          <ListItemIcon sx={{ minWidth: 32 }}><LogoutIcon fontSize="small" /></ListItemIcon>
          {t('usermenu.logout')}
        </MenuItem>
      </Menu>

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        session={session}
        authHeaders={authHeaders}
        currentOrgId={currentOrgId}
      />

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('usermenu.settings')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <AvatarEditor avatarUrl={avatarUrl} initial={initial} orgId={currentOrgId} authHeaders={authHeaders} onChange={setAvatarUrl} />
          <TextField
            select
            label={t('usermenu.language')}
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value as Locale)}
            size="small"
            sx={{ mt: 1 }}
          >
            {LOCALES.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={useProjectTimeRanges} onChange={(e) => setUseProjectTimeRanges(e.target.checked)} />}
            label={t('usermenu.useProjectTimeRanges')}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            {t('usermenu.useProjectTimeRangesHint')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>{t('usermenu.cancel')}</Button>
          <Button variant="contained" onClick={saveSettings} disabled={saving}>{t('usermenu.save')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
