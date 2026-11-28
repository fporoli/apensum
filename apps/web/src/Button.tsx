import { forwardRef, type ReactNode } from 'react';
import { Button as MuiButton, type ButtonProps } from '@mui/material';
import { DICTIONARIES } from './dictionaries';
import { useI18n, type Locale } from './i18n';
import { useBranding } from './theme';
import { ACTION_COLORS, buttonActions, normalizeLabel, type ButtonAction } from './colorful';
import {
  AddIcon, ArchiveIcon, AutoAwesomeIcon, BlockIcon, GroupIcon, LockIcon, LockOpenIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, ContentCopyIcon, DeleteIcon,
  DownloadIcon, EditIcon, EventIcon, LoginIcon, LogoutIcon, PlayArrowIcon, PrintIcon, PublicIcon, RefreshIcon,
  RestartAltIcon, SaveIcon, SearchIcon, SendIcon, SettingsIcon, StopIcon, UploadIcon, VisibilityIcon,
} from './icons';

const ICONS: Record<ButtonAction, typeof SaveIcon> = {
  save: SaveIcon, cancel: CloseIcon, close: CloseIcon, delete: DeleteIcon, add: AddIcon, edit: EditIcon,
  download: DownloadIcon, upload: UploadIcon, send: SendIcon, approve: CheckIcon, reject: BlockIcon, search: SearchIcon,
  print: PrintIcon, refresh: RefreshIcon, copy: ContentCopyIcon, back: ChevronLeftIcon, next: ChevronRightIcon,
  view: VisibilityIcon, publish: PublicIcon, archive: ArchiveIcon, reset: RestartAltIcon, start: PlayArrowIcon,
  stop: StopIcon, login: LoginIcon, logout: LogoutIcon, today: EventIcon, settings: SettingsIcon,
  lock: LockIcon, unlock: LockOpenIcon, ai: AutoAwesomeIcon, access: GroupIcon,
};

/** Per language, built on first use (the plugins' texts are merged into the dictionaries before the app renders). */
const byLocale = new Map<Locale, Map<string, ButtonAction>>();
function actionsFor(locale: Locale): Map<string, ButtonAction> {
  let map = byLocale.get(locale);
  if (!map) {
    map = buttonActions(DICTIONARIES[locale] ?? {});
    byLocale.set(locale, map);
  }
  return map;
}

/** The button's text when it is only text (strings and numbers); else null. */
function textOf(children: ReactNode): string | null {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === 'string' || typeof c === 'number')) return children.join('');
  return null;
}

/**
 * The app's button: MUI's, and with the organization's colorful look (branding `colorful`) an icon before the text,
 * chosen by what the text means (colorful.ts). A button that brings its own icon keeps it. Used everywhere instead of
 * MUI's (plugins: `@worktime3/web/plugin`).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { branding } = useBranding();
  const { locale } = useI18n();
  let startIcon = props.startIcon;
  if (branding.colorful && !props.startIcon && !props.endIcon) {
    const text = textOf(props.children);
    if (text) {
      const actions = actionsFor(locale);
      const label = normalizeLabel(text);
      const action = actions.get(label) ?? actions.get(label.replace(/\s*\([^)]*\)$/, ''));
      if (action) {
        const Icon = ICONS[action];
        const plain = props.variant !== 'contained' && (!props.color || props.color === 'primary' || props.color === 'inherit') && !props.disabled;
        startIcon = <Icon sx={plain ? { color: ACTION_COLORS[action] } : undefined} />;
      }
    }
  }
  return <MuiButton ref={ref} {...props} startIcon={startIcon} />;
}) as typeof MuiButton;
