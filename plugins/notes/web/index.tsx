import { lazy } from 'react';
import { defineWebPlugin, EditIcon } from '@worktime3/web/plugin';
import { NOTES_TEXTS } from './texts';

const Notes = lazy(() => import('./Notes'));

// Everything the plugin adds to the web app is declared here (docs/PLUGINS.md): its texts and one page in
// the core's "Personal" navbar group, shown to whoever holds `nav.notes` (the module switched on).
export default defineWebPlugin({
  id: 'notes',
  texts: NOTES_TEXTS,
  // A note shared with someone: the bell opens the Notes page.
  notificationSections: { 'notes.notes': 'notes' },
  pages: [
    {
      section: 'notes',
      hash: '#/notes',
      object: 'nav.notes',
      nav: { group: 'personal', label: 'nav.notes', icon: <EditIcon fontSize="small" /> },
      render: ({ orgId, authHeaders }) => <Notes orgId={orgId} authHeaders={authHeaders} />,
    },
  ],
});
