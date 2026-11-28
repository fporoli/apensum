// Customers (127): whom an organization works for, with address and contact people; a project names its customer,
// the customer's reference (an authority's file number) and the contact it goes to ("z. H."), a subproject may have
// its own. What the organization calls them is its term (organizations.settings.customers.term): Kunde (`customer`),
// Auftraggeber (`client`) or Mandant (`principal`); a text that names them has a variant per term (`<key>.client`,
// `<key>.principal`, termKey). Used by the API, the web app and plugins (billing).
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

export const CUSTOMER_TERMS = ['customer', 'client', 'principal'] as const;
export type CustomerTerm = (typeof CUSTOMER_TERMS)[number];

export function parseCustomerTerm(raw: unknown): CustomerTerm {
  return (CUSTOMER_TERMS as readonly unknown[]).includes(raw) ? (raw as CustomerTerm) : 'customer';
}

/** The text key for a term: its variant where the dictionary has one (`has`), else the key itself. */
export function termKey(key: string, term: CustomerTerm, has: (key: string) => boolean): string {
  if (term === 'customer') return key;
  const variant = `${key}.${term}`;
  return has(variant) ? variant : key;
}

export const CUSTOMER_LANGUAGES = ['de', 'fr', 'it', 'en'] as const;
export type CustomerLanguage = (typeof CUSTOMER_LANGUAGES)[number];

/** A customer's contact person: whom something goes to ("z. H."), with role, e-mail and phone. */
export interface CustomerContact { id: string | null; name: string; role: string | null; email: string | null; phone: string | null }

/** A customer as the API takes and gives it (contacts in order). */
export interface CustomerInput {
  name: string; street: string | null; houseNumber: string | null; zip: string | null; city: string | null; country: string;
  email: string | null; phone: string | null; language: CustomerLanguage; active: boolean;
}

export const MAX_CONTACTS = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY = /^[A-Z]{2}$/;

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nullable = (v: unknown, max: number) => text(v, max) || null;

/** A customer from a request, or what is wrong with it. */
export function cleanCustomer(body: unknown): { ok: true; value: CustomerInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = text(b.name, 70);
  if (!name) return { ok: false, error: 'customer-name-missing' };
  const country = text(b.country || 'CH', 10).toUpperCase();
  if (!COUNTRY.test(country)) return { ok: false, error: 'invalid-country' };
  const email = text(b.email, 200);
  if (email && !EMAIL.test(email)) return { ok: false, error: 'invalid-email' };
  const language = (CUSTOMER_LANGUAGES as readonly unknown[]).includes(b.language) ? (b.language as CustomerLanguage) : 'de';
  return {
    ok: true,
    value: {
      name, street: nullable(b.street, 70), houseNumber: nullable(b.houseNumber, 16), zip: nullable(b.zip, 16), city: nullable(b.city, 35),
      country, email: email || null, phone: nullable(b.phone, 40), language, active: b.active !== false,
    },
  };
}

/** A customer's contacts from a request (the complete list, in order; an `id` keeps that contact), or what is wrong. */
export function cleanContacts(raw: unknown): { ok: true; value: CustomerContact[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > MAX_CONTACTS) return { ok: false, error: 'invalid-contacts' };
  const out: CustomerContact[] = [];
  for (const c of raw) {
    const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const name = text(r.name, 70);
    if (!name) return { ok: false, error: 'contact-name-missing' };
    const email = text(r.email, 200);
    if (email && !EMAIL.test(email)) return { ok: false, error: 'invalid-email' };
    const id = typeof r.id === 'string' && ID.test(r.id) ? r.id : null;
    out.push({ id, name, role: text(r.role, 70) || null, email: email || null, phone: text(r.phone, 40) || null });
  }
  if (new Set(out.map((c) => c.id).filter(Boolean)).size !== out.filter((c) => c.id).length) return { ok: false, error: 'invalid-contacts' };
  return { ok: true, value: out };
}

/** A reference (an authority's file number) from a request: trimmed, at most 70 characters; empty = none. */
export const cleanReference = (v: unknown): string | null => text(v, 70) || null;

/**
 * What goes to a customer for a project or subproject ("Ihre Referenz", "z. H."): the subproject's where it has them,
 * else its project's.
 */
export function addressee(
  project: { reference: string | null; contactName: string | null } | null,
  subproject: { reference: string | null; contactName: string | null } | null,
): { theirReference: string | null; attention: string | null } {
  return {
    theirReference: subproject?.reference ?? project?.reference ?? null,
    attention: subproject?.contactName ?? project?.contactName ?? null,
  };
}
