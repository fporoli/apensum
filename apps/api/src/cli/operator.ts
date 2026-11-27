/**
 * The instance operator's command line, run on the server; no login of the app reaches it.
 *
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js owner list <organization>
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js owner set <organization> <e-mail>
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license list <organization>
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license grant <organization> <module> [--until YYYY-MM-DD]
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license revoke <organization> <module>
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators list
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators grant <e-mail>
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators revoke <e-mail>
 *   docker exec -e OPERATOR_PASSWORD apensum-<env>-api node apps/api/dist/cli/operator.js operators ensure <e-mail>
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js twofactor status <e-mail>
 *   docker exec apensum-<env>-api node apps/api/dist/cli/operator.js twofactor reset <e-mail>
 *
 * <organization> is its slug or id. `owner set` makes an active member an owner (for an organization
 * without one: only owners appoint owners in the app). A license lets the organization's admin switch
 * a licensed module on, through the last day given; without one the module is off and keeps its data.
 * Every change is in the organization's audit log.
 *
 * Operators are the active members of the Admin organization (OPERATOR_ORG_ID, 098): its Super Admin
 * pages (licenses, product news, superusers) and the AI limits, no right inside any other
 * organization. This command line or an operator on the Superusers page makes someone one, never a
 * registration or an invitation; each grant and revocation is in the Admin organization's audit log.
 * The first grant creates the Admin organization.
 *
 * `operators ensure` is the deploy's (infra/vps/remote.sh): the instance's own operator account, created
 * when missing, its password set to OPERATOR_PASSWORD (from the environment, never the command line),
 * and made an operator. It has no workspace of its own.
 *
 * `twofactor reset` takes an account's two-step login away (a lost phone and no recovery code left; check
 * who is asking first). If an organization requires it, the person sets it up again at the next login.
 */
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { isIsoDate } from '@worktime3/shared/worktime';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { pluginsDir, readPluginManifests } from '../plugins';

const USAGE = [
  'Usage: operator owner list <organization slug or id>',
  '       operator owner set <organization slug or id> <e-mail>',
  '       operator license list <organization slug or id>',
  '       operator license grant <organization slug or id> <module> [--until YYYY-MM-DD]',
  '       operator license revoke <organization slug or id> <module>',
  '       operator operators list',
  '       operator operators grant <e-mail>',
  '       operator operators revoke <e-mail>',
  '       OPERATOR_PASSWORD=... operator operators ensure <e-mail>',
  '       operator twofactor status <e-mail>',
  '       operator twofactor reset <e-mail>',
].join('\n');

async function twoFactor(action: string | undefined, email: string | undefined, rest: string[]): Promise<void> {
  if (!email || rest.length || (action !== 'status' && action !== 'reset')) throw new Error(USAGE);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const address = email.trim().toLowerCase();
    const { rows } = await pool.query<{ id: string; enabled: boolean | null; left: number | null }>(
      `SELECT u.id, t.enabled, cardinality(t.recovery_hashes) AS left FROM users u LEFT JOIN user_two_factor t ON t.user_id = u.id WHERE u.email = $1`,
      [address],
    );
    if (!rows.length) throw new Error(`no account ${address}`);
    if (action === 'reset') {
      const { rowCount } = await pool.query('DELETE FROM user_two_factor WHERE user_id = $1', [rows[0].id]);
      console.log(rowCount ? `${address}: two-step login removed` : `${address}: had no two-step login`);
      return;
    }
    console.log(rows[0].enabled ? `${address}: two-step login on, ${rows[0].left} recovery codes left` : `${address}: two-step login off`);
  } finally {
    await pool.end();
  }
}

