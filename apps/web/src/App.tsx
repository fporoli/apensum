import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Collapse,
  Container,
  Drawer,
  FormControl,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  MenuItem,
  Select,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useI18n, type Locale } from './i18n';
import { useBranding } from './theme';
import Login, { clearSession, loadSession, saveSession, type Session } from './Login';
import { keycloak, refreshSsoToken, ssoLogout } from './auth';
import UserMenu from './UserMenu';
import { DesignModeNotice, DesignModeProvider, useDesignAccess } from './designMode';
import NotificationBell from './NotificationBell';
import { useNotifications, type Notification } from './useNotifications';
import { formatDurationMinutes } from './localeFormat';
import { PLUGIN_NAV_GROUPS, PLUGIN_NOTIFICATION_SECTIONS, PLUGIN_PAGES } from './plugins';
import { ApensumMark } from './ApensumMark';
import { CORE_NAV_GROUPS, CORE_PAGES, type AppPage, type CorePageContext } from './corePages';
import { buildNavTree, sectionHashes } from './navigation';
import { resolveRoleFlags, type RoleFlags } from './roleFlags';
import { holdsAny, isBasicDataReviewer } from '@worktime3/shared/permissions';
import {
  AutoAwesomeIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  MenuIcon,
  TimerIcon,
} from './icons';

const Assistant = lazy(() => import('./Assistant'));

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const DRAWER_WIDTH = 240;

/** Every page: the core's (corePages.tsx), then the plugins' (plugins.ts). */
const PAGES: readonly AppPage[] = [...CORE_PAGES, ...PLUGIN_PAGES];
const NAV_TREE = buildNavTree([...CORE_NAV_GROUPS, ...PLUGIN_NAV_GROUPS], PAGES);
const { toHash: SECTION_TO_HASH, toSection: HASH_TO_SECTION } = sectionHashes(PAGES);

/** A page's section id (core or plugin). */
type Section = string;

function pageOf(section: Section): AppPage | undefined {
  return PAGES.find((p) => p.section === section);
}

function sectionFromHash(): Section {
  if (typeof window === 'undefined') return 'home';
  const clean = window.location.hash.split('?')[0];
  return HASH_TO_SECTION[clean] ?? 'home';
}

const ASSISTANT_PANEL_WIDTH = 380;

/**
 * Whether the caller may open a page. Uses their permissions in the current organization
 * (GET organizations/:orgId/me/permissions) on the page's object; until those have loaded, or when the
 * API is offline, falls back to the page's role check.
 */
