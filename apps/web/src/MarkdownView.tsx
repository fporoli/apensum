// Markdown shown as formatted text (markdownRender.ts: markdown-it, safe for typed text: no HTML, safe links in a new
// tab, pictures as text). With MarkdownHelp, a quick reference. Both in the plugin contract.
import { useMemo, useState } from 'react';
import {
  Box, Dialog, DialogActions, DialogContent, DialogTitle, Link, Table, TableBody, TableCell, TableHead, TableRow, Typography,
  type SxProps, type Theme,
} from '@mui/material';
import { Button } from './Button';
import { useI18n } from './i18n';
import { markdownHtml } from './markdownRender';

export { markdownHtml };

export function MarkdownView({ text, sx }: { text: string; sx?: SxProps<Theme> }) {
  const html = useMemo(() => markdownHtml(text), [text]);
  return (
    <Box
      sx={[{
        overflowWrap: 'anywhere',
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& h1': { typography: 'h6', mt: 1.5, mb: 0.5 },
        '& h2': { typography: 'subtitle1', fontWeight: 700, mt: 1.5, mb: 0.5 },
        '& h3, & h4, & h5, & h6': { typography: 'subtitle2', fontWeight: 700, mt: 1.25, mb: 0.5 },
        '& p, & li': { typography: 'body1', lineHeight: 1.6 },
        '& p': { my: 0.75 },
        '& ul, & ol': { my: 0.75, pl: 3 },
        '& li.task': { listStyle: 'none', ml: -2.5 },
        '& li.task input': { mr: 0.75, verticalAlign: 'middle' },
        '& blockquote': { m: 0, my: 1, pl: 1.5, borderLeft: 3, borderColor: 'primary.main', color: 'text.secondary' },
        '& code': { fontFamily: 'monospace', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontSize: '0.9em' },
        '& pre': { bgcolor: 'action.hover', p: 1.25, borderRadius: 1, overflowX: 'auto', my: 1 },
        '& pre code': { bgcolor: 'transparent', p: 0 },
        '& table': { borderCollapse: 'collapse', my: 1, display: 'block', overflowX: 'auto' },
        '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5, typography: 'body2' },
        '& th': { bgcolor: 'action.hover', fontWeight: 600 },
        '& hr': { border: 0, borderTop: 1, borderColor: 'divider', my: 1.5 },
      }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The quick reference's rows, each as typed and as shown. */
const HELP_ROWS = [
  '# {{heading}}\n## {{subheading}}',
  '**{{bold}}** *{{italic}}* ~~{{struck}}~~ `{{code}}`',
  '- {{item}}\n- {{item}}',
  '1. {{first}}\n2. {{second}}',
  '- [ ] {{todo}}\n- [x] {{done}}',
  '> {{quote}}',
  '[{{link}}](https://apensum.ch)',
  '| {{col}} | {{col}} |\n|---|---|\n| 1 | 2 |',
  '```\n{{codeBlock}}\n```',
];

/**
 * "Markdown help": a link that opens a quick reference (typed on the left, shown on the right) and points to
 * markdownguide.org for more. Texts `markdown.help.*` in the core dictionaries.
 */
export function MarkdownHelp() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => t(`markdown.help.${k}`));
  return (
    <>
      <Link component="button" type="button" variant="caption" onClick={() => setOpen(true)}>{t('markdown.help.open')}</Link>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('markdown.help.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t('markdown.help.intro')}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('markdown.help.type')}</TableCell>
                <TableCell>{t('markdown.help.shows')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {HELP_ROWS.map((row) => (
                <TableRow key={row}>
                  <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', verticalAlign: 'top' }}>{fill(row)}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}><MarkdownView text={fill(row)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            <Link href="https://www.markdownguide.org/basic-syntax/" target="_blank" rel="noopener noreferrer">{t('markdown.help.more')}</Link>
          </Typography>
        </DialogContent>
        <DialogActions><Button onClick={() => setOpen(false)}>{t('common.close')}</Button></DialogActions>
      </Dialog>
    </>
  );
}
