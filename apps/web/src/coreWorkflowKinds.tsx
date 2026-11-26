import { lazy, Suspense } from 'react';
import type { PluginWorkflowKind } from './plugin';

const BasicDataChangeReview = lazy(() => import('./BasicDataChangeReview'));

/**
 * The core's flow kinds that the Flows page shows like a plugin's (PluginWorkflowKind): a change of personal data a
 * person asked for (API basicdata.controller.ts, kind `basicdata.change`), reviewed in its dialog (old against new).
 */
export const CORE_WORKFLOW_KINDS: readonly PluginWorkflowKind[] = [
  {
    definitionName: 'basicdata change',
    recordField: 'basicdata_change',
    label: (t) => t('workflowConfig.kind.basicdata.change'),
    source: { name: 'Personal data', label: (t) => t('workflowConfig.kind.basicdata.change') },
    title: { sourceName: 'getBasicDataChangeTitle', get: (r) => String(r.user_display_name ?? '') },
    Inspect: (props) => (
      <Suspense fallback={null}>
        <BasicDataChangeReview {...props} />
      </Suspense>
    ),
  },
];
