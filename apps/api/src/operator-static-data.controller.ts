import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { AuditService } from './audit.service';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, isOperator, type Executor } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { static_data } from './db/schema';
import { cleanDescription } from '@worktime3/shared/staticData';
import { builtInKeys, checkDefaultValues } from './static-data-defaults';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === '23505' || e.cause?.code === '23505';
}

/**
 * Super Admin -> Default lists: the instance's operators edit the static data every organization starts from (global
 * rows, `organization_id` NULL). They add values and lists, change any translation and change or remove what they
 * added (`operator_keys`); what migrations put there stays (static-data-defaults.ts), and so does a list's name while
 * it holds such values. Organizations still copy a list to change it for themselves. Audited in the Admin organization.
 */
@Controller('operator/static-data')
export class OperatorStaticDataController {
  constructor(
    private readonly dbService: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  private async operator(db: Executor, req: AuthenticatedRequest): Promise<string | null> {
    const id = req.user ? await callerUserId(db, req.user) : null;
    return id && (await isOperator(db, id)) ? id : null;
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db || !(await this.operator(db, req))) return [];
    return db.select().from(static_data).where(isNull(static_data.organization_id)).orderBy(asc(static_data.entity), asc(static_data.enum_name));
  }

  @Post()
  async create(@Body() body: { entity?: unknown; enumName?: unknown; values?: unknown; translation?: unknown; description?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.operator(db, req);
    if (!me) return { ok: false, error: 'forbidden' };
    const entity = typeof body?.entity === 'string' ? body.entity.trim() : '';
    const enumName = typeof body?.enumName === 'string' ? body.enumName.trim() : '';
    if (!entity || !enumName) return { ok: false, error: 'entity-and-enum-name-required' };
    const checked = checkDefaultValues(null, body.values ?? {});
    if (!checked.ok) return checked;
    const description = cleanDescription(body.description);
    if (!description) return { ok: false, error: 'invalid-description' };
    const row = {
      organization_id: null, entity, enum_name: enumName, values: checked.values,
      translation: isObject(body.translation) ? body.translation : {}, operator_keys: checked.operatorKeys, description,
    };
    try {
      const [created] = await db.insert(static_data).values(row).returning({ id: static_data.id });
      void this.versions.record('static_data', created.id, 'insert', me, { id: created.id, ...row }).catch(() => {});
      void this.audit.record(OPERATOR_ORG_ID, me, 'static-data.default.create', 'static_data', created.id).catch(() => {});
      return { ok: true, id: created.id };
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: 'duplicate-enum' };
      throw err;
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { enumName?: unknown; values?: unknown; translation?: unknown; description?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.operator(db, req);
    if (!me) return { ok: false, error: 'forbidden' };
    if (!UUID.test(id)) return { ok: false, error: 'not-found' };
    const [existing] = await db.select().from(static_data).where(and(eq(static_data.id, id), isNull(static_data.organization_id)));
    if (!existing) return { ok: false, error: 'not-found' };

    const patch: Partial<typeof static_data.$inferInsert> = {};
    if (body?.values !== undefined) {
      const checked = checkDefaultValues(existing, body.values);
      if (!checked.ok) return checked;
      patch.values = checked.values;
      patch.operator_keys = checked.operatorKeys;
    }
    if (body?.translation !== undefined) {
      if (!isObject(body.translation)) return { ok: false, error: 'invalid-translation' };
      patch.translation = body.translation;
    }
    if (body?.description !== undefined) {
      const description = cleanDescription(body.description);
      if (!description) return { ok: false, error: 'invalid-description' };
      patch.description = description;
    }
    if (typeof body?.enumName === 'string' && body.enumName.trim() && body.enumName.trim() !== existing.enum_name) {
      // The code finds a list by its name: one with built-in values keeps it.
      if (builtInKeys(existing).length > 0) return { ok: false, error: 'built-in-list' };
      patch.enum_name = body.enumName.trim();
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    try {
      await db.update(static_data).set(patch).where(and(eq(static_data.id, id), isNull(static_data.organization_id)));
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: 'duplicate-enum' };
      throw err;
    }
    void this.versions.record('static_data', id, 'update_delta', me, patch).catch(() => {});
    void this.audit.record(OPERATOR_ORG_ID, me, 'static-data.default.update', 'static_data', id).catch(() => {});
    return { ok: true };
  }

  /** Only a list without built-in values (one operators made) can be deleted. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.operator(db, req);
    if (!me) return { ok: false, error: 'forbidden' };
    if (!UUID.test(id)) return { ok: false, error: 'not-found' };
    const [existing] = await db.select().from(static_data).where(and(eq(static_data.id, id), isNull(static_data.organization_id)));
    if (!existing) return { ok: false, error: 'not-found' };
    if (builtInKeys(existing).length > 0) return { ok: false, error: 'built-in-list' };
    await db.delete(static_data).where(and(eq(static_data.id, id), isNull(static_data.organization_id)));
    void this.versions.record('static_data', id, 'delete', me, null).catch(() => {});
    void this.audit.record(OPERATOR_ORG_ID, me, 'static-data.default.delete', 'static_data', id).catch(() => {});
    return { ok: true };
  }
}
