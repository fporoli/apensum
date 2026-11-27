'use strict';
// Every local time below is Zurich's.
process.env.TZ = 'Europe/Zurich';
/**
 * Whale: a company's life since 2015, played through the API's own services (docs/OPERATIONS.md "Whale simulation").
 *
 * Runs inside the API's container (or against a dev database) as `node test/simulation/life.cjs <target>`, after the
 * instance was reset. It boots the API's Nest application without HTTP and calls its controllers as the person who
 * acts (`{ kind: 'local', sub: <user id> }`), so every check, flow and permission runs as in real use. Plain SQL only
 * where a service cannot act in the past (an account's join date, the admin's short demo password); each is marked
 * `SQL:`. Random but reproducible (`SIM_SEED`).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ROOT = process.env.APENSUM_ROOT ?? path.resolve(__dirname, '../..');
const dist = (p) => require(path.join(ROOT, 'apps/api/dist', p));
const plugin = (id, p) => require(path.join(ROOT, 'plugins', id, 'dist/api', p));
const TARGETS = ['vps-test', 'vps-preprod', 'local-check', 'dev'];

// ------------------------------------------------------------------------------------------------ the company

// SIM_FOUNDED=YYYY-MM-DD moves the founding (2015-01-01: about eleven years of history).
const FOUNDED = process.env.SIM_FOUNDED || '2015-01-01';
assert(/^\d{4}-\d{2}-\d{2}$/.test(FOUNDED) && new Date(`${FOUNDED}T00:00:00Z`).toISOString().startsWith(FOUNDED) && FOUNDED >= '2000-01-01', `SIM_FOUNDED: a day YYYY-MM-DD from 2000 on, not ${FOUNDED}`);
// SIM_HEADCOUNT: how many work at Whale today (200; 10 to 2000).
const HEADCOUNT = Number(process.env.SIM_HEADCOUNT || 200);
assert(Number.isInteger(HEADCOUNT) && HEADCOUNT >= 10 && HEADCOUNT <= 2000, `SIM_HEADCOUNT: a whole number from 10 to 2000, not ${process.env.SIM_HEADCOUNT}`);
const COMPANY = { name: 'Whale', founded: FOUNDED, headcount: HEADCOUNT, admin: 'admin@whale.com', adminPassword: 'admin' };
const DOMAIN = 'whale.example';
const SHARES = { hr: 0.05, finance: 0.05, lead: 0.1, it: 0.05 };
const DEPARTMENTS = [
  ['management', 'Management'], ['hr', 'HR'], ['finance', 'Finance'], ['it', 'IT Support'], ['sales', 'Sales'],
  ['consulting', 'Consulting'], ['development', 'Development'], ['operations', 'Operations'], ['marketing', 'Marketing'], ['service', 'Customer Service'],
];
/** Where people of each role work; members spread over the business departments. */
const ROLE_DEPARTMENT = { hr: 'hr', finance: 'finance', it: 'it' };
const BUSINESS = ['sales', 'consulting', 'development', 'operations', 'marketing', 'service'];
/** Departments that work on customer projects (and book project time). */
const PROJECT_DEPTS = ['consulting', 'development', 'operations', 'service', 'data', 'security', 'ai'];
/** Departments founded later (year, code, name): the business grows into new fields. */
const LATER_DEPARTMENTS = [[2017, 'data', 'Data & Analytics'], [2020, 'security', 'Security'], [2023, 'ai', 'AI Lab']];
const CATEGORIES = {
  values: { travel: { vat: 'standard', account: '5820' }, meals: { vat: 'standard', account: '5821' }, supplies: { vat: 'standard', account: '6500' }, software: { vat: 'standard', account: '6570' }, other: {} },
  translation: {
    en: { travel: 'Travel', meals: 'Meals & Entertainment', supplies: 'Office Supplies', software: 'Software & Subscriptions', other: 'Other' },
    de: { travel: 'Reisen', meals: 'Verpflegung & Bewirtung', supplies: 'Büromaterial', software: 'Software & Abonnemente', other: 'Sonstiges' },
    fr: { travel: 'Voyages', meals: 'Repas & représentation', supplies: 'Fournitures de bureau', software: 'Logiciels & abonnements', other: 'Autres' },
    it: { travel: 'Viaggi', meals: 'Pasti & rappresentanza', supplies: "Materiale d'ufficio", software: 'Software & abbonamenti', other: 'Altro' },
  },
};
/** What people ask in a Free Flow, and of whom (`manager` or a department's code). */
const FLOW_TOPICS = [
  ['Question about my payslip', 'hr'], ['Certificate of employment', 'hr'], ['Change of my working hours', 'manager'], ['Home office on Fridays', 'manager'],
  ['Training course', 'manager'], ['New laptop needed', 'it'], ['Access to the CRM', 'it'], ['VPN does not connect', 'it'], ['Parking spot', 'finance'],
  ['Expense advance for a trip', 'finance'], ['Desk move', 'manager'], ['Customer complaint', 'service'], ['Phone contract', 'it'], ['Reference letter', 'hr'],
];
/** Customers the projects are for. */
const CUSTOMERS = [['Seaside Insurance AG', '8001', 'Zürich'], ['Alpine Logistics SA', '1003', 'Lausanne'], ['Lakeview Bank AG', '6003', 'Luzern'], ['Ticino Foods SA', '6900', 'Lugano'], ['Rhine Pharma AG', '4051', 'Basel'], ['Berna Energie AG', '3011', 'Bern']];
const FIRST = ['Nora', 'Luca', 'Mila', 'Emil', 'Lea', 'Noah', 'Elena', 'David', 'Nina', 'Finn', 'Maya', 'Jonas', 'Sofia', 'Leon', 'Lina', 'Elias', 'Anna', 'Matteo', 'Julia', 'Samuel', 'Chiara', 'Levin', 'Alina', 'Gian', 'Selina', 'Marco', 'Laura', 'Nico', 'Sara', 'Tim'];
const LAST = ['Keller', 'Bernasconi', 'Roth', 'Meier', 'Fischer', 'Steiner', 'Weber', 'Graf', 'Bieri', 'Rossi', 'Aubert', 'Schmid', 'Baumann', 'Huber', 'Brunner', 'Frei', 'Moser', 'Zimmermann', 'Gerber', 'Widmer', 'Favre', 'Bianchi', 'Kälin', 'Suter', 'Lüthi'];

// ------------------------------------------------------------------------------------------------ helpers

/** Reproducible randomness (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(Number(process.env.SIM_SEED ?? 2008));
const chance = (p) => random() < p;
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

const day = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
const monthStart = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;
const monthEnd = (y, m) => day(new Date(Date.UTC(y, m, 0)));
/**
 * The business time during a simulated day: from 8:00 (Zurich in winter) on, a real second ten simulated minutes, at most
 * until 18:00, so what happens keeps its order and spreads over the working day.
 */
function dayTime(d) {
  const start = Date.parse(`${d}T07:00:00Z`);
  const real = Date.now();
  return () => new Date(Math.min(start + (Date.now() - real) * 600, start + 10 * 3_600_000));
}

/** Calendar days from `a` to `b` (YYYY-MM-DD). */
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const as = (userId) => ({ user: { kind: 'local', sub: userId }, headers: {} });
/** A Zurich wall-clock time on a day as an ISO instant. */
const at = (iso, hh, mm) => new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).toISOString();
const workDays = (from, to, holidays) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) !== 0 && weekday(d) !== 6 && !holidays.has(d)) out.push(d);
  return out;
};
/** Runs `fn` for every item, `width` at a time. */
async function parallel(items, width, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}
const WIDTH = Number(process.env.SIM_PARALLEL ?? 8);
/** Why someone sends a thing back, now and then. */
const REJECT_NOTES = ['Please check the dates again.', 'A day is missing, please complete it.', 'Please add a short comment.', 'This overlaps with the team\'s plan, please move it.'];

/** Counts and timings per service call, for the report. */
const stats = new Map();
async function call(label, fn) {
  const t = performance.now();
  const result = await fn();
  const s = stats.get(label) ?? { n: 0, ms: 0, failed: 0 };
  s.n++;
  s.ms += performance.now() - t;
  if (result && result.ok === false) {
    s.failed++;
    (s.errors ??= {})[result.error] = (s.errors[result.error] ?? 0) + 1;
  }
  stats.set(label, s);
  return result;
}
/** A call that must succeed. */
async function must(label, fn) {
  const result = await call(label, fn);
  assert(result && result.ok !== false && !result.offline, `${label}: ${result?.error ?? 'no answer'}${result?.fields ? ` ${JSON.stringify(result.fields)}` : ''}`);
  return result;
}

// ------------------------------------------------------------------------------------------------ the simulation

class Sim {
  constructor(app, pool) {
    this.app = app;
    this.pool = pool;
    this.c = {};
    this.people = [];
    this.today = day(new Date());
    /** Free Flows not resolved yet (`askFlow`, `takeOver`), by id. */
    this.openFlows = new Map();
    /** Flows taken over (`takeOver`), by why. */
    this.taken = {};
    /** Each department's (and the managers') time for flows this week (`newWeek`, `pace`). */
    this.load = {};
  }

  q(text, params) {
    return this.pool.query(text, params).then((r) => r.rows);
  }

  ctrl(file, name) {
    return (this.c[name] ??= this.app.get(dist(file)[name], { strict: false }));
  }

  /** A plugin's controller. */
  ctrl2(id, file, name) {
    return (this.c[`${id}:${name}`] ??= this.app.get(plugin(id, file)[name], { strict: false }));
  }

  // ---------------------------------------------------------------- the company itself

