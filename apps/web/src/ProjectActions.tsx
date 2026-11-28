import { Fragment } from 'react';
import { Stack } from '@mui/material';
import type { PluginProjectAction, ProjectActionContext } from './plugin';

// The plugins' project actions (WebPlugin.projectActions), handed over by plugins.ts once it has collected them: this
// file does not import plugins.ts, which imports the plugins, which import the plugin contract (and this file).
let actions: readonly PluginProjectAction[] = [];
export function registerProjectActions(list: readonly PluginProjectAction[]) {
  actions = list;
}

/**
 * The plugins' actions on a project or subproject (e.g. Billing's "Rechnung erstellen"), for any page that shows one,
 * a plugin's too (the cases plugin's case card): each renders nothing where it does not apply to the caller.
 */
export function ProjectActions(ctx: ProjectActionContext) {
  if (!actions.length) return null;
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {actions.map((a) => <Fragment key={a.id}>{a.render(ctx)}</Fragment>)}
    </Stack>
  );
}
