import { lazy, type ReactNode } from 'react';
import { grantedScopes, holdsAny, holdsBeyondOwn, isBasicDataReviewer, seesOthersBasicData } from '@worktime3/shared/permissions';
import type { Session } from './Login';
import type { PluginPage, PluginPageContext } from './plugin';
import type { NavGroupDef } from './navigation';
import type { RoleFlags } from './roleFlags';
import {
  AccountBalanceWalletIcon,
  BarChartIcon,
  BeachAccessIcon,
  CalendarMonthIcon,
  CampaignIcon,
  ContactsIcon,
  DashboardIcon,
  DescriptionIcon,
  EventIcon,
  GroupIcon,
  HistoryIcon,
  ImportExportIcon,
  KeyIcon,
  MemoryIcon,
  MailIcon,
  PeopleIcon,
  PersonIcon,
  ScheduleIcon,
  SettingsIcon,
  TimerIcon,
  TuneIcon,
  AccountTreeIcon,
  VerifiedUserIcon,
  WorkspacesIcon,
  BusinessIcon,
} from './icons';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';

const Home = lazy(() => import('./Home'));
const MyData = lazy(() => import('./MyData'));
const ProjectTime = lazy(() => import('./ProjectTime'));
const Management = lazy(() => import('./Management'));
const Customers = lazy(() => import('./Customers'));
const Invitations = lazy(() => import('./Invitations'));
const AdminSettings = lazy(() => import('./AdminSettings'));
const WorkflowSettings = lazy(() => import('./WorkflowSettings'));
const OrganizationSettings = lazy(() => import('./OrganizationSettings'));
const Timesheet = lazy(() => import('./Timesheet'));
const WorkTime = lazy(() => import('./WorkTime'));
const Absences = lazy(() => import('./Absences'));
const Reports = lazy(() => import('./Reports'));
const ProjectTimesheet = lazy(() => import('./ProjectTimesheet'));
const TeamView = lazy(() => import('./TeamView'));
const TeamCalendar = lazy(() => import('./TeamView').then((m) => ({ default: m.TeamCalendar })));
const BalanceReport = lazy(() => import('./BalanceReport'));
const AuditLog = lazy(() => import('./AuditLog'));
const Users = lazy(() => import('./Users'));
const Flows = lazy(() => import('./Flows'));
import type { FlowFocus } from './flowRows';
const Documents = lazy(() => import('./Documents'));
const Directory = lazy(() => import('./Directory'));
const News = lazy(() => import('./News'));
const ImportExport = lazy(() => import('./ImportExport'));
const SuperAdminHome = lazy(() => import('./SuperAdmin').then((m) => ({ default: m.SuperAdminHome })));
const SuperAdminLicenses = lazy(() => import('./SuperAdmin').then((m) => ({ default: m.SuperAdminLicenses })));
const SuperAdminAi = lazy(() => import('./SuperAdmin').then((m) => ({ default: m.SuperAdminAi })));
const SuperAdminInstance = lazy(() => import('./SuperAdmin').then((m) => ({ default: m.SuperAdminInstance })));
const SuperAdminNews = lazy(() => import('./SuperAdmin').then((m) => ({ default: m.SuperAdminNews })));
const DefaultLists = lazy(() => import('./AdminSettings').then((m) => ({ default: m.StaticDataSettings })));
const SuperAdminUsers = lazy(() => import('./SuperAdmin').then((m) => ({ default: m.SuperAdminUsers })));

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** What App.tsx hands the core's pages: the plugins' context plus the app state some pages share. */
export interface CorePageContext extends PluginPageContext {
  roles: RoleFlags;
  session: Session;
  /** Reviews other people's personal details (HR/admin by default). */
  isReviewer: boolean;
  /** Reloads the navbar counts (after an approval, a review, ...). */
  onBadgesChanged: () => void;
  onWorkTimeChanged: () => void;
  projectsVersion: number;
  onProjectsChanged: () => void;
  /** A request to open on the Requests page (from a notification or a link). */
  /** A flow to open on the Flows page (a notification, `#/flows?id=`). */
  flowFocus: FlowFocus | null;
  /** Changes when a notification arrives. */
  liveNotification: unknown;
  /** An organization's modules changed: permissions and navbar reload. */
  onModulesChanged: () => void;
  /** The plugin pages' Home quick actions the person may use (PluginPage.homeAction), labels translated. */
  homeActions: { section: string; label: string; icon: ReactNode; after?: string }[];
}

export type AppPage = PluginPage<CorePageContext>;

