import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { FORMS, GROUPS_KEY, checkCustomField, checkCustomKey, checkFieldOverride, checkGroupsOverride, formWithCustom, mergeForm } from '@worktime3/shared/fields';
import { DbService, type Db } from './db.service';
import { callerUserId, isOrgDeveloper, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { FieldsService, loadLayers } from './fields.service';

/**
 * Form templates (docs/FIELD_CONFIG.md): every member reads the merged template of their org;
 * an org's developer edits the org layer. The global layer comes from migrations, like the global
 * roles. Every write is checked against the code registry, so no layer can loosen a rule the code sets.
 */
@Controller()
export class FieldsController {
  constructor(
    private readonly db: DbService,
    private readonly fields: FieldsService,
    private readonly audit: AuditService,
    private readonly versionsService: VersionsService,
  ) {}

  /** Whether the caller may use design mode in this org. */
  @Get('organizations/:orgId/form-design-access')
  async designAccess(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, canDesign: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: true, canDesign: false };
    return { ok: true, canDesign: await isOrgDeveloper(db, orgId, callerId) };
  }

  @Get('organizations/:orgId/forms/:formId')
  async get(@Param('orgId') orgId: string, @Param('formId') formId: string, @Req() req: AuthenticatedRequest) {
    const form = FORMS[formId];
    if (!form) return { ok: false, error: 'unknown-form' };
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, form: mergeForm(form) };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    return { ok: true, form: await this.fields.resolved(orgId, formId) };
  }

  /** The code defaults and both layers separately, so the design panel can show where each value comes from. */
  @Get('organizations/:orgId/forms/:formId/layers')
  async layers(@Param('orgId') orgId: string, @Param('formId') formId: string, @Req() req: AuthenticatedRequest) {
    const form = FORMS[formId];
    if (!form) return { ok: false, error: 'unknown-form' };
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, code: form, global: { fields: {}, groups: {} }, org: { fields: {}, groups: {} } };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgDeveloper(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const layers = await loadLayers(db, orgId, formId);
    return { ok: true, code: form, ...layers };
  }

  @Put('organizations/:orgId/forms/:formId/fields/:fieldKey')
  async putOrg(
    @Param('orgId') orgId: string,
    @Param('formId') formId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: { config?: unknown; custom?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgDeveloper(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const result = await this.save(db, orgId, formId, fieldKey, body?.config, callerId, body?.custom === true);
    if (result.ok) void this.audit.record(orgId, callerId, 'fields.update', 'form', formId, { field: fieldKey }).catch(() => {});
    return result;
  }

  @Delete('organizations/:orgId/forms/:formId/fields/:fieldKey')
  async deleteOrg(
    @Param('orgId') orgId: string,
    @Param('formId') formId: string,
    @Param('fieldKey') fieldKey: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgDeveloper(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const result = await this.remove(db, orgId, formId, fieldKey, callerId);
    if (result.ok) void this.audit.record(orgId, callerId, 'fields.reset', 'form', formId, { field: fieldKey }).catch(() => {});
    return result;
  }

  /**
   * Checks the org layer's config for one field (or `$groups`) against the code registry and stores it.
   * A custom field (`custom`, or a key the layer already defines as custom) is checked as a
   * definition instead: a new key must be free in the code and both layers.
   */
  private async save(db: Db, orgId: string, formId: string, fieldKey: string, config: unknown, callerId: string, custom = false) {
    const form = FORMS[formId];
    if (!form) return { ok: false, error: 'unknown-form' };
    const invalid = (reason: string, property?: string) => ({ ok: false, error: 'field-config-invalid', reason, property });

    if (fieldKey === GROUPS_KEY) {
      const check = checkGroupsOverride(form, config);
      if (!check.ok) return invalid(check.reason, check.property);
      if (Object.keys(check.value).length === 0) return this.remove(db, orgId, formId, fieldKey, callerId);
      return this.store(db, orgId, formId, fieldKey, { groups: check.value }, callerId, false);
    }

    const layers = await loadLayers(db, orgId, formId);
    const own = layers.org;
    const previous = own.custom?.[fieldKey];
    if (previous || custom) {
      if (!previous) {
        const taken = [...Object.keys(layers.global.custom ?? {}), ...Object.keys(layers.org.custom ?? {}), ...Object.keys(own.fields)];
        const key = checkCustomKey(form, fieldKey, taken);
        if (!key.ok) return invalid(key.reason, 'key');
      }
      const check = checkCustomField(form, fieldKey, config, previous);
      if (!check.ok) return invalid(check.reason, check.property);
      return this.store(db, orgId, formId, fieldKey, check.value, callerId, true);
    }

    // An org may also override the global template's custom fields, under the same rules as code fields.
    const check = checkFieldOverride(formWithCustom(form, layers.global), fieldKey, config);
    if (!check.ok) return invalid(check.reason, check.property);
    if (Object.keys(check.value).length === 0) return this.remove(db, orgId, formId, fieldKey, callerId);
    return this.store(db, orgId, formId, fieldKey, check.value, callerId, false);
  }

  private async store(db: Db, orgId: string, formId: string, fieldKey: string, stored: object, callerId: string, isCustom: boolean) {
    const id = await this.fields.saveOverride(db, orgId, formId, fieldKey, stored, isCustom);
    void this.versionsService
      .record('field_config', id, 'update', callerId, { organization_id: orgId, form_id: formId, field_key: fieldKey, is_custom: isCustom, config: stored })
      .catch(() => {});
    return { ok: true, config: stored };
  }

  /** Resets a field to inherited. A custom field is retired instead: its key stays taken and stored values stay. */
  private async remove(db: Db, orgId: string, formId: string, fieldKey: string, callerId: string) {
    if (!FORMS[formId]) return { ok: false, error: 'unknown-form' };
    if (fieldKey !== GROUPS_KEY) {
      const layers = await loadLayers(db, orgId, formId);
      const custom = layers.org.custom?.[fieldKey];
      if (custom) return this.store(db, orgId, formId, fieldKey, { ...custom, retired: true }, callerId, true);
    }
    const id = await this.fields.removeOverride(db, orgId, formId, fieldKey);
    if (id) {
      void this.versionsService
        .record('field_config', id, 'delete', callerId, { organization_id: orgId, form_id: formId, field_key: fieldKey })
        .catch(() => {});
    }
    return { ok: true };
  }
}
