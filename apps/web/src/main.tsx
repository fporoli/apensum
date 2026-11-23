import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import DemoResetNotice from './DemoResetNotice';
import UpdateNotice from './UpdateNotice';
import { I18nProvider } from './i18n';
import { BrandingContext, createAppTheme, DEFAULT_BRANDING_COLORS, ThemeModeContext, type ThemeMode } from './theme';
import type { OrgBranding } from '@worktime3/shared/branding';
import { DatePickerLocalization } from './ConfigField';
import { parseResetHash } from './resetHash';
import { PLUGIN_PUBLIC_ROUTES } from './plugins';

// A plugin's page opened without signing in (e.g. the expenses plugin's phone upload for a QR code).
const publicRoute = PLUGIN_PUBLIC_ROUTES.map((r) => ({ route: r, match: r.match(window.location.hash) })).find((r) => r.match);
const ResetPassword = lazy(() => import('./ResetPassword'));
// The link in a password-reset e-mail opens the page that sets the new password, without signing in.
const passwordReset = parseResetHash(window.location.hash);

const THEME_STORAGE_KEY = 'worktime.themeMode';

function loadThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* private-browsing etc. */ }
  return 'light';
}

function Root() {
  const [mode, setMode] = useState<ThemeMode>(loadThemeMode);
  const [branding, setBranding] = useState<OrgBranding>({});
  const theme = useMemo(() => createAppTheme(mode, branding), [mode, branding]);
  const brandingCtx = useMemo(() => ({ branding, setBranding }), [branding]);
  // The phone's status bar (installed app, mobile browsers) takes the organization's header color.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', branding.headerColor ?? DEFAULT_BRANDING_COLORS.headerColor);
  }, [branding.headerColor]);
  const ctx = useMemo(
    () => ({
      mode,
      toggleMode: () => {
        setMode((prev) => {
          const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
          try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
          } catch { /* ignore */ }
          return next;
        });
      },
    }),
    [mode],
  );

  return (
    <ThemeModeContext.Provider value={ctx}>
      <BrandingContext.Provider value={brandingCtx}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <I18nProvider>
            <DatePickerLocalization>
              {publicRoute ? (
                <Suspense fallback={null}>{publicRoute.route.render(publicRoute.match)}</Suspense>
              ) : passwordReset ? (
                <Suspense fallback={null}>
                  <ResetPassword token={passwordReset.token} lang={passwordReset.lang} />
                </Suspense>
              ) : (
                <>
                  <App />
                  <DemoResetNotice />
                  <UpdateNotice />
                </>
              )}
            </DatePickerLocalization>
          </I18nProvider>
        </ThemeProvider>
      </BrandingContext.Provider>
    </ThemeModeContext.Provider>
  );
}

// Installable app (PWA): public/sw.js caches the app itself for a quick start, never API answers.
// Not in development, where Vite serves changing modules that a cache would only get in the way of.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker not registered:', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
