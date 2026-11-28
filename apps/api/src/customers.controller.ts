import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { cleanContacts, cleanCustomer, parseCustomerTerm, CUSTOMER_TERMS, type CustomerContact, type CustomerInput } from '@worktime3/shared/customers';
import { callerUserId, can, isOrgMember } from './access';
import { DbService, type Db } from './db.service';
import type { AuthenticatedRequest } from './jwt.guard';
import { VersionsService } from './versions.service';
import { customerTerm } from './customers.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CustomerRow {
  id: string; name: string; street: string | null; house_number: string | null; zip: string | null; city: string | null;
  country: string; email: string | null; phone: string | null; language: string; active: boolean;
}

interface ContactRow { id: string; customer_id: string; name: string; role: string | null; email: string | null; phone: string | null }

/** A contact of another customer in a request: the transaction is rolled back. */
class ContactError extends Error {}

export function customerJson(c: CustomerRow, contacts: ContactRow[] = []) {
  return {
    id: c.id, name: c.name, street: c.street, houseNumber: c.house_number, zip: c.zip, city: c.city, country: c.country,
    email: c.email, phone: c.phone, language: c.language, active: c.active,
    contacts: contacts.filter((k) => k.customer_id === c.id).map((k) => ({ id: k.id, name: k.name, role: k.role, email: k.email, phone: k.phone })),
  };
}


/**
 * Customers (127, docs/dev/FEATURES.md): whom the organization works for, with address and contact people, and what it
 * calls them (its term). `nav.customers` sees and edits them; whoever edits projects (`nav.management`) sees them too,
 * to pick a project's customer. A plugin (billing) reads them directly and keeps its own data per customer.
 */
@Controller('organizations/:orgId')
export class CustomersController {
  constructor(
    private readonly dbService: DbService,
    private readonly versions: VersionsService,
  ) {}

  /** The database and the caller when they may `see` (or pick) or `edit` customers; null otherwise. */
  private async access(orgId: string, req: AuthenticatedRequest, action: 'see' | 'edit'): Promise<{ db: Db; userId: string } | null> {
    const db = this.dbService.getDb();
    if (!db || !UUID.test(orgId)) return null;
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return null;
    const allowed = action === 'edit'
      ? await can(db, orgId, userId, 'nav.customers', 'edit')
      : (await can(db, orgId, userId, 'nav.customers', 'see')) || (await can(db, orgId, userId, 'nav.management', 'edit'));
    return allowed ? { db, userId } : null;
  }

  private async contactsOf(db: Db, orgId: string, customerId?: string): Promise<ContactRow[]> {
    const one = customerId ? sql`AND customer_id = ${customerId}::uuid` : sql``;
    return (await db.execute(sql`SELECT id, customer_id, name, role, email, phone FROM customer_contacts
      WHERE organization_id = ${orgId}::uuid ${one} ORDER BY sort, lower(name)`)).rows as unknown as ContactRow[];
  }

  /** A customer's contacts as the request lists them: those left out go, an `id` keeps one (of this customer only). */
  private async saveContacts(db: Db, orgId: string, customerId: string, contacts: CustomerContact[]): Promise<string | null> {
    const existing = await this.contactsOf(db, orgId, customerId);
    if (contacts.some((c) => c.id && !existing.some((e) => e.id === c.id))) return 'unknown-contact';
    const keep = new Set(contacts.map((c) => c.id).filter(Boolean));
    for (const e of existing) if (!keep.has(e.id)) await db.execute(sql`DELETE FROM customer_contacts WHERE id = ${e.id}::uuid`);
    let sort = 0;
    for (const c of contacts) {
      if (c.id) {
        await db.execute(sql`UPDATE customer_contacts SET name = ${c.name}, role = ${c.role}, email = ${c.email}, phone = ${c.phone}, sort = ${sort++}
          WHERE id = ${c.id}::uuid AND customer_id = ${customerId}::uuid`);
      } else {
        await db.execute(sql`INSERT INTO customer_contacts (organization_id, customer_id, name, role, email, phone, sort)
          VALUES (${orgId}::uuid, ${customerId}::uuid, ${c.name}, ${c.role}, ${c.email}, ${c.phone}, ${sort++})`);
      }
    }
    return null;
  }

