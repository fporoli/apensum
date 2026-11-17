import { Controller, Get, Param, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { callerUserId, isOrgMember, listableUserIds } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

/**
 * Embedded Superset dashboards (trial; Superset runs in the dev stack, profile `bi`, see
 * infra/superset). The browser never talks to Superset with its own rights: this endpoint asks
 * Superset, server to server and as its admin, for a guest token that lasts 5 minutes, opens only
 * the configured dashboard and carries row-level security: the caller's organization on every
 * dataset, and per dataset the people the caller may see on the matching Apensum page
 * (`listableUserIds`, the same rule those pages use). The web app's embed SDK asks again when
 * the token runs out.
 *
 * Without SUPERSET_URL the feature is off: `{ ok: false, error: 'analytics-not-configured' }`.
 */

/** Which page's rule decides whose rows a reporting view shows (infra/superset/reporting.sql). */
export const ANALYTICS_DATASETS: Record<string, string> = {
  project_hours: 'nav.time',
  attendance_days: 'nav.workTime',
  absences: 'nav.absences',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RlsRule {
  clause: string;
  dataset?: number;
}

/**
 * The row-level security of a guest token: the organization on everything, and per dataset the
 * listed people ('all' = no further limit). Ids go into SQL, so anything that is not a uuid is
 * refused rather than quoted; a dataset whose people list is empty shows nothing (`1 = 0`).
 */
export function guestRls(orgId: string, people: Array<{ dataset: number; userIds: 'all' | string[] }>): RlsRule[] {
  if (!UUID.test(orgId)) throw new Error('invalid organization id');
  const rules: RlsRule[] = [{ clause: `organization_id = '${orgId}'` }];
  for (const { dataset, userIds } of people) {
    if (userIds === 'all') continue;
    const ids = userIds.filter((id) => UUID.test(id));
    rules.push({ dataset, clause: ids.length ? `user_id IN (${ids.map((id) => `'${id}'`).join(', ')})` : '1 = 0' });
  }
  return rules;
}

interface SupersetConfig {
  url: string;
  publicUrl: string;
  user: string;
  password: string;
  dashboard: string;
}

function supersetConfig(): SupersetConfig | null {
  const url = process.env.SUPERSET_URL;
  if (!url || !process.env.SUPERSET_ADMIN_PASSWORD) return null;
  return {
    url: url.replace(/\/$/, ''),
    publicUrl: (process.env.SUPERSET_PUBLIC_URL || url).replace(/\/$/, ''),
    user: process.env.SUPERSET_ADMIN_USER || 'admin',
    password: process.env.SUPERSET_ADMIN_PASSWORD,
    dashboard: process.env.SUPERSET_DASHBOARD_SLUG || 'apensum-overview',
  };
}

@Controller('organizations/:orgId/analytics')
export class AnalyticsController {
  constructor(private readonly db: DbService) {}

  /** Replaceable in tests: a call to Superset's REST API. */
  superset: (config: SupersetConfig, method: string, path: string, token?: string, body?: unknown) => Promise<any> = async (config, method, path, token, body) => {
    const res = await fetch(config.url + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`superset ${method} ${path}: ${res.status}`);
    return res.json();
  };

  /** Whether the page is offered at all (the navbar asks). */
  @Get('status')
  async status(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, available: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', available: false };
    return { ok: true, available: supersetConfig() !== null };
  }

  /** What the embed SDK needs: Superset's address, the embedded dashboard and a guest token. */
  @Get('embed')
  async embed(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !UUID.test(orgId) || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const config = supersetConfig();
    if (!config) return { ok: false, error: 'analytics-not-configured' };

    try {
      const login = await this.superset(config, 'POST', '/api/v1/security/login', undefined, {
        username: config.user, password: config.password, provider: 'db', refresh: false,
      });
      const admin: string = login.access_token;
      const dashboard = await this.superset(config, 'GET', `/api/v1/dashboard/${encodeURIComponent(config.dashboard)}`, admin);
      const embedded = await this.superset(config, 'GET', `/api/v1/dashboard/${dashboard.result.id}/embedded`, admin);
      const datasets = await this.superset(config, 'GET', '/api/v1/dataset/?q=(page_size:100)', admin);

      const people: Array<{ dataset: number; userIds: 'all' | string[] }> = [];
      for (const ds of datasets.result as Array<{ id: number; table_name: string; schema: string }>) {
        if (ds.schema !== 'reporting') continue;
        const object = ANALYTICS_DATASETS[ds.table_name];
        // A reporting view without a rule here shows the caller's own rows only.
        people.push({ dataset: ds.id, userIds: object ? await listableUserIds(db, orgId, callerId, object) : [callerId] });
      }

      const guest = await this.superset(config, 'POST', '/api/v1/security/guest_token/', admin, {
        user: { username: callerId, first_name: 'Apensum', last_name: 'User' },
        resources: [{ type: 'dashboard', id: embedded.result.uuid }],
        rls: guestRls(orgId, people),
      });
      return { ok: true, supersetUrl: config.publicUrl, dashboardId: embedded.result.uuid, token: guest.token };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`analytics: no guest token: ${err instanceof Error ? err.message : err}`);
      return { ok: false, error: 'analytics-unavailable' };
    }
  }
}
