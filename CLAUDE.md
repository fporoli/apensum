# CLAUDE.md

Multi-tenant time tracking: NestJS API (`apps/api`), React 18 + MUI + Vite web
(`apps/web`), Postgres, Keycloak (same DB, `auth` schema), Caddy edge proxy.
npm workspaces, Node >= 24. `README.md` covers architecture, ports and deploy;
`docs/BUILD_PROMPT.md` holds the product spec and the architectural rules
below in full; `docs/DATABASE_SCHEMA.md` describes the tables.

## Commands

Run from the repo root unless noted.

```sh
cp env.example.dev.cfg .env.dev   # once; Windows: copy
npm install
npm run dev:up             # Docker: pg + migrate + keycloak + mailpit
npm run dev:seed           # demo data (infra/postgres/seeds/seed.sql)
npm run build              # all workspaces (api: tsc; web: tsc --noEmit + vite build)
npm test                   # all workspaces

npm run dev:api            # build + start the API on :8001
npm run dev:web            # Vite on :3001
npm run dev:migrate        # apply Liquibase changelogs (Docker required)
npm run dev:introspect     # regenerate apps/api/src/db/schema.ts + relations.ts from the live DB (also local:)
npm run dev:checkschema    # does the committed schema.ts/relations.ts match the DB? (also local:, db:)
npm run dev:status         # read-only: does the DB hold exactly this checkout's changesets? (also local:, db:)
npm run dev:psql           # psql into the dev database; dev:down / dev:logs
npm run dev:resetdb        # drop + recreate schema public, migrate, seed (also local:resetdb)
npm run local:up           # whole stack in Docker (.env.local); local:down / local:seed / local:psql
npm run stack -- <env> <push|build|reset|start|stop|all> [--reset]   # all excludes reset unless opted in
```

`npm run site:deploy -- [site|sitepp|all] [--remove]` (`scripts/site-deploy.mjs`) dispatches the `site` workflow for
apensum.ch (prod) and/or the wwwpp.apensum.ch preview (preprod) and waits for it; it deploys what is pushed.
`scripts/stack.mjs` wraps the scripts above for dev/local and only dispatches/follows the
GitHub workflows (`gh`) for VPS instances and Azure; keep deploy logic in the workflows.

Single API test file: `cd apps/api && NODE_PATH=./node_modules npx tsx --conditions=source --test ../../test/api/orgs.test.ts`
(`--conditions=source` makes `@worktime3/shared` resolve to its TypeScript sources).

Environments: **dev** (N=1, `.env.dev`, `compose/docker-compose.dev.yml`) runs
only pg/Keycloak/Mailpit in Docker, with the API and web on the host: pg 5431,
Keycloak 8091, web 3001, API 8001, Mailpit SMTP 1025 / inbox UI 8025. This is
the day-to-day setup. **local** (N=2, `.env.local`) runs everything in Docker
behind Caddy on 5432/8092/3002/8002. The VS Code "Development …" launch configs
debug the host-run API and web against `.env.dev` (the API launch first stops a leftover
Node API on 8001, `scripts/free-port.mjs`; Chrome waits for the fresh API, `scripts/wait-for-api.mjs`); "Local Full Stack: Docker +
Chrome" brings up the local compose stack (task `local: stack up`) and opens
Chrome on 3002. Host processes must not run on local's ports, which Caddy holds.

The base npm scripts (`db:migrate`, `db:seed`, `db:introspect`, `build`, `start`)
are environment-agnostic: they read config only from the process environment,
never from an env file, because CI and the VPS/Azure deploys run them with config
from GitHub Environments. The `dev:*` / `local:*` scripts are thin wrappers for
local development: `scripts/with-env.mjs <dev|local> <cmd>` loads `.env.dev` /
`.env.local` (file values win over the shell's, `PG*` derived from `POSTGRES_*`)
and runs a base script or `docker compose`. Add new local conveniences that way;
never make CI, workflows or deploy scripts depend on them or on `.env` files.
`db:seed` exits if `DATABASE_URL` is unset. The API still starts without it, in offline mode
(logged as a WARNING at startup), and every endpoint, including login, then
returns `{ ok: true, offline: true }`. That looks like success but does nothing.

Demo logins (from `seed.sql`): every `<name>@acme.com` user's password is `<name>`
(`admin@acme.com` / `admin`, `marta@acme.com` / `marta`, ...). Acme reporting line:
Alice manages Admin and Adam; Adam manages Marta, Marco and Uma; Marta manages Ulla
(also hr); Marco manages Ueli; Uma is also developer. The Login screen's demo-account dropdown (Admin, Manager = Marta, HR User = Ulla, User = Ueli)
come from the global `static_data` row `login`/`demo_accounts` via public
`GET auth/demo-accounts`; each value is a JSON string `{name, user, password}`.
The end of `seed.sql` generates each Acme member's history from their start date to yesterday
(absences, attendance, project time, approved timesheets); a plugin's `seed.sql` (expenses: expenses and
reports) runs after it in the same transaction and may use its `pg_temp.seed_*` helpers. It is
deterministic (`pg_temp.seed_rnd`/`seed_id` hash a key), so re-seeding adds only newly passed days.
Its working days use Zurich's holidays (`pg_temp.seed_workday`); keep that in step with
`worktime.ts` if Acme's region changes.

## Tests

- Most tests are API tests in `test/api/*.test.ts`, using `node:test` +
  `node:assert`, run through `tsx` from the `apps/api` workspace. No Nest boot,
  no database: controllers are constructed directly with hand-rolled mock
  `DbService`/service objects (see `project-time-auth.test.ts`), and pure
  helpers exported from controllers/services are tested directly
  (`nextMonthStart`, `isValidEmail`, `vacationDebitMinutes`, …).
