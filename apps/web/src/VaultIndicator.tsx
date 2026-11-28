import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { KeyIcon } from './icons';
import { useI18n } from './i18n';
import { minutesUntilAutoLock, useKeyringState } from './vaultKeyring';

/**
 * In the header, after the logo: a key while the person's vault keys are unlocked (docs/VAULT.md); hovering it says in
 * how many minutes they lock themselves without use (the organization's setting, counted from the last use).
 */
export function VaultIndicator() {
  const { t } = useI18n();
  const state = useKeyringState();
  const [minutes, setMinutes] = useState<number | null>(null);
  if (state !== 'unlocked') return null;
  return (
    <Tooltip title={t('vault.header', { min: String(minutes ?? '') })} onOpen={() => setMinutes(minutesUntilAutoLock())}>
      <Box
        component="span"
        role="img"
        aria-label={t('vault.unlocked')}
        onClick={(e) => e.stopPropagation()}
        sx={{ display: 'inline-flex', alignItems: 'center', color: '#fde68a', cursor: 'default' }}
      >
        <KeyIcon fontSize="small" />
      </Box>
    </Tooltip>
  );
}
