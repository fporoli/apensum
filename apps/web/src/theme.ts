import { createContext, useContext } from 'react';
import { alpha, createTheme, darken } from '@mui/material';
import { contrastTextColor, isDarkColor, type OrgBranding } from '@worktime3/shared/branding';

export type ThemeMode = 'light' | 'dark';

export const ThemeModeContext = createContext<{ mode: ThemeMode; toggleMode: () => void }>({
  mode: 'light',
  toggleMode: () => {},
});

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

/**
 * The current organization's look and feel. App.tsx sets it when the organization changes
 * (GET organizations/:id/branding); main.tsx rebuilds the theme from it.
 */
export const BrandingContext = createContext<{ branding: OrgBranding; setBranding: (b: OrgBranding) => void }>({
  branding: {},
  setBranding: () => {},
});

export function useBranding() {
  return useContext(BrandingContext);
}

const primaryLight = { main: '#1d4ed8', light: '#3b82f6', dark: '#1e40af', contrastText: '#ffffff' };
const primaryDark = { main: '#60a5fa', light: '#93c5fd', dark: '#2563eb', contrastText: '#ffffff' };

/** The light theme's colors that an organization's branding can replace. */
export const DEFAULT_BRANDING_COLORS = { headerColor: primaryLight.main, backgroundColor: '#f8fafc', sidebarColor: '#fbfbfd' } as const;

/**
 * App theme for a mode, with an organization's branding on top. The header color applies in
 * both modes; page and sidebar colors only in light mode, where the app's text is dark.
 */
