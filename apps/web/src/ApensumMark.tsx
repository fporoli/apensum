import { Box, type SxProps, type Theme } from '@mui/material';

/**
 * The Apensum mark (same drawing as public/favicon.svg and the website's logo): a clock-face "a".
 * `solid` is the blue tile (login); `onColor` sits on a colored app bar, white on a light veil.
 */
export function ApensumMark({ size = 28, variant = 'solid', sx }: { size?: number; variant?: 'solid' | 'onColor'; sx?: SxProps<Theme> }) {
  const solid = variant === 'solid';
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      role="img"
      aria-label="Apensum"
      sx={{ width: size, height: size, display: 'block', flexShrink: 0, ...sx }}
    >
      <rect width="32" height="32" rx="8" fill={solid ? '#1a56db' : 'rgba(255,255,255,0.18)'} />
      <circle cx="15" cy="17.5" r="6.5" fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d="M21.5 11v13" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15 14.2v3.5l2.3 1.4" fill="none" stroke={solid ? '#9ec0ff' : 'rgba(255,255,255,0.7)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Box>
  );
}