  async found() {
    const auth = this.ctrl('auth.controller', 'AuthController');
    const orgs = this.ctrl('orgs.controller', 'OrgsController');
    // The founder registers (a password the service accepts), then the demo password the spec asks for.
    const session = await must('auth.register', () => auth.register({ email: COMPANY.admin, displayName: 'Whale Admin', password: 'whale-founder-2008' }));
    this.admin = { userId: session.userId, name: 'Whale Admin', role: 'admin', start: COMPANY.founded, hired: true };
    this.org = session.memberships[0].organizationId;
    // SQL: the admin's short demo password (the service asks for 8 characters), as the demo seed does.
    const bcrypt = require(require.resolve('bcryptjs', { paths: [path.join(ROOT, 'apps/api')] }));
    await this.q(`UPDATE user_identities SET password_hash = $1 WHERE user_id = $2 AND provider = 'password'`, [await bcrypt.hash(COMPANY.adminPassword, 10), this.admin.userId]);
    await must('org.update', () => orgs.update(this.org, { name: COMPANY.name, defaultCurrency: 'CHF' }, as(this.admin.userId)));
    // The founder is owner and admin; registering also gave HR, which the founder does until the first HR person comes.
    const [m] = await this.q(`SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`, [this.org, this.admin.userId]);
    this.admin.membershipId = m.id;
    const roles = await this.q(`SELECT id, name FROM roles WHERE organization_id IS NULL`);
    this.roles = Object.fromEntries(roles.map((r) => [r.name, r.id]));
    this.founderDoesHr = true;
    // The founding runs on the founding day (the business clock): the account joined then; its start date as everyone's.
    await must('employment.startDate', () => this.ctrl('employment.controller', 'EmploymentController').setStartDate(this.org, this.admin.userId, { startDate: COMPANY.founded }, as(this.admin.userId)));
    this.people.push(this.admin);

    // Its own finance role: pays expenses (payment runs).
    const orgRoles = this.ctrl('roles.controller', 'OrgRolesController');
    const finance = await must('roles.create', () => orgRoles.create(this.org, {
      name: 'finance', description: 'Pays expenses (payment runs)',
      translations: { de: 'Finanzen', en: 'Finance', fr: 'Finances', it: 'Finanze' },
      permissions: ['nav.expensePayout:see:all', 'nav.expensePayout:edit:all', 'nav.billing:see:all', 'nav.billing:edit:all'],
    }, as(this.admin.userId)));
    this.roles.finance = finance.id ?? finance.role?.id;
    assert(this.roles.finance, 'finance role id');

    const locations = this.ctrl('locations.controller', 'LocationsController');
    const loc = await must('locations.create', () => locations.create(this.org, { name: 'Zürich', canton: 'ZH', municipality: 'Zürich' }, as(this.admin.userId)));
    this.locationId = loc.id ?? loc.location?.id;

    const employment = this.ctrl('employment.controller', 'EmploymentController');
    this.departments = {};
    for (const [i, [code, name]] of DEPARTMENTS.entries()) {
      const d = await must('departments.create', () => employment.createDepartment(this.org, { name, code, sortOrder: i + 1 }, as(this.hr())));
      this.departments[code] = { id: d.id ?? d.department?.id, leader: null, name };
    }
    await this.assign(this.admin, 'management', null, COMPANY.founded, true);
    await must('basicdata.update', () => this.ctrl('basicdata.controller', 'BasicDataController').update(this.org, this.admin.userId, { patch: { personnelNumber: '1000' } }, as(this.admin.userId)));
    this.departments.management.leader = this.admin;
    await must('departments.update', () => employment.updateDepartment(this.org, this.departments.management.id, { leaderUserId: this.admin.userId }, as(this.hr())));
    // Expense categories (Admin settings -> static data).
    const staticData = this.ctrl('static-data.controller', 'StaticDataController');
    await must('staticData.create', () => staticData.create(this.org, { entity: 'expenses', enumName: 'expense_category', values: CATEGORIES.values, translation: CATEGORIES.translation }, as(this.admin.userId)));
    // Billing is licensed: the instance's operator grants it (SQL where the instance has none, as a fresh dev database).
    const [operator] = await this.q(`SELECT m.user_id FROM organization_memberships m WHERE m.organization_id = '00000000-0000-0000-0000-00000000a0a0' AND m.status = 'active' LIMIT 1`).catch(() => []);
    if (operator) await must('operator.license', () => this.ctrl('operator.controller', 'OperatorController').grant(this.org, 'billing', {}, as(operator.user_id)));
    else await this.q(`INSERT INTO organization_licenses (organization_id, module_id) VALUES ($1, 'billing') ON CONFLICT DO NOTHING`, [this.org]);
    await must('org.setModules', () => orgs.setModules(this.org, { billing: true }, as(this.admin.userId)));
    this.teams = {};
    this.projects = [];
    this.customers = [];
    await this.newProject('Internal', this.admin, COMPANY.founded, null);
    console.log(`founded ${COMPANY.name} (${this.org}), ${DEPARTMENTS.length} departments`);
  }

  /** Who does HR's work today: an HR person, else the founder (who still holds HR then). */
  hr(iso = this.current ?? this.today) {
    return (this.working(iso).find((p) => p.role === 'hr') ?? this.admin).userId;
  }

  /** The person's dated assignment: department, manager, location. */
  async assign(person, dept, manager, from, management = false) {
    const employment = this.ctrl('employment.controller', 'EmploymentController');
    person.dept = dept;
    person.manager = manager?.userId ?? null;
    const body = {
      validFrom: from, departmentId: this.departments[dept].id, managerUserId: person.manager, locationId: this.locationId,
      jobFunction: person.role === 'lead' ? 'Team lead' : null, isManagement: management,
    };
    // A second change on the same day changes that day's assignment.
    const [existing] = await this.q(`SELECT id FROM employee_assignments WHERE organization_id = $1 AND user_id = $2 AND valid_from = $3::date`, [this.org, person.userId, from]);
    if (existing) {
      await must('employment.updateAssignment', () => employment.updateAssignment(this.org, existing.id, body, as(this.hr(this.current ?? from))));
      return;
    }
    await must('employment.assign', () => employment.addAssignment(this.org, person.userId, body, as(this.hr(this.current ?? from))));
  }

  // ---------------------------------------------------------------- people come and go

  /** How many people work here at a month's start: from a handful at the founding to the headcount today. */
  target(iso) {
    const from = Date.parse(`${COMPANY.founded}T00:00:00Z`);
    const share = (Date.parse(`${iso}T00:00:00Z`) - from) / (Date.parse(`${this.today}T00:00:00Z`) - from);
    return Math.max(6, Math.round(6 + (COMPANY.headcount - 6) * Math.min(1, share) ** 1.3));
  }

  /** The role the next hire gets: whichever share is furthest behind (each at least one). */
  nextRole(staff) {
    const n = staff.length + 1;
    const count = (r) => staff.filter((p) => p.role === r).length;
    for (const r of ['hr', 'finance', 'lead', 'it']) if (count(r) < Math.max(1, Math.round(SHARES[r] * n))) return r;
    return 'member';
  }

