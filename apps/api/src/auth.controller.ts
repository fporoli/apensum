import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from './client-ip';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { Public, type AuthenticatedRequest } from './jwt.guard';
import { mintLocalToken, purposeKey } from './jwt';
import { sendMail } from './mailer';
import * as bcrypt from 'bcryptjs';
import { users, user_identities, organizations, organization_memberships, organization_invitations, roles, membership_roles, static_data } from './db/schema';
import { pickPrimaryRole } from './access';
import { VersionsService } from './versions.service';
import { HourlyLimiter, mintResetToken, passwordStamp, readResetToken, RESET_LIMIT_PER_EMAIL, RESET_LIMIT_PER_IP, resetLink, resetMail } from './password-reset';

/**
 * Auth: Keycloak is the IdP (same Postgres DB, `auth` schema).
 * - Password reset mails a signed one-time link (password-reset.ts); only the link sets the password.
 * - Identities are only ever created for the caller: SSO sync from the token's verified e-mail, a password
 *   by registering or by accepting an invitation as a new account.
 * - Local login/register/invite-accept below power the web login screen (dev
 *   parity with Keycloak; production should validate Keycloak JWTs instead).
 */

export const OWNER_ROLE_ID = '00000000-0000-0000-0000-000000000001';
export const ADMIN_ROLE_ID = '00000000-0000-0000-0000-000000000002';

