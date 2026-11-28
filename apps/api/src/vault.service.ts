import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import type { UserKeyRecord } from '@worktime3/shared/vault';
import { currentMasterKey, masterKeys, openSecret, sealSecret } from './document-crypto';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/**
 * A module's encrypted objects (ApiPlugin.vaultObjects): the kind, and the module's rule for who may reach one. The
 * core keeps the keys; whether a person may see or edit the object (and so hold its key) is the module's to say.
 */
export interface VaultObjectSource {
  /** `<module>.<kind>`, e.g. `cases.case`; unique, and its prefix is the plugin's id. */
  kind: string;
  /** The module that must be on (and licensed) in the organization; none = always. */
  module?: string;
  /** Whether the person may see / edit this object of the organization; null when there is no such object. */
  access: (db: Db, q: { orgId: string; objectId: string; userId: string; action: 'see' | 'edit' }) => Promise<boolean | null>;
}

const SOURCES = new Map<string, VaultObjectSource>();

export function registerVaultObjects(source: VaultObjectSource): void {
  if (!/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/.test(source.kind)) throw new Error(`vault object kind ${source.kind} must be <module>.<kind>`);
  if (SOURCES.has(source.kind)) throw new Error(`vault object kind ${source.kind} is registered twice`);
  SOURCES.set(source.kind, source);
}

export function vaultObjectSource(kind: string): VaultObjectSource | undefined {
  return SOURCES.get(kind);
}

/** A raw AES-256 key as base64 (32 bytes): what the level Standard hands to whoever may see the object. */
export const isRawObjectKey = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, 'base64').length === 32;

/** One holder's wrapped copy of an object's key. */
export interface ObjectKey { userId: string; wrappedKey: string }

/**
 * The core's vault for modules (docs/VAULT.md, the plugin contract): each person's key pair (the private half sealed
 * under their passphrase) and each encrypted object's key, wrapped once per holder. Everything here is ciphertext or a
 * public key; the server cannot read an object and cannot check that a wrapped key is the right one. Callers decide
 * who may hold a key first (the module's `access`).
 */
@Injectable()
export class VaultService {
  /** A person's key record, or null when they have not set up encryption. */
  async keyRecord(db: Db, userId: string): Promise<UserKeyRecord | null> {
    if (!UUID.test(userId)) return null;
    const res = await db.execute(sql`
      SELECT public_key, wrapped_private_key, salt, iterations FROM vault_user_keys WHERE user_id = ${userId}::uuid`);
    const r = res.rows[0] as { public_key: string; wrapped_private_key: string; salt: string; iterations: number } | undefined;
    return r ? { publicKey: r.public_key, wrappedPrivateKey: r.wrapped_private_key, salt: r.salt, iterations: r.iterations } : null;
  }

  /** Stores a new key pair; false when the person already has one (a key pair is never replaced). */
  async createKeys(db: Db, userId: string, rec: UserKeyRecord): Promise<boolean> {
    const res = await db.execute(sql`
      INSERT INTO vault_user_keys (user_id, public_key, wrapped_private_key, salt, iterations)
      VALUES (${userId}::uuid, ${rec.publicKey}, ${rec.wrappedPrivateKey}, ${rec.salt}, ${rec.iterations})
      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`);
    return res.rows.length > 0;
  }

  /** The same key pair sealed under a new passphrase; false when the public key is not the stored one. */
  async changePassphrase(db: Db, userId: string, rec: UserKeyRecord): Promise<boolean> {
    const res = await db.execute(sql`
      UPDATE vault_user_keys SET wrapped_private_key = ${rec.wrappedPrivateKey}, salt = ${rec.salt}, iterations = ${rec.iterations}
      WHERE user_id = ${userId}::uuid AND public_key = ${rec.publicKey} RETURNING user_id`);
    return res.rows.length > 0;
  }

  /** Which of these people have set up encryption. */
  async withKeys(db: Db, userIds: readonly string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = (await db.execute(sql`SELECT user_id FROM vault_user_keys WHERE user_id = ANY(${uuidArray(userIds)}::uuid[])`)).rows as { user_id: string }[];
    return new Set(rows.map((r) => r.user_id));
  }

