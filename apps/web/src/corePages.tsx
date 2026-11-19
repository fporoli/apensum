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
  CheckCircleIcon,
  ContactsIcon,
  DashboardIcon,
  DescriptionIcon,
  FolderCopyIcon,
  ForumIcon,
  GroupIcon,
  HistoryIcon,
  ImportExportIcon,
  MailIcon,
  PeopleIcon,
  PersonIcon,
  ScheduleIcon,
  SettingsIcon,
  TimerIcon,
  TuneIcon,
  WorkspacesIcon,
} from './icons';

const Home = lazy(() => import('./Home'));
const MyData = lazy(() => import('./MyData'));
const ProjectTime = lazy(() => import('./ProjectTime'));
const Management = lazy(() => import('./Management'));
const Invitations = lazy(() => import('./Invitations'));
const AdminSettings = lazy(() => import('./AdminSettings'));
const OrganizationSettings = lazy(() => import('./OrganizationSettings'));
const Timesheet = lazy(() => import('./Timesheet'));
const WorkTime = lazy(() => import('./WorkTime'));
const Absences = lazy(() => import('./Absences'));
const Approvals = lazy(() => import('./Approvals'));
const TeamHours = lazy(() => import('./TeamHours'));
const Reports = lazy(() => import('./Reports'));
const ProjectTimesheet = lazy(() => import('./ProjectTimesheet'));
const TeamView = lazy(() => import('./TeamView'));
const BalanceReport = lazy(() => import('./BalanceReport'));
const AuditLog = lazy(() => import('./AuditLog'));
const Users = lazy(() => import('./Users'));
const Requests = lazy(() => import('./Requests'));
const Documents = lazy(() => import('./Documents'));
const Directory = lazy(() => import('./Directory'));
const ImportExport = lazy(() => import('./ImportExport'));

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
  requestFocus: string | null;
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
  { id: 'organization', header: 'nav.organization' },
  { id: 'administration', header: 'nav.administration' },
  { id: 'personal', header: 'nav.personal' },
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
    render: (c) => (
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
    section: 'directory',
    hash: '#/directory',
    object: 'nav.directory',
    nav: { group: 'organization', label: 'nav.directory', icon: <ContactsIcon fontSize="small" /> },
    render: (c) => <Directory orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'hours',
    hash: '#/team-hours',
    object: 'nav.teamHours',
    allowedByRole: (r) => r.canManage,
    nav: { group: 'organization', label: 'nav.teamHours', icon: <GroupIcon fontSize="small" /> },
    render: (c) => <TeamHours orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'balances',
    hash: '#/balances',
    object: 'nav.balances',
    allowedByRole: (r) => r.canManage,
    nav: { group: 'organization', label: 'nav.balances', icon: <AccountBalanceWalletIcon fontSize="small" /> },
    render: (c) => <BalanceReport orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'reports',
    hash: '#/reports',
    object: 'nav.reports',
    nav: { group: 'organization', label: 'nav.reports', icon: <BarChartIcon fontSize="small" /> },
    render: (c) => <Reports orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'approvals',
    hash: '#/approvals',
    object: 'nav.approvals',
    allowedByRole: (r) => r.canManage,
    nav: {
      group: 'organization',
      label: 'nav.approvals',
      icon: <CheckCircleIcon fontSize="small" />,
      badge: async ({ authHeaders }) => {
        const d = await fetchJson(`${API}/workflows/assigned-to-me`, authHeaders);
        return Array.isArray(d) ? d.length : 0;
      },
    },
    render: (c) => <Approvals orgId={c.orgId} role={c.roles.displayRole} authHeaders={c.authHeaders} onChanged={c.onBadgesChanged} />,
  },
  {
    section: 'users',
    hash: '#/users',
    object: 'nav.users',
    allowedByRole: (r) => r.canSeeUsers,
    nav: { group: 'organization', label: 'nav.users', icon: <PeopleIcon fontSize="small" />, showForChildren: true },
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
          canManage={r.canManage}
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
    nav: { group: 'organization', parent: 'users', label: 'nav.invitations', icon: <MailIcon fontSize="small" /> },
    render: (c) => <Invitations orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  ...(['management', 'managementProjects'] as const).map((section): AppPage => ({
    section,
    hash: section === 'management' ? '#/teams' : '#/projects',
    object: 'nav.management',
    allowedByRole: (r) => r.canManage,
    nav: section === 'management'
      ? { group: 'organization', label: 'nav.management', icon: <WorkspacesIcon fontSize="small" /> }
      : { group: 'organization', parent: 'management', label: 'nav.projects', icon: <FolderCopyIcon fontSize="small" /> },
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
    allowedByRole: (r) => r.isAdmin || r.isHr,
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

  // personal
  {
    section: 'requests',
    hash: '#/requests',
    object: 'nav.requests',
    nav: {
      group: 'personal',
      label: 'nav.requests',
      icon: <ForumIcon fontSize="small" />,
      badge: async ({ orgId, authHeaders }) => {
        const d = (await fetchJson(`${API}/organizations/${orgId}/requests/summary`, authHeaders)) as { inbox?: unknown } | null;
        return typeof d?.inbox === 'number' ? d.inbox : 0;
      },
    },
    render: (c) => (
      <Requests
        orgId={c.orgId}
        userId={c.userId}
        authHeaders={c.authHeaders}
        focusId={c.requestFocus}
        refreshKey={c.liveNotification}
        onChanged={c.onBadgesChanged}
      />
    ),
  },
  {
    section: 'documents',
    hash: '#/documents',
    object: 'nav.documents',
    nav: { group: 'personal', label: 'nav.documents', icon: <DescriptionIcon fontSize="small" /> },
    render: (c) => <Documents orgId={c.orgId} authHeaders={c.authHeaders} />,
  },
  {
    section: 'myData',
    hash: '#/my-data',
    object: 'nav.myData',
    nav: {
      group: 'personal',
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
];