/** Roles of a new registration in its own workspace: owner; the instance's very first user also admin. */
export function registrationRoleIds(firstUserOfInstance: boolean): string[] {
  return firstUserOfInstance ? [OWNER_ROLE_ID, ADMIN_ROLE_ID] : [OWNER_ROLE_ID];
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
  /** Local API token (HS256). Keycloak SSO uses a Keycloak-issued token instead. */
  token: string;
  memberships: SessionMembership[];
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

  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  /**
   * Register a new admin user: creates the user, a personal workspace org, and an owner membership.
   * The very first user of an instance (an empty production database) also becomes admin and
   * superdeveloper, so a fresh instance needs no SQL to be run.
   */
  @Public()
  @Post('register')
  async register(@Body() body: { email: string; displayName: string; password: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    if (!body.displayName?.trim()) return { ok: false, error: 'display-name-required' };
    if (!isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) return { ok: false, error: 'email-taken' };
    const passwordHash = await bcrypt.hash(body.password, 10);
    const { u: user, orgId, membershipId, slug, first } = await db.transaction(async (tx) => {
      const [anyone] = await tx.select({ id: users.id }).from(users).limit(1);
      const first = !anyone;
      const [u] = await tx
        .insert(users)
        .values({ email, display_name: body.displayName.trim(), is_superdeveloper: first })
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
        .values({ organization_id: org.id, user_id: uid, status: 'active' })
        .returning({ id: organization_memberships.id });
      await tx.insert(membership_roles).values(registrationRoleIds(first).map((role_id) => ({ membership_id: membership.id, role_id })));
      // Static data (absence types, `locales`, `countries`) is inherited from the global rows
      // (`organization_id = null`); an org gets its own copy only when it customizes one.
      return { u, orgId: org.id, membershipId: membership.id, slug: workspaceSlug, first };
    });

    const userId = user.id;
    void this.versions.record('users', userId, 'insert', userId, { ...user, ...(first ? { is_superdeveloper: true } : {}) }).catch(() => {});
    void this.versions.record('organizations', orgId, 'insert', userId, { id: orgId, slug, name: `${body.displayName.trim()}'s workspace`, type: 'personal' }).catch(() => {});
    void this.versions.record('organization_memberships', membershipId, 'insert', userId, { id: membershipId, organization_id: orgId, user_id: userId, status: 'active' }).catch(() => {});

    const session: Session = {
      userId,
      email: user.email,
      displayName: user.display_name,
      token: await mintLocalToken(userId, email),
      memberships: await membershipsOf(db, userId),
    };
    // Best-effort welcome mail (local catcher); never fail registration over it.
    void sendMail({
      to: email,
      subject: 'Welcome to Apensum',
      text: `Hi ${body.displayName.trim()},\n\nYour account and personal workspace "${slug}" are ready.\n`,
    }).catch(() => {});
    return { ok: true, ...session };
  }

  /** Local login: verifies the password identity and returns the session. */
  /** Demo accounts for the login screen dropdown. Only seeded databases define them; otherwise empty. */
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
    return { ok: true, accounts: parseDemoAccounts(row?.values) };
  }

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email) || typeof body.password !== 'string') return { ok: false, error: 'invalid-credentials' };
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
    if (!row) return { ok: false, error: 'invalid-credentials' };
    if (row.status !== 'active') return { ok: false, error: 'account-inactive' };
    const match = row.password_hash ? await bcrypt.compare(body.password, row.password_hash) : false;
    if (!match) return { ok: false, error: 'invalid-credentials' };
    await db
      .update(user_identities)
      .set({ last_sign_in_at: new Date().toISOString() })
      .where(and(eq(user_identities.provider, 'password'), eq(user_identities.provider_user_id, email)));
    const session: Session = {
      userId: row.id,
      email: row.email,
      displayName: row.display_name,
      token: await mintLocalToken(row.id, row.email),
      memberships: await membershipsOf(db, row.id),
    };
    return { ok: true, ...session };
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
      .select({ id: users.id, status: users.status, display_name: users.display_name, is_superdeveloper: users.is_superdeveloper })
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
        if (identities.length > 0 || existingUser.is_superdeveloper || !onlyInvitingOrg) return { ok: false, error: 'invitation-account-exists' };
      }
    } else if (!body.displayName?.trim()) {
      return { ok: false, error: 'display-name-required' };
    }
    if (setsPassword && !isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
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
        .values({ organization_id: invitation.organization_id, user_id: uid, status: 'active' })
        .onConflictDoUpdate({
          target: [organization_memberships.organization_id, organization_memberships.user_id],
          set: { status: 'active' },
        })
        .returning({ id: organization_memberships.id });
      await tx
        .insert(membership_roles)
        .values({ membership_id: membership.id, role_id: invitation.role_id })
        .onConflictDoNothing();
      await tx.update(organization_invitations).set({ status: 'accepted' }).where(eq(organization_invitations.token, token));
      return { userId: uid, membershipId: membership.id, wasNewUser: !existingUser };
    });

    if (wasNewUser) {
      void this.versions.record('users', userId, 'insert', userId, { id: userId, email, display_name: displayName }).catch(() => {});
    }
    void this.versions.record('organization_memberships', membershipId, 'update_delta', userId, { organization_id: invitation.organization_id, user_id: userId, status: 'active' }).catch(() => {});
    void this.versions.record('organization_invitations', invitation.id, 'update_delta', userId, { status: 'accepted' }).catch(() => {});

    const session: Session = {
      userId,
      email,
      displayName,
      token: await mintLocalToken(userId, email),
      memberships: await membershipsOf(db, userId),
    };
    return { ok: true, ...session };
  }

  /**
   * SSO sync: upserts the caller from their validated token (Keycloak `sub`
   * -> `oidc` identity, or the local user id) and returns the session.
   * The web app calls this right after the Keycloak redirect; the session
   * keeps the Keycloak access token for subsequent API calls.
   */
  @Post('sso/sync')
  async ssoSync(@Req() req: AuthenticatedRequest, @Body() body: { displayName?: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const userId = principal.kind === 'local' ? principal.sub : await this.resolveSsoUserId(db, principal, body ?? {});
    if (!userId) return { ok: false, error: 'email-not-verified' };
    const [user] = await db
      .select({ id: users.id, email: users.email, display_name: users.display_name })
      .from(users)
      .where(eq(users.id, userId));
    const session = {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      memberships: await membershipsOf(db, userId),
    };
    return { ok: true, ...session };
  }

  /**
   * The account of a Keycloak login: the one it is linked to, else the one of the token's verified e-mail
   * (created if there is none). Nothing in the request body picks the account. Null = no verified e-mail.
   */
  private async resolveSsoUserId(
    db: Db,
    principal: { sub: string; email?: string; emailVerified?: boolean },
    body: { displayName?: string },
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
      .values({ email, display_name: body.displayName ?? email })
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