  /** A planned person starts on `iso`: invited, the invitation accepted, start date, roles, department and manager. */
  async hire(person, iso) {
    const orgs = this.ctrl('orgs.controller', 'OrgsController');
    const auth = this.ctrl('auth.controller', 'AuthController');
    const employment = this.ctrl('employment.controller', 'EmploymentController');
    const staff = this.working(iso);
    const role = person.role;
    const n = this.people.indexOf(person);
    const first = pick(FIRST);
    const last = pick(LAST);
    const email = `${first}.${last}.${n}@${DOMAIN}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const baseRole = { hr: 'hr', finance: 'member', lead: 'manager', it: 'admin', member: 'member' }[role];
    const inv = await must('org.invite', () => orgs.invite(this.org, { email, roleId: this.roles[baseRole] }, as(this.admin.userId)));
    // The person reads the invitation in their mailbox.
    const [{ token }] = await this.q(`SELECT token FROM organization_invitations WHERE id = $1`, [inv.id]);
    const password = `whale-${n}-${Math.floor(random() * 1e9)}`;
    const session = await must('auth.acceptInvitation', () => auth.acceptInvitation({ token, displayName: `${first} ${last}`, password }));
    Object.assign(person, { userId: session.userId, name: `${first} ${last}`, email, password, start: iso });
    const [m] = await this.q(`SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`, [this.org, person.userId]);
    person.membershipId = m.id;
    await must('employment.startDate', () => employment.setStartDate(this.org, person.userId, { startDate: iso }, as(this.hr(iso))));
    // HR gives the personnel number (payroll and expense payments need it).
    const basic = this.ctrl('basicdata.controller', 'BasicDataController');
    await must('basicdata.update', () => basic.update(this.org, person.userId, { patch: { personnelNumber: String(1000 + n) } }, as(this.hr(iso))));
    if (role === 'finance') await must('org.grantRole', () => orgs.grantRole(this.org, m.id, { roleId: this.roles.finance }, as(this.admin.userId)));
    // IT support has at least one developer; a tenth of the members develop too.
    const developers = staff.filter((p) => p.developer);
    if ((role === 'it' && !developers.some((p) => p.role === 'it')) || (role === 'member' && chance(0.1))) {
      await must('org.grantRole', () => orgs.grantRole(this.org, m.id, { roleId: this.roles.developer }, as(this.admin.userId)));
      person.developer = true;
    }
    // Department and manager: leads take a department without a leader first.
    let dept = ROLE_DEPARTMENT[role] ?? pick(BUSINESS);
    if (role === 'lead') {
      const free = BUSINESS.concat(['hr', 'finance', 'it']).find((d) => !this.departments[d].leader || this.departments[d].leader.exit);
      dept = free ?? pick(BUSINESS);
    }
    const leader = this.departments[dept].leader;
    const manager = role === 'lead' ? this.admin : leader && !leader.exit && leader !== person ? leader : this.admin;
    await this.assign(person, dept, manager, iso, role === 'lead');
    if (role === 'lead' && (!leader || leader.exit)) {
      this.departments[dept].leader = person;
      await must('departments.update', () => employment.updateDepartment(this.org, this.departments[dept].id, { leaderUserId: person.userId }, as(this.hr(iso))));
      // Their department's people report to them from now on.
      for (const p of staff.filter((x) => x.dept === dept && x.role !== 'lead' && !x.exit)) await this.assign(p, dept, person, iso);
    }
    person.hired = true;
    await this.joinTeam(person);
    if (role === 'hr' && this.founderDoesHr) {
      // The first HR person takes over: the founder gives HR away.
      await must('org.revokeRole', () => orgs.revokeRole(this.org, this.admin.membershipId, this.roles.hr, as(this.admin.userId)));
      this.founderDoesHr = false;
    }
    return person;
  }

  /** Someone gave notice: HR records the last day (`iso`, weeks ahead); a leaving leader's people go to the founder. */
  async offboard(person, iso) {
    if (!person.hired) return;
    const employment = this.ctrl('employment.controller', 'EmploymentController');
    await must('employment.exitDate', () => employment.setExitDate(this.org, person.userId, { lastDay: iso }, as(this.hr(this.current))));
    person.exit = iso;
    if (this.departments[person.dept]?.leader === person) {
      for (const p of this.working(this.current).filter((x) => x !== person && x.dept === person.dept && x.manager === person.userId && (!x.exit || x.exit > iso))) await this.assign(p, p.dept, this.admin, addDays(iso, 1));
    }
  }

  // ---------------------------------------------------------------- decisions

  /**
   * Whoever a record's open flow step waits for decides it, step by step: approve, or now and then send it back with
   * a note (`rejectChance`). Returns 'approved', 'rejected' or 'none' (no flow, e.g. approved at once).
   */
  async decide(sourceTable, id, rejectChance = 0) {
    const workflows = this.ctrl('workflows.controller', 'WorkflowsController');
    for (let guard = 0; guard < 8; guard++) {
      const [w] = await this.q(`
        SELECT w.workflow_id, w.assigned_to_user_id,
          (SELECT st FROM jsonb_array_elements(COALESCE(w.steps, d.steps)) st WHERE st->>'key' = w.step LIMIT 1) AS step
        FROM workflows w JOIN workflow_definitions d ON d.workflow_def_id = w.workflow_def_id
        WHERE w.source_table = $1 AND w.source_table_uuid = $2 AND w.step_status = 'pending' ORDER BY w.workflow_started DESC LIMIT 1`, [sourceTable, id]);
      if (!w) return guard === 0 ? 'none' : 'approved';
      const decider = w.assigned_to_user_id[0];
      // Only a step that can be sent back is (work steps, such as paying, cannot).
      const rejectable = w.step?.rejectable !== false && w.step?.reject !== 'none';
      // A dated manager change that came into force today moves the step to the new manager as it is decided
      // (`rerouteToCurrentManagers`): the old one is refused, and whoever has it now decides (read again).
      const rerouted = (r) => r?.ok === false && r.error === 'forbidden';
      if (rejectable && chance(rejectChance)) {
        const r = await call(`decide.reject.${sourceTable}`, () => workflows.reject(w.workflow_id, { note: pick(REJECT_NOTES) }, as(decider)));
        if (rerouted(r)) { this.rerouted = (this.rerouted ?? 0) + 1; continue; }
        assert(r?.ok !== false, `decide.reject.${sourceTable}: ${r?.error}`);
        return 'rejected';
      }
      const r = await call(`decide.approve.${sourceTable}`, () => workflows.approve(w.workflow_id, {}, as(decider)));
      if (rerouted(r)) { this.rerouted = (this.rerouted ?? 0) + 1; continue; }
      assert(r?.ok !== false, `decide.approve.${sourceTable}: ${r?.error}`);
    }
    return 'approved';
  }

  // ---------------------------------------------------------------- structure: teams and projects

  holidays(y) {
    return (this.holidayCache ??= new Map()).get(y) ?? (() => {
      const { cantonHolidays } = require(require.resolve('@worktime3/shared/worktime', { paths: [path.join(ROOT, 'apps/api')] }));
      const set = new Set(cantonHolidays(y, 'ZH').map((h) => h.date));
      this.holidayCache.set(y, set);
      return set;
    })();
  }

  /** A team per business department once it has a leader; projects come and go, owned by leaders. */
  async structureMonth(y, m) {
    const first = monthStart(y, m);
    const teams = this.ctrl('teams.controller', 'TeamsController');
    const projects = this.ctrl('projects.controller', 'ProjectsController');
    this.teams ??= {};
    this.projects ??= [];
    for (const dept of BUSINESS) {
      const leader = this.departments[dept].leader;
      if (!leader || leader.exit || this.teams[dept]) continue;
      const team = await must('teams.create', () => teams.create(this.org, { name: this.departments[dept].name, code: dept, leadUserId: leader.userId }, as(this.admin.userId)));
      this.teams[dept] = team.id ?? team.team?.id;
      // The department's people join their team.
      for (const p of this.working(this.current).filter((x) => x.dept === dept && x !== leader)) await this.joinTeam(p);
    }
    // A leaving owner's projects go to the founder.
    for (const p of this.projects.filter((x) => x.owner.exit && x.owner.exit < first && !x.closed)) {
      await must('projects.update', () => projects.update(p.id, { ownerUserId: this.admin.userId }, as(this.admin.userId)));
      p.owner = this.admin;
    }
    // The internal project from the start; a customer project about every four months, running one to three years.
    const leaders = PROJECT_DEPTS.filter((d) => this.departments[d]).map((d) => this.departments[d].leader).filter((l) => l && !l.exit && l.start <= first);
    if (leaders.length && chance(0.25)) {
      const owner = pick(leaders);
      const end = addDays(first, between(365, 3 * 365));
      await this.newProject(`${pick(['Atlas', 'Orca', 'Coral', 'Tide', 'Reef', 'Harbor', 'Krill', 'Lagoon', 'Pearl', 'Current'])} ${y}-${m}`, owner, first, end);
    }
    for (const p of this.projects.filter((x) => x.end && x.end < first && !x.closed)) p.closed = true;
    // Customer projects started before there was anyone in finance get their customer now.
    for (const p of this.projects.filter((x) => x.end && !x.closed && !x.customer)) await this.billProject(p);
  }

  /** A person joins their department's team (if it has one). */
  async joinTeam(person) {
    const teamId = this.teams?.[person.dept];
    if (!teamId || person.teamId === teamId) return;
    const teams = this.ctrl('teams.controller', 'TeamsController');
    await must('teams.addMember', () => teams.addMember(teamId, { userId: person.userId }, as(this.admin.userId)));
    person.teamId = teamId;
  }

  async newProject(name, owner, from, end) {
    const projects = this.ctrl('projects.controller', 'ProjectsController');
    const teamIds = owner.dept && this.teams?.[owner.dept] ? [this.teams[owner.dept]] : [];
    const created = await must('projects.create', () => projects.create(this.org, { name, ownerUserId: owner.userId, type: end ? 'customer' : 'internal', teamIds }, as(owner === this.admin ? this.admin.userId : owner.userId)));
    const project = { id: created.id ?? created.project?.id, name, owner, from, end, closed: false, teamId: teamIds[0] ?? null };
    this.projects.push(project);
    if (end) await this.billProject(project);
  }

  /** The projects a person books on in a month: the internal one for staff functions, an open customer one else. */
  projectFor(person, first) {
    // Only projects the person may book on: without a team, or of their team.
    const open = this.projects.filter((p) => !p.closed && p.from <= first && (!p.teamId || p.teamId === person.teamId));
    if (!PROJECT_DEPTS.includes(person.dept)) return open.find((p) => !p.end);
    if (!person.project || person.project.closed || chance(0.1)) person.project = pick(open.filter((p) => p.end).concat(open.filter((p) => !p.end)));
    return person.project;
  }

  // ---------------------------------------------------------------- the agenda: what happens on which day

  /** Something to do on a day: `org` things (people come and go, projects) first, then what people do. */
  schedule(d, fn, kind = 'person') {
    if (d < this.firstDay) d = this.firstDay;
    // A day whose agenda ran already (today's, from what happens during the day): the next one, not lost.
    if (this.agendaRan && d <= this.agendaRan) d = addDays(this.agendaRan, 1);
    const a = (this.agenda ??= new Map()).get(d) ?? { org: [], person: [] };
    a[kind].push(fn);
    this.agenda.set(d, a);
  }

  /** The n-th working day from `d` on (0 = `d` itself when it is one). */
  workdayFrom(d, n = 0) {
    let x = d;
    while (weekday(x) === 0 || weekday(x) === 6 || this.holidays(Number(x.slice(0, 4))).has(x)) x = addDays(x, 1);
    for (let i = 0; i < n; i++) {
      x = addDays(x, 1);
      while (weekday(x) === 0 || weekday(x) === 6 || this.holidays(Number(x.slice(0, 4))).has(x)) x = addDays(x, 1);
    }
    return x;
  }

  isWorkday(d) {
    return weekday(d) !== 0 && weekday(d) !== 6 && !this.holidays(Number(d.slice(0, 4))).has(d);
  }

  /** Whoever works here on `d`. */
  working(d) {
    return this.people.filter((p) => p.hired && p.start <= d && (!p.exit || p.exit >= d));
  }

  /**
   * The first of a month: who will join this month (each on their first day), who gives notice (HR records it now,
   * the last day a few weeks later), the month just ended is closed in the next days, and in January the year before.
   */
  planMonth(y, m) {
    const first = monthStart(y, m);
    const staff = this.working(first);
    // Notice: about 10% a year; never the founder, never the last of a role that must exist.
    for (const p of staff.filter((x) => x !== this.admin && !x.exit && !x.leaving && chance(0.1 / 12))) {
      if (p.role !== 'member' && staff.filter((x) => x.role === p.role && !x.leaving).length <= 1) continue;
      p.leaving = true;
      const lastDay = addDays(first, between(28, 75));
      this.schedule(addDays(first, between(0, 20)), () => this.offboard(p, lastDay), 'org');
    }
    // Joining: up to the target, counting who will still be here at the month's end.
    const stay = staff.filter((p) => !p.leaving || (p.exit && p.exit > monthEnd(y, m))).length + this.people.filter((p) => !p.hired).length;
    const missing = this.target(first) - stay;
    for (let i = 0; i < missing; i++) {
      const d = this.workdayFrom(addDays(first, between(0, 24)));
      if (d >= this.today) continue;
      const person = this.plannedPerson();
      this.schedule(d, () => this.hire(person, d), 'org');
    }
    this.schedule(addDays(first, between(0, 27)), () => this.structureMonth(y, m), 'org');
    this.schedule(addDays(first, between(0, 27)), () => this.changes(y, m), 'org');
    // Money: the payment run around the 12th, invoices for the month before on the first working days.
    this.schedule(this.workdayFrom(addDays(first, 11)), () => this.payRun(), 'org');
    if (first > this.firstDay) {
      const prev = monthStart(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
      // Once the project months are approved.
      this.schedule(this.workdayFrom(first, 8), () => this.invoiceMonth(prev), 'org');
      // Every month closed within a month: HR follows up on the rest around the 20th.
      this.schedule(this.workdayFrom(first, 15), () => this.followUp(prev), 'org');
    }
    // Now and then a move (address to change) or a forgotten password.
    for (const p of staff.filter((x) => x !== this.admin)) {
      if (chance(0.01)) this.schedule(addDays(first, between(0, 27)), () => this.askDataChange(p));
      if (chance(0.004)) this.schedule(addDays(first, between(0, 27)), () => this.forgotPassword(p));
    }
    // Vacation: asked for some weeks ahead, about 25 days a year.
    for (const p of staff.filter((x) => !x.leaving)) {
      const ahead = addDays(first, between(14, 60));
      const summer = ['07', '08'].includes(ahead.slice(5, 7));
      if (chance(summer ? 0.55 : ahead.slice(5, 7) === '12' ? 0.4 : 0.17)) this.schedule(addDays(first, between(0, 25)), () => this.askVacation(p, ahead, summer));
    }
    // The month before is handed in on the first working days (a few later); the year before is closed in January.
    if (first > this.firstDay) {
      const prev = monthStart(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
      for (const p of this.people.filter((x) => x.hired && x.start <= monthEnd(Number(prev.slice(0, 4)), Number(prev.slice(5, 7))) && (!x.exit || x.exit >= prev))) {
        const d = this.workdayFrom(first, chance(0.9) ? between(0, 3) : between(4, 9));
        if (d < this.today) this.schedule(d, () => this.handIn(p, prev));
      }
    }
    if (m === 1 && y > Number(COMPANY.founded.slice(0, 4))) {
      this.schedule(this.workdayFrom(`${y}-01-24`), () => this.closeYear(y - 1), 'org');
      this.schedule(this.workdayFrom(`${y}-02-24`), () => this.closeYear(y - 1, true), 'org');
    }
  }

  /** A person to hire: the role whichever share is furthest behind (counting those already planned). */
  plannedPerson() {
    const planned = this.people.filter((p) => !p.exit && !p.leaving);
    const role = this.nextRole(planned);
    const person = { role, hired: false, developer: false };
    this.people.push(person);
    return person;
  }

  /** A day: what the company does, what people do, then everyone at work books the day. */
  async live(d) {
    const a = this.agenda?.get(d);
    this.agenda?.delete(d);
    this.agendaRan = d;
    for (const fn of a?.org ?? []) await fn();
    await parallel(a?.person ?? [], WIDTH, (fn) => fn());
    if (!this.isWorkday(d)) return;
    await parallel(this.working(d), WIDTH, (p) => this.workDay(p, d));
    // 0 to 10 Free Flows a working day, more in January and on Mondays, fewer in summer and on Fridays.
    const people = this.working(d).filter((p) => p !== this.admin);
    const month = Number(d.slice(5, 7));
    const inflow = (month === 1 ? 1.3 : month === 7 || month === 8 ? 0.7 : 1) * ({ 1: 1.3, 5: 0.8 }[weekday(d)] ?? 1);
    for (let i = Math.round(between(0, 10) * inflow); i > 0 && people.length; i--) await this.askFlow(pick(people));
    if (weekday(d) === 1) this.newWeek();
    await this.takeOver();
    if (d.slice(8) >= '28' && Number(addDays(d, 7).slice(8)) <= 7) {
      // The month's last working week: how many wait (the year's line shows the range).
      const [{ n }] = await this.q(`SELECT count(*)::int AS n FROM flows WHERE organization_id = $1 AND status <> 'resolved' AND archived_at IS NULL`, [this.org]);
      (this.openByMonth ??= new Map()).set(d.slice(0, 7), n);
    }
  }

  /**
   * How much time each department (and the managers) has for flows this week: a random walk between a quarter and all
   * of it, less in the summer holidays and from 20 December. A busy department answers fewer flows at first, later,
   * and takes over less: the open flows rise and fall as in real life (spec by Fabio, 2026-11-27).
   */
  newWeek() {
    for (const key of ['manager', ...Object.keys(this.departments)]) {
      this.load[key] = Math.min(1, Math.max(0.25, (this.load[key] ?? 0.8) + (random() - 0.5) * 0.5));
    }
  }

  /** The share of time `to` (a department's code or `manager`) has for flows today (0.25 .. 1, less in holidays). */
  pace(to) {
    const d = this.current;
    const holidays = d.slice(5, 7) === '07' || d.slice(5, 7) === '08' || d.slice(5) >= '12-20' ? 0.6 : 1;
    return (this.load[to] ?? 0.8) * holidays;
  }

  /**
   * A Free Flow: to the manager or a department, sometimes with a due date (set by the asker, or later by whoever
   * handles it). Most get an answer in the next days and are resolved; about a quarter never get one.
   */
  async askFlow(p) {
    const flows = this.ctrl('flows.controller', 'FlowsController');
    // Nobody asks their own department (an IT person fixes their VPN themselves), nor one where nobody works yet.
    const staffed = new Set(this.working(this.current).map((x) => x.dept));
    const [subject, to] = pick(FLOW_TOPICS.filter(([, t]) => t !== p.dept && (t === 'manager' || staffed.has(t))));
    const dept = to === 'manager' ? null : this.departments[to];
    // The flow's type (the global ones): HR matters are confidential, IT is support.
    const type = { hr: 'hr', it: 'support', finance: 'service', service: 'service', manager: 'other' }[to];
    const body = {
      subject, type, message: `${subject}: could you please help me with this? Thanks, ${p.name.split(' ')[0]}`,
      ...(dept ? { target: 'department', departmentId: dept.id } : { target: 'manager' }),
      ...(chance(0.3) ? { dueDate: addDays(this.current, between(3, 20)) } : {}),
      ...(chance(0.1) ? { urgent: true } : {}),
    };
    const r = await call('flows.create', () => flows.create(this.org, body, [], as(p.userId)));
    if (!r.ok) return;
    const id = r.id ?? r.flow?.id;
    // Until it is resolved: whoever waits too long gets it taken over (`takeOver`).
    const open = { id, to, asker: p, due: body.dueDate ?? null, last: this.current, handler: null };
    this.openFlows.set(id, open);
    // The first one it reaches does not answer: a quarter of them in a normal week, more when the department is busy.
    const pace = this.pace(to);
    if (chance(1 - 0.75 * pace)) return;
    // Who handles it: the manager, or someone of the department (its leader first) who takes it.
    const handler = async () => {
      if (!dept) return this.flowManager(p);
      const staff = this.working(this.current).filter((x) => x.dept === to && x !== p);
      return dept.leader && !dept.leader.exit ? dept.leader : staff.length ? pick(staff) : null;
    };
    this.schedule(this.workdayFrom(addDays(this.current, between(1, Math.round(3 + 7 * (1 - pace))))), async () => {
      const h = await handler();
      if (!h || !this.openFlows.has(id)) return;
      if (dept) await call('flows.take', () => flows.take(this.org, id, {}, as(h.userId)));
      if (!body.dueDate && chance(0.3)) {
        const due = addDays(this.current, between(2, 10));
        const d = await call('flows.details', () => flows.setDetails(this.org, id, { dueDate: due }, as(h.userId)));
        if (d?.ok) open.due = due;
      }
      const a = await call('flows.reply', () => flows.reply(this.org, id, { body: pick(['On it, I will get back to you.', 'Done, please check.', 'I need a bit more information, please.', 'Approved.']) }, [], as(h.userId)));
      if (!a?.ok) return;
      open.last = this.current;
      open.handler = h;
      if (chance(0.85)) this.schedule(this.workdayFrom(addDays(this.current, between(0, 4))), () => this.resolveFlow(open, h));
    });
  }

  /**
   * Who answers a flow to the asker's manager: as the API decides it (`membershipManagerId`, the assignment in force on
   * the business clock's today, the simulated day). Nobody when that manager left.
   */
  async flowManager(p) {
    const [row] = await this.q(`SELECT manager_user_id FROM employee_assignments WHERE organization_id = $1 AND user_id = $2
      AND valid_from <= $3::date ORDER BY valid_from DESC LIMIT 1`, [this.org, p.userId, this.current]);
    if (!row?.manager_user_id) return null;
    if (row.manager_user_id === this.admin.userId) return this.admin;
    return this.people.find((x) => x.userId === row.manager_user_id && x.hired && !(x.exit && x.exit < this.current)) ?? null;
  }

  /** The handler resolves it (refused, e.g. they moved to another department: it waits for someone to take it over). */
  async resolveFlow(open, h) {
    if (!this.openFlows.has(open.id)) return;
    const flows = this.ctrl('flows.controller', 'FlowsController');
    const r = await call('flows.resolve', () => flows.setStatus(this.org, open.id, { status: 'resolved' }, as(h.userId)));
    if (r?.ok) this.openFlows.delete(open.id);
  }

  /**
   * Flows don't stay put, as in real life (spec by Fabio, 2026-11-27): each working day, a flow to a department that
   * waited ten days without anyone acting on it, or is overdue and quiet for two days, is taken over now and then by a colleague of that
   * department (not the asker, not whoever has it), who answers it and resolves it in the next days. A flow to the
   * manager that waited two weeks gets a late answer from whoever is the asker's manager by then.
   */
  async takeOver() {
    const flows = this.ctrl('flows.controller', 'FlowsController');
    const today = this.current;
    for (const open of [...this.openFlows.values()]) {
      const waiting = daysBetween(open.last, today);
      const overdue = open.due && open.due < today;
      // Two weeks of working days without anyone acting, or overdue and quiet for two days.
      if (waiting < 10 && !(overdue && waiting >= 2)) continue;
      let who;
      if (open.to === 'manager') {
        if (waiting < 14 || !chance(0.2 * this.pace('manager'))) continue;
        // Whoever manages the asker by then.
        who = await this.flowManager(open.asker);
      } else {
        if (!chance((overdue ? 0.5 : 0.3) * this.pace(open.to))) continue;
        // A colleague of the department; in a small one whoever has it after all (none: it waits for the next hire).
        const staff = this.working(today).filter((x) => x.dept === open.to && x !== open.asker);
        const others = staff.filter((x) => x !== open.handler);
        who = others.length ? pick(others) : staff[0];
        if (!who) continue;
        const t = await call('flows.takeOver', () => flows.take(this.org, open.id, {}, as(who.userId)));
        if (!t?.ok) continue;
      }
      const a = await call('flows.reply', () => flows.reply(this.org, open.id, { body: pick(['Sorry for the wait, I am taking this over.', 'I will take care of this now.', 'Taking this over: done, please check.']) }, [], as(who.userId)));
      if (!a?.ok) continue;
      open.last = today;
      open.handler = who;
      const why = open.to === 'manager' ? 'manager late' : overdue ? 'overdue' : 'waited';
      this.taken[why] = (this.taken[why] ?? 0) + 1;
      if (chance(0.9)) this.schedule(this.workdayFrom(addDays(today, between(0, 3))), () => this.resolveFlow(open, who));
    }
  }

  /** Asks for vacation from `from` on; the manager decides in the next days (now and then no: moved and asked again). */
  async askVacation(p, from, summer) {
    if (p.exit && p.exit <= from) return;
    const absences = this.ctrl('absences.controller', 'AbsencesController');
    const len = between(1, summer ? 10 : 5);
    const span = [];
    for (let d = this.workdayFrom(from); span.length < len; d = this.workdayFrom(addDays(d, 1))) span.push(d);
    if (span.some((d) => p.off?.has(d))) return;
    const half = len === 1 && chance(0.3);
    const r = await call('absences.submit', () => absences.submit(this.org, { dateStart: span[0], dateEnd: span[span.length - 1], absenceType: 'vacation', halfDay: half, note: summer ? 'Summer holidays' : 'Vacation' }, as(p.userId)));
    if (!r.ok) return;
    const asked = span[0];
    this.schedule(this.workdayFrom(addDays(this.current, between(1, 3))), async () => {
      const outcome = await this.decide('absences', r.id, 0.07);
      if (outcome === 'rejected') {
        // Sent back: asked again a week later, for the following week.
        if (len > 1) this.schedule(addDays(this.current, 1), () => this.askVacation(p, addDays(asked, 7), false));
        return;
      }
      (p.off ??= new Map());
      for (const d of span) p.off.set(d, half ? 'half' : 'full');
    });
  }

  /** A working day of one person: ill now and then (recorded that morning), else the day's time and project hours. */
  async workDay(p, d) {
    const off = p.off?.get(d);
    if (off === 'full') return;
    if (!off && chance(0.012)) {
      const absences = this.ctrl('absences.controller', 'AbsencesController');
      const days = between(1, 3);
      let end = d;
      for (let i = 1; i < days; i++) end = this.workdayFrom(addDays(end, 1));
      if (p.exit && end > p.exit) end = p.exit;
      const r = await call('absences.submit', () => absences.submit(this.org, { dateStart: d, dateEnd: end, absenceType: 'sickness' }, as(p.userId)));
      if (r.ok) {
        (p.off ??= new Map());
        for (let x = d; x <= end; x = addDays(x, 1)) p.off.set(x, 'full');
        return;
      }
    }
    // A forgotten day now and then (the manager notices it at the month's end).
    if (chance(0.004)) {
      (p.forgot ??= new Map()).set(d.slice(0, 7), [...(p.forgot.get(d.slice(0, 7)) ?? []), d]);
      return;
    }
    const work = this.ctrl('work-time.controller', 'WorkTimeController');
    const projectTime = this.ctrl('project-time.controller', 'ProjectTimeController');
    const minutes = off === 'half' ? between(225, 260) : between(480, 540);
    const checkIn = at(d, between(7, 9), pick([0, 15, 30, 45]));
    const checkOut = new Date(Date.parse(checkIn) + minutes * 60_000).toISOString();
    await must('work.addEntry', () => work.addEntry(this.org, p.userId, { checkIn, checkOut, comment: off === 'half' ? 'Half day' : undefined }, as(p.userId)));
    const project = this.projectFor(p, d);
    if (project) {
      const end = new Date(Date.parse(checkIn) + Math.round(minutes * (0.6 + random() * 0.3)) * 60_000).toISOString();
      await call('projectTime.create', () => projectTime.create(this.org, { projectId: project.id, startTime: checkIn, endTime: end, comment: pick(['Analysis', 'Development', 'Meetings', 'Documentation', 'Customer call', 'Review']) }, as(p.userId)));
    }
    await this.maybeExpense(p, d, project);
  }

  /** Out with customers: travel and meals (on the customer's project); in the office now and then supplies or software. */
  async maybeExpense(p, d, project) {
    const outside = ['sales', 'consulting', 'service'].includes(p.dept);
    if (!chance(outside ? 0.05 : 0.006)) return;
    const expenses = this.ctrl2('expenses', 'expenses.controller', 'ExpensesController');
    const forCustomer = outside && project?.end && chance(0.7);
    const category = forCustomer ? pick(['travel', 'travel', 'meals']) : outside ? pick(['travel', 'meals', 'other']) : pick(['supplies', 'software']);
    const amount = Math.round((category === 'travel' ? 20 + random() * 180 : category === 'meals' ? 15 + random() * 90 : 10 + random() * 140) * 20) / 20;
    const text = { travel: 'Train to the customer', meals: 'Lunch with the customer', supplies: 'Office material', software: 'Licence', other: 'Parking' }[category];
    const r = await call('expenses.create', () => expenses.create(this.org, {
      expenseDate: d, category, originalValue: amount, originalCurrency: 'CHF', currency: 'CHF',
      description: forCustomer ? `${text} (${project.name})` : text, comment: forCustomer ? 'Customer visit' : undefined,
      ...(forCustomer ? { projectId: project.id } : {}),
    }, as(p.userId)));
    if (r.ok) (p.expenses ??= []).push({ id: r.id, date: d, project: forCustomer ? project : null });
  }

  /**
   * Hands in a finished month (the working time to the manager, the project hours to their projects' owners); the
   * decisions come in the next days. Sent back (a forgotten day): completed the next day and handed in again.
   */
  async handIn(p, periodStart) {
    const timesheets = this.ctrl('timesheets.controller', 'TimesheetsController');
    const projectTimesheets = this.ctrl('project-timesheets.controller', 'ProjectTimesheetsController');
    const submitted = await call('timesheet.submit', () => timesheets.submit(this.org, { periodStart, note: null }, as(p.userId)));
    if (!submitted.ok) return;
    const id = submitted.id ?? submitted.period?.id;
    const forgot = p.forgot?.get(periodStart.slice(0, 7)) ?? [];
    this.schedule(this.workdayFrom(addDays(this.current, between(1, 3))), async () => {
      const outcome = await this.decide('timesheet_periods', id, forgot.length ? 0.9 : 0.03);
      if (outcome === 'rejected') this.schedule(this.workdayFrom(addDays(this.current, 1)), () => this.complete(p, periodStart, forgot));
    });
    await this.expenseReport(p, periodStart);
    const projectMonth = await call('projectTimesheet.submit', () => projectTimesheets.submit(this.org, { periodStart, note: null }, as(p.userId)));
    if (projectMonth.ok) {
      this.schedule(this.workdayFrom(addDays(this.current, between(1, 4))), async () => {
        const rows = await this.q(`SELECT id FROM project_time_periods WHERE organization_id = $1 AND user_id = $2 AND period_start = $3::date`, [this.org, p.userId, periodStart]);
        for (const r of rows) await this.decide('project_time_periods', r.id, 0.02);
      });
    }
  }

  /**
   * The month's expenses in a report: the manager decides in the next days (marks customer expenses to bill on);
   * now and then sent back, the amount corrected and handed in again.
   */
  async expenseReport(p, periodStart) {
    const month = periodStart.slice(0, 7);
    const items = (p.expenses ?? []).filter((e) => e.date.startsWith(month));
    if (!items.length) return;
    p.expenses = p.expenses.filter((e) => !e.date.startsWith(month));
    const reports = this.ctrl2('expenses', 'expense-reports.controller', 'ExpenseReportsController');
    const report = await call('expenseReport.create', () => reports.create(this.org, as(p.userId)));
    if (!report.ok) return;
    for (const e of items) await call('expenseReport.attach', () => reports.attach(report.id, { expenseId: e.id }, as(p.userId)));
    const sent = await call('expenseReport.submit', () => reports.submit(report.id, { note: null }, as(p.userId)));
    if (!sent.ok) return;
    const review = async (reject) => {
      const [w] = await this.q(`SELECT assigned_to_user_id FROM workflows WHERE source_table = 'expense_reports' AND source_table_uuid = $1 AND step_status = 'pending' LIMIT 1`, [report.id]);
      if (w) for (const e of items.filter((x) => x.project)) await call('expenseReport.billable', () => reports.billable(report.id, { expenseId: e.id, billable: true }, as(w.assigned_to_user_id[0])));
      return this.decide('expense_reports', report.id, reject);
    };
    this.schedule(this.workdayFrom(addDays(this.current, between(1, 4))), async () => {
      if ((await review(0.06)) !== 'rejected') return;
      // Sent back: the person corrects the amount and hands it in again.
      this.schedule(this.workdayFrom(addDays(this.current, 1)), async () => {
        const expenses = this.ctrl2('expenses', 'expenses.controller', 'ExpensesController');
        await call('expenses.update', () => expenses.update(items[0].id, { comment: 'Corrected as asked' }, as(p.userId)));
        const again = await call('expenseReport.submit', () => reports.submit(report.id, { note: 'Corrected' }, as(p.userId)));
        if (again.ok) this.schedule(this.workdayFrom(addDays(this.current, between(1, 3))), () => review(0));
      });
    });
  }

  /** HR puts the approved expense reports into a payment run; finance approves and pays it in the next days. */
  async payRun() {
    const reports = await this.q(`SELECT id FROM expense_reports WHERE organization_id = $1 AND status = 'approved' AND payrun_id IS NULL ORDER BY id LIMIT 300`, [this.org]);
    if (!reports.length) return;
    const payruns = this.ctrl2('expenses', 'payrun.controller', 'PayrunController');
    const run = await call('payrun.create', () => payruns.create(this.org, { reportIds: reports.map((r) => r.id) }, as(this.hr(this.current))));
    if (!run.ok) return;
    this.schedule(this.workdayFrom(addDays(this.current, between(1, 3))), () => this.decide('expense_payruns', run.id, 0.03));
  }

  /** Finance invoices each customer for the month before (hours and expenses to bill); paid some weeks later. */
  async invoiceMonth(periodStart) {
    const finance = this.working(this.current).find((x) => x.role === 'finance');
    if (!finance || !this.billingReady) return;
    const billing = this.ctrl2('billing', 'billing.controller', 'BillingController');
    const to = monthEnd(Number(periodStart.slice(0, 4)), Number(periodStart.slice(5, 7)));
    for (const c of this.customers) {
      const inv = await call('billing.createInvoice', () => billing.createInvoice(this.org, as(finance.userId), { customerId: c.id, from: periodStart, to, invoiceDate: this.current }));
      if (!inv.ok) continue;
      const issued = await call('billing.issue', () => billing.issue(this.org, inv.id ?? inv.invoice?.id, as(finance.userId)));
      if (!issued.ok) continue;
      const id = inv.id ?? inv.invoice?.id;
      this.schedule(this.workdayFrom(addDays(this.current, between(15, 45))), async () => {
        const payer = this.working(this.current).find((x) => x.role === 'finance');
        if (payer) await call('billing.paid', () => billing.paid(this.org, id, as(payer.userId), { paid: true, date: this.current }));
      });
    }
  }

  /** The first finance person sets up billing: the company's details and account for the invoices and QR bills. */
  async setupBilling(finance) {
    if (this.billingReady) return;
    const billing = this.ctrl2('billing', 'billing.controller', 'BillingController');
    await must('billing.settings', () => billing.putSettings(this.org, as(finance.userId), {
      name: 'Whale AG', street: 'Seestrasse', houseNumber: '12', zip: '8002', city: 'Zürich', country: 'CH', iban: 'CH9300762011623852957',
      vatNumber: 'CHE-123.456.789 MWST', vatRate: 8.1, currency: 'CHF', paymentDays: 30, footer: 'Thank you for your trust.',
    }));
    this.billingReady = true;
  }

  /** A customer project is billed: its customer (made the first time) and the rate. */
  async billProject(project) {
    const finance = this.working(this.current).find((x) => x.role === 'finance');
    if (!finance) return;
    await this.setupBilling(finance);
    const billing = this.ctrl2('billing', 'billing.controller', 'BillingController');
    let customer = this.customers.length < CUSTOMERS.length && chance(0.6) ? null : pick(this.customers.length ? this.customers : [null]);
    if (!customer) {
      const [name, zip, city] = CUSTOMERS[this.customers.length % CUSTOMERS.length];
      const c = await must('billing.createCustomer', () => billing.createCustomer(this.org, as(finance.userId), { name, zip, city, country: 'CH', paymentDays: 30 }));
      customer = { id: c.id ?? c.customer?.id, name };
      this.customers.push(customer);
    }
    await must('billing.project', () => billing.putProject(this.org, project.id, as(finance.userId), { customerId: customer.id, rate: pick([140, 160, 180, 200]) }));
    project.customer = customer;
  }

  /** Real life: someone moves to another department (and team); a new field of business gets its department. */
  async changes(y, m) {
    const employment = this.ctrl('employment.controller', 'EmploymentController');
    const teams = this.ctrl('teams.controller', 'TeamsController');
    const later = LATER_DEPARTMENTS.find(([year, code]) => year === y && m === 3 && !this.departments[code]);
    if (later) {
      const [, code, name] = later;
      const d = await must('departments.create', () => employment.createDepartment(this.org, { name, code, sortOrder: DEPARTMENTS.length + 1 }, as(this.hr(this.current))));
      this.departments[code] = { id: d.id ?? d.department?.id, leader: null, name };
      BUSINESS.push(code);
      console.log(`  ${this.current}: new department ${name}`);
    }
    // About 1.5% of the members move each month.
    for (const p of this.working(this.current).filter((x) => x.role === 'member' && !x.exit && chance(0.015))) {
      const to = pick(BUSINESS.filter((d) => d !== p.dept));
      const leader = this.departments[to].leader;
      if (p.teamId) await call('teams.removeMember', async () => {
        const [tm] = await this.q(`SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`, [this.org, p.userId]);
        return teams.removeMember(p.teamId, tm.id, as(this.admin.userId));
      });
      p.teamId = null;
      p.project = null;
      await this.assign(p, to, leader && !leader.exit ? leader : this.admin, this.current);
      await this.joinTeam(p);
    }
  }

  /** Personal data: someone moves and asks HR to change their address (a flow); HR decides in the next days. */
  async askDataChange(p) {
    const basic = this.ctrl('basicdata.controller', 'BasicDataController');
    const r = await call('basicdata.request', () => basic.requestChange(this.org, p.userId, { patch: { street: `${pick(['Bahnhofstrasse', 'Seeweg', 'Dorfstrasse', 'Hauptgasse', 'Lindenweg'])} ${between(1, 80)}`, postalCode: String(between(8000, 8999)), city: 'Zürich' } }, as(p.userId)));
    if (r.ok) this.schedule(this.workdayFrom(addDays(this.current, between(1, 3))), () => this.decide('basicdata', p.userId, 0.05));
  }

  /** Forgotten password: the person asks for the link and sets a new one (the link as the mail carries it). */
  async forgotPassword(p) {
    const auth = this.ctrl('auth.controller', 'AuthController');
    await call('auth.requestReset', () => auth.requestReset({ email: p.email }, { headers: {}, socket: {} }));
    const { mintResetToken } = dist('password-reset');
    const { purposeKey } = dist('jwt');
    const [row] = await this.q(`SELECT password_hash FROM user_identities WHERE user_id = $1 AND provider = 'password'`, [p.userId]);
    const token = mintResetToken(purposeKey('password-reset'), p.userId, row?.password_hash ?? null, Math.floor(Date.now() / 1000));
    p.password = `whale-new-${Math.floor(random() * 1e9)}`;
    await must('auth.confirmReset', () => auth.confirmReset({ token, newPassword: p.password }));
  }

  /**
   * HR's follow-up around the 20th of the month after: whoever has not handed in the month does it now, open
   * decisions are made, a month sent back and not completed is completed. So every month is closed within a month.
   */
  async followUp(periodStart) {
    const [y, m] = periodStart.split('-').map(Number);
    const people = this.people.filter((x) => x.hired && x.start <= monthEnd(y, m) && (!x.exit || x.exit >= periodStart));
    let late = 0;
    await parallel(people, WIDTH, async (p) => {
      const [t] = await this.q(`SELECT id, status FROM timesheet_periods WHERE organization_id = $1 AND user_id = $2 AND period_start = $3::date`, [this.org, p.userId, periodStart]);
      if (t?.status === 'approved') return;
      late++;
      if (!t || t.status === 'open') {
        const timesheets = this.ctrl('timesheets.controller', 'TimesheetsController');
        const sent = await call('followUp.timesheet.submit', () => timesheets.submit(this.org, { periodStart, note: 'Handed in after HR\'s reminder' }, as(p.userId)));
        if (sent.ok) await this.decide('timesheet_periods', sent.id ?? sent.period?.id, 0);
      } else if (t.status === 'submitted') {
        await this.decide('timesheet_periods', t.id, 0);
      } else if (t.status === 'rejected') {
        await this.complete(p, periodStart, p.forgot?.get(periodStart.slice(0, 7)) ?? []);
        const [again] = await this.q(`SELECT id FROM timesheet_periods WHERE organization_id = $1 AND user_id = $2 AND period_start = $3::date AND status = 'submitted'`, [this.org, p.userId, periodStart]);
        if (again) await this.decide('timesheet_periods', again.id, 0);
      }
      for (const r of await this.q(`SELECT id FROM project_time_periods WHERE organization_id = $1 AND user_id = $2 AND period_start = $3::date AND status = 'submitted'`, [this.org, p.userId, periodStart])) await this.decide('project_time_periods', r.id, 0);
    });
    if (late) (this.lateMonths ??= []).push(`${periodStart.slice(0, 7)}: ${late}`);
  }

  /** A month sent back: the forgotten days added, handed in again, decided in the next days. */
  async complete(p, periodStart, forgot) {
    const timesheets = this.ctrl('timesheets.controller', 'TimesheetsController');
    const work = this.ctrl('work-time.controller', 'WorkTimeController');
    for (const d of forgot.splice(0)) {
      const checkIn = at(d, 8, 0);
      await call('work.addEntry', () => work.addEntry(this.org, p.userId, { checkIn, checkOut: new Date(Date.parse(checkIn) + 504 * 60_000).toISOString(), comment: 'Added after the review' }, as(p.userId)));
    }
    const again = await call('timesheet.submit', () => timesheets.submit(this.org, { periodStart, note: 'Completed' }, as(p.userId)));
    if (!again.ok) return;
    this.schedule(this.workdayFrom(addDays(this.current, between(1, 2))), () => this.decide('timesheet_periods', again.id ?? again.period?.id, 0));
  }

  /** HR closes a year for everyone who worked in it; `retry`: those still open (a month handed in late). */
  async closeYear(y, retry = false) {
    const balances = this.ctrl('balances.controller', 'BalancesController');
    const userIds = this.people.filter((p) => p.hired && p.start <= `${y}-12-31` && (!p.exit || p.exit >= `${y}-01-01`) && !(p.closed ?? []).includes(y)).map((p) => p.userId);
    const hr = this.hr(this.current);
    let closed = 0;
    for (let i = 0; i < userIds.length; i += 50) {
      const r = await must('balances.closeYears', () => balances.closeYears(this.org, { year: y, userIds: userIds.slice(i, i + 50) }, as(hr)));
      for (const [k, x] of (r.results ?? []).entries()) {
        const person = this.people.find((p) => p.userId === (x.userId ?? userIds[i + k]));
        if (x.ok) {
          closed++;
          if (person) (person.closed ??= []).push(y);
        } else if (retry) (this.closeErrors ??= []).push(`${y} ${person?.name ?? ''}: ${x.error}`);
      }
    }
    console.log(`  ${this.current}: HR closed ${y} for ${closed} people${retry ? ' (late ones)' : ''}`);
  }
}

// ------------------------------------------------------------------------------------------------ checks over HTTP

/** The instance's API (in its container: its own port). */
const API = process.env.SIM_API ?? `http://127.0.0.1:${process.env.API_PORT ?? (process.argv[2] === 'dev' ? 8001 : 8000)}/api/v1/`;

async function http(pathname, token, body, method) {
  const t = performance.now();
  const res = await fetch(API + pathname, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  assert(res.ok, `${pathname}: HTTP ${res.status}`);
  return { data: JSON.parse(text), ms: Math.round(performance.now() - t), bytes: Buffer.byteLength(text) };
}

async function login(email, password) {
  const { data } = await http('auth/login', null, { email, password });
  assert(data.token, `login ${email}: ${data.error ?? 'no token'}`);
  return data.token;
}

/**
 * After the company's life: real logins over HTTP, the data checks (row counts, consistency), paging, the security
 * checks (another company's directory, someone else's step) and three serial timings of the important lists.
 */
async function verify(sim) {
  const org = sim.org;
  const base = `organizations/${org}`;
  const now = sim.working(sim.today);
  const member = now.find((p) => p.role === 'member' && p.manager && p.manager !== sim.admin.userId) ?? now.find((p) => p.role === 'member');
  const manager = sim.people.find((p) => p.userId === member.manager) ?? sim.admin;
  const hrPerson = now.find((p) => p.role === 'hr');
  const tokens = {
    admin: await login(COMPANY.admin, COMPANY.adminPassword),
    member: await login(member.email, member.password),
    manager: manager === sim.admin ? await login(COMPANY.admin, COMPANY.adminPassword) : await login(manager.email, manager.password),
    hr: await login(hrPerson.email, hrPerson.password),
  };
  console.log(`logged in over HTTP: admin, ${member.name} (member), ${manager.name} (manager), ${hrPerson.name} (HR)`);

  const [c] = await sim.q(`SELECT
    (SELECT count(*)::int FROM organization_memberships WHERE organization_id = $1) AS accounts,
    (SELECT count(*)::int FROM organization_memberships WHERE organization_id = $1 AND (exit_at IS NULL OR exit_at > now())) AS working,
    (SELECT count(*)::int FROM departments WHERE organization_id = $1) AS departments,
    (SELECT count(*)::int FROM teams WHERE organization_id = $1) AS teams,
    (SELECT count(*)::int FROM projects WHERE organization_id = $1) AS projects,
    (SELECT count(*)::int FROM employee_assignments WHERE organization_id = $1) AS assignments,
    (SELECT count(*)::int FROM work_times WHERE organization_id = $1) AS work_times,
    (SELECT count(*)::int FROM project_times WHERE organization_id = $1) AS project_times,
    (SELECT count(*)::int FROM absences WHERE organization_id = $1) AS absences,
    (SELECT count(*)::int FROM timesheet_periods WHERE organization_id = $1 AND status = 'approved') AS approved_months,
    (SELECT count(*)::int FROM project_time_periods WHERE organization_id = $1 AND status = 'approved') AS approved_project_months,
    (SELECT count(*)::int FROM balance_years WHERE organization_id = $1) AS closed_years,
    (SELECT count(*)::int FROM expenses WHERE organization_id = $1) AS expenses,
    (SELECT count(*)::int FROM expense_reports WHERE organization_id = $1) AS expense_reports,
    (SELECT count(*)::int FROM expense_payruns WHERE organization_id = $1) AS payruns,
    (SELECT count(*)::int FROM billing.invoices WHERE organization_id = $1) AS invoices,
    (SELECT count(*)::int FROM workflows WHERE organization_id = $1) AS flows,
    (SELECT count(*)::int FROM workflows WHERE organization_id = $1 AND step_status = 'rejected') AS flows_rejected,
    (SELECT count(*)::int FROM timesheet_periods t WHERE organization_id = $1 AND status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM work_time_months m WHERE m.timesheet_period_id = t.id)) AS approved_without_snapshot,
    (SELECT count(*)::int FROM project_times t JOIN projects p ON p.id = t.project_id WHERE t.organization_id = $1 AND p.organization_id <> t.organization_id) AS foreign_project_bookings,
    (SELECT count(*)::int FROM expense_report_items i JOIN expenses e ON e.id = i.expense_id JOIN expense_reports r ON r.id = i.expense_report_id
      WHERE i.organization_id = $1 AND (e.organization_id <> i.organization_id OR r.organization_id <> i.organization_id OR r.user_id <> e.user_id)) AS mismatched_expense_items,
    (SELECT count(*)::int FROM work_times w JOIN organization_memberships m ON m.organization_id = w.organization_id AND m.user_id = w.user_id
      WHERE w.organization_id = $1 AND m.exit_at IS NOT NULL AND w.check_in >= m.exit_at) AS work_after_exit,
    (SELECT min((check_in AT TIME ZONE 'Europe/Zurich')::date)::text FROM work_times WHERE organization_id = $1) AS history_from`, [org]);
  console.log(`data: ${JSON.stringify(c)}`);
  assert.equal(c.working, now.length, 'people working today');
  assert.equal(c.approved_without_snapshot, 0, 'every approved month has its closing');
  assert.equal(c.foreign_project_bookings, 0);
  assert.equal(c.mismatched_expense_items, 0);
  assert.equal(c.work_after_exit, 0, 'nobody works after their last day');
  assert(c.history_from <= `${Number(COMPANY.founded.slice(0, 4))}-02-01`, 'history from the founding on');
  // Years closed one month after the month closings: the last year only from March on.
  const lastClosable = Number(sim.today.slice(0, 4)) - (sim.today.slice(5) >= '03-01' ? 1 : 2);
  const expectedYears = sim.people.filter((p) => p.hired).reduce((n, p) => {
    const from = Number(p.start.slice(0, 4));
    const to = Math.min(Number((p.exit ?? sim.today).slice(0, 4)), lastClosable);
    return n + Math.max(0, to - from + 1);
  }, 0);
  console.log(`closed person-years: ${c.closed_years} of ${expectedYears}${sim.closeErrors?.length ? ` (${sim.closeErrors.length} not closed)` : ''}`);
  assert.equal(c.closed_years, expectedYears, 'year-end closings for every person and year');
  // Every month ended more than a month ago is approved for everyone who worked in it.
  const [ty0, tm0] = sim.today.split('-').map(Number);
  const cutoff = tm0 <= 2 ? monthStart(ty0 - 1, tm0 + 10) : monthStart(ty0, tm0 - 2);
  const [{ missing }] = await sim.q(`
    SELECT count(*)::int AS missing FROM organization_memberships m
    CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(m.start_date, m.joined_at::date)), $2::date, interval '1 month') g(month)
    WHERE m.organization_id = $1 AND (m.exit_at IS NULL OR m.exit_at > g.month)
      AND NOT EXISTS (SELECT 1 FROM timesheet_periods t WHERE t.organization_id = m.organization_id AND t.user_id = m.user_id
                        AND t.period_start = g.month::date AND t.status = 'approved')`, [org, cutoff]);
  console.log(`months closed: every month up to ${cutoff.slice(0, 7)} approved for everyone (${missing} missing)${sim.lateMonths?.length ? `; HR followed up ${sim.lateMonths.length} times` : ''}`);
  assert.equal(missing, 0, 'every month closed within a month');

  // Paging: HR's expense lists page correctly.
  for (const pathname of ['expenses', 'expense-reports']) {
    const { data: all } = await http(`${base}/${pathname}`, tokens.hr);
    const total = (Array.isArray(all) ? all : all.entries).length;
    if (total < 60) continue;
    const { data: first } = await http(`${base}/${pathname}?page=0&pageSize=25`, tokens.hr);
    const { data: second } = await http(`${base}/${pathname}?page=1&pageSize=25`, tokens.hr);
    const { data: last } = await http(`${base}/${pathname}?page=${Math.ceil(total / 25) - 1}&pageSize=25`, tokens.hr);
    assert.equal(first.entries.length, 25);
    assert.equal(second.entries.length, 25);
    assert.equal(new Set([...first.entries, ...second.entries].map((r) => r.id)).size, 50, `${pathname}: pages overlap`);
    assert.equal(first.hasMore, true);
    assert.equal(last.entries.length, total % 25 || 25);
    assert.equal(last.hasMore, false);
    console.log(`paging ${pathname}: ${total} rows in ${Math.ceil(total / 25)} pages of 25, no overlap`);
  }

  // Security: another company's directory, and a step that is someone else's.
  const [other] = await sim.q(`SELECT id FROM organizations WHERE id <> $1 AND id <> '00000000-0000-0000-0000-00000000a0a0' ORDER BY name LIMIT 1`, [org]);
  if (other) {
    const foreign = await http(`organizations/${other.id}/directory`, tokens.member);
    assert.equal(foreign.data.error, 'forbidden', 'another company\'s directory');
    assert.deepEqual(foreign.data.people ?? [], []);
    console.log('security: a member does not see another company\'s directory');
  }
  const [step] = await sim.q(`SELECT workflow_id FROM workflows WHERE organization_id = $1 AND step_status = 'pending' AND NOT ($2::uuid = ANY(assigned_to_user_id)) LIMIT 1`, [org, member.userId]);
  if (step) {
    const denied = await http(`workflows/${step.workflow_id}/approve`, tokens.member, {});
    assert.equal(denied.data.ok, false, 'a member decides only their own steps');
    console.log(`security: a member cannot decide someone else's step (${denied.data.error})`);
  }

  // Timings: three serial calls each (loopback, not a load test).
  const [ty, tm] = sim.today.split('-').map(Number);
  const lastMonth = tm === 1 ? monthStart(ty - 1, 12) : monthStart(ty, tm - 1);
  for (const [name, pathname, token, rows] of [
    ['directory', `${base}/directory`, tokens.admin, (d) => d.people.length],
    ['manager approvals (all)', `workflows/assigned-to-me?orgId=${org}&status=all`, tokens.manager, (d) => d.length],
    ['manager approvals (to do)', `workflows/assigned-to-me?orgId=${org}&status=pending`, tokens.manager, (d) => d.length],
    ['timesheet list', `${base}/timesheet-periods`, tokens.hr, (d) => d.length],
    ['expense-report list (25 per page)', `${base}/expense-reports?page=0&pageSize=25`, tokens.hr, (d) => d.entries.length],
    ['monthly balances', `${base}/balances/report?month=${lastMonth.slice(0, 7)}`, tokens.hr, (d) => d.rows?.length ?? 0],
    ['year-end overview', `${base}/balance-years?year=${Number(sim.today.slice(0, 4)) - 1}`, tokens.hr, (d) => d.rows?.length ?? 0],
  ]) {
    const samples = [];
    let count = 0;
    let bytes = 0;
    for (let i = 0; i < 3; i++) {
      const r = await http(pathname, token);
      count = rows(r.data);
      bytes = r.bytes;
      samples.push(r.ms);
    }
    console.log(`timing ${name}: ${samples.join('/')} ms, ${count} rows, ${bytes} B (loopback, serial)`);
  }
}

// ------------------------------------------------------------------------------------------------ main

async function main() {
  const target = process.argv[2];
  assert(TARGETS.includes(target), `Simulation target required: ${TARGETS.join(', ')}`);
  assert(process.env.DATABASE_URL, 'Missing DATABASE_URL');
  if (target === 'local-check') assert.equal(new URL(process.env.DATABASE_URL).pathname, '/apensum_simulation_check');
  // dev: the developer's own database on this machine (after `npm run dev:resetdb`), its API on 8001.
  else if (target === 'dev') assert(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname), 'dev runs against a local database only');
  else assert.equal(new URL(process.env.DATABASE_URL).hostname, `apensum-${target.slice(4)}-pg`);
  // No timers of the API in this process (its reminders run in the instance itself).
  for (const k of ['REQUEST_ALERTS', 'HR_TASKS', 'HRPLUS_REMINDERS']) process.env[k] = 'off';

  require(require.resolve('reflect-metadata', { paths: [path.join(ROOT, 'apps/api')] }));
  const { NestFactory } = require(require.resolve('@nestjs/core', { paths: [path.join(ROOT, 'apps/api')] }));
  const { AppModule } = dist('app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const pool = app.get(dist('db.service').DbService).getPool();
  const [{ n }] = (await pool.query(`SELECT count(*)::int AS n FROM organizations WHERE name = $1 OR slug IN ('whale', 'dolphin')`, [COMPANY.name])).rows;
  assert.equal(n, 0, 'Whale exists already: reset the instance first');
  const [{ taken }] = (await pool.query(`SELECT count(*)::int AS taken FROM users WHERE email = $1 OR email LIKE $2`, [COMPANY.admin, `%@${DOMAIN}`])).rows;
  assert.equal(taken, 0, 'Whale accounts exist already: reset the instance first');

  const sim = new Sim(app, pool);
  const started = performance.now();
  sim.firstDay = COMPANY.founded;
  sim.current = COMPANY.founded;
  // The API's business clock (clock.ts) runs on the simulated day: the founding on its day, each day from 8:00 on.
  const { clock } = dist('clock');
  await clock.at(new Date(`${COMPANY.founded}T07:00:00Z`), () => sim.found());
  // SIM_UNTIL=YYYY-MM-DD stops early (a quick check of the first years).
  const until = process.env.SIM_UNTIL ?? sim.today;
  // Day after day, from the founding to yesterday.
  for (let d = COMPANY.founded; d < sim.today && d <= until; d = addDays(d, 1)) {
    sim.current = d;
    if (d.endsWith('-01')) sim.planMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7)));
    await clock.at(dayTime(d), () => sim.live(d));
    if (d.endsWith('-12-31')) {
      const open = [...(sim.openByMonth ?? new Map())].filter(([m]) => m.startsWith(d.slice(0, 4))).map(([, n]) => n);
      const range = open.length ? `, open flows at month-end ${Math.min(...open)}-${Math.max(...open)}` : '';
      console.log(`${d.slice(0, 4)}: ${sim.working(d).length} people, ${sim.people.filter((p) => p.hired).length} hired so far${range} (${Math.round((performance.now() - started) / 1000)} s)`);
    }
  }
  for (const e of (sim.closeErrors ?? []).slice(0, 10)) console.log(`  not closed: ${e}`);
  // Free Flows: what still waits, and that the stamps are the simulated days' (none from the run's own time).
  const [ff] = await sim.q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status <> 'resolved')::int AS open,
      count(*) FILTER (WHERE status <> 'resolved' AND last_activity_at < $2::date - 30)::int AS stale,
      max(last_activity_at) AS newest FROM flows WHERE organization_id = $1`, [sim.org, sim.current]);
  console.log(`free flows: ${ff.total}, open ${ff.open} (no activity for 30 days: ${ff.stale}), taken over ${JSON.stringify(sim.taken)}`);
  console.log(`decisions moved to a new manager on the day the change came into force: ${sim.rerouted ?? 0}`);
  assert(!ff.newest || day(new Date(ff.newest)) <= sim.current, `flows stamped on the simulated days (newest ${ff.newest})`);
  if (!process.env.SIM_UNTIL) await verify(sim);
  const now = sim.working(sim.current);
  const roleCount = (r) => now.filter((p) => p.role === r).length;
  console.log(`${sim.current}: ${now.length} people; hr ${roleCount('hr')}, finance ${roleCount('finance')}, leads ${roleCount('lead')}, it ${roleCount('it')}, developers ${now.filter((p) => p.developer).length}`);
  for (const [label, s] of [...stats].sort((a, b) => b[1].ms - a[1].ms)) console.log(`  ${label}: ${s.n} calls, ${Math.round(s.ms / s.n)} ms avg${s.failed ? `, ${s.failed} refused ${JSON.stringify(s.errors)}` : ''}`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
