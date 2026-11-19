import { createContext, useContext, useState, type ReactNode } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Paper, Typography, type SxProps, type Theme } from '@mui/material';
import { ExpandMoreIcon } from './icons';

/** True inside a SettingsSection: a SectionPaper then shows only its content (the section shows the title). */
const InSection = createContext(false);

const storageKey = (id: string) => `settings.section.${id}`;

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(storageKey(id));
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/**
 * One collapsible block of a settings page (Organization settings): the title and subtitle in the
 * header, the content when opened. Whether it is open is remembered per browser (a convenience only).
 */
export function SettingsSection({ id, title, subtitle, defaultExpanded = false, end, children }: {
  id: string;
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  /** Shown at the right of the header (a status chip). */
  end?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultExpanded));
  return (
    <Accordion
      expanded={open}
      disableGutters
      onChange={(_, expanded) => {
        setOpen(expanded);
        try { localStorage.setItem(storageKey(id), expanded ? '1' : '0'); } catch { /* private window */ }
      }}
      sx={{ '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls={`${id}-content`} id={`${id}-header`}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', width: '100%', pr: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {end}
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <InSection.Provider value>{children}</InSection.Provider>
      </AccordionDetails>
    </Accordion>
  );
}

/**
 * A settings card: on its own a Paper with title and subtitle; inside a SettingsSection only the
 * content (in the same grid layout), since the section header already shows title and subtitle.
 */
export function SectionPaper({ title, subtitle, sx, children }: { title: string; subtitle?: string; sx?: SxProps<Theme>; children: ReactNode }) {
  const inSection = useContext(InSection);
  const layout = { display: 'grid', gap: 1.5, ...(sx as object) };
  if (inSection) return <Box sx={layout}>{children}</Box>;
  return (
    <Paper sx={{ p: 2, ...layout }}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
      </Box>
      {children}
    </Paper>
  );
}
