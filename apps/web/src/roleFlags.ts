import type { Session } from './Login';

/** The caller's roles in one organization: the fallback until permissions have loaded (or offline). */
export interface RoleFlags {
  isAdmin: boolean;
  isManager: boolean;
  isHr: boolean;
  isBillingAdmin: boolean;
  canManage: boolean;
  canSeeUsers: boolean;
  displayRole: 'admin' | 'manager' | 'user';
}

export function resolveRoleFlags(session: Session | null, orgId: string | null): RoleFlags {
  const membership = session?.memberships.find((m) => m.organizationId === orgId);
  const roles = membership?.roles ?? (membership?.role ? [membership.role] : []);
  const isAdmin = roles.includes('owner') || roles.includes('admin') || membership?.role === 'owner' || membership?.role === 'admin';
  const isManager = roles.includes('manager') || membership?.role === 'manager';
  const isHr = roles.includes('hr');
  const isBillingAdmin = roles.includes('billing_admin');
  const canManage = isAdmin || isManager;
  return {
    isAdmin,
    isManager,
    isHr,
    isBillingAdmin,
    canManage,
    canSeeUsers: canManage || isHr,
    displayRole: isAdmin ? 'admin' : isManager ? 'manager' : 'user',
  };
}