/** The account (created when missing) with this password, and an operator. The password is never printed. */
async function ensureOperator(pool: Pool, email: string, password: string): Promise<string> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`not an e-mail address: ${email}`);
  if (password.length < 8) throw new Error('OPERATOR_PASSWORD must have at least 8 characters');
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let created = false;
    let { rows } = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (!rows.length) {
      ({ rows } = await client.query<{ id: string }>(`INSERT INTO users (email, display_name) VALUES ($1, 'Operator') RETURNING id`, [email]));
      created = true;
    }
    const userId = rows[0].id;
    const updated = await client.query(
      `UPDATE user_identities SET password_hash = $2 WHERE user_id = $1 AND provider = 'password'`,
      [userId, hash],
    );
    if (!updated.rowCount) {
      await client.query(
        `INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash) VALUES ($1, 'password', $2, $3)`,
        [userId, email, hash],
      );
    }
    const granted = await client.query<{ added: boolean }>('SELECT operator_grant($1::uuid) AS added', [userId]);
    if (granted.rows[0]?.added) {
      await client.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, NULL, 'operator.grant', 'user', $2, jsonb_build_object('by', 'deploy'))`,
        [OPERATOR_ORG_ID, userId],
      );
    }
    await client.query('COMMIT');
    return `${email}: ${created ? 'account created' : 'password set'}, operator`;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listOperators(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT u.email::text AS email FROM organization_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1 AND m.status = 'active' ORDER BY 1`,
    [OPERATOR_ORG_ID],
  );
  return rows.map((r) => r.email);
}

/** False when nothing changed (already one, or none). The change and its audit entry in one transaction. */
async function setOperator(pool: Pool, email: string, operator: boolean): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (!rows.length) throw new Error(`no account ${email}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fn = operator ? 'operator_grant' : 'operator_revoke';
    const result = await client.query<{ changed: boolean }>(`SELECT ${fn}($1::uuid) AS changed`, [rows[0].id]);
    const changed = result.rows[0]?.changed === true;
    if (changed) {
      await client.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, NULL, $2, 'user', $3, jsonb_build_object('by', 'operator CLI'))`,
        [OPERATOR_ORG_ID, operator ? 'operator.grant' : 'operator.revoke', rows[0].id],
      );
    }
    await client.query('COMMIT');
    return changed;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function operators(action: string | undefined, email: string | undefined, rest: string[]): Promise<void> {
  const valid = !rest.length && (action === 'list' ? !email : (action === 'grant' || action === 'revoke' || action === 'ensure') && !!email);
  if (!valid) throw new Error(USAGE);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (action === 'ensure') {
      console.log(await ensureOperator(pool, email!.trim().toLowerCase(), process.env.OPERATOR_PASSWORD ?? ''));
    } else if (email) {
      const address = email.trim().toLowerCase();
      const changed = await setOperator(pool, address, action === 'grant');
      console.log(action === 'grant'
        ? (changed ? `${address} is now an operator` : `${address} already is an operator`)
        : (changed ? `${address} is no operator any more` : `${address} was no operator`));
    }
    const list = await listOperators(pool);
    console.log(list.length ? `operators: ${list.join(', ')}` : 'no operator');
  } finally {
    await pool.end();
  }
}

/** The licensed modules of the plugins installed here: a typo must not pass as a license. */
function licensableModules(): string[] {
  return readPluginManifests(pluginsDir()).flatMap((p) => (p.manifest.module?.licensed ? [p.manifest.module.id] : []));
}

async function listLicenses(pool: Pool, orgId: string): Promise<string[]> {
  const { rows } = await pool.query<{ line: string }>(
    `SELECT module_id || CASE
              WHEN valid_until IS NULL THEN ' (open-ended)'
              WHEN valid_until < (now() AT TIME ZONE 'Europe/Zurich')::date THEN ' (expired ' || valid_until::text || ')' -- real time: licenses are contracts in real time
              ELSE ' (until ' || valid_until::text || ')' END AS line
     FROM organization_licenses WHERE organization_id = $1 ORDER BY module_id`,
    [orgId],
  );
  return rows.map((r) => r.line);
}

async function grantLicense(pool: Pool, orgId: string, moduleId: string, until: string | null): Promise<void> {
  await pool.query(
    `WITH changed AS (
       INSERT INTO organization_licenses (organization_id, module_id, valid_until) VALUES ($1::uuid, $2::text, $3::date)
       ON CONFLICT (organization_id, module_id) DO UPDATE SET valid_until = EXCLUDED.valid_until
       WHERE organization_licenses.valid_until IS DISTINCT FROM EXCLUDED.valid_until
       RETURNING organization_id, module_id, valid_until
     )
     INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
     SELECT organization_id, NULL, 'license.grant', 'module', module_id, jsonb_build_object('until', valid_until, 'by', 'operator CLI')
     FROM changed`,
    [orgId, moduleId, until],
  );
}

