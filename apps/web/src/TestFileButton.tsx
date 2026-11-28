import { useState } from 'react';
import { Button } from './Button';
import { useT } from './i18n';
import { useTestInstance } from './instance';

/**
 * Beside a file chooser, on every instance but prod: "Testdatei verwenden" hands a fixed test file (a bundled asset,
 * e.g. `import url from './samples/x.m4a?url'`) to the same handler as a chosen file, so a flow can be tried without
 * looking for a file. Nothing on prod.
 */
export function TestFileButton({ url, name, type, onFile, disabled, size }: {
  url: string;
  name: string;
  type: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
}) {
  const t = useT();
  const test = useTestInstance();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!test) return null;
  const use = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      onFile(new File([await res.blob()], name, { type }));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button variant="outlined" color={failed ? 'error' : 'secondary'} size={size} disabled={disabled || loading} onClick={() => void use()}
      title={failed ? t('testFile.failed') : t('testFile.help')}>
      {t('testFile.use')}
    </Button>
  );
}