  /** Who holds the object's key, each with their wrapped copy. */
  async holders(db: Db, kind: string, objectId: string): Promise<ObjectKey[]> {
    if (!UUID.test(objectId)) return [];
    const rows = (await db.execute(sql`
      SELECT user_id, wrapped_key FROM vault_object_keys WHERE object_kind = ${kind} AND object_id = ${objectId}::uuid`)).rows as { user_id: string; wrapped_key: string }[];
    return rows.map((r) => ({ userId: r.user_id, wrappedKey: r.wrapped_key }));
  }

  /** The person's wrapped keys of these objects (by object id; objects they hold no key of are missing). */
  async wrappedFor(db: Db, kind: string, objectIds: readonly string[], userId: string | null): Promise<Map<string, string>> {
    if (!objectIds.length || !userId || !UUID.test(userId)) return new Map();
    const rows = (await db.execute(sql`
      SELECT object_id, wrapped_key FROM vault_object_keys
      WHERE object_kind = ${kind} AND user_id = ${userId}::uuid AND object_id = ANY(${uuidArray(objectIds)}::uuid[])`)).rows as { object_id: string; wrapped_key: string }[];
    return new Map(rows.map((r) => [r.object_id, r.wrapped_key]));
  }

  /** Gives (or, for the holder themselves, replaces) one holder's key of the object. The caller checked who may. */
  async grant(db: Db, orgId: string, kind: string, objectId: string, userId: string, wrappedKey: string, grantedBy: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO vault_object_keys (organization_id, object_kind, object_id, user_id, wrapped_key, granted_by)
      VALUES (${orgId}::uuid, ${kind}, ${objectId}::uuid, ${userId}::uuid, ${wrappedKey}, ${grantedBy}::uuid)
      ON CONFLICT (object_kind, object_id, user_id) DO UPDATE SET wrapped_key = EXCLUDED.wrapped_key, granted_by = EXCLUDED.granted_by`);
  }

  /** The object's new key after a rotation: every old copy goes, these come. Run it in the module's transaction. */
  async replaceKeys(db: Db, orgId: string, kind: string, objectId: string, keys: readonly ObjectKey[], grantedBy: string): Promise<void> {
    await db.execute(sql`DELETE FROM vault_object_keys WHERE object_kind = ${kind} AND object_id = ${objectId}::uuid`);
    for (const k of keys) await this.grant(db, orgId, kind, objectId, k.userId, k.wrappedKey, grantedBy);
  }

  // ---- level Standard: the key held by the server (vault_object_escrow, 131) ----------------------

  /** Whether the instance can hold keys (DOCUMENTS_KEY is set); without it there is no level Standard. */
  standardAvailable(): boolean {
    return currentMasterKey() !== null;
  }

  /** Keeps a Standard object's key, sealed with the instance's master key. The caller checked who may. */
  async escrow(db: Db, orgId: string, kind: string, objectId: string, rawKey: string): Promise<void> {
    const master = currentMasterKey();
    if (!master) throw new Error('standard-unavailable');
    if (!isRawObjectKey(rawKey)) throw new Error('invalid-key');
    const sealed = sealSecret(rawKey, master);
    await db.execute(sql`
      INSERT INTO vault_object_escrow (organization_id, object_kind, object_id, sealed_key, key_id)
      VALUES (${orgId}::uuid, ${kind}, ${objectId}::uuid, ${sealed.sealed}, ${sealed.keyId})`);
  }

  /** The raw keys of these Standard objects of the organization (by object id); others are missing. */
  async escrowed(db: Db, orgId: string, kind: string, objectIds: readonly string[]): Promise<Map<string, string>> {
    if (!objectIds.length) return new Map();
    const rows = (await db.execute(sql`
      SELECT object_id, sealed_key, key_id FROM vault_object_escrow
      WHERE organization_id = ${orgId}::uuid AND object_kind = ${kind} AND object_id = ANY(${uuidArray(objectIds)}::uuid[])`)).rows as { object_id: string; sealed_key: string; key_id: string }[];
    const keys = masterKeys();
    const out = new Map<string, string>();
    for (const r of rows) {
      try { out.set(r.object_id, openSecret(r.sealed_key, r.key_id, keys)); } catch { /* key not configured: the object stays closed */ }
    }
    return out;
  }
}
