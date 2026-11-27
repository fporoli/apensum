import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from './client-ip';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { forgetSessions, mintSessionToken } from './session-state';
import { Public } from './jwt.guard';
import { purposeKey, ssoPublicConfig, TWO_FACTOR_SETUP_TOKEN_SEC, verifySsoIdToken } from './jwt';
import { sendMail } from './mailer';
import * as bcrypt from 'bcryptjs';
import { users, user_identities, organizations, organization_memberships, organization_invitations, roles, membership_roles, static_data } from './db/schema';
import { invitationNeedsOwner, isOrgOwner, pickPrimaryRole } from './access';
import { VersionsService } from './versions.service';
import { NotificationsService } from './notifications.service';
import { noticeRegistration } from './registration-notice';
import { demoPeople } from './demo-switch';
import {
  HourlyLimiter, LOGIN_FAILS_PER_ACCOUNT, LOGIN_FAILS_PER_ACCOUNT_AND_IP, LOGIN_FAILS_PER_IP, mintResetToken, passwordStamp, readResetToken,
  REGISTRATIONS_PER_IP, RESET_LIMIT_PER_EMAIL, RESET_LIMIT_PER_IP, resetLink, resetMail,
} from './password-reset';
import { TWO_FACTOR_CHALLENGE_SEC, twoFactorChallengeKey, twoFactorOff, twoFactorRequired, twoFactorRow, useSecondFactor } from './two-factor';
import { clock } from './clock';

/** Second-step attempts per account within an hour (in memory, per API process). */
export const TWO_FACTOR_ATTEMPTS_PER_HOUR = 10;

/**
 * Auth: the API keeps the accounts and issues every session (local HS256 tokens).
 * - Password reset mails a signed one-time link (password-reset.ts); only the link sets the password.
 * - Identities are only ever created for the caller: an SSO login from the ID token's verified e-mail, a
 *   password by registering or by accepting an invitation as a new account.
 * - SSO is optional, one identity provider per instance (SSO_PROVIDER `dex` or `keycloak`, jwt.ts): the web app
 *   signs in there and hands the ID token to `sso/exchange` once, for a session like a password login's.
 */

export const OWNER_ROLE_ID = '00000000-0000-0000-0000-000000000001';
export const ADMIN_ROLE_ID = '00000000-0000-0000-0000-000000000002';
export const HR_ROLE_ID = '00000000-0000-0000-0000-000000000007';

/**
 * Roles of a new registration in its own workspace: owner only governs, so admin and HR come as roles
 * of their own, which a larger company moves to other people.
 */
export function registrationRoleIds(): string[] {
  return [OWNER_ROLE_ID, ADMIN_ROLE_ID, HR_ROLE_ID];
}

export function isValidEmail(email: unknown): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPassword(password: unknown): boolean {
  return typeof password === 'string' && password.length >= 8;
}

export interface DemoAccount {
  name: string;
  user: string;
  password: string;
}

/**
 * Login-screen demo accounts from the global `static_data` row (entity `login`, enum
 * `demo_accounts`). Each value is a JSON string `{name, user, password}`; keys give the order.
 * Malformed entries are skipped rather than failing the login screen.
 */
export function parseDemoAccounts(values: unknown): DemoAccount[] {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  const out: DemoAccount[] = [];
  for (const key of Object.keys(values).sort()) {
    const raw = (values as Record<string, unknown>)[key];
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const { name, user, password } = parsed as Record<string, unknown>;
    if (typeof name !== 'string' || typeof user !== 'string' || typeof password !== 'string') continue;
    if (!name.trim() || !user.trim()) continue;
    out.push({ name: name.trim(), user: user.trim(), password });
  }
  return out;
}

