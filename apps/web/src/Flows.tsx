// The Flows page: everything someone starts and others work on, in one place (the glossary in CLAUDE.md, "Flow").
// Its tabs are what waits for the caller, what they started, and what is done. For now each tab shows two lists: the
// free flows and the flows of the organization's own types (Requests.tsx), then the built-in types such as absences,
// expense reports and timesheets (Approvals.tsx), whose request-steps are left out there since the first list has them.
import { useState } from 'react';
import { Box, Button, Tab, Tabs, Typography } from '@mui/material';
import { AddIcon } from './icons';
import Approvals, { type Scope } from './Approvals';
import Requests, { type Box_ } from './Requests';
import { PageHeader } from './components';
import { useT } from './i18n';

export type FlowsTab = 'todo' | 'mine' | 'done';

interface FlowsProps {
  orgId: string;
  userId: string | null;
  role: 'admin' | 'manager' | 'user';
  /** Decides on others' items (managers, HR). */
  canDecide: boolean;
  /** The requests module is on and the caller may use it (`nav.requests`). */
  hasFreeFlows: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  /** The tab to open on (an old link to the Workflow or Requests page, a notification). */
  initialTab?: FlowsTab;
  /** A free flow to open (a notification, `#/requests?id=`). */
  focusId?: string | null;
  refreshKey?: unknown;
  onChanged?: () => void;
  navigate?: (section: string) => void;
}

/** What each tab shows of the two lists. */
const TABS: Record<FlowsTab, { box: Box_; scope?: Scope; status?: 'pending'; statuses?: readonly ('approved' | 'rejected')[] }> = {
  todo: { box: 'inbox', scope: 'assigned', status: 'pending' },
  mine: { box: 'mine', scope: 'mine' },
  done: { box: 'archived', statuses: ['approved', 'rejected'] },
};

export default function Flows(props: FlowsProps) {
  const t = useT();
  const { orgId, userId, authHeaders, hasFreeFlows } = props;
  const [tab, setTab] = useState<FlowsTab>(props.initialTab ?? (props.canDecide ? 'todo' : 'mine'));
  const [composeSignal, setComposeSignal] = useState(0);
  const [created, setCreated] = useState<string | null>(null);
  const shown = TABS[tab];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('flows.title')}
        subtitle={t('flows.subtitle')}
        end={hasFreeFlows ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setTab('mine'); setComposeSignal((n) => n + 1); }}>
            {t('flows.new')}
          </Button>
        ) : undefined}
      />

      <Tabs value={tab} onChange={(_, v: FlowsTab) => { setTab(v); setComposeSignal(0); }} variant="scrollable" allowScrollButtonsMobile>
        <Tab value="todo" label={t('flows.tab.todo')} />
        <Tab value="mine" label={t('flows.tab.mine')} />
        <Tab value="done" label={t('flows.tab.done')} />
      </Tabs>

      {hasFreeFlows && (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('flows.section.free')}</Typography>
          <Requests
            key={`requests-${tab}`}
            orgId={orgId}
            userId={userId}
            authHeaders={authHeaders}
            focusId={created ?? props.focusId}
            refreshKey={props.refreshKey}
            onChanged={props.onChanged}
            navigate={props.navigate}
            embedded={{ box: shown.box, composeSignal: tab === 'mine' ? composeSignal : 0, onCreated: (id) => setCreated(id) }}
          />
        </Box>
      )}

      <Box sx={{ display: 'grid', gap: 1 }}>
        {hasFreeFlows && <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('flows.section.builtIn')}</Typography>}
        <Approvals
          key={`approvals-${tab}`}
          orgId={orgId}
          role={props.role}
          canDecide={props.canDecide}
          authHeaders={authHeaders}
          onChanged={props.onChanged}
          embedded={{ scope: shown.scope, status: shown.status, statuses: shown.statuses, excludeSources: hasFreeFlows ? ['requests'] : [] }}
        />
      </Box>
    </Box>
  );
}