async function revokeLicense(pool: Pool, orgId: string, moduleId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `WITH removed AS (
       DELETE FROM organization_licenses WHERE organization_id = $1 AND module_id = $2
       RETURNING organization_id, module_id
     )
     INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
     SELECT organization_id, NULL, 'license.revoke', 'module', module_id, jsonb_build_object('by', 'operator CLI')
     FROM removed`,
    [orgId, moduleId],
  );
  return !!rowCount;
}

async function organizationId(pool: Pool, key: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE id::text = $1 OR slug::text = $1', [key]);
  if (rows.length !== 1) throw new Error(rows.length ? `"${key}" matches more than one organization: use the id` : `no organization "${key}"`);
  // The Admin organization has no owners or licenses: its members are the operators (`operators`).
  if (rows[0].id === OPERATOR_ORG_ID) throw new Error('that is the Admin organization: use `operators`');
  return rows[0].id;
}

async function listOwners(pool: Pool, orgId: string): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT DISTINCT u.email::text AS email FROM organization_memberships m
     JOIN users u ON u.id = m.user_id
     JOIN membership_roles mr ON mr.membership_id = m.id
     JOIN roles r ON r.id = mr.role_id
     WHERE m.organization_id = $1 AND m.status = 'active' AND r.name = 'owner'
     ORDER BY 1`,
    [orgId],
  );
  return rows.map((r) => r.email);
}

/** False when they already are one. */
async function setOwner(pool: Pool, orgId: string, email: string): Promise<boolean> {
  const member = await pool.query<{ id: string }>(
    `SELECT m.id FROM organization_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1 AND u.email = $2 AND m.status = 'active'`,
    [orgId, email],
  );
  if (!member.rows.length) throw new Error(`${email} is no active member of that organization`);
  // One statement, so there is no owner without its audit entry.
  const { rowCount } = await pool.query(
    `WITH granted AS (
       INSERT INTO membership_roles (membership_id, role_id)
       SELECT $2::uuid, id FROM roles WHERE name = 'owner' AND organization_id IS NULL
       ON CONFLICT DO NOTHING
       RETURNING membership_id, role_id
     )
     INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
     SELECT $1::uuid, NULL, 'role.grant', 'membership', membership_id::text, jsonb_build_object('roleId', role_id, 'by', 'operator CLI')
     FROM granted`,
    [orgId, member.rows[0].id],
  );
  return !!rowCount;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'operators') return operators(args[1], args[2], args.slice(3));
  if (args[0] === 'twofactor') return twoFactor(args[1], args[2], args.slice(3));
  const [subject, action, organization, value, flag, flagValue, ...rest] = args;
  const command = `${subject} ${action}`;
  const until = flag === '--until' ? flagValue : undefined;
  const wantsValue = ['owner set', 'license grant', 'license revoke'].includes(command);
  const valid =
    !!organization && !rest.length &&
    (wantsValue || command === 'owner list' || command === 'license list') &&
    wantsValue === !!value &&
    (flag === undefined || (command === 'license grant' && until !== undefined));
  if (!valid) throw new Error(USAGE);
  if (until !== undefined && !isIsoDate(until)) throw new Error(`not a date (YYYY-MM-DD): ${until}`);
  if (command === 'license grant' && !licensableModules().includes(value)) {
    throw new Error(`no licensed module "${value}" here (licensed: ${licensableModules().join(', ') || 'none'})`);
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const orgId = await organizationId(pool, organization);
    if (subject === 'owner') {
      if (action === 'set') console.log((await setOwner(pool, orgId, value)) ? `${value} is now an owner` : `${value} already is an owner`);
      const owners = await listOwners(pool, orgId);
      console.log(owners.length ? `owners: ${owners.join(', ')}` : 'no owner');
      return;
    }
    if (action === 'grant') await grantLicense(pool, orgId, value, until ?? null);
    if (action === 'revoke') console.log((await revokeLicense(pool, orgId, value)) ? `${value}: license removed` : `${value}: there was no license`);
    const licenses = await listLicenses(pool, orgId);
    console.log(licenses.length ? `licenses: ${licenses.join(', ')}` : 'no license');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