export function createAppTheme(mode: ThemeMode = 'light', branding: OrgBranding = {}) {
  const isDark = mode === 'dark';
  const primary = isDark ? primaryDark : primaryLight;
  const dividerColor = isDark ? 'rgba(255, 255, 255, 0.09)' : '#e5e7eb';
  const header = branding.headerColor;
  const pageBackground = !isDark ? branding.backgroundColor : undefined;
  const sidebar = !isDark ? branding.sidebarColor : undefined;
  const sidebarText = sidebar && isDarkColor(sidebar) ? contrastTextColor(sidebar) : undefined;

  return createTheme({
    palette: {
      mode,
      primary,
      background: isDark
        ? { default: '#090d16', paper: '#111827' }
        : { default: pageBackground ?? DEFAULT_BRANDING_COLORS.backgroundColor, paper: '#ffffff' },
      text: isDark
        ? { primary: '#f8fafc', secondary: '#94a3b8' }
        : { primary: '#0f172a', secondary: '#5b6474' },
      divider: dividerColor,
    },
    shape: {
      borderRadius: 6,
    },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      h4: { fontWeight: 700, letterSpacing: '-0.02em' },
      h5: { fontWeight: 600, letterSpacing: '-0.02em' },
      h6: { fontWeight: 600, letterSpacing: '-0.015em' },
      subtitle1: { fontWeight: 600, letterSpacing: '-0.01em' },
      subtitle2: { fontWeight: 600, letterSpacing: '-0.005em' },
      body1: { fontSize: '0.925rem', letterSpacing: '-0.005em' },
      body2: { fontSize: '0.85rem' },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.005em' },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 7,
            paddingInline: 15,
            paddingBlock: 6,
            transition: 'all 0.15s ease',
          },
          contained: {
            boxShadow: '0 1px 2px rgba(16,24,40,0.06)',
            '&:hover': {
              boxShadow: '0 4px 8px -2px rgba(16,24,40,0.18)',
              transform: 'translateY(-1px)',
            },
            '&:active': {
              transform: 'translateY(0)',
            },
          },
          outlined: {
            borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : '#d0d5dd',
            '&:hover': {
              borderColor: isDark ? 'rgba(255, 255, 255, 0.3)' : '#98a2b3',
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f8f9fc',
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : '#d0d5dd',
              borderWidth: '1px',
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: isDark ? 'rgba(255, 255, 255, 0.28)' : '#98a2b3',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: primary.main,
              borderWidth: '1px',
            },
            '&.Mui-focused': {
              boxShadow: isDark
                ? `0 0 0 3px ${alpha(primary.main, 0.25)}`
                : `0 0 0 3px ${alpha(primary.main, 0.12)}`,
            },
            '&.Mui-error .MuiOutlinedInput-notchedOutline': {
              borderColor: '#ef4444',
            },
            '&.Mui-error.Mui-focused': {
              boxShadow: `0 0 0 3px ${alpha('#ef4444', 0.14)}`,
            },
          },
          input: {
            padding: '8px 12px',
            fontSize: '0.875rem',
          },
          inputSizeSmall: {
            padding: '7px 11px',
            fontSize: '0.84rem',
          },
          // Multiline: the padding sits on the root, so the first text line matches the resting label.
          multiline: {
            padding: '8px 12px',
          },
          inputMultiline: {
            padding: 0,
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            fontSize: '0.875rem',
            color: isDark ? '#94a3b8' : '#64748b',
            '&.Mui-focused': {
              color: primary.main,
            },
            // The resting label (empty field) sits on the input's text line, which the compact
            // input padding above (8px 12px) moved up from MUI's default 16.5px 14px.
            '&.MuiInputLabel-outlined:not(.MuiInputLabel-shrink)': {
              transform: 'translate(12px, 8px) scale(1)',
            },
          },
          sizeSmall: {
            fontSize: '0.84rem',
            '&.MuiInputLabel-outlined:not(.MuiInputLabel-shrink)': {
              transform: 'translate(11px, 7px) scale(1)',
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          icon: {
            color: isDark ? '#94a3b8' : '#64748b',
            fontSize: '1.2rem',
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 6,
            border: `1px solid ${dividerColor}`,
            boxShadow: isDark
              ? '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)'
              : '0 10px 25px -5px rgba(16, 24, 40, 0.08), 0 8px 10px -6px rgba(16, 24, 40, 0.04)',
            marginTop: 4,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontSize: '0.86rem',
            borderRadius: 4,
            margin: '2px 6px',
            padding: '6px 10px',
            transition: 'background-color 0.1s ease',
            '&.Mui-selected': {
              backgroundColor: alpha(primary.main, isDark ? 0.16 : 0.08),
              color: primary.main,
              fontWeight: 600,
              '&:hover': {
                backgroundColor: alpha(primary.main, isDark ? 0.22 : 0.12),
              },
            },
            '&:hover': {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#f1f5f9',
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: header
              ? `linear-gradient(135deg, ${header} 0%, ${darken(header, 0.2)} 100%)`
              : isDark
                ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
                : `linear-gradient(135deg, ${primaryLight.main} 0%, ${primaryLight.dark} 100%)`,
            ...(header ? { backgroundColor: header, color: contrastTextColor(header) } : {}),
            borderBottom: isDark ? `1px solid ${dividerColor}` : 'none',
            boxShadow: isDark
              ? '0 1px 3px rgba(0,0,0,0.35)'
              : '0 1px 3px rgba(16,24,40,0.05), 0 2px 8px rgba(16,24,40,0.06)',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: sidebar ?? (isDark ? '#0f172a' : DEFAULT_BRANDING_COLORS.sidebarColor),
            borderRight: `1px solid ${dividerColor}`,
            // A dark sidebar color gets light text, including group headers and the selected item.
            ...(sidebarText
              ? {
                  color: sidebarText,
                  '& .MuiListSubheader-root': { color: alpha(sidebarText, 0.7) },
                  '& .MuiDivider-root': { borderColor: alpha(sidebarText, 0.2) },
                  '& .MuiListItemButton-root.Mui-selected': { color: sidebarText, backgroundColor: alpha(sidebarText, 0.16) },
                  '& .MuiListItemButton-root:hover': { backgroundColor: alpha(sidebarText, 0.1) },
                }
              : {}),
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          outlined: { borderColor: dividerColor },
          elevation1: {
            border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : '#e5e7eb'}`,
            boxShadow: isDark
              ? '0 1px 3px rgba(0,0,0,0.32)'
              : '0 1px 3px rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.02)',
          },
          elevation2: {
            border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#e5e7eb'}`,
            boxShadow: isDark
              ? '0 4px 16px rgba(0,0,0,0.45)'
              : '0 4px 6px -1px rgba(16,24,40,0.06), 0 2px 4px -2px rgba(16,24,40,0.04)',
          },
        },
      },
      // Phones: content grids and flex rows default to `min-width: auto`, so one wide table or row of
      // tabs widens the whole page past the screen. Layout boxes in the content may shrink instead
      // (tables then scroll inside their TableContainer); classes set via sx still win (higher specificity).
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFeatureSettings: '"cv02", "cv03", "cv04", "cv11", "tnum"',
          },
          'main :where(.MuiBox-root, .MuiPaper-root, .MuiCard-root, .MuiStack-root, .MuiTableContainer-root, .MuiTabs-root)': {
            minWidth: 0,
          },
        },
      },
      MuiTabs: {
        // A row of tabs wider than the screen scrolls (with arrows on touch screens) instead of widening the page.
        defaultProps: { variant: 'scrollable', scrollButtons: 'auto', allowScrollButtonsMobile: true },
        styleOverrides: {
          indicator: { height: 3, borderRadius: 3 },
        },
      },
      MuiTab: {
        // Every tab has an icon before its label (it reads as a tab, not as a button or a heading).
        defaultProps: { iconPosition: 'start' },
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, minHeight: 44 },
          labelIcon: { minHeight: 44, paddingTop: 6, paddingBottom: 6 },
          iconWrapper: { fontSize: '1.15rem' },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 600,
            fontSize: '0.73rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: isDark ? '#94a3b8' : '#64748b',
            backgroundColor: isDark ? '#141c2e' : '#f8fafc',
            borderBottom: `1px solid ${dividerColor}`,
            whiteSpace: 'nowrap',
          },
          root: {
            borderBottom: `1px solid ${isDark ? '#1e293b' : '#f1f3f7'}`,
            fontVariantNumeric: 'tabular-nums',
            padding: '10px 14px',
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            border: `1px solid ${isDark ? '#1e293b' : '#e5e7eb'}`,
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: 'background-color 0.12s ease',
            '&:hover': { backgroundColor: alpha(primary.main, isDark ? 0.08 : 0.035) },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 600,
            borderRadius: 6,
            fontSize: '0.78rem',
            letterSpacing: '0.01em',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 7,
            marginLeft: 8,
            marginRight: 8,
            paddingTop: 6,
            paddingBottom: 6,
            width: 'auto',
            transition: 'all 0.12s ease',
            '&.Mui-selected': {
              backgroundColor: alpha(primary.main, isDark ? 0.16 : 0.08),
              color: primary.main,
              fontWeight: 600,
              '& .MuiListItemIcon-root': { color: primary.main },
              '&:hover': { backgroundColor: alpha(primary.main, isDark ? 0.22 : 0.12) },
            },
          },
        },
      },
    },
  });
}

export default createAppTheme('light');
