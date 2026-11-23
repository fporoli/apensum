import { useEffect, useState } from 'react';
import { Alert, Button, Snackbar } from '@mui/material';
import { useT } from './i18n';
import { isNewVersion } from './appVersion';

/** How often an open tab looks for a new version (also whenever it becomes visible again). */
const CHECK_EVERY_MS = 5 * 60 * 1000;

/** The main file this tab was loaded with (null on the development server). */
function runningScript(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
  return src ? new URL(src, window.location.origin).pathname : null;
}

/**
 * After a deploy, an open tab keeps running the old app until it is reloaded. This notices a new version on
 * the server (appVersion.ts) and offers to reload; it asks, it never reloads by itself (unsaved input).
 */
export default function UpdateNotice() {
  const t = useT();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const running = runningScript();
    if (!running) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/?version-check=${Date.now()}`, { cache: 'no-store' });
        if (res.ok && isNewVersion(running, await res.text())) setAvailable(true);
      } catch { /* offline: try again later */ }
    };
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  return (
    <Snackbar open={available} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert
        severity="info"
        variant="filled"
        action={<Button color="inherit" size="small" onClick={() => window.location.reload()}>{t('update.reload')}</Button>}
        onClose={() => setAvailable(false)}
      >
        {t('update.available')}
      </Alert>
    </Snackbar>
  );
}