/** Slug base for a workspace derived from an email local part. */
export function slugBase(email: string): string {
  return email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export interface SessionMembership {
  organizationId: string;
  slug: string;
  name: string;
  /** Highest-privilege role, for the existing single-role UI gates. */
  role: string;
  /** Every role this membership currently holds — a membership can carry more than one. */
  roles: string[];
  status: string;
}

export interface Session {
  userId: string;
  email: string;
  displayName: string;
  /** Local API token (HS256), for password and SSO logins alike. */
  token: string;
  memberships: SessionMembership[];
  /** An organization requires a second step the person has not set up: `token` reaches only its setup. */
  twoFactorSetupRequired?: true;
}

/**
 * The session after a login (password and, when on, the second step): a full one, or a setup-only one
 * (30 minutes) when an organization requires a second step the person has not set up yet.
 */
export async function issueSession(db: Db, user: { id: string; email: string; display_name: string }): Promise<Session> {
  const setup = (await twoFactorRequired(db, user.id)) && !(await twoFactorRow(db, user.id))?.enabled;
  return {
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    token: setup ? await mintSessionToken(db, user.id, user.email, TWO_FACTOR_SETUP_TOKEN_SEC, 'two-factor-setup') : await mintSessionToken(db, user.id, user.email),
    memberships: await membershipsOf(db, user.id),
    ...(setup ? { twoFactorSetupRequired: true as const } : {}),
  };
}

export async function membershipsOf(db: Db, userId: string): Promise<SessionMembership[]> {
  const rows = await db
    .select({
      organizationId: organization_memberships.organization_id,
      slug: organizations.slug,
      name: organizations.name,
      status: organization_memberships.status,
      roleName: roles.name,
    })
    .from(organization_memberships)
    .innerJoin(organizations, eq(organizations.id, organization_memberships.organization_id))
    .leftJoin(membership_roles, eq(membership_roles.membership_id, organization_memberships.id))
    .leftJoin(roles, eq(roles.id, membership_roles.role_id))
    .where(eq(organization_memberships.user_id, userId))
    .orderBy(asc(organizations.slug));

  const byOrg = new Map<string, SessionMembership>();
  for (const row of rows) {
    let entry = byOrg.get(row.organizationId);
    if (!entry) {
      entry = { organizationId: row.organizationId, slug: row.slug, name: row.name, role: '', roles: [], status: row.status };
      byOrg.set(row.organizationId, entry);
    }
    if (row.roleName) entry.roles.push(row.roleName);
  }
  for (const entry of byOrg.values()) {
    entry.role = pickPrimaryRole(entry.roles) ?? 'member';
  }
  return [...byOrg.values()];
}

@Controller('auth')
export class AuthController {
  private readonly resetPerEmail = new HourlyLimiter(RESET_LIMIT_PER_EMAIL);
  private readonly resetPerIp = new HourlyLimiter(RESET_LIMIT_PER_IP);
  // Failed logins (in memory, per API process; see password-reset.ts for the limits) and registrations per address.
  private readonly loginFailsPerAccountAndIp = new HourlyLimiter(LOGIN_FAILS_PER_ACCOUNT_AND_IP);
  private readonly loginFailsPerIp = new HourlyLimiter(LOGIN_FAILS_PER_IP);
  private readonly loginFailsPerAccount = new HourlyLimiter(LOGIN_FAILS_PER_ACCOUNT);
  private readonly registrationsPerIp = new HourlyLimiter(REGISTRATIONS_PER_IP);

  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Register: creates the user and a personal workspace org they are owner, admin and HR of.
   * Nobody becomes the instance's operator by registering, the first account included: the
   * operator CLI grants that (`operators grant`).
   */
  @Public()
  @Post('register')
  async register(@Body() body: { email: string; displayName: string; password: string }, @Req() req?: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    if (req && !this.registrationsPerIp.allow(clientIp(req), Date.now())) return { ok: false, error: 'too-many-attempts' };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    if (!body.displayName?.trim()) return { ok: false, error: 'display-name-required' };
    if (!isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) return { ok: false, error: 'email-taken' };
    const passwordHash = await bcrypt.hash(body.password, 10);
    const { u: user, orgId, membershipId, slug } = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email, display_name: body.displayName.trim() })
        .returning({ id: users.id, email: users.email, display_name: users.display_name });
      const uid = u.id;
      await tx
        .insert(user_identities)
        .values({ user_id: uid, provider: 'password', provider_user_id: email, password_hash: passwordHash });
      const base = slugBase(email) || 'workspace';
      let workspaceSlug = base;
      for (let attempt = 0; attempt < 25; attempt++) {
        const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, workspaceSlug));
        if (!taken) break;
        workspaceSlug = `${base}-${attempt + 2}`;
      }
      const [org] = await tx
        .insert(organizations)
        .values({ slug: workspaceSlug, name: `${body.displayName.trim()}'s workspace`, type: 'personal', created_by_user_id: uid })
        .returning({ id: organizations.id });
      const [membership] = await tx
        .insert(organization_memberships)
        .values({ organization_id: org.id, user_id: uid, status: 'active', joined_at: clock.now().toISOString() })
        .returning({ id: organization_memberships.id });
      await tx.insert(membership_roles).values(registrationRoleIds().map((role_id) => ({ membership_id: membership.id, role_id })));
      // Static data (absence types, `locales`, `countries`) is inherited from the global rows
      // (`organization_id = null`); an org gets its own copy only when it customizes one.
      return { u, orgId: org.id, membershipId: membership.id, slug: workspaceSlug };
    });

    const userId = user.id;
    void this.versions.record('users', userId, 'insert', userId, user).catch(() => {});
    void this.versions.record('organizations', orgId, 'insert', userId, { id: orgId, slug, name: `${body.displayName.trim()}'s workspace`, type: 'personal' }).catch(() => {});
    void this.versions.record('organization_memberships', membershipId, 'insert', userId, { id: membershipId, organization_id: orgId, user_id: userId, status: 'active' }).catch(() => {});

    const session: Session = {
      userId,
      email: user.email,
      displayName: user.display_name,
      token: await mintSessionToken(db, userId, email),
      memberships: await membershipsOf(db, userId),
    };
    // Best-effort welcome mail (local catcher); never fail registration over it.
    void sendMail({
      to: email,
      subject: 'Welcome to Apensum',
      text: `Hi ${body.displayName.trim()},\n\nYour account and personal workspace "${slug}" are ready.\n`,
    }).catch(() => {});
    // The instance's operators hear of every registration (registration is open), by mail and in the Admin organization.
    void noticeRegistration(db, this.notifications, { name: body.displayName.trim(), email, workspace: `${body.displayName.trim()}'s workspace`, orgId }).catch(() => {});
    return { ok: true, ...session };
  }

  /** Local login: verifies the password identity and returns the session. */
  /** Demo accounts for the login screen dropdown (seeded databases only; otherwise empty) and, on the demo instance, the people of the user menu's switcher (demo-switch.ts). */
  @Public()
  @Get('demo-accounts')
  async demoAccounts() {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, accounts: [] };
    const [row] = await db
      .select({ values: static_data.values })
      .from(static_data)
      .where(and(isNull(static_data.organization_id), eq(static_data.entity, 'login'), eq(static_data.enum_name, 'demo_accounts')))
      .limit(1);
    // The demo instance (DEMO_AUTO_LOGIN): the people to switch between, and whom to sign in as without a session.
    const people = await demoPeople(db, process.env.DEMO_AUTO_LOGIN);
    return { ok: true, accounts: parseDemoAccounts(row?.values), people, autoLogin: people[0]?.user ?? null };
  }

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; password: string }, @Req() req?: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email) || typeof body.password !== 'string') return { ok: false, error: 'invalid-credentials' };
    // Too many failures from here, for this account, or for this account from anywhere: wait (before any password check).
    const ip = req ? clientIp(req) : 'unknown';
    const now = Date.now();
    if (this.loginFailsPerAccountAndIp.full(`${email}|${ip}`, now) || this.loginFailsPerIp.full(ip, now) || this.loginFailsPerAccount.full(email, now)) {
      return { ok: false, error: 'too-many-attempts' };
    }
    const failed = () => {
      this.loginFailsPerAccountAndIp.allow(`${email}|${ip}`, now);
      this.loginFailsPerIp.allow(ip, now);
      this.loginFailsPerAccount.allow(email, now);
      return { ok: false as const, error: 'invalid-credentials' };
    };
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        display_name: users.display_name,
        status: users.status,
        password_hash: user_identities.password_hash,
      })
      .from(users)
      .innerJoin(user_identities, and(eq(user_identities.user_id, users.id), eq(user_identities.provider, 'password')))
      .where(eq(users.email, email));
    if (!row) return failed();
    if (row.status !== 'active') return { ok: false, error: 'account-inactive' };
    const match = row.password_hash ? await bcrypt.compare(body.password, row.password_hash) : false;
    if (!match) return failed();
    // Two-step login on: the password only earns a short token for the second step (bound to this password).
    if (!twoFactorOff() && (await twoFactorRow(db, row.id))?.enabled) {
      const challenge = mintResetToken(twoFactorChallengeKey(), row.id, row.password_hash, Math.floor(Date.now() / 1000), TWO_FACTOR_CHALLENGE_SEC);
      return { ok: false, error: 'two-factor-code', challenge };
    }
    await this.signedIn(db, row.id);
    return { ok: true, ...(await issueSession(db, row)) };
  }

  /** Login, step 2 when two-step login is on: the code from the app (or a recovery code) and the step-1 token. */
  @Public()
  @Post('login/two-factor')
  async loginSecondStep(@Body() body: { challenge?: unknown; code?: unknown }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const read = readResetToken(twoFactorChallengeKey(), body?.challenge, Math.floor(Date.now() / 1000));
    if (!read) return { ok: false, error: 'two-factor-expired' };
    if (!this.secondStepPerUser.allow(read.userId, Date.now())) return { ok: false, error: 'too-many-attempts' };
    const [row] = await db
      .select({ id: users.id, email: users.email, display_name: users.display_name, status: users.status, password_hash: user_identities.password_hash })
      .from(users)
      .innerJoin(user_identities, and(eq(user_identities.user_id, users.id), eq(user_identities.provider, 'password')))
      .where(eq(users.id, read.userId));
    // The password changed since step 1 (or the account went): start over.
    if (!row || row.status !== 'active' || passwordStamp(row.password_hash) !== read.stamp) return { ok: false, error: 'two-factor-expired' };
    const passed = await useSecondFactor(db, row.id, body?.code);
    if (!passed) return { ok: false, error: 'two-factor-invalid' };
    await this.signedIn(db, row.id);
    return { ok: true, ...(await issueSession(db, row)), ...(passed === 'recovery' ? { recoveryCodeUsed: true } : {}) };
  }

  private readonly secondStepPerUser = new HourlyLimiter(TWO_FACTOR_ATTEMPTS_PER_HOUR);

  private async signedIn(db: Db, userId: string) {
    await db
      .update(user_identities)
      .set({ last_sign_in_at: new Date().toISOString() })
      .where(and(eq(user_identities.provider, 'password'), eq(user_identities.user_id, userId)));
  }

  /**
   * Forgot password, step 1: mails a reset link to the address if it has a password login. Always
   * answers ok (no account enumeration) and sends in the background, so the timing tells nothing either.
   */
  @Public()
  @Post('reset')
  async requestReset(@Body() body: { email?: string }, @Req() req: Request) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const email = (body?.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: true };
    const now = Date.now();
    if (!this.resetPerIp.allow(clientIp(req), now) || !this.resetPerEmail.allow(email, now)) return { ok: true };
    void this.sendResetLink(db, email, now).catch(() => {});
    return { ok: true };
  }

  private async sendResetLink(db: Db, email: string, nowMs: number): Promise<void> {
    const [row] = await db
      .select({ id: users.id, name: users.display_name, locale: users.locale, hash: user_identities.password_hash })
      .from(user_identities)
      .innerJoin(users, eq(users.id, user_identities.user_id))
      .where(and(eq(user_identities.provider, 'password'), eq(user_identities.provider_user_id, email)));
    if (!row) return;
    const token = mintResetToken(purposeKey('password-reset'), row.id, row.hash, Math.floor(nowMs / 1000));
    const link = resetLink(process.env.APP_BASE_URL ?? 'http://localhost:3001', token, row.locale);
    await sendMail({ to: email, ...resetMail(row.locale, row.name ?? email, link) }, 10_000);
  }

  /** Forgot password, step 2: the link's token sets the new password, once. */
  @Public()
  @Post('reset/confirm')
  async confirmReset(@Body() body: { token?: string; newPassword?: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const claim = readResetToken(purposeKey('password-reset'), body?.token, Math.floor(Date.now() / 1000));
    if (!claim) return { ok: false, error: 'reset-link-invalid' };
    if (!isValidPassword(body.newPassword)) return { ok: false, error: 'password-too-short' };
    const [identity] = await db
      .select({ id: user_identities.id, hash: user_identities.password_hash, email: user_identities.provider_user_id })
      .from(user_identities)
      .where(and(eq(user_identities.user_id, claim.userId), eq(user_identities.provider, 'password')));
    if (!identity || passwordStamp(identity.hash) !== claim.stamp) return { ok: false, error: 'reset-link-invalid' };
    const passwordHash = await bcrypt.hash(body.newPassword as string, 10);
    // Only if the hash is still the one the link was issued for: two clicks cannot both succeed.
    const updated = await db
      .update(user_identities)
      .set({ password_hash: passwordHash })
      .where(and(eq(user_identities.id, identity.id), identity.hash === null ? isNull(user_identities.password_hash) : eq(user_identities.password_hash, identity.hash)))
      .returning({ id: user_identities.id });
    if (updated.length === 0) return { ok: false, error: 'reset-link-invalid' };
    // Every session of the old password ends now (session-state.ts), here at once, in other processes within seconds.
    forgetSessions(claim.userId);
    void this.versions.record('users', claim.userId, 'update_delta', claim.userId, { password: 'reset by e-mail link' }).catch(() => {});
    return { ok: true, email: identity.email };
  }

  /**
   * Accept an organization invitation: attaches the invited email to the org with the invited role.
   * The inviter knows the token, so it proves nothing about the address: an existing account confirms
   * with its own password, which is never changed here. A password is set only for a new account, or for
   * one that has no login at all and belongs to the inviting organization alone (created by its import).
   */
  @Public()
  @Post('invitations/accept')
  async acceptInvitation(@Body() body: { token: string; displayName: string; password: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const token = (body.token ?? '').trim();
    if (!token) return { ok: false, error: 'token-required' };
    if (typeof body.password !== 'string' || !body.password) return { ok: false, error: 'password-too-short' };
    const [invitation] = await db
      .select({
        id: organization_invitations.id,
        organization_id: organization_invitations.organization_id,
        email: organization_invitations.email,
        role_id: organization_invitations.role_id,
        invited_by_user_id: organization_invitations.invited_by_user_id,
        status: organization_invitations.status,
        expires_at: organization_invitations.expires_at,
      })
      .from(organization_invitations)
      .where(eq(organization_invitations.token, token));
    if (!invitation) return { ok: false, error: 'invalid-token' };
    if (invitation.status !== 'pending') return { ok: false, error: 'invitation-not-pending' };
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      await db.update(organization_invitations).set({ status: 'expired' }).where(eq(organization_invitations.token, token));
      void this.versions.record('organization_invitations', invitation.id, 'update_delta', null, { status: 'expired' }).catch(() => {});
      return { ok: false, error: 'invitation-expired' };
    }
    const email = invitation.email.toLowerCase();
    const [existingUser] = await db
      .select({ id: users.id, status: users.status, display_name: users.display_name })
      .from(users)
      .where(eq(users.email, email));
    let setsPassword = true;
    if (existingUser) {
      if (existingUser.status !== 'active') return { ok: false, error: 'account-inactive' };
      const identities = await db
        .select({ provider: user_identities.provider, password_hash: user_identities.password_hash })
        .from(user_identities)
        .where(eq(user_identities.user_id, existingUser.id));
      const own = identities.find((i) => i.provider === 'password');
      if (own) {
        if (!own.password_hash || !(await bcrypt.compare(body.password, own.password_hash))) return { ok: false, error: 'invitation-password-mismatch' };
        setsPassword = false;
      } else {
        const orgs = await db
          .select({ organization_id: organization_memberships.organization_id })
          .from(organization_memberships)
          .where(eq(organization_memberships.user_id, existingUser.id));
        const onlyInvitingOrg = orgs.length > 0 && orgs.every((m) => m.organization_id === invitation.organization_id);
        if (identities.length > 0 || !onlyInvitingOrg) return { ok: false, error: 'invitation-account-exists' };
      }
    } else if (!body.displayName?.trim()) {
      return { ok: false, error: 'display-name-required' };
    }
    if (setsPassword && !isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
    // The inviter knows the token. Checked now, not when it was sent: they may be no owner any more.
    if (
      (await invitationNeedsOwner(db, invitation.organization_id, invitation.role_id, existingUser ? { id: existingUser.id, setsPassword } : null)) &&
      !(await isOrgOwner(db, invitation.organization_id, invitation.invited_by_user_id))
    ) {
      return { ok: false, error: 'invitation-needs-owner' };
    }
    const passwordHash = setsPassword ? await bcrypt.hash(body.password, 10) : null;
    const displayName = existingUser?.display_name ?? body.displayName.trim();

    const { userId, membershipId, wasNewUser } = await db.transaction(async (tx) => {
      let uid: string;
      if (!existingUser) {
        const [created] = await tx
          .insert(users)
          .values({ email, display_name: displayName })
          .returning({ id: users.id });
        uid = created.id;
      } else {
        uid = existingUser.id;
      }
      // A plain insert on purpose: an existing password is never overwritten, a conflict fails.
      if (passwordHash) {
        await tx.insert(user_identities).values({ user_id: uid, provider: 'password', provider_user_id: email, password_hash: passwordHash });
      }
      const [membership] = await tx
        .insert(organization_memberships)
        .values({ organization_id: invitation.organization_id, user_id: uid, status: 'active', joined_at: clock.now().toISOString() })
        .onConflictDoUpdate({
          target: [organization_memberships.organization_id, organization_memberships.user_id],
          set: { status: 'active' },
        })
        .returning({ id: organization_memberships.id });
      await tx
        .insert(membership_roles)
        .values({ membership_id: membership.id, role_id: invitation.role_id })
        .onConflictDoNothing();
      // Owner only governs: invited as one and nothing else, they are an ordinary member as well.
      await tx.execute(sql`
        INSERT INTO membership_roles (membership_id, role_id)
        SELECT ${membership.id}::uuid, member.id
        FROM (SELECT id FROM roles
              WHERE name = 'member' AND (organization_id = ${invitation.organization_id} OR organization_id IS NULL)
              ORDER BY organization_id NULLS LAST LIMIT 1) member
        WHERE EXISTS (SELECT 1 FROM roles WHERE id = ${invitation.role_id} AND name = 'owner')
          AND NOT EXISTS (SELECT 1 FROM membership_roles WHERE membership_id = ${membership.id} AND role_id <> ${invitation.role_id})
        ON CONFLICT DO NOTHING`);
      await tx.update(organization_invitations).set({ status: 'accepted' }).where(eq(organization_invitations.token, token));
      return { userId: uid, membershipId: membership.id, wasNewUser: !existingUser };
    });

    if (wasNewUser) {
      void this.versions.record('users', userId, 'insert', userId, { id: userId, email, display_name: displayName }).catch(() => {});
    }
    void this.versions.record('organization_memberships', membershipId, 'update_delta', userId, { organization_id: invitation.organization_id, user_id: userId, status: 'active' }).catch(() => {});
    void this.versions.record('organization_invitations', invitation.id, 'update_delta', userId, { status: 'accepted' }).catch(() => {});

    // An existing account with two-step login: joined, but it signs in itself (password and code).
    if (!wasNewUser && !twoFactorOff() && (await twoFactorRow(db, userId))?.enabled) return { ok: true, signInRequired: true };
    return { ok: true, ...(await issueSession(db, { id: userId, email, display_name: displayName })) };
  }

  /** Public: whether this instance offers SSO, and where the login page sends people for it. */
  @Public()
  @Get('sso')
  ssoConfig() {
    const config = ssoPublicConfig();
    return config ? { enabled: true, ...config } : { enabled: false };
  }

  /**
   * Public: an SSO login. The ID token the web app got from the instance's identity provider (verified
   * against its keys, at most 10 minutes old) gives a session like a password login: the account linked to
   * its `sub`, else the one of its verified e-mail (created if there is none). Nothing in the body but the
   * token picks the account. The provider's own second step stands in for two-step login.
   */
  @Public()
  @Post('sso/exchange')
  async ssoExchange(@Body() body: { idToken?: unknown }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    if (!ssoPublicConfig()) return { ok: false, error: 'sso-off' };
    const principal = typeof body?.idToken === 'string' ? await verifySsoIdToken(body.idToken) : null;
    if (!principal) return { ok: false, error: 'sso-invalid' };
    const userId = await this.resolveSsoUserId(db, principal);
    if (!userId) return { ok: false, error: 'email-not-verified' };
    const [user] = await db
      .select({ id: users.id, email: users.email, display_name: users.display_name })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return { ok: false, error: 'sso-invalid' };
    return {
      ok: true,
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      token: await mintSessionToken(db, user.id, user.email),
      memberships: await membershipsOf(db, user.id),
    };
  }

  /**
   * The account of an SSO login: the one it is linked to, else the one of the token's verified e-mail
   * (created if there is none). Nothing in the request body picks the account. Null = no verified e-mail.
   */
  private async resolveSsoUserId(
    db: Db,
    principal: { sub: string; email?: string; emailVerified?: boolean; name?: string },
  ): Promise<string | null> {
    const [found] = await db
      .select({ user_id: user_identities.user_id })
      .from(user_identities)
      .where(eq(user_identities.provider_user_id, principal.sub))
      .limit(1);
    if (found) return found.user_id;
    if (principal.emailVerified !== true || !isValidEmail(principal.email)) return null;
    const email = (principal.email as string).toLowerCase();
    const [created] = await db
      .insert(users)
      .values({ email, display_name: principal.name?.trim().slice(0, 100) || email })
      .onConflictDoUpdate({ target: users.email, set: { email } })
      .returning({ id: users.id });
    const userId = created.id;
    await db
      .insert(user_identities)
      .values({ user_id: userId, provider: 'oidc', provider_user_id: principal.sub })
      .onConflictDoNothing();
    void this.versions.record('users', userId, 'insert', userId, { id: userId, email }).catch(() => {});
    return userId;
  }

  @Public()
  @Get('azure/providers')
  providers() {
    return [{ type: 'azure_oidc', tenantHint: process.env.AZURE_TENANT_ID ?? null }];
  }
}

