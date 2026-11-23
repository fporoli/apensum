// Two-step login (a code from an authenticator app after the password): optional for everyone, and
// required by an organization's rule (organizations.settings.twoFactor) for its admins and HR, or for
// everyone. An account spans organizations, so the rule applies at login: if any organization the
// person is an active member of requires it for them, they set it up before they get in. The Admin
// organization (operator.ts) always requires it.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

export const TWO_FACTOR_POLICIES = ['off', 'privileged', 'all'] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];

/** The stored rule, `off` for anything missing or unknown. */
export function parseTwoFactorPolicy(raw: unknown): TwoFactorPolicy {
  return (TWO_FACTOR_POLICIES as readonly unknown[]).includes(raw) ? (raw as TwoFactorPolicy) : 'off';
}

/**
 * "Admins and HR": whoever holds Admin settings (`nav.admin`), edits everyone's employment
 * (`section.people.employment`, HR) or may export everyone's data (`nav.importExport`).
 */
export function isPrivileged(held: Iterable<string>): boolean {
  for (const id of held) {
    const [object, action, scope] = id.split(':');
    if (object === 'nav.admin') return true;
    if ((object === 'section.people.employment' || object === 'nav.importExport') && action === 'edit' && scope !== 'own') return true;
    if (object === 'nav.importExport' && scope === 'all') return true;
  }
  return false;
}

/** Whether one membership's organization requires a second step of this person. */
export function membershipRequires(policy: TwoFactorPolicy, privileged: boolean): boolean {
  return policy === 'all' || (policy === 'privileged' && privileged);
}