  @Get('customers')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const a = await this.access(orgId, req, 'see');
    if (!a) return { ok: true, customers: [], term: 'customer', editable: false };
    const [rows, contacts, term] = await Promise.all([
      a.db.execute(sql`SELECT id, name, street, house_number, zip, city, country, email, phone, language, active
        FROM customers WHERE organization_id = ${orgId}::uuid ORDER BY active DESC, lower(name)`),
      this.contactsOf(a.db, orgId),
      customerTerm(a.db, orgId),
    ]);
    return {
      ok: true, term, editable: await can(a.db, orgId, a.userId, 'nav.customers', 'edit'),
      customers: (rows.rows as unknown as CustomerRow[]).map((c) => customerJson(c, contacts)),
    };
  }

  @Post('customers')
  async create(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const a = await this.access(orgId, req, 'edit');
    if (!a) return { ok: false, error: 'forbidden' };
    const c = cleanCustomer(body);
    if (!c.ok) return c;
    const contacts = cleanContacts((body as { contacts?: unknown } | null)?.contacts);
    if (!contacts.ok) return contacts;
    const v: CustomerInput = c.value;
    const row = await a.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        INSERT INTO customers (organization_id, name, street, house_number, zip, city, country, email, phone, language, active)
        VALUES (${orgId}::uuid, ${v.name}, ${v.street}, ${v.houseNumber}, ${v.zip}, ${v.city}, ${v.country}, ${v.email}, ${v.phone}, ${v.language}, ${v.active})
        RETURNING id, name, street, house_number, zip, city, country, email, phone, language, active`);
      const created = rows.rows[0] as unknown as CustomerRow;
      await this.saveContacts(tx as unknown as Db, orgId, created.id, contacts.value.map((k) => ({ ...k, id: null })));
      return created;
    });
    void this.versions.record('customers', row.id, 'insert', a.userId, { ...row, contacts: contacts.value.length }).catch(() => {});
    return { ok: true, customer: customerJson(row, await this.contactsOf(a.db, orgId, row.id)) };
  }

  @Put('customers/:id')
  async update(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const a = await this.access(orgId, req, 'edit');
    if (!a) return { ok: false, error: 'forbidden' };
    if (!UUID.test(id)) return { ok: false, error: 'not-found' };
    const c = cleanCustomer(body);
    if (!c.ok) return c;
    // Contacts only when the request lists them (else they stay as they are).
    const raw = (body as { contacts?: unknown } | null)?.contacts;
    const contacts = raw === undefined ? null : cleanContacts(raw);
    if (contacts && !contacts.ok) return contacts;
    const v = c.value;
    const result = await a.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE customers SET name = ${v.name}, street = ${v.street}, house_number = ${v.houseNumber}, zip = ${v.zip}, city = ${v.city},
          country = ${v.country}, email = ${v.email}, phone = ${v.phone}, language = ${v.language}, active = ${v.active}
        WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid
        RETURNING id, name, street, house_number, zip, city, country, email, phone, language, active`);
      const row = rows.rows[0] as unknown as CustomerRow | undefined;
      if (!row) return { error: 'not-found' };
      if (contacts?.ok) {
        const bad = await this.saveContacts(tx as unknown as Db, orgId, id, contacts.value);
        if (bad) throw new ContactError(bad);
      }
      return { row };
    }).catch((e) => { if (e instanceof ContactError) return { error: e.message }; throw e; });
    if ('error' in result) return { ok: false, error: result.error };
    void this.versions.record('customers', id, 'update', a.userId, { ...result.row, ...(contacts?.ok ? { contacts: contacts.value.length } : {}) }).catch(() => {});
    return { ok: true, customer: customerJson(result.row, await this.contactsOf(a.db, orgId, id)) };
  }

  /** Deletes a customer no project names and nothing else keeps (a plugin's invoice); else `customer-in-use` (set it inactive). */
  @Delete('customers/:id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const a = await this.access(orgId, req, 'edit');
    if (!a) return { ok: false, error: 'forbidden' };
    if (!UUID.test(id)) return { ok: false, error: 'not-found' };
    const used = await a.db.execute(sql`SELECT 1 FROM projects WHERE customer_id = ${id}::uuid LIMIT 1`);
    if (used.rows.length) return { ok: false, error: 'customer-in-use' };
    try {
      const rows = await a.db.execute(sql`DELETE FROM customers WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid RETURNING id`);
      if (!rows.rows.length) return { ok: false, error: 'not-found' };
    } catch (e) {
      // A plugin's row still refers to it (a foreign key, e.g. billing's invoices).
      if ((e as { code?: string; cause?: { code?: string } }).code === '23503' || (e as { cause?: { code?: string } }).cause?.code === '23503') return { ok: false, error: 'customer-in-use' };
      throw e;
    }
    void this.versions.record('customers', id, 'delete', a.userId, { id }).catch(() => {});
    return { ok: true };
  }

  /** What the organization calls its customers, for every member (the navbar and texts name them so). */
  @Get('customers-term')
  async getTerm(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db || !UUID.test(orgId)) return { ok: true, term: 'customer' };
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId || !(await isOrgMember(db, orgId, userId))) return { ok: true, term: 'customer' };
    return { ok: true, term: await customerTerm(db, orgId) };
  }

  /** What the organization calls its customers: Kunde, Auftraggeber or Mandant. */
  @Put('customers-term')
  async putTerm(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: { term?: unknown }) {
    const a = await this.access(orgId, req, 'edit');
    if (!a) return { ok: false, error: 'forbidden' };
    if (!(CUSTOMER_TERMS as readonly unknown[]).includes(body?.term)) return { ok: false, error: 'invalid-term' };
    await a.db.execute(sql`
      UPDATE organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{customers}', COALESCE(settings->'customers', '{}'::jsonb) || jsonb_build_object('term', ${body.term}::text))
      WHERE id = ${orgId}::uuid`);
    void this.versions.record('organizations', orgId, 'update_delta', a.userId, { settings: { customers: { term: body.term } } }).catch(() => {});
    return { ok: true, term: body.term };
  }
}
