import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { cleanReference } from '@worktime3/shared/customers';
import type { Db } from './db.service';
import { VersionsService } from './versions.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A project with its customer fields (127). */
export interface ProjectRecord { id: string; name: string; type: string; costItem: string | null; customerId: string | null; customerReference: string | null; customerContactId: string | null }

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
  // Nest injects it (a provider); a plugin's free function may make one to read (`new ProjectsService()`); writes record in the versions.
  constructor(private readonly versions?: VersionsService) {}

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
    void this.versions?.record('projects', row.id, 'insert', actorId, row).catch(() => {});
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
    void this.versions?.record('subprojects', row.id, 'insert', actorId, row).catch(() => {});
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

  /** The organization's projects (only these ids, or of one customer, when given) with their customer fields. */
  async projects(db: Db, orgId: string, filter: { ids?: readonly string[]; customerId?: string } = {}): Promise<ProjectRecord[]> {
    const ids = filter.ids ? sql`AND p.id = ANY(${`{${filter.ids.filter((id) => UUID.test(id)).join(',')}}`}::uuid[])` : sql``;
    const customer = filter.customerId !== undefined ? (UUID.test(filter.customerId) ? sql`AND p.customer_id = ${filter.customerId}::uuid` : sql`AND false`) : sql``;
    const rows = await db.execute(sql`SELECT p.id, p.name, p.type, p.cost_item, p.customer_id, p.customer_reference, p.customer_contact_id
      FROM projects p WHERE p.organization_id = ${orgId}::uuid ${ids} ${customer} ORDER BY lower(p.name)`);
    return (rows.rows as { id: string; name: string; type: string; cost_item: string | null; customer_id: string | null; customer_reference: string | null; customer_contact_id: string | null }[])
      .map((p) => ({ id: p.id, name: p.name, type: p.type, costItem: p.cost_item, customerId: p.customer_id, customerReference: p.customer_reference, customerContactId: p.customer_contact_id }));
  }

  /** The subprojects of these projects (of the organization). */
  async subprojects(db: Db, orgId: string, projectIds: readonly string[]): Promise<{ id: string; projectId: string; name: string; customerReference: string | null; customerContactId: string | null }[]> {
    if (!projectIds.length) return [];
    const rows = await db.execute(sql`SELECT s.id, s.project_id, s.name, s.customer_reference, s.customer_contact_id FROM subprojects s
      WHERE s.organization_id = ${orgId}::uuid AND s.project_id = ANY(${`{${projectIds.filter((id) => UUID.test(id)).join(',')}}`}::uuid[])
      ORDER BY lower(s.name)`);
    return (rows.rows as { id: string; project_id: string; name: string; customer_reference: string | null; customer_contact_id: string | null }[])
      .map((s) => ({ id: s.id, projectId: s.project_id, name: s.name, customerReference: s.customer_reference, customerContactId: s.customer_contact_id }));
  }

  /**
   * "Ihre Referenz" and "z. H." for a project of the customer, or one of its subprojects (the subproject's where set,
   * else the project's); null when the project is not the customer's or the subproject not the project's.
   */
  async addressee(db: Db, orgId: string, customerId: string, projectId: string, subprojectId: string | null):
    Promise<{ project: { reference: string | null; contactName: string | null }; subproject: { reference: string | null; contactName: string | null } | null } | null> {
    if (!UUID.test(projectId) || !UUID.test(customerId) || (subprojectId && !UUID.test(subprojectId))) return null;
    const [p] = (await db.execute(sql`SELECT p.customer_reference AS reference, k.name AS contact FROM projects p
      LEFT JOIN customer_contacts k ON k.id = p.customer_contact_id
      WHERE p.id = ${projectId}::uuid AND p.customer_id = ${customerId}::uuid AND p.organization_id = ${orgId}::uuid`)).rows as { reference: string | null; contact: string | null }[];
    if (!p) return null;
    let sub: { reference: string | null; contactName: string | null } | null = null;
    if (subprojectId) {
      const [s] = (await db.execute(sql`SELECT s.customer_reference AS reference, k.name AS contact FROM subprojects s
        LEFT JOIN customer_contacts k ON k.id = s.customer_contact_id
        WHERE s.id = ${subprojectId}::uuid AND s.project_id = ${projectId}::uuid AND s.organization_id = ${orgId}::uuid`)).rows as { reference: string | null; contact: string | null }[];
      if (!s) return null;
      sub = { reference: s.reference, contactName: s.contact };
    }
    return { project: { reference: p.reference, contactName: p.contact }, subproject: sub };
  }

  /** Who booked project time on the organization's projects: per project, the people (with names). */
  async bookers(db: Db, orgId: string): Promise<{ projectId: string; userId: string; name: string }[]> {
    const rows = await db.execute(sql`SELECT DISTINCT pt.project_id, pt.user_id, COALESCE(u.display_name, u.email) AS name FROM project_times pt
      JOIN users u ON u.id = pt.user_id WHERE pt.organization_id = ${orgId}::uuid AND pt.project_id IS NOT NULL`);
    return (rows.rows as { project_id: string; user_id: string; name: string }[]).map((r) => ({ projectId: r.project_id, userId: r.user_id, name: r.name }));
  }

  /**
   * Project time on these projects (one subproject only, when set) dated within [from, to] in each person's time zone,
   * with whether that person's project timesheet of its month is approved; entries in `except` left out.
   */
  async timeEntries(db: Db, orgId: string, q: { projectIds: readonly string[]; subprojectId: string | null; from: string; to: string }):
    Promise<{ id: string; projectId: string; projectName: string; userId: string; userName: string; minutes: number; approved: boolean }[]> {
    if (!q.projectIds.length) return [];
    const sub = q.subprojectId && UUID.test(q.subprojectId) ? sql`AND pt.subproject_id = ${q.subprojectId}::uuid` : sql``;
    const rows = await db.execute(sql`
      SELECT pt.id, pt.project_id, p.name AS project_name, pt.user_id, COALESCE(u.display_name, u.email) AS user_name,
        EXTRACT(EPOCH FROM (pt.end_time - pt.start_time)) / 60 AS minutes,
        COALESCE(ptp.status::text = 'approved', false) AS approved
      FROM project_times pt
      JOIN projects p ON p.id = pt.project_id
      JOIN users u ON u.id = pt.user_id
      LEFT JOIN project_time_periods ptp ON ptp.organization_id = pt.organization_id AND ptp.user_id = pt.user_id AND ptp.project_id = pt.project_id
        AND ptp.period_start = date_trunc('month', (pt.start_time AT TIME ZONE COALESCE(u.timezone, 'Europe/Zurich')))::date
      WHERE pt.organization_id = ${orgId}::uuid AND pt.project_id = ANY(${`{${q.projectIds.filter((id) => UUID.test(id)).join(',')}}`}::uuid[])
        AND (pt.start_time AT TIME ZONE COALESCE(u.timezone, 'Europe/Zurich'))::date BETWEEN ${q.from}::date AND ${q.to}::date ${sub}`);
    return (rows.rows as { id: string; project_id: string; project_name: string; user_id: string; user_name: string; minutes: string; approved: boolean }[])
      .map((r) => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, userId: r.user_id, userName: r.user_name, minutes: Number(r.minutes), approved: r.approved }));
  }

  /** Names of these projects and subprojects of the organization (by id). */
  async names(db: Db, orgId: string, q: { projectIds?: readonly (string | null)[]; subprojectIds?: readonly (string | null)[] }): Promise<{ projects: Map<string, string>; subprojects: Map<string, string> }> {
    const list = (ids: readonly (string | null)[] | undefined) => `{${[...new Set((ids ?? []).filter((id): id is string => !!id && UUID.test(id)))].join(',')}}`;
    const [p, s] = await Promise.all([
      q.projectIds?.length ? db.execute(sql`SELECT id, name FROM projects WHERE organization_id = ${orgId}::uuid AND id = ANY(${list(q.projectIds)}::uuid[])`) : Promise.resolve({ rows: [] }),
      q.subprojectIds?.length ? db.execute(sql`SELECT id, name FROM subprojects WHERE organization_id = ${orgId}::uuid AND id = ANY(${list(q.subprojectIds)}::uuid[])`) : Promise.resolve({ rows: [] }),
    ]);
    return {
      projects: new Map((p.rows as { id: string; name: string }[]).map((r) => [r.id, r.name])),
      subprojects: new Map((s.rows as { id: string; name: string }[]).map((r) => [r.id, r.name])),
    };
  }

  /** The organization's projects and subprojects whose name contains the text (case aside): for a search. */
  async matching(db: Db, orgId: string, text: string): Promise<{ projectIds: string[]; subprojectIds: string[] }> {
    return this.matchingPattern(db, orgId, `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  /** The same with an ILIKE pattern of the caller's (e.g. a search's word, already escaped). */
  async matchingPattern(db: Db, orgId: string, pattern: string): Promise<{ projectIds: string[]; subprojectIds: string[] }> {
    const [p, s] = await Promise.all([
      db.execute(sql`SELECT id FROM projects WHERE organization_id = ${orgId}::uuid AND name ILIKE ${pattern}`),
      db.execute(sql`SELECT id FROM subprojects WHERE organization_id = ${orgId}::uuid AND name ILIKE ${pattern}`),
    ]);
    return { projectIds: (p.rows as { id: string }[]).map((r) => r.id), subprojectIds: (s.rows as { id: string }[]).map((r) => r.id) };
  }
}