/** The core's navbar groups, in order; plugins add theirs behind one of them. */
export const CORE_NAV_GROUPS: NavGroupDef[] = [
  { id: 'myWork', header: 'nav.myWork' },
  { id: 'projectTracking', header: 'nav.projectTracking' },
  { id: 'personal', header: 'nav.personal' },
  { id: 'organization', header: 'nav.organization' },
  { id: 'administration', header: 'nav.administration' },
  // Only in the Admin organization (OPERATOR_ORG_ID), for the instance's operators.
  { id: 'superAdmin', header: 'nav.superAdmin' },
];

async function fetchJson(url: string, authHeaders: () => Promise<Record<string, string>>): Promise<unknown> {
  const res = await fetch(url, { headers: await authHeaders() });
  return res.json();
}

/**
 * The core's pages, in navbar order. `object` is the permission behind each page; `allowedByRole`
 * is the fallback the app used before permissions existed (until they load, or offline).
 */
export const CORE_PAGES: AppPage[] = [
  // myWork
  {
    section: 'home',
    hash: '#/home',
    nav: { group: 'myWork', label: 'nav.home', icon: <DashboardIcon fontSize="small" /> },
    render: (c) => c.orgId === OPERATOR_ORG_ID ? <SuperAdminHome onNavigate={(target) => c.navigate(target)} /> : (
      <Home
        orgId={c.orgId}
        userId={c.userId}
        displayName={c.session.displayName}
        canManage={c.roles.canManage}
        isHrOrAdmin={c.isReviewer}
        authHeaders={c.authHeaders}
        onNavigate={(target) => c.navigate(target)}
        pluginActions={c.homeActions}
        onWorkTimeChanged={c.onWorkTimeChanged}
        onReviewResolved={c.onBadgesChanged}
      />
    ),
  },
  {
    section: 'workTime',
    hash: '#/work-time',
    object: 'nav.workTime',
    nav: { group: 'myWork', label: 'nav.workTime', icon: <TimerIcon fontSize="small" /> },
    render: (c) => (
      <TeamView
        orgId={c.orgId}
        kind="workTime"
        authHeaders={c.authHeaders}
        renderOwn={(personId) => (
          <WorkTime orgId={c.orgId} userId={c.userId} authHeaders={c.authHeaders} onWorkTimeChanged={c.onWorkTimeChanged} initialPersonId={personId} />
        )}
      />
    ),
  },
  {
    section: 'absences',
    hash: '#/absences',
    object: 'nav.absences',
    nav: { group: 'myWork', label: 'nav.absences', icon: <BeachAccessIcon fontSize="small" /> },
    render: (c) => (
      <TeamView orgId={c.orgId} kind="absences" authHeaders={c.authHeaders} renderOwn={() => <Absences orgId={c.orgId} userId={c.userId} authHeaders={c.authHeaders} />} />
    ),
  },
  {
    section: 'timesheet',
    hash: '#/timesheet',
    object: 'nav.timesheet',
    nav: { group: 'myWork', label: 'nav.monthlyTimesheet', icon: <CalendarMonthIcon fontSize="small" /> },
    render: (c) => (
      <TeamView
        orgId={c.orgId}
        kind="timesheet"
        authHeaders={c.authHeaders}
        renderOwn={(personId, month) => (
          <Timesheet orgId={c.orgId} userId={c.userId} authHeaders={c.authHeaders} initialPersonId={personId} initialMonth={month} />
        )}
      />
    ),
  },

  // projectTracking
  {
    section: 'time',
    hash: '#/time',
    object: 'nav.time',
    nav: { group: 'projectTracking', label: 'nav.timeTracking', icon: <ScheduleIcon fontSize="small" /> },
    render: (c) => (
      <TeamView
        orgId={c.orgId}
        kind="time"
        authHeaders={c.authHeaders}
        renderOwn={(personId) => (
          <ProjectTime
            orgId={c.orgId}
            userId={c.userId}
            useProjectTimeRanges={c.session.settings?.useProjectTimeMinutesRanges === true}
            authHeaders={c.authHeaders}
            projectsVersion={c.projectsVersion}
            initialPersonId={personId}
          />
        )}
      />
    ),
  },
  {
    section: 'projectTimesheet',
    hash: '#/project-timesheet',
    object: 'nav.projectTimesheet',
    nav: { group: 'projectTracking', label: 'nav.projectTimesheet', icon: <WorkspacesIcon fontSize="small" /> },
    render: (c) => (
      <TeamView
        orgId={c.orgId}
        kind="projectTimesheet"
        authHeaders={c.authHeaders}
        renderOwn={(personId, month) => (
          <ProjectTimesheet orgId={c.orgId} userId={c.userId} authHeaders={c.authHeaders} initialPersonId={personId} initialMonth={month} />
        )}
      />
    ),
  },

  // organization
  {
    section: 'news',
    hash: '#/news',
    object: 'nav.news',
    nav: {
      group: 'organization',
      after: 'reports',
      label: 'nav.news',
      icon: <CampaignIcon fontSize="small" />,
      badge: async ({ orgId, authHeaders }) => {
        const d = (await fetchJson(`${API}/organizations/${orgId}/news/summary`, authHeaders)) as { unread?: unknown } | null;
        return typeof d?.unread === 'number' ? d.unread : 0;
      },
    },
    render: (c) => <News orgId={c.orgId} userId={c.userId} authHeaders={c.authHeaders} refreshKey={c.liveNotification} onChanged={c.onBadgesChanged} />,
  },
  {
    section: 'directory',
    hash: '#/directory',
    object: 'nav.directory',
    nav: { group: 'organization', after: 'flows', label: 'nav.directory', icon: <ContactsIcon fontSize="small" /> },
    render: (c) => <Directory orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'balances',
    hash: '#/balances',
    object: 'nav.balances',
    allowedByRole: (r) => r.canManage,
    nav: { group: 'personal', after: 'myData', label: 'nav.balances', icon: <AccountBalanceWalletIcon fontSize="small" /> },
    render: (c) => <BalanceReport orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'reports',
    hash: '#/reports',
    object: 'nav.reports',
    nav: { group: 'organization', after: 'managementProjects', label: 'nav.reports', icon: <BarChartIcon fontSize="small" /> },
    render: (c) => <Reports orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'flows',
    hash: '#/flows',
    object: 'nav.approvals',
    // Everyone sees their own flows; managers and HR decide on others'.
    allowedByRole: () => true,
    nav: {
      group: 'organization',
      label: 'flows.title',
      icon: <AccountTreeIcon fontSize="small" />,
      // What waits for the caller: workflow items (a free flow's steps among them) and free flows to handle.
      badge: async ({ orgId, authHeaders }) => {
        const [items, summary] = await Promise.all([
          fetchJson(`${API}/workflows/assigned-to-me?orgId=${orgId}`, authHeaders),
          fetchJson(`${API}/organizations/${orgId}/flows/summary`, authHeaders) as Promise<{ inboxFree?: unknown } | null>,
        ]);
        return (Array.isArray(items) ? items.length : 0) + (typeof summary?.inboxFree === 'number' ? summary.inboxFree : 0);
      },
    },
    render: (c) => flowsPage(c),
  },
  // The former Workflow and Requests pages: their links (mails, notifications, bookmarks) open the Flows page.
  { section: 'approvals', hash: '#/approvals', object: 'nav.approvals', allowedByRole: () => true, render: (c) => flowsPage(c, 'todo') },
  {
    section: 'users',
    hash: '#/users',
    object: 'nav.users',
    allowedByRole: (r) => r.canSeeUsers,
    nav: { group: 'personal', label: 'nav.users', icon: <PeopleIcon fontSize="small" />, showForChildren: true },
    render: (c) => {
      const p = c.permissions;
      const r = c.roles;
      return (
        <Users
          orgId={c.orgId}
          isAdmin={r.isAdmin}
          isHr={r.isHr}
          canAccessBasicData={p ? seesOthersBasicData(p) : r.isAdmin || r.isHr}
          canSeeWorkSchedules={p ? holdsBeyondOwn(p, 'section.workTime.schedule', 'see') : r.isAdmin || r.isHr || r.canManage}
          canSeeEmployment={p ? holdsBeyondOwn(p, 'section.people.employment', 'see') : r.isAdmin || r.isHr || r.canManage}
          canSeePersonnelDocs={p ? holdsBeyondOwn(p, 'section.people.documents', 'see') : r.isHr}
          canViewBalances={p ? holdsBeyondOwn(p, 'nav.balances', 'see') : r.isHr}
          canInvite={p ? holdsBeyondOwn(p, 'nav.invitations', 'edit') : r.isAdmin}
          canEditDepartments={p ? grantedScopes(p, 'section.people.employment', 'edit').has('all') : r.isHr}
          authHeaders={c.authHeaders}
        />
      );
    },
  },
  {
    section: 'invitations',
    hash: '#/invitations',
    object: 'nav.invitations',
    allowedByRole: (r) => r.canManage,
    nav: { group: 'personal', parent: 'users', label: 'nav.invitations', icon: <MailIcon fontSize="small" /> },
    render: (c) => <Invitations orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    // Team calendar: absences and vacations of everyone the caller may see (HR, managers), one month at a time.
    section: 'calendar',
    hash: '#/calendar',
    object: 'nav.calendar',
    allowedByRole: (r) => r.isHr || r.canManage,
    nav: { group: 'personal', label: 'nav.calendar', icon: <EventIcon fontSize="small" /> },
    render: (c) => <TeamCalendar orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  ...(['management', 'managementProjects'] as const).map((section): AppPage => ({
    section,
    hash: section === 'management' ? '#/teams' : '#/projects',
    object: 'nav.management',
    allowedByRole: (r) => r.canManage,
    // Projects & Teams opens the projects; Teams is its sub-entry.
    nav: section === 'managementProjects'
      ? { group: 'organization', after: 'directory', label: 'nav.management', icon: <WorkspacesIcon fontSize="small" /> }
      : { group: 'organization', parent: 'managementProjects', label: 'nav.teams', icon: <GroupIcon fontSize="small" /> },
    render: (c) => (
      <Management
        session={c.session}
        orgId={c.orgId}
        // 'admin' = edits every team and project; 'manager' = only the ones they lead/own.
        role={c.permissions ? (grantedScopes(c.permissions, 'nav.management', 'edit').has('all') ? 'admin' : 'manager') : c.roles.displayRole}
        authHeaders={c.authHeaders}
        tab={section === 'managementProjects' ? 'projects' : 'teams'}
        onDataChanged={c.onProjectsChanged}
      />
    ),
  })),
  {
    // Customers (127): whom the organization works for; a project names its customer. The label follows the term.
    section: 'customers',
    hash: '#/customers',
    object: 'nav.customers',
    allowedByRole: (r) => r.isAdmin || r.isBillingAdmin || r.canManage,
    nav: { group: 'organization', parent: 'managementProjects', label: 'nav.customers', icon: <BusinessIcon fontSize="small" /> },
    render: (c) => <Customers orgId={c.orgId} authHeaders={c.authHeaders} />,
  },

  // administration
  {
    section: 'orgSettings',
    hash: '#/org-settings',
    object: 'nav.orgSettings',
    allowedByRole: (r) => r.isAdmin,
    nav: { group: 'administration', label: 'nav.organizationSettings', icon: <SettingsIcon fontSize="small" /> },
    render: (c) => <OrganizationSettings orgId={c.orgId} authHeaders={c.authHeaders} onModulesChanged={c.onModulesChanged} />,
  },
  {
    section: 'importExport',
    hash: '#/import-export',
    object: 'nav.importExport',
    allowedByRole: (r) => r.isHr,
    nav: { group: 'administration', label: 'nav.importExport', icon: <ImportExportIcon fontSize="small" /> },
    render: (c) => <ImportExport orgId={c.orgId} isAdmin={c.roles.isAdmin} isHr={c.roles.isHr} authHeaders={c.authHeaders} />,
  },
  {
    section: 'audit',
    hash: '#/audit',
    object: 'nav.audit',
    allowedByRole: (r) => r.isAdmin,
    nav: { group: 'administration', label: 'nav.auditLog', icon: <HistoryIcon fontSize="small" /> },
    render: (c) => <AuditLog orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  ...(['admin', 'adminRoles'] as const).map((section): AppPage => ({
    section,
    hash: section === 'admin' ? '#/admin' : '#/admin/roles',
    object: section === 'admin' ? 'nav.admin' : 'section.admin.roles',
    allowedByRole: (r) => r.isAdmin,
    nav: section === 'admin'
      ? { group: 'administration', label: 'nav.adminSettings', icon: <TuneIcon fontSize="small" /> }
      : { group: 'administration', parent: 'admin', label: 'roles.title', icon: <GroupIcon fontSize="small" /> },
    render: (c) => <AdminSettings orgId={c.orgId} authHeaders={c.authHeaders} tab={section === 'adminRoles' ? 'roles' : 'staticData'} />,
  })),
  // Admin settings -> Workflows: the configurable workflows' steps (read by admins, changed by owners).
  {
    section: 'adminWorkflows',
    hash: '#/admin/workflows',
    object: 'nav.admin',
    allowedByRole: (r) => r.isAdmin,
    nav: { group: 'administration', parent: 'admin', label: 'workflowConfig.title', icon: <AccountTreeIcon fontSize="small" /> },
    render: (c) => <WorkflowSettings orgId={c.orgId} authHeaders={c.authHeaders} />,
  },

  { section: 'requests', hash: '#/requests', object: 'nav.flows', render: (c) => flowsPage(c, c.flowFocus ? undefined : 'mine') },
  // personal
  {
    section: 'documents',
    hash: '#/documents',
    object: 'nav.documents',
    // Under My Data: one's own documents belong with one's own details.
    nav: { group: 'personal', parent: 'myData', label: 'nav.documents', icon: <DescriptionIcon fontSize="small" /> },
    render: (c) => <Documents orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'myData',
    hash: '#/my-data',
    object: 'nav.myData',
    nav: {
      group: 'personal',
      // Seldom changed: at the end of the group.
      last: true,
      label: 'nav.myData',
      icon: <PersonIcon fontSize="small" />,
      // Change requests waiting for review, for whoever reviews them.
      badge: async ({ orgId, authHeaders, permissions, roles }) => {
        if (!(permissions ? isBasicDataReviewer(permissions) : roles.isAdmin || roles.isHr)) return 0;
        const d = await fetchJson(`${API}/organizations/${orgId}/basicdata/pending`, authHeaders);
        return Array.isArray(d) ? d.length : 0;
      },
    },
    render: (c) => (
      <MyData
        orgId={c.orgId}
        userId={c.userId}
        authHeaders={c.authHeaders}
        onReviewResolved={c.onBadgesChanged}
        showWorkSchedule={c.permissions ? holdsAny(c.permissions, 'section.workTime.schedule') : true}
        showEmployment={c.permissions ? holdsAny(c.permissions, 'section.people.employment') : true}
      />
    ),
  },
  // Super Admin: only operators hold `nav.operator`, and only in the Admin organization (access.ts).
  {
    section: 'superAdminInstance',
    hash: '#/super-admin/instance',
    object: 'nav.operator',
    allowedByRole: () => false,
    nav: { group: 'superAdmin', label: 'nav.superAdminInstance', icon: <MemoryIcon fontSize="small" /> },
    render: (c) => <SuperAdminInstance authHeaders={c.authHeaders} />,
  },
  {
    section: 'superAdminLicenses',
    hash: '#/super-admin/licenses',
    object: 'nav.operator',
    allowedByRole: () => false,
    nav: { group: 'superAdmin', label: 'nav.superAdminLicenses', icon: <KeyIcon fontSize="small" /> },
    render: (c) => <SuperAdminLicenses authHeaders={c.authHeaders} />,
  },
  {
    section: 'superAdminAi',
    hash: '#/super-admin/ai',
    object: 'nav.operator',
    allowedByRole: () => false,
    nav: { group: 'superAdmin', label: 'nav.superAdminAi', icon: <BarChartIcon fontSize="small" /> },
    render: (c) => <SuperAdminAi authHeaders={c.authHeaders} />,
  },
  {
    section: 'superAdminNews',
    hash: '#/super-admin/news',
    object: 'nav.operator',
    allowedByRole: () => false,
    nav: { group: 'superAdmin', label: 'nav.superAdminNews', icon: <CampaignIcon fontSize="small" /> },
    render: (c) => <SuperAdminNews authHeaders={c.authHeaders} />,
  },
  {
    // The static data every organization starts from (global rows): operators add values and lists, change
    // translations; what migrations put there stays (operator-static-data.controller.ts).
    section: 'superAdminStaticData',
    hash: '#/super-admin/default-lists',
    object: 'nav.operator',
    allowedByRole: () => false,
    nav: { group: 'superAdmin', label: 'nav.superAdminStaticData', icon: <TuneIcon fontSize="small" /> },
    render: (c) => <DefaultLists orgId={c.orgId} authHeaders={c.authHeaders} operator />,
  },
  {
    section: 'superAdminUsers',
    hash: '#/super-admin/superusers',
    object: 'nav.operator',
    allowedByRole: () => false,
    nav: { group: 'superAdmin', label: 'nav.superAdminUsers', icon: <VerifiedUserIcon fontSize="small" /> },
    render: (c) => <SuperAdminUsers authHeaders={c.authHeaders} />,
  },
];

/** The Flows page (Flows.tsx), opened on `tab` (else the caller's inbox when they decide, else their own). */
function flowsPage(c: CorePageContext, tab?: 'todo' | 'mine' | 'done') {
  const p = c.permissions;
  return (
    <Flows
      orgId={c.orgId}
      userId={c.userId}
      role={c.roles.displayRole}
      canDecide={p ? holdsBeyondOwn(p, 'nav.approvals', 'edit') : c.roles.canManage}
      hasFreeFlows={p ? holdsAny(p, 'nav.flows') : true}
      authHeaders={c.authHeaders}
      initialTab={tab}
      focus={c.flowFocus}
      refreshKey={c.liveNotification}
      onChanged={c.onBadgesChanged}
      navigate={c.navigate}
    />
  );
}
