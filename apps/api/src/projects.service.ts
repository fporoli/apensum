import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { cleanReference } from '@worktime3/shared/customers';
import type { Db } from './db.service';
import { VersionsService } from './versions.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A customer with its projects, for a plugin's choice (e.g. a case's time tracking). */
export interface CustomerProjects {
  id: string;
  name: string;
  active: boolean;
  contacts: { id: string; name: string; role: string | null }[];
  projects: { id: string; name: string }[];
}

/** A subproject with its project, customer and the time booked on it. */
export interface SubprojectSummary {
  subprojectId: string;
  subprojectName: string;
  projectId: string;
  projectName: string;
  customerId: string | null;
  customerName: string | null;
  reference: string | null;
  contactName: string | null;
  /** Project time booked on it, all people, minutes; and how many entries. */
  minutes: number;
  entries: number;
}

/**
 * Projects and subprojects for plugins (the plugin contract): the customers with their projects, a new project for a
 * customer, a new subproject (e.g. one case of an assessor), and what a subproject holds. Callers authorize first
 * (this service checks only that the ids belong to the organization and to each other); every write is recorded in
 * the versions like the Projects & Teams page's.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly versions: VersionsService) {}

  /** The organization's customers with their contacts and projects. */
  async customersWithProjects(db: Db, orgId: string): Promise<CustomerProjects[]> {
    const [customers, contacts, projects] = await Promise.all([
      db.execute(sql`SELECT id, name, active FROM customers WHERE organization_id = ${orgId}::uuid ORDER BY active DESC, lower(name)`),
      db.execute(sql`SELECT id, customer_id, name, role FROM customer_contacts WHERE organization_id = ${orgId}::uuid ORDER BY sort, lower(name)`),
      db.execute(sql`SELECT id, name, customer_id FROM projects WHERE organization_id = ${orgId}::uuid AND customer_id IS NOT NULL ORDER BY lower(name)`),
    ]);
    const k = contacts.rows as { id: string; customer_id: string; name: string; role: string | null }[];
    const p = projects.rows as { id: string; name: string; customer_id: string }[];
    return (customers.rows as { id: string; name: string; active: boolean }[]).map((c) => ({
      id: c.id, name: c.name, active: c.active,
      contacts: k.filter((x) => x.customer_id === c.id).map((x) => ({ id: x.id, name: x.name, role: x.role })),
      projects: p.filter((x) => x.customer_id === c.id).map((x) => ({ id: x.id, name: x.name })),
    }));
  }

  /** Whether the contact is one of the customer's (of this organization). */
  private async contactOf(db: Db, orgId: string, contactId: string | null, customerId: string | null): Promise<boolean> {
    if (!contactId) return true;
    if (!customerId || !UUID.test(contactId)) return false;
    return (await db.execute(sql`SELECT 1 FROM customer_contacts WHERE id = ${contactId}::uuid AND customer_id = ${customerId}::uuid AND organization_id = ${orgId}::uuid`)).rows.length > 0;
  }

  /** A new customer project (type `customer`), owned by `ownerUserId`. */
  async createCustomerProject(db: Db, orgId: string, actorId: string, input: { name: string; customerId: string; ownerUserId: string }):
    Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const name = input.name.trim().slice(0, 200);
    if (!name) return { ok: false, error: 'name-required' };
    if (!UUID.test(input.customerId) || !(await db.execute(sql`SELECT 1 FROM customers WHERE id = ${input.customerId}::uuid AND organization_id = ${orgId}::uuid`)).rows.length) {
      return { ok: false, error: 'unknown-customer' };
    }
    const [row] = (await db.execute(sql`
      INSERT INTO projects (organization_id, name, owner_user_id, type, customer_id)
      VALUES (${orgId}::uuid, ${name}, ${input.ownerUserId}::uuid, 'customer', ${input.customerId}::uuid)
      RETURNING id, organization_id, name, owner_user_id, type, customer_id`)).rows as { id: string }[];
    void this.versions.record('projects', row.id, 'insert', actorId, row).catch(() => {});
    return { ok: true, id: row.id };
  }

  /**
   * A new subproject of the organization's project, with its own customer reference and contact (one of the project's
   * customer's). The caller has authorized it.
   */
  async createSubproject(db: Db, orgId: string, actorId: string, input: {
    projectId: string; name: string; ownerUserId: string; customerReference?: string | null; customerContactId?: string | null;
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const name = input.name.trim().slice(0, 200);
    if (!name) return { ok: false, error: 'name-required' };
    if (!UUID.test(input.projectId)) return { ok: false, error: 'project-not-found' };
    const [project] = (await db.execute(sql`SELECT customer_id FROM projects WHERE id = ${input.projectId}::uuid AND organization_id = ${orgId}::uuid`)).rows as { customer_id: string | null }[];
    if (!project) return { ok: false, error: 'project-not-found' };
    const contactId = input.customerContactId || null;
    if (!(await this.contactOf(db, orgId, contactId, project.customer_id))) return { ok: false, error: 'unknown-contact' };
    const [row] = (await db.execute(sql`
      INSERT INTO subprojects (project_id, organization_id, name, owner_user_id, type, customer_reference, customer_contact_id)
      VALUES (${input.projectId}::uuid, ${orgId}::uuid, ${name}, ${input.ownerUserId}::uuid, 'work_package', ${cleanReference(input.customerReference)}, ${contactId})
      RETURNING id, project_id, organization_id, name, owner_user_id, type, customer_reference, customer_contact_id`)).rows as { id: string }[];
    void this.versions.record('subprojects', row.id, 'insert', actorId, row).catch(() => {});
    return { ok: true, id: row.id };
  }

  /** A subproject of the organization with its project, customer, reference ("z. H." falls back to the project's) and booked time. */
  async subprojectSummary(db: Db, orgId: string, subprojectId: string): Promise<SubprojectSummary | null> {
    if (!UUID.test(subprojectId)) return null;
    const [r] = (await db.execute(sql`
      SELECT s.id, s.name, p.id AS project_id, p.name AS project_name, c.id AS customer_id, c.name AS customer_name,
        COALESCE(s.customer_reference, p.customer_reference) AS reference, k.name AS contact_name,
        COALESCE((SELECT sum(EXTRACT(EPOCH FROM (pt.end_time - pt.start_time)) / 60) FROM project_times pt WHERE pt.subproject_id = s.id), 0) AS minutes,
        (SELECT count(*) FROM project_times pt WHERE pt.subproject_id = s.id) AS entries
      FROM subprojects s JOIN projects p ON p.id = s.project_id
      LEFT JOIN customers c ON c.id = p.customer_id
      LEFT JOIN customer_contacts k ON k.id = COALESCE(s.customer_contact_id, p.customer_contact_id)
      WHERE s.id = ${subprojectId}::uuid AND s.organization_id = ${orgId}::uuid`)).rows as {
        id: string; name: string; project_id: string; project_name: string; customer_id: string | null; customer_name: string | null;
        reference: string | null; contact_name: string | null; minutes: string | number; entries: string | number;
      }[];
    if (!r) return null;
    return {
      subprojectId: r.id, subprojectName: r.name, projectId: r.project_id, projectName: r.project_name, customerId: r.customer_id,
      customerName: r.customer_name, reference: r.reference, contactName: r.contact_name, minutes: Math.round(Number(r.minutes)), entries: Number(r.entries),
    };
  }
}