function isSectionAllowed(sec: Section, flags: RoleFlags, permissions: Set<string> | null): boolean {
  const page = pageOf(sec);
  if (!page) return false;
  if (!page.object) return true;
  if (permissions) return holdsAny(permissions, page.object);
  return page.allowedByRole ? page.allowedByRole(flags) : true;
}

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [appBarNode, setAppBarNode] = useState<HTMLElement | null>(null);
  const [appBarHeight, setAppBarHeight] = useState(64);
  const [expandedNav, setExpandedNav] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!appBarNode) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setAppBarHeight(height);
    });
    observer.observe(appBarNode);
    return () => observer.disconnect();
  }, [appBarNode]);

  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [adminSession, setAdminSession] = useState<Session | null>(null);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(
    () => session?.memberships[0]?.organizationId ?? null,
  );
  const [section, setSectionState] = useState<Section>(() => sectionFromHash());
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPinned, setAssistantPinned] = useState(false);
  const [assistantEverOpened, setAssistantEverOpened] = useState(false);
  useEffect(() => { if (assistantOpen) setAssistantEverOpened(true); }, [assistantOpen]);

  const [projectsVersion, setProjectsVersion] = useState(0);
  const [workTimeVersion, setWorkTimeVersion] = useState(0);
  const [activeCheckIn, setActiveCheckIn] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Navbar counts per section (PageNav.badge).
  const [badges, setBadges] = useState<Record<string, number>>({});
  // A request to open on the Requests page (from a notification).
  const [requestFocus, setRequestFocus] = useState<string | null>(null);
  // Bumped when an organization's modules change, so the permissions (and navbar) reload.
  const [permissionsVersion, setPermissionsVersion] = useState(0);

  const orgId = currentOrgId;
  const flags = useMemo(() => resolveRoleFlags(session, orgId), [session, orgId]);
  // The caller's permission ids in the current org; null until loaded (or offline). Re-fetched per org.
  const [loadedPermissions, setPermissions] = useState<{ orgId: string; ids: Set<string> } | null>(null);
  const permissions = loadedPermissions && loadedPermissions.orgId === orgId ? loadedPermissions.ids : null;
  const allowed = useCallback((sec: Section) => isSectionAllowed(sec, flags, permissions), [flags, permissions]);
  // Edits (and reviews change requests for) other people's personal details: HR/admin by default.
  const isReviewer = permissions ? isBasicDataReviewer(permissions) : flags.isAdmin || flags.isHr;

  const navigate = useCallback((next: Section) => {
    setSectionState(next);
    const targetHash = SECTION_TO_HASH[next];
    if (typeof window !== 'undefined' && window.location.hash !== targetHash) {
      window.history.pushState(null, '', targetHash);
    }
  }, []);

  // A link to one request (`#/requests?id=...`, e.g. from a forwarded e-mail) opens it.
  useEffect(() => {
    const focusFromHash = () => {
      const [path, query] = window.location.hash.split('?');
      const id = path === '#/requests' ? new URLSearchParams(query ?? '').get('id') : null;
      if (id) setRequestFocus(id);
    };
    focusFromHash();
    window.addEventListener('hashchange', focusFromHash);
    return () => window.removeEventListener('hashchange', focusFromHash);
  }, []);

  useEffect(() => {
    const onHash = () => {
      const parsed = sectionFromHash();
      setSectionState(allowed(parsed) ? parsed : 'home');
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed(section)) {
      navigate('home');
    }
  }, [section, allowed, navigate]);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!session) return {};
    let token = session.token;
    if (session.sso) {
      await refreshSsoToken();
      token = keycloak.token ?? token;
      if (token !== session.token) {
        const updated = { ...session, token };
        setSession(updated);
        saveSession(updated);
      }
    }
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session]);

  useEffect(() => {
    setPermissions(null);
    if (!session || !orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/me/permissions`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled && data?.ok && !data.offline && Array.isArray(data.permissions)) {
          setPermissions({ orgId, ids: new Set<string>(data.permissions) });
        }
      } catch { /* offline: keep the role-based fallback */ }
    })();
    return () => {
      cancelled = true;
    };
    // authHeaders changes when the SSO token refreshes; that must not drop and refetch permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, orgId, permissionsVersion]);

  // The organization's look and feel (theme colors, app bar logo); the default theme when signed out.
  const { branding, setBranding } = useBranding();
  useEffect(() => {
    setBranding({});
    if (!session || !orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/branding`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled && data?.ok && data.branding) setBranding(data.branding);
      } catch { /* offline: default look */ }
    })();
    return () => {
      cancelled = true;
    };
    // Same as permissions: a token refresh must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, orgId]);

  const designAccess = useDesignAccess(orgId, authHeaders);
  const { items: notifications, unreadCount, live: liveNotification, clearLive, markRead, markAllRead } = useNotifications(session, authHeaders);

  const refreshBadges = useCallback(async () => {
    if (!session || !orgId) {
      setBadges({});
      return;
    }
    const ctx = { orgId, authHeaders, permissions, roles: flags };
    const counted = await Promise.all(
      PAGES.filter((p) => p.nav?.badge && allowed(p.section)).map(async (p) => {
        try {
          return [p.section, await p.nav!.badge!(ctx)] as const;
        } catch {
          return [p.section, 0] as const; // offline
        }
      }),
    );
    setBadges(Object.fromEntries(counted));
  }, [session, orgId, flags, permissions, authHeaders, allowed]);

  const refreshWorkStatus = useCallback(async () => {
    if (!session) {
      setActiveCheckIn(null);
      return;
    }
    try {
      const res = await fetch(`${API}/work-time/status`, { headers: await authHeaders() });
      const data = await res.json();
      setActiveCheckIn(data && data.check_in && !data.check_out ? data.check_in : null);
    } catch { /* offline fallback */ }
  }, [session, authHeaders]);

  useEffect(() => {
    void refreshBadges();
  }, [refreshBadges, liveNotification]);

  useEffect(() => {
    void refreshWorkStatus();
  }, [refreshWorkStatus, workTimeVersion, orgId]);

  useEffect(() => {
    if (!activeCheckIn) return;
    const timer = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [activeCheckIn]);

  // Ctrl+/ or Cmd+/ opens or closes the assistant (the header's sparkle button does the same).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setAssistantOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!session || (session.locale && session.settings)) return;
    (async () => {
      try {
        const res = await fetch(`${API}/users/me`, { headers: await authHeaders() });
        const data = await res.json();
        if (data.ok) {
          setSession((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, locale: data.locale ?? prev.locale, settings: data.settings ?? prev.settings ?? {} };
            saveSession(updated);
            return updated;
          });
        }
      } catch { /* offline demo */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId]);

  useEffect(() => {
    if (session?.locale && session.locale !== locale) setLocale(session.locale as Locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.locale]);

  function navigateToNotification(n: Notification) {
    if (n.type === 'workflow.assigned') {
      navigate('approvals');
      return;
    }
    if (n.source_table === 'personnel_documents' || n.source_table === 'report_runs') {
      navigate('documents');
      return;
    }
    if (n.source_table === 'news_posts') {
      window.location.hash = `#/news?id=${n.source_table_uuid}`;
      return;
    }
    if (n.source_table === 'requests') {
      setRequestFocus(n.source_table_uuid);
      navigate('requests');
      return;
    }
    const pluginSection = PLUGIN_NOTIFICATION_SECTIONS[n.source_table];
    if (pluginSection) navigate(pluginSection);
    else if (n.source_table === 'timesheet_periods') navigate('timesheet');
    else if (n.source_table === 'absences') navigate('absences');
    else if (n.source_table === 'basicdata' || n.source_table === 'users') navigate('myData');
  }

  function switchOrg(newOrgId: string) {
    setCurrentOrgId(newOrgId);
    const nextFlags = resolveRoleFlags(session, newOrgId);
    // The new org's permissions load afterwards (and re-check the page); until then, use its roles.
    if (!isSectionAllowed(section, nextFlags, null)) navigate('home');
    if (isMobile) setMobileNavOpen(false);
  }

  function switchUserSession(nextSession: Session, organizationId: string) {
    if (session && !adminSession) setAdminSession(session);
    setSession(nextSession);
    saveSession(nextSession);
    setCurrentOrgId(organizationId);
    navigate('home');
  }

  function returnToAdmin() {
    if (!adminSession) return;
    setSession(adminSession);
    saveSession(adminSession);
    setCurrentOrgId(adminSession.memberships[0]?.organizationId ?? null);
    setAdminSession(null);
    navigate('home');
  }

  function closeAssistant() {
    setAssistantOpen(false);
    setAssistantPinned(false);
  }



  async function logout() {
    if (session?.sso) {
      try {
        await ssoLogout();
      } catch { /* fall through */ }
    }
    clearSession();
    setSession(null);
  }

  if (!session) {
    return (
      <Login
        onLoggedIn={(s) => {
          setSession(s);
          setAdminSession(null);
          saveSession(s);
          const firstOrg = s.memberships[0]?.organizationId ?? null;
          setCurrentOrgId(firstOrg);
          navigate('home');
        }}
      />
    );
  }

  interface NavSubItem {
    id: string;
    section: Section;
    label: string;
    icon?: ReactNode;
    visible: boolean;
    badge?: number;
  }

  interface NavItem extends NavSubItem {
    children?: NavSubItem[];
  }

  const toNavItem = (p: AppPage): NavSubItem => ({
    id: p.section,
    section: p.section,
    label: t(p.nav!.label),
    icon: p.nav!.icon,
    visible: allowed(p.section),
    badge: badges[p.section],
  });
  const NAV_GROUPS: Array<{ id: string; header: string; items: NavItem[] }> = NAV_TREE.map((g) => ({
    id: g.id,
    header: g.header ? t(g.header) : '',
    items: g.items.map(({ page, children }): NavItem => {
      const subItems = children.map(toNavItem);
      const item = toNavItem(page);
      return {
        ...item,
        visible: item.visible || (!!page.nav!.showForChildren && subItems.some((c) => c.visible)),
        children: subItems.length > 0 ? subItems : undefined,
      };
    }),
  }));

  const pageContext: CorePageContext | null = orgId
    ? {
        orgId,
        userId: session.userId,
        authHeaders,
        permissions,
        roles: flags,
        navigate,
        session,
        isReviewer,
        onBadgesChanged: () => void refreshBadges(),
        onWorkTimeChanged: () => setWorkTimeVersion((v) => v + 1),
        projectsVersion,
        onProjectsChanged: () => setProjectsVersion((v) => v + 1),
        requestFocus,
        liveNotification,
        onModulesChanged: () => setPermissionsVersion((v) => v + 1),
        homeActions: PAGES.filter((p) => p.homeAction && allowed(p.section)).map((p) => ({
          section: p.section,
          label: t(p.homeAction!.label),
          icon: p.homeAction!.icon,
          after: p.homeAction!.after,
        })),
      }
    : null;
  const currentPage = pageContext && allowed(section) ? pageOf(section) : undefined;

  const navList = (
    <List dense>
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((n) => n.visible);
        if (visibleItems.length === 0) return null;
        return (
          <li key={group.id}>
            <ul style={{ padding: 0 }}>
              {group.header && (
                <ListSubheader
                  disableSticky
                  sx={{
                    bgcolor: 'transparent',
                    color: 'text.secondary',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    lineHeight: '28px',
                    mx: 1.5,
                    mt: 1.5,
                    mb: 0.5,
                  }}
                >
                  {group.header}
                </ListSubheader>
              )}
              {visibleItems.map((n) => {
                const visibleChildren = n.children?.filter((c) => c.visible) ?? [];
                const hasChildren = visibleChildren.length > 0;
                const isChildActive = visibleChildren.some((c) => c.section === section);
                const isExpanded =
                  expandedNav[n.id] !== undefined
                    ? expandedNav[n.id]
                    : (section === n.section || isChildActive);

                return (
                  <li key={n.id} style={{ listStyle: 'none' }}>
                    <ListItemButton
                      selected={section === n.section}
                      onClick={() => {
                        if (allowed(n.section)) {
                          navigate(n.section);
                          if (hasChildren) {
                            if (section === n.section) {
                              setExpandedNav((prev) => ({ ...prev, [n.id]: !isExpanded }));
                            } else {
                              setExpandedNav((prev) => ({ ...prev, [n.id]: true }));
                            }
                          }
                          if (isMobile) setMobileNavOpen(false);
                        } else if (hasChildren) {
                          setExpandedNav((prev) => ({ ...prev, [n.id]: !isExpanded }));
                        }
                      }}
                    >
                      {n.icon && (
                        <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
                          {n.icon}
                        </ListItemIcon>
                      )}
                      <ListItemText
                        primary={n.label}
                        slotProps={{ primary: { fontSize: '0.9rem' } }}
                      />
                      {!!n.badge && n.badge > 0 && (
                        <Chip
                          size="small"
                          label={n.badge}
                          color="warning"
                          sx={{ height: 20, fontSize: '0.72rem', ml: 0.5 }}
                        />
                      )}
                      {hasChildren && (
                        <Box
                          component="span"
                          role="button"
                          tabIndex={0}
                          aria-label={isExpanded ? 'collapse' : 'expand'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedNav((prev) => ({ ...prev, [n.id]: !isExpanded }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              setExpandedNav((prev) => ({ ...prev, [n.id]: !isExpanded }));
                            }
                          }}
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            p: 0.25,
                            ml: 0.5,
                            borderRadius: 1,
                            color: 'text.secondary',
                            cursor: 'pointer',
                            '&:hover': {
                              bgcolor: 'action.hover',
                              color: 'text.primary',
                            },
                          }}
                        >
                          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        </Box>
                      )}
                    </ListItemButton>
                    {hasChildren && (
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <List component="div" disablePadding dense>
                          {visibleChildren.map((child) => (
                            <ListItemButton
                              key={child.id}
                              selected={section === child.section}
                              onClick={() => {
                                navigate(child.section);
                                if (isMobile) setMobileNavOpen(false);
                              }}
                              sx={{
                                pl: 4,
                                py: 0.5,
                                minHeight: 34,
                              }}
                            >
                              {child.icon && (
                                <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                                  {child.icon}
                                </ListItemIcon>
                              )}
                              <ListItemText
                                primary={child.label}
                                slotProps={{
                                  primary: {
                                    fontSize: '0.84rem',
                                    fontWeight: section === child.section ? 600 : 400,
                                  },
                                }}
                              />
                              {!!child.badge && child.badge > 0 && (
                                <Chip
                                  size="small"
                                  label={child.badge}
                                  color="warning"
                                  sx={{ height: 18, fontSize: '0.7rem', ml: 0.5 }}
                                />
                              )}
                            </ListItemButton>
                          ))}
                        </List>
                      </Collapse>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </List>
  );

  // The assistant takes no room while closed; open it overlays the page, pinned (desktop) it is docked
  // and the page makes room for it.
  const assistantDocked = !isMobile && !!orgId && assistantOpen && assistantPinned;
  const assistantReservedWidth = assistantDocked ? ASSISTANT_PANEL_WIDTH : 0;
  const designMode = { ...designAccess, panelTop: appBarHeight, panelRight: assistantReservedWidth };
  const activeElapsed = activeCheckIn ? Math.max(0, Math.round((nowMs - new Date(activeCheckIn).getTime()) / 60000)) : 0;

  return (
    <DesignModeProvider value={designMode}>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <AppBar ref={setAppBarNode} position="fixed" sx={{ zIndex: (th) => th.zIndex.drawer + 1 }}>
          <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap', py: 1 }}>
            {isMobile && (
              <IconButton color="inherit" edge="start" onClick={() => setMobileNavOpen(true)} aria-label={t('app.openNavigation')}>
                <MenuIcon />
              </IconButton>
            )}
            <Box
              onClick={() => navigate('home')}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexGrow: 1, cursor: 'pointer' }}
            >
              {branding.logo ? (
                <Box
                  component="img"
                  src={branding.logo}
                  alt={session.memberships.find((m) => m.organizationId === orgId)?.name ?? ''}
                  sx={{ height: 36, maxWidth: 140, objectFit: 'contain', display: 'block', borderRadius: '6px' }}
                />
              ) : (
                <ApensumMark size={28} variant="onColor" sx={{ display: { xs: 'none', sm: 'block' } }} />
              )}
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('appbar.title')}</Typography>
            </Box>

            {activeCheckIn && (
              <Chip
                size="small"
                color="success"
                icon={<TimerIcon fontSize="small" />}
                label={t('app.checkedInBadge', { elapsed: formatDurationMinutes(activeElapsed) })}
                onClick={() => navigate('workTime')}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.18)',
                  color: 'inherit',
                  fontWeight: 600,
                  border: '1px solid rgba(255,255,255,0.22)',
                  backdropFilter: 'blur(4px)',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.26)' },
                  '& .MuiChip-icon': { color: '#86efac' },
                  display: { xs: 'none', md: 'inline-flex' },
                }}
              />
            )}

            {session.memberships.length > 1 ? (
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <Select
                  value={currentOrgId ?? ''}
                  onChange={(e) => switchOrg(e.target.value)}
                  inputProps={{ 'aria-label': t('app.orgSwitcher') }}
                  sx={{ bgcolor: 'background.paper', borderRadius: 1 }}
                >
                  {session.memberships.map((m) => (
                    <MenuItem key={m.organizationId} value={m.organizationId}>{m.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              session.memberships[0] && (
                <Typography variant="body2" sx={{ opacity: 0.85, display: { xs: 'none', sm: 'block' } }}>
                  {session.memberships[0].name}
                </Typography>
              )
            )}

            {orgId && (
              <Tooltip title={`${t('assistant.title')} (Ctrl+/)`}>
                {/* A labelled pill, not a bare icon, so the assistant is found; just the icon on a phone. */}
                <Button
                  color="inherit"
                  variant="outlined"
                  aria-label={t('assistant.title')}
                  aria-pressed={assistantOpen}
                  onClick={() => setAssistantOpen((open) => !open)}
                  startIcon={<AutoAwesomeIcon />}
                  sx={{
                    borderRadius: 999,
                    borderColor: 'rgba(255,255,255,0.6)',
                    bgcolor: assistantOpen ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.1)',
                    textTransform: 'none',
                    fontWeight: 600,
                    minWidth: 0,
                    px: { xs: 1, sm: 1.75 },
                    '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 }, ml: { xs: 0, sm: -0.25 } },
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.28)', borderColor: 'common.white' },
                  }}
                >
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('assistant.title')}</Box>
                </Button>
              </Tooltip>
            )}

            <NotificationBell
              items={notifications}
              unreadCount={unreadCount}
              live={liveNotification}
              clearLive={clearLive}
              markRead={markRead}
              markAllRead={markAllRead}
              onItemClick={navigateToNotification}
            />

            <UserMenu
              session={session}
              authHeaders={authHeaders}
              currentOrgId={currentOrgId}
              canSwitchUser={flags.isAdmin && !adminSession}
              canDesign={designAccess.canDesign}
              designMode={designAccess.enabled}
              onDesignModeChange={designAccess.setEnabled}
              adminSession={adminSession}
              onSwitchSession={switchUserSession}
              onReturnToAdmin={returnToAdmin}
              onLogout={logout}
              onLocaleChange={(newLocale) => {
                const updated = { ...session, locale: newLocale };
                setSession(updated);
                saveSession(updated);
              }}
              onSettingsChange={(newSettings) => {
                const updated = { ...session, settings: newSettings };
                setSession(updated);
                saveSession(updated);
              }}
            />
          </Toolbar>
        </AppBar>

        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={isMobile ? mobileNavOpen : true}
          onClose={() => setMobileNavOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              ...(isMobile ? { top: appBarHeight, height: `calc(100% - ${appBarHeight}px)` } : {}),
            },
          }}
        >
          {!isMobile && <Box sx={{ height: appBarHeight, flexShrink: 0 }} />}
          {navList}
        </Drawer>

        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ height: appBarHeight, flexShrink: 0 }} />
          {/* minmax(0, 1fr): without it the grid's one column grows to its widest child (a table, a row
              of tabs) and pushes the whole page wider than a phone screen. */}
          <Container maxWidth="xl" sx={{ py: 3, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
            <DesignModeNotice />
            <Suspense fallback={<LinearProgress sx={{ my: 2 }} />}>
              {currentPage && pageContext && currentPage.render(pageContext)}
            </Suspense>
          </Container>
        </Box>

        {!isMobile && (
          <Box sx={{ width: assistantReservedWidth, flexShrink: 0, transition: 'width 0.2s ease' }} />
        )}

        {/* The assistant: slides in from the right below the header (full screen on a phone); overlay while
            open, docked when pinned. Mounted once opened, so a conversation survives closing it. */}
        {orgId && (
          <Box
            role="complementary"
            aria-label={t('assistant.title')}
            aria-hidden={!assistantOpen}
            sx={{
              position: 'fixed',
              top: appBarHeight,
              right: 0,
              bottom: 0,
              width: isMobile ? '100vw' : ASSISTANT_PANEL_WIDTH,
              maxWidth: '100vw',
              transform: assistantOpen ? 'none' : 'translateX(100%)',
              visibility: assistantOpen ? 'visible' : 'hidden',
              transition: 'transform 0.2s ease, visibility 0.2s',
              zIndex: (th) => th.zIndex.drawer + 2,
              boxShadow: assistantOpen && !assistantDocked ? '-4px 0 20px rgba(16,24,40,0.14)' : 'none',
            }}
          >
            {assistantEverOpened && (
              <Suspense fallback={<LinearProgress sx={{ m: 2 }} />}>
                <Assistant
                  orgId={orgId}
                  authHeaders={authHeaders}
                  onClose={closeAssistant}
                  pinned={isMobile ? undefined : assistantPinned}
                  onTogglePin={isMobile ? undefined : () => setAssistantPinned((pinned) => !pinned)}
                />
              </Suspense>
            )}
          </Box>
        )}
      </Box>
    </DesignModeProvider>
  );
}
