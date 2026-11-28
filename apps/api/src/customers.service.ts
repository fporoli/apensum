import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CustomerContact } from '@worktime3/shared/customers';
import type { Db } from './db.service';
import { parseCustomerTerm } from '@worktime3/shared/customers';

/** The organization's term for its customers (organizations.settings.customers.term). */
export async function customerTerm(db: Db, orgId: string) {
  const rows = await db.execute(sql`SELECT settings->'customers'->'term' AS term FROM organizations WHERE id = ${orgId}::uuid`);
  return parseCustomerTerm((rows.rows[0] as { term?: unknown } | undefined)?.term);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A customer as plugins read it (127). */
export interface CustomerRecord {
  id: string; name: string; street: string | null; houseNumber: string | null; zip: string | null; city: string | null; country: string;
  email: string | null; phone: string | null; language: string; active: boolean; contacts: CustomerContact[];
}

/**
 * The organization's customers for plugins (the plugin contract), instead of their tables: the list, one, their
 * names, and what the organization calls them. Plugins keep their own data per customer by its id.
 */
@Injectable()
export class CustomersService {
  async list(db: Db, orgId: string, ids?: readonly string[]): Promise<CustomerRecord[]> {
    const only = ids ? sql`AND c.id = ANY(${`{${ids.filter((id) => UUID.test(id)).join(',')}}`}::uuid[])` : sql``;
    const [rows, contacts] = await Promise.all([
      db.execute(sql`SELECT c.id, c.name, c.street, c.house_number, c.zip, c.city, c.country, c.email, c.phone, c.language, c.active
        FROM customers c WHERE c.organization_id = ${orgId}::uuid ${only} ORDER BY c.active DESC, lower(c.name)`),
      db.execute(sql`SELECT k.id, k.customer_id, k.name, k.role, k.email, k.phone FROM customer_contacts k
        WHERE k.organization_id = ${orgId}::uuid ORDER BY k.sort, lower(k.name)`),
    ]);
    const k = contacts.rows as { id: string; customer_id: string; name: string; role: string | null; email: string | null; phone: string | null }[];
    return (rows.rows as { id: string; name: string; street: string | null; house_number: string | null; zip: string | null; city: string | null; country: string; email: string | null; phone: string | null; language: string; active: boolean }[])
      .map((c) => ({
        id: c.id, name: c.name, street: c.street, houseNumber: c.house_number, zip: c.zip, city: c.city, country: c.country,
        email: c.email, phone: c.phone, language: c.language, active: c.active,
        contacts: k.filter((x) => x.customer_id === c.id).map((x) => ({ id: x.id, name: x.name, role: x.role, email: x.email, phone: x.phone })),
      }));
  }

  async get(db: Db, orgId: string, id: string): Promise<CustomerRecord | null> {
    if (!UUID.test(id)) return null;
    return (await this.list(db, orgId, [id]))[0] ?? null;
  }

  /** What the organization calls its customers (Kunde, Auftraggeber, Mandant). */
  term(db: Db, orgId: string) {
    return customerTerm(db, orgId);
  }
}
