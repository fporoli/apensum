import { useState } from 'react';
import { IconButton, ListItemIcon, Menu, MenuItem, Tooltip } from '@mui/material';
import { KeyIcon, LockIcon } from './icons';
import { useI18n } from './i18n';
import { lockKeyring, minutesUntilAutoLock, useKeyringState } from './vaultKeyring';

/**
 * In the header, after the logo: a key while the person's vault keys are unlocked (docs/VAULT.md). Hovering it says in
 * how many minutes they lock themselves without use (the organization's setting, counted from the last use); a click
 * offers to lock them now.
 */
export function VaultIndicator() {
  const { t } = useI18n();
  const state = useKeyringState();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (state !== 'unlocked') return null;
  return (
    <>
      <Tooltip title={t('vault.header', { min: String(minutes ?? '') })} onOpen={() => setMinutes(minutesUntilAutoLock())}>
        <IconButton
          size="small"
          aria-label={t('vault.unlocked')}
          onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}
          sx={{ color: '#fde68a' }}
        >
          <KeyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={() => { lockKeyring(); setAnchor(null); }}>
          <ListItemIcon><LockIcon fontSize="small" /></ListItemIcon>
          {t('vault.lockNow')}
        </MenuItem>
      </Menu>
    </>
  );
}
