import React, { lazy, Suspense, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import { I18nProvider } from './i18n';
import { BrandingContext, createAppTheme, ThemeModeContext, type ThemeMode } from './theme';
import type { OrgBranding } from '@worktime3/shared/branding';
import { DatePickerLocalization } from './ConfigField';
import { parseReceiptHash } from './receiptHash';
import { parseResetHash } from './resetHash';

const PhoneUpload = lazy(() => import('./PhoneUpload'));
// A phone that scanned the expense form's QR code gets the receipt page alone, without signing in.
const receiptHandoff = parseReceiptHash(window.location.hash);
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
              {receiptHandoff ? (
                <Suspense fallback={null}>
                  <PhoneUpload token={receiptHandoff.token} lang={receiptHandoff.lang} />
                </Suspense>
              ) : passwordReset ? (
                <Suspense fallback={null}>
                  <ResetPassword token={passwordReset.token} lang={passwordReset.lang} />
                </Suspense>
              ) : (
                <App />
              )}
            </DatePickerLocalization>
          </I18nProvider>
        </ThemeProvider>
      </BrandingContext.Provider>
    </ThemeModeContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
