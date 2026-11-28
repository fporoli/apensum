import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { isWrappedKey, validateUserKeyRecord } from '@worktime3/shared/vault';
import { DbService, type Db } from './db.service';
import { callerUserId, can, isOrgMember } from './access';
import { VersionsService } from './versions.service';
import type { AuthenticatedRequest } from './jwt.guard';
import { modulesOf } from './modules-of';
import { PeopleService } from './people.service';
import { OrganizationsService } from './organizations.service';
import { VaultService, vaultObjectSource, type VaultObjectSource } from './vault.service';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Minutes without use after which the browser locks the keyring: the organization's (`settings.vault.idleMinutes`), else 30. */
export const DEFAULT_IDLE_MINUTES = 30;
export function idleMinutesOf(vault: unknown): number {
  const m = vault && typeof vault === 'object' ? (vault as { idleMinutes?: unknown }).idleMinutes : undefined;
  return typeof m === 'number' && Number.isInteger(m) && m >= 5 && m <= 480 ? m : DEFAULT_IDLE_MINUTES;
}

/**
 * The vault's keys (docs/VAULT.md): a person's own key pair, colleagues' public keys, and who holds which object's
 * key. The core stores them; whether someone may hold an object's key is the owning module's rule
 * (`ApiPlugin.vaultObjects`): only people who may see the object, handed over by someone who already holds it (the
 * first key is made by whoever may edit it). Every route checks the caller (handler-auth.test.ts).
 */
@Controller('organizations/:orgId/vault')
export class VaultController {
  // The defaults let a test build the controller with the database only.
  constructor(
    private readonly dbService: DbService,
    private readonly vault: VaultService = new VaultService(),
    private readonly people: PeopleService = new PeopleService(),
    private readonly orgs: OrganizationsService = new OrganizationsService(),
    private readonly versions?: VersionsService,
  ) {}

  // ---- the organization's setting ----------------------------------------------------------------

  /** The minutes without use before the keyring locks itself (Organization settings), for whoever sees those settings. */
  @Get('settings')
  async settings(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const a = await this.member(orgId, req);
    if (!a || !(await can(a.db, orgId, a.userId, 'nav.orgSettings', 'see'))) return { ok: true, idleMinutes: DEFAULT_IDLE_MINUTES, editable: false };
    return {
      ok: true,
      idleMinutes: idleMinutesOf(await this.orgs.settingsOf(a.db, orgId, 'vault')),
      editable: await can(a.db, orgId, a.userId, 'nav.orgSettings', 'edit'),
    };
  }