- Some tests mirror logic instead of importing it (`rbac.test.ts`,
  `project-time.test.ts`). Prefer importing the real function.
- Several tests do `import type { AuthenticatedRequest } from '../../apps/api/src/types'`,
  which does not exist (the type lives in `jwt.guard.ts`). It works only
  because tsx strips type-only imports; use `jwt.guard` in new tests.
- `apps/web` and `packages/shared` tests are `src/*.test.mjs` run by
  `node --test`; they can import plain `.ts` files (Node strips types) but not
  `.tsx`.
- CI (`.github/workflows/ci.yml`) builds, tests, then runs `db:migrate` and
  `db:seed` against a fresh Postgres 16, so a broken changelog or seed fails CI.

## Database: Liquibase owns schema, Drizzle owns queries

- Schema changes go in a **new** file in `infra/liquibase/changelog/`
  (`NNN-description.sql`, formatted SQL with `--changeset author:id`
  headers), added to `db.changelog-master.xml`. Never edit an existing
  changeset; Liquibase checksums them.
- Then run `npm run dev:migrate` and `npm run dev:introspect` (drizzle-kit 0.31,
  matching drizzle-orm 0.45), and commit the generated files (also a plugin's `api/db/schema.ts` for the tables
  its manifest lists in `apensum.tables`, or of the Postgres schema it owns, `apensum.dbSchema`; `scripts/plugin-schemas.mjs`). `db:checkschema`
  (`apps/api/scripts/check-schema.mjs`) introspects into a scratch folder and compares,
  ignoring table/line order (which follows the database's history); `resetdb` runs it after
  migrating and CI fails on a mismatch.
- `apps/api/src/db/schema.ts` and `relations.ts` are **generated**. Never
  hand-edit them. `scripts/fix-introspected-schema.mjs` patches what drizzle-kit
  gets wrong after introspection (`citext` columns, truncated `COALESCE(... ::uuid)`
  index expressions); extend it rather than editing the output.
- The seed (`infra/postgres/seeds/seed.sql`) is separate from migrations and
  must run cleanly on a freshly migrated database, which CI checks. Insert
  parents before children (e.g. `users` before `organizations`, which
  references them), and use `ON CONFLICT DO NOTHING` for rows that migrations
  already insert (system roles, permissions, some `static_data`).
- To reset a database, drop and recreate the `public` schema, then
  `db:migrate` and `db:seed` (`npm run dev:resetdb` / `local:resetdb` does all three,
  localhost only). Don't just truncate: that deletes the reference
  data the migrations insert. Keycloak's tables live in the `auth` schema;
  leave it alone.
- Regular tables have no `created_at`/`updated_at` columns. Record history
  through `VersionsService.record(table, id, action, actorUserId, row)` after
  writes (fire-and-forget with `.catch(() => {})`), not with timestamp columns.

## API conventions (`apps/api/src`)

- Flat layout: `name.controller.ts` / `name.service.ts`, one controller per
  resource, all registered in `app.module.ts` (add new controllers and
  providers there). Global prefix `api/v1`.
- Auth: global `JwtAuthGuard` (`jwt.guard.ts`) accepts local HS256 tokens
  (`API_JWT_SECRET`) and Keycloak JWKS tokens. Use `@Public()` to opt a route out.
  Forgot password (`password-reset.ts`): `auth/reset` mails a signed link (30 min, bound to the current
  password hash, so one use; key from `purposeKey`), `#/reset/<token>` (`ResetPassword.tsx`, no login)
  sends it to `auth/reset/confirm`. No public endpoint may set a password from an e-mail address alone.
  Registration is open: each registration gets its own workspace as owner; the instance's very first
  user is also admin and superdeveloper (`registrationRoleIds`), so a fresh prod needs no SQL.
  Handlers take `@Req() req: AuthenticatedRequest`.
- **Every org-scoped handler authorizes itself**, using helpers from `access.ts`:
  1. `const db = this.db.getDb(); if (!db) return <offline/empty shape>;`
  2. `const userId = req.user ? await callerUserId(db, req.user) : null;`
     Never trust a user id from the body or query for the caller.
  3. Gate with permissions (below) via `can` / `canSeeUserData` / `listableUserIds` /
     `reachesAll` / `canEditBeyondOwn` / `canEditUserData`, plus `isOrgMember`, `isManagerOf`, `isSuperDeveloper`.
     Teams & Projects uses `canManageItem` (scope `own` = teams you lead, projects you own).
     Don't add checks on role names; `isOrgDeveloper` (form design) is the one left.
  4. Work-time and absence writes check `isPeriodLocked` (working-time timesheet month
     submitted/approved); project-time writes check `isProjectPeriodLocked` (that project's
     month in the project timesheet).
- Permissions: ids are `<object>:<action>:<scope>` (`nav.teamHours:see:reports`,
  `section.basicdata.personalien:edit:all`), catalogued in
  `packages/shared/src/permissions.ts` and in Liquibase (035-037), held via
  `membership_roles` -> `role_permissions`. Global roles (`organization_id` NULL) carry the
  defaults (superdevelopers edit them); an org customizes a role by getting its own copy
  (same name; memberships are moved onto it, "reset" moves them back), or creates its own
  roles. Admin settings -> Roles & permissions (`roles.controller.ts`) manages both.
  `edit` implies `see`; a section also requires its parent navbar entry (My data for own
  data, Users for others'). `owner` holds everything; `admin` always keeps role management.
  People's data: `canSeeUserData` = self, anyone above them in the reporting line (the manager, that
  manager's manager, ... `isAboveInReportingLine`, read-only), or a grant covering them; `listableUserIds`
  adds the whole line below (`reportingLineUserIds`). Editing, approving and reopening stay with the
  direct manager (`isManagerOf`, `canEditUserData`); `time-record-people` flags each person `editable` and
  the time pages are read-only for the others; admin-only overrides use `canEditBeyondOwn` (ignores everyone's `:edit:own`).
  New navbar entries/sections need a registry entry, catalogue rows and default grants
  (a new `NNN-permission-*.sql` changelog); the catalogue test checks those match the registry.
- Roles are per organization. A membership can hold several roles
  (`membership_roles`). "Manager of X" is the manager of X's employee assignment in force
  (`employee_assignments`: dated department, function and manager per person, 050), read through
  `membershipManagerId` / `isManagerOf` / `directReportUserIds`, never stored elsewhere. Approvals
  route to that specific manager, not to any org manager; pending manager requests move to the new
  manager when it changes (`WorkflowsService.rerouteToCurrentManagers`, run on writes, on the
  Approvals inbox and before a decision). Departments (Organization settings, `departments`) have a
  default leader, which is only offered as manager. Employment (start date
  `organization_memberships.start_date` plus assignments, `employment.controller.ts`,
  `EmploymentPanel`) is `section.people.employment`: HR and admin edit it (051).
- Errors are returned, not thrown: `{ ok: false, error: 'kebab-code' }`
  (e.g. `forbidden`, `period-locked`, `unknown-user`); success is `{ ok: true, ... }`.
  Read endpoints return empty shapes on denial.
- Degrade gracefully: no `DATABASE_URL` means offline/empty responses; mail
  (`mailer.ts`, nodemailer) is best-effort and never fails a request (failures are logged; the startup
  `verifySmtp` and each send set `smtp` in the public `GET health`); the
  assistant returns `{ ok: false, error: 'assistant-not-configured' }`
  without `GEMINI_API_KEY`/`OPENAI_API_KEY`.
- AI assistant (`assistant.service.ts`): OpenAI SDK pointed at Gemini's or
  OpenAI's compatible endpoint, with tool-calling. Each tool must run the same
  authorization as its REST equivalent, using the caller's real identity.
- Cases encryption (`docs/CASES_ENCRYPTION.md`, `plugins/cases/shared/caseCrypto.ts`, `caseVault.ts`): a case is end-to-end
  encrypted in the browser (passphrase -> RSA key pair -> a case key per case, wrapped per member in `cases.case_keys`; each
  file has its own key sealed in its row). Rows carry an `enc` envelope and blanked plaintext columns; the API refuses
  plaintext writes to an encrypted case (`case-encrypted`) and its server-side AI/PDF/transcription paths. Those jobs run
  as stateless `compute/*` calls with the decrypted content in the request and store nothing. Never read, log or index
  an encrypted row's fields on the server, never add a server feature that needs them without a `compute` path, and
  never store a passphrase or key. A lost passphrase is unrecoverable by design.
- Cases (plugin `plugins/cases`, module `cases`, default off; its own Postgres schema `cases`, `apensum.dbSchema`;
  tables created by the core's old changesets 071-076, new changes in its changelog; api/, web/, shared/cases.ts, texts).
  Cases AI per organization (`organizations.settings.cases.ai`, `plugins/cases/shared/cases.ts`, set only by a
  superdeveloper under Organization settings -> AI and costs, the plugin's `CaseAiSettingsPanel` shown there via
  `orgSettings` `within: 'org.ai'`, `GET/PUT case-ai-settings`):
  transcription Whisper on the server or Azure OpenAI Whisper (`azure-transcribe.ts`; Azure has no fast Speech transcription in Switzerland), summary key sentences / instance provider / Azure OpenAI, AI draft
  instance provider or Azure OpenAI. Default: nothing goes to Azure. `case-ai.service.ts` picks the provider
  (a chosen but unconfigured one is an error, never a silent fallback). The AI budget is the core's, for every
  module and plugin: every Azure call goes through `AiBudgetService` (`ai_usage` 078, with an optional
  `subject_table`/`subject_id` and any lowercase `kind`): it reserves the estimated CHF under an advisory lock and
  refuses beyond `AI_MONTHLY_BUDGET_CHF` (instance, unset = Azure off), the org's limit (`organizations.settings.ai
  .monthlyLimitChf`, `packages/shared/src/ai.ts`, default 10; `GET/PUT ai-settings`, `AiSettingsPanel.tsx`, superdeveloper
  only), one running call per user and 20 per hour; prices come from env (`AZURE_*_CHF_*`), `AI_AZURE_ENABLED=false` is
  the kill switch, no retries against Azure. Azure resources (shared by all environments, Switzerland North,
  "Standard" deployments only, resource group `apensum-ai`) are `infra/azure/ai-provision.sh`
  (`resources|github|local|rotate`); budgets per environment are GitHub Environment variables, keys repo-level.
- Domain terms: **project time** (`project_times`, hours booked against
  projects) is separate from **work time** (`work_times`, check-in/check-out
  attendance) and from **balances** (vacation/overtime, `balances.service.ts`).
  Approval flows (timesheets, expense reports, absences, timesheet reopen) go
  through `workflows.service.ts` and create notifications
  (`notifications.service.ts`, which persists rows and pushes over the WS
  gateway at `/ws/notifications`). Admin-editable dropdown vocabularies live
  in `static_data`. Rows for all organizations (`organization_id` NULL) are read-only for
  everyone, superdevelopers included, and come only from migrations: an org copies one
  (Admin settings, the copy icon) and edits its copy, which then replaces it for that org. Absence types (`absences`/`absence_type`) map each key to
  attributes instead of a label (labels are in `translation`): `{"approval": false}`
  (set for sickness and accident in the global row, 047) records the absence as
  approved and notifies the manager instead of asking. The code keeps no list of
  types; new orgs inherit the global row. "Basic data" (`basicdata.*`) is personal data with an
  HR change-request/approval history.
- Work-time model (`packages/shared/src/worktime.ts`, DB side in
  `work-time-model.service.ts`): a person's target per day comes from their
  `work_schedules` row in force (minutes per weekday, with history; else the org's
  full-time week Mon-Fri), minus public holidays (computed per canton from
  `organizations.settings.holidayRegion`, plus `org_holidays` rows) and approved
  absences. A session or project entry past midnight is one row, split at the person's local midnight
  wherever days are counted (`minutesByLocalDay` in `work-time-model.service.ts`, `minutesPerDay` in the web's
  `aggregate.ts`); lock checks cover every day it touches (`isPeriodLocked`/`isProjectPeriodLocked` take an end);
  a session over 16 h (`LONG_SESSION_MINUTES`) returns `long-session-confirm` until resent with
  `acknowledgeLongSession`. Project time stays independent of attendance, but a day's project time above its
  attendance + `projectTimeToleranceMinutes` returns `project-exceeds-attendance-confirm`
  until the client resends with `acknowledgeAttendance`.
- Balances (`balances.service.ts`, `computeYearBalances` is pure): approving a working-time
  timesheet closes the month into `work_time_months` (reopening deletes it); other months
  are computed live from the model. Overtime = month differences + `balance_adjustments`;
  Überzeit (attendance beyond `legalMaxWeeklyMinutes` per calendar week) is a share of it,
  kept as its own account (`legal_overtime` adjustments move both);
  vacation is in full-time days (entitlement `vacationDaysPerYear` prorated by workload,
  or a `vacation_entitlements` row; carried over). Others' balances and the monthly report
  with alerts are `nav.balances` (Time balances page); one's own are always visible.
- Two timesheets: the working-time timesheet (`timesheet_periods`, `timesheets.controller.ts`,
  Monthly timesheet page) goes to the line manager and closes the month's balance; the project
  timesheet (`project_time_periods`, one row per person, project and month,
  `project-timesheets.controller.ts`) goes to each project's owner (Approvals page), approved
  on submit when the person owns the project or it has none. Hours without a project can't
  be submitted. A project can be limited to teams (`project_teams`, 070, set under Teams & Projects → Projects): then only
  their members and leads and the project owner book on it (`projectBookingError` in `access.ts`, checked on
  create and when an entry moves to another project, for the person whose entry it is; existing entries stay);
  `GET projects?bookableFor=` flags each project `bookable`. Work time and project time are changed by the person, their designated manager or
  HR (`canEditUserData`: `nav.workTime` / `nav.time` edit beyond own) and only while the month is
  open; the manager or HR reopens a submitted/approved month (`timesheet-periods/:id/reopen`,
  `project-timesheets/:id/reopen`). The pages pick the person via `time-record-people` (`PersonPicker`).
  Managers and HR also get a Team tab on those pages and on Absences, Expenses and Expense reports
  (`TeamView.tsx`, `GET organizations/:orgId/team-overview?kind=&month=`): one row per person they may
  see (`listableUserIds`, caller excluded), opening that person's page or their entries; Absences adds a
  month calendar with the org's holidays. HR's read access to absences and expenses is 049. Plugins add team
  tables (`ApiPlugin.teamViews` rows, web `teamViews` columns; the expenses plugin's two). Import/Export: plugins
  add payroll items (`ApiPlugin.payroll`, e.g. Abacus wage type 3000 for expenses) and their tables to the backup
  (`ApiPlugin.backup`, restored after the core's users, documents and projects).
  The work schedule is HR's alone (048); every basic-data section, Personalien included, is
  requested by the employee and approved by HR.

## Web conventions (`apps/web/src`)

- Flat folder of PascalCase page components. Each page is an entry in `corePages.tsx` (section, hash,
  permission object, role fallback, navbar entry with optional parent and count, render), the same shape
  plugins use (`PluginPage`); `App.tsx` builds the navbar (`navigation.ts`), hashes and gating from
  the core's and the plugins' entries alike and owns session, org switcher and badges.
- Each page calls the API directly with
  `fetch(\`${API}/...\`, { headers: await authHeaders() })`, where
  `const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1'`
  is declared per file.
- All UI strings go through i18n: `const t = useT()` from `i18n.tsx`. When you
  add a key, add it to all four dictionaries in `dictionaries.ts` (en/de/fr/it);
  `dictionaries.test.mjs` fails on missing keys or mismatched `{{placeholders}}`.
- Format dates, times and numbers with the app's `locale` from `useI18n()`,
  never the browser default (`toLocaleDateString()` with no argument), and in its Swiss variant:
  the `localeFormat.ts` helpers do it, direct `Intl`/`toLocale*` calls pass `swissLocale(locale)`
  (`de` -> `de-CH`: 2'848.77, 17.11.2026). `locale` itself stays the language key (texts, labels).
  Date pickers use dayjs `de-ch`/`fr-ch`/`it-ch` and a Swiss English `en-ch` (`ConfigField.tsx`).
- Configurable form fields (docs/FIELD_CONFIG.md): field definitions live in
  `packages/shared/src/fields.ts` (imported as `@worktime3/shared/fields`) and
  are rendered by `ConfigField` / `ConfigFieldGroup` (`ConfigField.tsx`). Number
  entry and display go through `localeFormat.ts`; date pickers are MUI X with
  dayjs, set up once by `DatePickerLocalization` in `main.tsx`. The basic-data
  and expense forms use them; other forms still have hand-written fields.
- Global and per-org templates (`field_config`, edited by the `developer` role
  and `users.is_superdeveloper`) override the registry. Merging, override
  checks (`checkFieldOverride`) and value validation (`validateFields`) live in
  `fields.ts` so the browser and the API apply the same rules. A form page
  loads its merged template from `GET organizations/:orgId/forms/:formId`; a
  controller saving a configured form validates with
  `FieldsService.resolved()` + `validateFields`, as `basicdata.controller.ts` does.
  In the web app, a page with a configured form uses `useFormTemplate`
  (`designMode.tsx`), wraps the form in `FieldDesignScope` and renders
  `FormDesignPanel` while designing, as `Home.tsx` does.
- Custom fields (defined by a template, `field_config.is_custom`) are stored in
  the form's `customStorage` JSON column. Basic data keeps org-defined ones in
  `users.basicdata.orgs.<orgId>`: read basic data through `scopeToOrg` so one
  org never sees another's section.
- Show API errors to the user. Don't apply changes optimistically and then
  revert them silently.
- Re-resolve the user's role when they switch organizations. Never cache one
  global role.
- Modules (`packages/shared/src/modules.ts`): optional feature areas an org switches on or off
  (Organization settings -> Modules, `GET/PUT organizations/:id/modules`, stored in
  `organizations.settings.modules`, unset = the module's default). A module owns permission objects;
  `permissionIdsOf` drops them when it is off, so its navbar entries disappear and every `can()` on
  them fails, with no per-endpoint module check. A new module: a registry entry, its permission
  objects (with a changelog as usual) and i18n `modules.<id>` / `modules.<id>.description`.
- Requests (module `requests`, `requests.controller.ts`, `Requests.tsx`, tables 052): tickets to the
  line manager or a department, with a message thread (`request_messages`, kind `message` or `event`).
  Handlers are worked out per call, never stored: the requester's manager in force, or the department's
  members in force and its leader, plus `nav.requests:edit:all` (admin). Any handler takes, answers, sets
  the status, archives; the requester answers and resolves/reopens. Every change notifies the other
  side (`source_table = 'requests'`, the bell opens the thread). Each request has a type (static_data
  `requests`/`request_type`, global row in 069: service, support, other; `{"sort": n}` orders them), an
  `urgent` flag and an optional http(s) `link_url`; validation is `packages/shared/src/requests.ts` plus
  `validateRequestDetails`, and requester or handler change them via `POST requests/:id/details`.
  Messages carry attachments (054): files go through `DocumentsService` (`documents` rows, linked by
  `request_message_documents`), uploaded multipart in `files` on create/reply, downloaded via
  `requests/:id/attachments/:documentId` with the request's access check; the web composer takes the
  paperclip, drag-and-drop and pasted screenshots (`attachments.tsx`).
- News (module `news`, `nav.news`, 080/081; `news.controller.ts`, `News.tsx`, `NewsHomeCard.tsx` on Home,
  `packages/shared/src/news.ts`): admin and HR (`nav.news:edit:all`) write posts (title + Markdown per language, pictures
  as `![alt](doc:<document id>)` uploaded to the post, no SVG), publish them to everyone or some departments (audience
  worked out per call like request handlers), optionally by e-mail (a link, never the text's pictures), optionally asking
  readers to confirm (`require_ack`; editors see who read/confirmed). Everyone but guests reads (`see:all`). Markdown is
  `packages/shared/src/markdown.ts` (escapes everything; also used by the website's news posts). Product news (082,
  `organization_id` NULL): a superdeveloper writes it for the admins (`nav.admin`) of every organization with the module
  on; it shows in each of their organizations' News, one notification per person (`news.product`), pictures stored in
  the organization it was written in; only superdevelopers change it (`mayEditNews`). A product post marked
  public (083, `is_public`) is also on the website and can be sent to the newsletter's confirmed subscribers
  (`POST news/:id/newsletter`, superdeveloper, test mail to oneself first; `news-newsletter.ts`: HTML + text in the
  subscriber's language, pictures from `public/news/:id/images/...`, a signed never-expiring unsubscribe link and
  List-Unsubscribe one-click; `newsletter_deliveries` makes a send resumable and never mails anyone twice).
- Documents (`nav.documents`, `documents.controller.ts`, `Documents.tsx`, Personal navbar group): the
  caller's own documents only, as one list built per call: timesheet PDFs, monthly project reports, absence
  evidence, attachments of requests they sent, and plugin documents (`ApiPlugin.documents`,
  web `documentCategories`: expense receipts); downloads are checked against that same list.
  `timesheet-documents.service.ts` (pdfkit, labels in the person's `users.locale`) issues a working-time
  timesheet PDF when that month is approved, and one project report per person and month (every project
  with its own approval status) whenever one of that month's projects is approved or reopened; the previous
  version gets `superseded_at` (`timesheet_documents`, 057/059). Issuing is best effort and never fails an
  approval. Opening Documents issues the current year's missing PDFs; `npm run db:documents` does it for
  everyone (run by `dev:seed` / `dev:resetdb`, dev only: the Docker stacks keep files in the API container).
- Directory (`nav.directory:see:all`, everyone, 058; `directory.controller.ts`, `Directory.tsx`): active
  members with avatar, e-mail, basic-data `phone1` (deliberately shown org-wide), position and department
  of the assignment in force, and an open check-in. Return nothing more from basic data or time records.
- "Send by e-mail" on requests and Approvals items (`ForwardMailDialog.tsx`, `POST requests/:id/forward`,
  `POST workflows/:id/forward`, `forward-mail.service.ts`): the server mails active members of the org only
  (max 20), Reply-To the sender, with a link back; whoever may see the item may send it. It is the action
  itself, so a mail failure is returned as an error (dev: Mailpit on :8025).
- Documents are encrypted at rest (`document-crypto.ts`, 060): AES-256-GCM per file, its key wrapped with
  `DOCUMENTS_KEY` (env/secret, never in the DB). Read files only through `DocumentsService.read`/`send`.
  No key = stored plain with a startup WARNING. `npm run db:encrypt-documents` encrypts plain files;
  rotation: new key in DOCUMENTS_KEY, old in DOCUMENTS_KEY_PREVIOUS, then `-- --rewrap`. Losing the key
  loses the documents.
- Personnel file (`personnel_documents` 061, `section.people.documents` 062, HR edit:all only, not admin;
  `personnel-documents.controller.ts`, `PersonnelDocumentsPanel.tsx` on the Users page): HR's documents per
  person, each shared with the person (listed on their Documents page, notified) or HR only. Access is the
  grant alone, not the reporting line; a person never edits their own file.
- Plugins (`plugins/<id>`, docs/PLUGINS.md): a folder with a package.json `apensum` manifest (`id` = folder name,
  `apensumApi` = `PLUGIN_API_VERSION` of `packages/shared/src/pluginApi.ts`, checked at API start and web build: bump it
  when a contract change can break existing plugins; every name a plugin adds (tables, permission objects, reports,
  pages, ...) starts with its id, checked by `namespaceMismatch`, `legacyNames: true` only for expenses,
  optional `module` registered via `registerModule`, optional `permissions` = its permission objects, registered via
  `registerPermissionObjects` by the API and the web app, `api` = built entry, `web` = TS entry). Not npm workspaces and
  no dependencies of their own (everything resolves from the root `node_modules`), so a private plugin cloned into
  the folder (gitignored except the bundled `plugins/expenses`) changes neither the lockfile nor `npm ci`. A plugin
  imports the core only through the contracts `@worktime3/api/plugin` (+ `@worktime3/api/schema`) and
  `@worktime3/web/plugin`; extend those files, never import other core files from a plugin. API: `plugins.ts` loads
  them in `app.module.ts` (an unbuilt plugin stops the start); `npm run build --workspace=@worktime3/api` compiles them
  (`scripts/plugins.mjs build`, after the API's declarations). Web: Vite's `virtual:apensum-plugins`
  (`vite.config.ts`) bundles them; `plugins.ts` merges their texts into the dictionaries and App.tsx /
  main.tsx / OrganizationSettings.tsx / Approvals.tsx show their pages, nav groups, settings sections, public routes and
  workflow kinds (label, source, title, Inspect dialog of an approval kind; the API side declares `ApiPlugin.workflows`:
  actions, source tables with org resolver and record loader, manager routing). Everything a plugin adds to the API is
  declared in `defineApiPlugin`; `plugins.ts` and `plugin-registrar.ts` register it, plugins call no `register*` themselves.
  Tests: `plugins/<id>/test` (`*.test.ts` via tsx, `*.test.mjs` via node), run by `npm test` (`scripts/plugins.mjs test`).
  The core must work without plugins: CI job `core-only` (empty `APENSUM_PLUGINS_DIR`, `scripts/smoke-no-plugins.mjs`);
  grants on objects outside the catalogue (a missing plugin's) count for nothing (`mergePermissionRows`).
  Database: `plugins/<id>/changelog/db.changelog-master.xml` (same rules as the core's, author = plugin id) runs after
  the core's: the migrate image's entrypoint `infra/liquibase/apensum-migrate.sh` (APENSUM_CHANGELOG=core|<id> limits
  it), changesets recorded as `<id>/changelog/<file>`; compose and `migrate.mjs` mount `plugins/`, the Azure/VPS
  workflows stage them (`scripts/plugins.mjs stage-changelogs` -> `infra/liquibase/plugins`); `db:status` checks
  each changelog. A plugin's permission rows and default grants live there; its tables may be in `public`.
  Tables a plugin lists in `apensum.tables` are introspected into its own `api/db/schema.ts`, not the core's
  (expenses: expenses, expense_reports, expense_report_items, exchange_rates; their old changesets and the rows
  035/037/049 made stay in the core's changelogs).
- Expenses (plugin `plugins/expenses`, module `expenses`, default on; everything expense-specific is in the plugin:
  tables (`api/db/schema.ts`), changelog, form (`shared/form.ts`, registered via `ApiPlugin.forms`), booking
  (`shared/booking.ts`), report, team views, documents, payroll/backup, workflow, Home quick action (`homeAction`);
  the core only keeps the organization's currency list under static_data `expenses`/`currency` and the old changesets): the receipt (one file) is attached in the expense form itself (drop, paste, paperclip) and
  shown there when editing; the list is newest first. `receiptCapture.tsx` adds a photo (phone camera via
  `capture`, webcam dialog on a computer), a screen area (`getDisplayMedia` + crop) and a QR code: the PC
  creates a hand-off (`receipt-handoffs`, in memory, 10 min, one file, `ReceiptHandoffService`), the phone
  opens `#/receipt/<token>` (`PhoneUpload.tsx`, rendered by `main.tsx` without login, token = credential)
  and sends the photo; the PC polls, takes the file into the form and uploads it as usual.
- Expense booking (077, `plugins/expenses/shared/booking.ts` `bookExpense`, used by the form's preview and by
  `expense-booking.ts` on create/update): people enter the receipt's amount and currency; the API books `value`
  in the org's reporting currency (`settings.defaultCurrency`, else CHF) with the hand-kept exchange rate in force
  on the date (`exchange_rates`, Organization settings, `exchange-rates.controller.ts`) and stores it in
  `expenses.exchange_rate`; no rate = `exchange-rate-missing`. Mileage is category `mileage` (offered by the form,
  in no category list): `quantity` = km x the rate per km in force (static_data `expenses`/`mileage_rate`, key =
  valid from, global 0.70, org copy overrides), stored in `unit_rate`. Booked expenses never change with later
  rates; older ones in another currency stay as they are ("not converted") until edited. Never trust a client `value`.
  Receipt recognition (`expense-receipt.ts`, `ExpenseReceiptService`, `POST expenses/scan-receipt`): photo or PDF text
  to Azure OpenAI (Switzerland) only, for every org with expenses when the instance has it, through `AiBudgetService`
  (kind `receipt`, the org's AI monthly limit, `orgMonthlyLimitChf`); returns a suggestion, stores nothing.
  The expense API/web files named here live in `plugins/expenses/{api,web}`.
- Organization settings sections are collapsible (`SettingsSection.tsx`; a card uses `SectionPaper` so it shows its own
  title only outside a section). AI and costs (`AiSettingsPanel`, plus plugins' parts via `within: 'org.ai'`) lives there.
- Reports (module `reports`, `nav.reports`, 063; `reports.controller.ts`, `Reports.tsx`): the catalogue, grouping and
  totals are `packages/shared/src/reports.ts` (a `balance` measure is each person's last month, summed over people).
  Each report shows `listableUserIds` of its page object (project hours `nav.time`, attendance `nav.workTime`,
  absences `nav.absences`); a filter naming someone outside that is refused. Attendance and absences come from
  `BalancesService.year`, so they match Time balances. A report with a money measure keeps `alwaysGroupBy: ['currency']`
  and never totals across currencies (the expenses plugin's report); People (`section.people.employment`) is a snapshot on the period's last day. Excel/CSV are
  built in the browser from the shown rows (`packages/shared/src/xlsx.ts`, no dependency); the PDF is the same table,
  labelled in the browser and laid out by `POST reports/pdf` (`report-pdf.ts`, pdfkit, nothing stored). Saved reports
  (`saved_reports` 064, `saved-reports.controller.ts`): the owner edits; sharing with role names needs
  `nav.reports:edit` (admin, hr, manager); whoever opens one runs it with their own rights. Report logic is
  `reports.service.ts`; labels and the table (page, PDF, Excel, scheduled files) are `packages/shared/src/reportTable.ts`
  with the texts in `reportTexts.ts` (spread into `dictionaries.ts`; the API uses them for scheduled files). Dimension
  labels come from the definition (`labels`: static data or a text prefix), the project filter from `projectFilter`.
  Plugins add reports (`ApiPlugin.reports` / `WebPlugin.reports`: one shared definition + texts, `registerReport`,
  `registerAvailablePluginTexts`; rows from the plugin, `report-sources.ts`, filtered by the core to the checked people).
  The `workingTimeAct` report checks recorded attendance against the Working Hours Act (`working-time-act.ts`, pure:
  daily rest, breaks, 14-hour day, weekly maximum, yearly Überzeit, night and Sunday work; rules as SECO's 710.224.d
  summary states them; it lists findings, it does not judge permits or exceptions).
  Schedules (065 `report_schedules` / `report_runs`, `report-schedules.service.ts`, math in `report-schedule.ts`):
  weekly or monthly at an hour in the owner's time zone; a job runner in the API (every minute, claims a due row by
  moving `next_run_at`, `REPORT_SCHEDULER=off` disables it) makes one file per recipient with that recipient's rights
  and language, stores it in Documents (category `report`) and notifies and mails a link, never the file. Recipients
  other than oneself need `nav.reports:edit`; a recipient who may not see the report gets a run with the error.
- Setup checklist (`setup.controller.ts`, `SetupChecklist.tsx` on Home, `nav.orgSettings:edit` only): the steps of
  setting up a new organization (name, canton, work-time rules, departments with leaders, people, everyone's
  assignment with a manager; optional: schedules, projects, look), worked out from the data on every call
  (`setupSteps`, pure). Only `organizations.settings.setupDismissed` is stored; Organization Settings shows it again.
- Organization look and feel (header/page/sidebar colors, logo as a data URL) lives in
  `organizations.settings.branding`, validated by `packages/shared/src/branding.ts`
  (API and browser), served by `GET/PUT organizations/:id/branding` (edit = `nav.orgSettings`).
  App.tsx loads it per org into `BrandingContext`; `createAppTheme(mode, branding)` applies it.
  Seeded logos are `infra/postgres/seeds/branding/*.svg`, base64-inlined in `seed.sql`.

## Other

- `packages/shared`: `index.ts` (role ids, RBAC matrix) mirrors API constants
  and is not imported yet; `fields.ts` (the field registry) is used by the web
  app and the API, as are `permissions.ts` and `branding.ts`. Keep these to erasable TypeScript (no enums) so Node
  tests can import them. Its `exports` map has a `source` condition (the `.ts`
  sources, used by Vite, the web type check and all tests) and a built `dist/`
  (used by the API, which is CommonJS and loads it via `require` of ESM). The
  API's `build` script builds the shared package first.
- Environments: `compose/docker-compose.{dev,local,vps}.yml`; `local` uses
  `infra/caddy/Caddyfile.local`, `vps` the shared edge in `infra/caddy/edge/`.
  Azure is `infra/azure/provision.sh` (no compose file). `vps` and `azure`
  deploy only through GitHub Actions, with config in GitHub Environments
  (`azure`, and one per VPS instance: `prod`, `preprod`, `test`, ...). A VPS GitHub Environment is one instance: its name sets
  the container prefix, `/opt/apensum-<env>`, its own Postgres, and `DOMAIN` + `WEB_SUB/API_SUB/AUTH_SUB`
  (optional `MAIL_SUB` for the Mailpit inbox, `PORTAINER_SUB` for Portainer, default `portainer`) set its hostnames. `VPS_HOST/USER` are
  variables, `VPS_SSH_KEY` a secret. Never hand-edit files on the server; change
  `infra/vps/remote.sh` or `infra/caddy/edge/`. `deploy` does not seed: use the
  `vps` workflow's `seed` (additive, needs `SEED <env>`) or `reset-seed` (destructive).
  `seed.sql` must stay re-runnable: fixed keys on every row, `ON CONFLICT DO NOTHING`,
  and UPDATEs that only fill in unset values. Each VPS instance has its own Postgres
  container (`PG_PORT`, role/db `worktime`) and Mailpit; only Caddy is shared (`infra/caddy/edge`).
  Portainer is its own per-server stack (`infra/portainer`, `vps` workflow action `portainer`). So is Whisper (Cases
  transcription): one sidecar per machine, never per stack. On a VPS `infra/whisper/docker-compose.yml`
  (action `whisper`, model `WHISPER_MODEL_FILE`), joined by every instance's API over the internal network
  `apensum-whisper`, enabled per instance by `CASES_WHISPER_URL=http://whisper:8080`; locally
  `compose/docker-compose.whisper.yml` (`npm run whisper:up`), used by dev (`127.0.0.1:8081`) and local (`whisper:8080`). Ports follow `8090+N` (Keycloak), `5430+N`
  (pg), `3000+N` (web), `8000+N` (API). Each compose file has a one-shot
  `migrate` service that runs before the API and Keycloak start.
- Keycloak realm config: `infra/keycloak/realm-worktime.json`.
- Website (`apps/site`, apensum.ch): static marketing pages in de/fr/it/en, built by `build.mjs`
  with no dependencies (no framework, nothing loaded from third parties; the only scripts are
  `assets/reveal.js`, which shows the phone number on click so it is not in the HTML, `assets/contact.js` on the
  contact page: topic from `?topic=`, time trap, and `assets/news.js` on the News page: the posts from the API). No `mailto:` links (they do nothing without a mail program): buttons
  open the contact form with a topic (`ctx.contactLink`), the address is plain text (`ctx.email`). Texts are in `src/i18n/<lang>.mjs`, all four with the same keys, list lengths and
  `{{placeholders}}` (`test/site.test.mjs`); German is Swiss (no ß). The holiday card imports
  `packages/shared/src/worktime.ts`. The Working Hours Act page (`law`) cites SECO (`lawSourceUrl`); its cards must
  stay true to the app (report, Überzeit account, midnight split, retention via versions). Claims must match what the app does. Deployed only by the
  `site` workflow (`infra/site/`: own Caddy container behind the shared edge, `remote.sh`; a host other than
  the main domain, e.g. `wwwpp.apensum.ch`, is a noindex preview in its own container);
  `npm run site:dev` previews on :3010. Media (not in git, `apps/site/media`, shipped from the `site-media`
  release by `npm run site:videos:publish`): role videos plus the developer one (`npm run site:videos`,
  `videos/record.mjs`) and the features page's screenshots per language (`npm run site:screens`,
  `videos/screens.mjs`, shot ids = `FEATURE_SHOTS`), both from the dev stack with demo data; pages show
  only what is there. The contact form (only when `SITE_CONTACT_URL` is set, workflow
  input `contact_url`) is a plain HTML post to the API's public `public/contact`
  (`site-contact.controller.ts`): honeypot, `spamReason` (sent within 3 s, links in the name, more than 3 links: dropped
  silently, logged), per-IP and daily limits, topic in the subject (`[Website] <topic>: <name>`), Origin must be in
  `CONTACT_SITE_ORIGINS`; it mails `CONTACT_EMAIL` (default info@apensum.ch, visitor as Reply-To) through
  the instance's SMTP and redirects to `/<lang>/<contact>/<thanks|error>/`. `remote.sh` puts the API's
  origin into the CSP `form-action`. The menu groups the module pages (Cases, Expenses, "build your own module" = `plugins`, its steps true to
  docs/PLUGINS.md) under "Modules" (`MODULE_PAGES` in `layout.mjs`, CSS-only submenu). The app links back to the site ("More about Apensum", `infoUrl.ts`).
  News by e-mail (page `news`, a one-line form in every footer; only with `SITE_CONTACT_URL`): the forms post to the same
  API (`public/newsletter/subscribe` / `unsubscribe-request`, `site-newsletter.controller.ts`, table
  `newsletter_subscribers` 079 with the consent timestamps). Double opt-in: the mail's link opens a small API page with a
  button (GET shows, POST acts, so mail scanners change nothing); unsubscribing by form mails a link, and no answer tells
  whether an address is subscribed; one mail per address per 10 minutes, per-IP and daily limits. The posts are public
  product news written in the app (News module below): `news.js` loads them from the API's public `public/news`
  (`public-news.controller.ts`, HTML rendered there), `?post=<id>` shows one; the site's CSP allows the API origin for
  connections and pictures (`SITE_IMG_SRC`, `remote.sh`). Without `SITE_CONTACT_URL` there are no posts. References page
  (`references`): no references yet, first customers' operation free, only customizations billed; contact topic `pilot`
  (also in `site-contact.controller.ts`).
