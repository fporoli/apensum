import { lazy, Suspense } from 'react';
import { holdsAny } from '@worktime3/shared/permissions';
import { ArticleIcon, defineWebPlugin, FolderSharedIcon, type PluginPageContext } from '@worktime3/web/plugin';
import { CASES_TEXTS } from './texts';

const Cases = lazy(() => import('./Cases'));
const AssessmentTemplates = lazy(() => import('./Cases').then((m) => ({ default: m.AssessmentTemplates })));
const CaseAiSettingsPanel = lazy(() => import('./CaseAiSettingsPanel').then((m) => ({ default: m.CaseAiSettingsPanel })));

/** Cases' editors: admins and managers, or whoever holds Cases (editing is checked by the API). */
const canEdit = ({ roles, permissions }: PluginPageContext) => roles.isAdmin || roles.isManager || (permissions ? holdsAny(permissions, 'nav.cases') : true);

export default defineWebPlugin({
  id: 'cases',
  texts: CASES_TEXTS,
  navGroups: [{ id: 'cases', header: 'nav.casesGroup', after: 'projectTracking' }],
  pages: [
    {
      section: 'cases',
      hash: '#/cases',
      object: 'nav.cases',
      allowedByRole: (r) => r.isAdmin || r.isManager,
      nav: { group: 'cases', label: 'nav.cases', icon: <FolderSharedIcon fontSize="small" /> },
      render: (ctx) => <Cases orgId={ctx.orgId} authHeaders={ctx.authHeaders} canEdit={canEdit(ctx)} />,
    },
    {
      // Templates belong to Cases: whoever may open Cases sees them (editing is checked by the API).
      section: 'casesTemplates',
      hash: '#/assessment-templates',
      object: 'nav.cases',
      allowedByRole: (r) => r.isAdmin || r.isManager,
      nav: { group: 'cases', label: 'nav.assessmentTemplates', icon: <ArticleIcon fontSize="small" /> },
      render: (ctx) => <AssessmentTemplates orgId={ctx.orgId} authHeaders={ctx.authHeaders} canEdit={canEdit(ctx)} />,
    },
  ],
  // The Cases providers, inside Organization settings -> AI and costs (after the organization's limit).
  orgSettings: [
    {
      id: 'org.ai.cases',
      within: 'org.ai',
      title: (t) => t('cases.ai.settings.casesGroup'),
      render: ({ orgId, authHeaders }) => (
        <Suspense fallback={null}>
          <CaseAiSettingsPanel orgId={orgId} authHeaders={authHeaders} />
        </Suspense>
      ),
    },
  ],
});