  @Put('settings')
  async saveSettings(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: { idleMinutes?: unknown }) {
    const a = await this.member(orgId, req);
    if (!a || !(await can(a.db, orgId, a.userId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const m = body?.idleMinutes;
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 5 || m > 480) return { ok: false, error: 'invalid-minutes' };
    const current = await this.orgs.settingsOf(a.db, orgId, 'vault');
    const next = { ...(current && typeof current === 'object' ? current : {}), idleMinutes: m };
    await this.orgs.setSettingsOf(a.db, orgId, 'vault', next);
    void this.versions?.record('organizations', orgId, 'update_delta', a.userId, { settings: { vault: next } }).catch(() => {});
    return { ok: true, idleMinutes: m };
  }

  /** The caller, a member of the organization; null otherwise. */
  private async member(orgId: string, req: AuthenticatedRequest): Promise<{ db: Db; userId: string } | null> {
    const db = this.dbService.getDb();
    if (!db) return null;
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId || !(await isOrgMember(db, orgId, userId))) return null;
    return { db, userId };
  }

  /** The kind's source when its module is on in the organization; the object's access rule. */
  private async source(db: Db, orgId: string, kind: string, objectId: string): Promise<VaultObjectSource | null> {
    const s = vaultObjectSource(kind);
    if (!s || !UUID.test(objectId)) return null;
    if (s.module && (await modulesOf(db, orgId))[s.module] !== true) return null;
    return s;
  }

  private async may(db: Db, orgId: string, s: VaultObjectSource, objectId: string, userId: string, action: 'see' | 'edit'): Promise<boolean> {
    return (await s.access(db, { orgId, objectId, userId, action })) === true;
  }

  // ---- the caller's own key pair ----------------------------------------------------------------

  @Get('me')
  async myKeys(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const a = await this.member(orgId, req);
    if (!a) return { ok: true, keys: null, idleMinutes: DEFAULT_IDLE_MINUTES };
    const [keys, settings] = await Promise.all([this.vault.keyRecord(a.db, a.userId), this.orgs.settingsOf(a.db, orgId, 'vault')]);
    return { ok: true, keys, idleMinutes: idleMinutesOf(settings) };
  }

  /** First setup: the browser made a key pair and sealed the private half under the passphrase. */
  @Put('me')
  async createMyKeys(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const a = await this.member(orgId, req);
    if (!a) return { ok: false, error: 'forbidden' };
    const rec = validateUserKeyRecord(body);
    if (!rec) return { ok: false, error: 'invalid-keys' };
    return (await this.vault.createKeys(a.db, a.userId, rec)) ? { ok: true } : { ok: false, error: 'keys-exist' };
  }

  /** New passphrase: the same key pair, sealed again. The public key must not change, or every object key would break. */
  @Post('me/passphrase')
  async changeMyPassphrase(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const a = await this.member(orgId, req);
    if (!a) return { ok: false, error: 'forbidden' };
    const rec = validateUserKeyRecord(body);
    if (!rec) return { ok: false, error: 'invalid-keys' };
    return (await this.vault.changePassphrase(a.db, a.userId, rec)) ? { ok: true } : { ok: false, error: 'public-key-mismatch' };
  }

  /** A colleague's public key, to hand them an object's key. Public keys are not secret; members only. */
  @Get('users/:userId')
  async publicKeyOf(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const a = await this.member(orgId, req);
    if (!a || !UUID.test(userId) || !(await isOrgMember(a.db, orgId, userId))) return { ok: false };
    const rec = await this.vault.keyRecord(a.db, userId);
    return rec ? { ok: true, publicKey: rec.publicKey } : { ok: false, error: 'no-keys' };
  }

  // ---- an object's keys ---------------------------------------------------------------------------

  /** Who holds a key for the object, and the caller's own wrapped key. Empty for people who may not see the object. */
  @Get('objects/:kind/:objectId/keys')
  async objectKeys(@Param('orgId') orgId: string, @Param('kind') kind: string, @Param('objectId') objectId: string, @Req() req: AuthenticatedRequest) {
    const none = { ok: true, encrypted: false, mine: null, members: [] };
    const a = await this.member(orgId, req);
    if (!a) return none;
    const s = await this.source(a.db, orgId, kind, objectId);
    if (!s || !(await this.may(a.db, orgId, s, objectId, a.userId, 'see'))) return none;
    const keys = await this.vault.holders(a.db, kind, objectId);
    // Their names (the core's), in name order.
    const names = await this.people.names(a.db, orgId, keys.map((k) => k.userId));
    const rows = keys.map((k) => ({ ...k, name: names.get(k.userId) ?? '' })).sort((x, y) => x.name.localeCompare(y.name));
    return {
      ok: true,
      encrypted: rows.length > 0,
      mine: rows.find((r) => r.userId === a.userId)?.wrappedKey ?? null,
      members: rows.map((r) => ({ userId: r.userId, name: r.name })),
    };
  }

  @Put('objects/:kind/:objectId/keys/:userId')
  async grantKey(
    @Param('orgId') orgId: string,
    @Param('kind') kind: string,
    @Param('objectId') objectId: string,
    @Param('userId') target: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { wrappedKey?: unknown },
  ) {
    const a = await this.member(orgId, req);
    if (!a) return { ok: false, error: 'forbidden' };
    const s = await this.source(a.db, orgId, kind, objectId);
    if (!s || !UUID.test(target) || (await s.access(a.db, { orgId, objectId, userId: a.userId, action: 'see' })) === null) return { ok: false, error: 'not-found' };
    if (!isWrappedKey(body?.wrappedKey)) return { ok: false, error: 'invalid-key' };
    const holders = new Set((await this.vault.holders(a.db, kind, objectId)).map((k) => k.userId));
    if (holders.size === 0) {
      // Encrypting an object for the first time: whoever may edit it makes the first key, for themselves.
      if (target !== a.userId || !(await this.may(a.db, orgId, s, objectId, a.userId, 'edit'))) return { ok: false, error: 'forbidden' };
    } else {
      if (!holders.has(a.userId)) return { ok: false, error: 'no-object-key' };
      // Someone's key is theirs: another holder may hand one to a person without it, never replace it (a wrong key
      // would lock them out; a key pair is never replaced, and a removed holder goes through the module's rotation).
      if (target !== a.userId && holders.has(target)) return { ok: false, error: 'already-holder' };
      if (!(await isOrgMember(a.db, orgId, target)) || !(await this.may(a.db, orgId, s, objectId, target, 'see'))) return { ok: false, error: 'forbidden' };
      if (!(await this.vault.keyRecord(a.db, target))) return { ok: false, error: 'no-keys' };
    }
    await this.vault.grant(a.db, orgId, kind, objectId, target, body.wrappedKey as string, a.userId);
    return { ok: true };
  }

  /**
   * Whoever may open this object and whoever holds its key, with what they may do: holder, can be given the key (has
   * set up encryption), or not yet. A holder without the right is listed (to be removed); anyone else in the
   * organization is not. For the sharing dialog; names only.
   */
  @Get('objects/:kind/:objectId/candidates')
  async candidates(@Param('orgId') orgId: string, @Param('kind') kind: string, @Param('objectId') objectId: string, @Req() req: AuthenticatedRequest) {
    const a = await this.member(orgId, req);
    if (!a) return { ok: true, candidates: [] };
    const s = await this.source(a.db, orgId, kind, objectId);
    if (!s || !(await this.may(a.db, orgId, s, objectId, a.userId, 'see'))) return { ok: true, candidates: [] };
    const members = await this.people.memberDetails(a.db, orgId);
    const ids = members.map((m) => m.userId);
    const [withKeys, held] = await Promise.all([this.vault.withKeys(a.db, ids), this.vault.holders(a.db, kind, objectId)]);
    const holders = new Set(held.map((k) => k.userId));
    const candidates = [];
    for (const m of members) {
      const reach = await this.may(a.db, orgId, s, objectId, m.userId, 'see');
      const holder = holders.has(m.userId);
      if (!holder && !reach) continue;
      candidates.push({ userId: m.userId, name: m.name, holder, hasKeys: withKeys.has(m.userId), canAccess: reach, me: m.userId === a.userId });
    }
    return { ok: true, candidates };
  }
}
