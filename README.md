# Apensum — Modular Swiss Business Framework & Enterprise Suite

**Apensum** is a modular enterprise business framework and application suite engineered specifically for Swiss labor law (ArG) and enterprise requirements.\
It combines a robust time-tracking and organizational core with an extensible plugin architecture, business modules as plugins (Spesen/Expenses, Gutachten/Assessments and HR processes in private repositories; Notes, an open example plugin, bundled), and a high-performance marketing website.

Built with **NestJS** (API), **React 18 + MUI + Vite** (Web & PWA), **Postgres**, **Keycloak** (OIDC IdP in `auth` schema), and **Caddy** (edge reverse proxy).\
Schema is strictly versioned with **Liquibase** and typed against **Drizzle ORM**.

## Key Highlights

- **Extensible Plugin Framework**: Clean separation between core operations and business modules (`plugins/<id>`).\
  Plugins contribute isolated DB schemas/tables, NestJS controllers, React pages, navigation entries, permission namespaces, and workflow hooks.
- **Swiss Labor Law (ArG) Compliance**: Automatic holiday calendars for all 26 Swiss cantons, Pensum-prorated vacation calculations, and strict statutory Überzeit tracking (hours exceeding 45/50 h/week) segregated from flextime/overtime.
- **Swiss Payroll Interfaces**: 1-click monthly payroll export for Abacus (AbaSalary wage types / Lohnarten CSV), Bexio, and formatted Excel (XLSX) / CSV.
- **Zero-Knowledge Dossier Encryption (`plugins/cases`, private plugin)**: End-to-end envelope encryption (AES-256-GCM + PBKDF2/Argon2id) for sensitive case dossiers, medical/legal assessments, and audio recordings.
- **Integrated AI Pipeline**: Audio transcription and drafts with Azure OpenAI in Switzerland only (Whisper, GPT), and automated draft synthesis for case interviews and assessments with strict per-instance and per-org monthly budget caps.
- **Multi-Currency Expense Management (`plugins/expenses`, private plugin)**: Multi-currency receipts, OCR capture, approval chains, and payroll debiting.
- **Absence Calendar Feeds**: RFC 5545 iCalendar / WebCal live feeds for Apple Calendar, Microsoft Outlook, and Google Calendar with scoped capability tokens (`personal`, `team`, `all`).
- **Bulk Employee Onboarding**: CSV employee onboarding with dry-run validation preview and automatic reporting line resolution.

## Live PWA Demo (Installable on Mobile)

Experience Apensum as a native-like Progressive Web App (PWA) on your smartphone or desktop: 👉 **[https://appdemo.apensum.ch](https://appdemo.apensum.ch)**

- **Install on iOS (iPhone / iPad)**: Open [https://appdemo.apensum.ch](https://appdemo.apensum.ch) in Safari, tap the **Share** button (box with upward arrow), and select **"Add to Home Screen"**.
- **Install on Android**: Open [https://appdemo.apensum.ch](https://appdemo.apensum.ch) in Chrome, tap the menu (three dots) or install prompt, and select **"Install app"** / **"Add to Home screen"**.
- **Desktop (Chrome / Edge / macOS)**: Click the install icon in the URL address bar to run Apensum in its own dedicated, native-feeling window.
- **Instant Demo Logins**: The login page provides 1-click logins for **Admin**, **Manager (Marta)**, and **Employee (Ulla)** with pre-seeded demo hours, absences, and expenses.

## Architecture

```
apps/web  (React + MUI, Vite)  --HTTP-->  apps/api  (NestJS)  --Drizzle-->  Postgres
                                               |                                ^
                                               |  validates JWTs                |
                                               v                                |
                                          Keycloak  ------------------------------
                                          (IdP; stores its own tables in the
                                           `auth` schema of the same database)

Caddy fronts web, API, and Keycloak in the `local` Compose
environments. The VPS stack uses the shared edge Caddy; `dev` accesses its
host-run API and web app directly.
```

### Components

| Path | What it is |
| --- | --- |
| `apps/web` | React 18 + MUI + Vite. One PascalCase file per page, registered in `corePages.tsx` like a plugin page; `App.tsx` builds nav drawer, routing and gating from them. |
| `apps/api` | NestJS API, one controller per resource. |
| `apps/site` | Static marketing website and developer docs in 4 languages (de/en/fr/it). Built with modern zero-dependency generator (`build.mjs`). |
| `packages/shared` | Code shared by web and API: `permissions.ts` (permission catalogue), `fields.ts` (configurable form fields), `branding.ts`, `worktime.ts` (daily targets, holidays, month summaries, vacation entitlement), and `pluginApi.ts`. |
| `plugins/cases` | Private plugin (`fporoli/apensum-assessment`, cloned here): Gutachten / Assessments with client-side zero-knowledge AES-256-GCM encryption, interview audio transcription, and AI draft synthesis. |
| `plugins/expenses` | Private plugin (`fporoli/apensum-expenses`, cloned here): Multi-currency expense claims, receipt OCR, multi-tier approval workflow, and payroll exports. |
| `plugins/notes` | Bundled example plugin: personal notes, the smallest complete plugin to start a new module from (see its README). |
| `infra/liquibase` | The database schema's source of truth (see below). |
| `infra/postgres/seeds` | `seed.sql`: demo orgs/users/projects/project times/expenses. Run manually, separate from schema migrations. |
| `infra/keycloak` | Realm export (`realm-worktime.json`) imported on Keycloak startup. |
| `infra/caddy` | Environment-specific Caddyfiles plus the shared VPS edge proxy configuration. |
| `infra/vps` | `remote.sh`, the script the `vps` workflow runs on the server. |
| `infra/azure` | `provision.sh`, the Azure Container Apps provisioning phases. |
| `compose/docker-compose.{dev,local,vps}.yml` | Environment-specific stacks (see below). Azure has no compose file. |

**Compose stacks**

| File | What runs in Docker |
| --- | --- |
| `dev` | Postgres, migrations, Keycloak and Mailpit. API and web run on the host. |
| `local` | The full stack, including Caddy. |
| `vps` | One stack per instance (own Postgres, Keycloak, API, web) that joins the server's shared edge proxy network. |

#### Web (`apps/web/src`)

| Area | Files |
| --- | --- |
| Session and shell | `App.tsx` (session, org switcher, branding), `corePages.tsx` (pages and nav groups), `Login.tsx` (local + Keycloak SSO + invite-accept), `Home`, `NotificationBell`, `UserMenu` |
| My work | `WorkTime` (check-in/out), `Absences` (requests, approvals, calendar, RFC 5545 iCal/WebCal subscriptions), `Timesheet` (monthly working-time timesheet for the line manager), `MyData` (`BasicDataPanel`), `BalancesPanel` (overtime/vacation by month) |
| Projects | `ProjectTime` (hours per project), `ProjectTimesheet` (monthly submission to each project's owner) |
| Expenses | `Expenses`, `ExpenseReports`, `ExpenseProcessing` |
| Organization | `Approvals`, `BalanceReport` (Time balances with alerts), `Management` (teams/projects/subprojects), `Users` (`WorkSchedulePanel`, `Invitations` nested in submenu), `ImportExport` (Payroll exports, employee CSV onboarding), `OrganizationSettings` (`WorkTimeSettings`, `BrandingSettings`) |
| Admin | `AdminSettings` (static-data enums), `RolesPermissions`, `FormDesigner`, `AuditLog` |
| Form fields | `ConfigField`, `designMode.tsx` (configurable forms, see `docs/FIELD_CONFIG.md`) |
| AI | `Assistant` (chat) |
| Support modules | `auth.ts` (Keycloak client + token refresh), `aggregate.ts` (daily/weekly/monthly bucketing), `i18n.tsx` (en/de/fr/it) |

#### API (`apps/api/src`)

| Area | Controllers |
| --- | --- |
| Identity | `auth`, `users`, `basicdata`, `orgs`, `roles`, `permissions`, `fields` |
| Organization | `teams`, `projects` (+ subprojects) |
| Time | `work-time`, `absences`, `calendar-feed`, `work-schedules`, `timesheets`, `balances`, `project-time`, `project-timesheets` |
| Expenses | `expenses`, `expense-reports` |
| Cross-cutting | `workflows`, `import-export`, `static-data`, `audit`, `assistant`, `notifications` (+ WebSocket gateway) |

| Module | Role |
| --- | --- |
| `access.ts` | Authorization helpers every controller calls (`callerUserId`, `can`, `canSeeUserData`, period locks, …), resolved from the caller's validated JWT, never trusted from the request body. |
| `work-time-model.service.ts`, `balances.service.ts` | Daily targets (schedules, holidays, absences) and the monthly overtime/vacation balances. |
| `jwt.ts` / `jwt.guard.ts` | Validate local HS256 tokens and Keycloak-issued tokens (JWKS) behind one global guard. Routes opt out with `@Public()`. |
| `db.service.ts` | Wraps a single `pg.Pool` and exposes a typed Drizzle client via `getDb()`. |
| `db/schema.ts`, `relations.ts` | **Generated, not hand-written** (see Database below). |

### Request flow

1. The web app obtains a token (local HS256 login or Keycloak SSO, see `auth.ts`) and sends it as a bearer token on every call.\
   Each page calls the API directly under the global prefix `/api/v1`; there is no shared client layer or state store.
2. The global `JwtAuthGuard` validates the token (local secret or Keycloak JWKS) and attaches `req.user`.\
   Routes marked `@Public()` skip the guard.
3. The handler gets the Drizzle client from `DbService.getDb()`, resolves the caller's user id from the validated token (`callerUserId`), and checks access with the helpers in `access.ts`.\
   Every org-scoped handler does this itself; there is no central policy layer.
4. Writes go through Drizzle, then record history via `VersionsService.record(...)` (tables carry no `created_at`/`updated_at`) and, where relevant, create notifications and send best-effort mail.
5. Errors come back as data, not exceptions: `{ ok: false, error: 'kebab-code' }` on failure, `{ ok: true, ... }` on success, and empty shapes for reads the caller may not see.

### Multi-tenancy and authorization

- Data is partitioned by organization.\
  A user can belong to several organizations through `organization_memberships`, and the web app re-resolves the user's role whenever the org switcher changes.
- Roles are per organization, and a membership can hold several (`membership_roles`).\
  Access is decided by **permissions**, not role names: ids of the form `<object>:<action>:<scope>` (`nav.balances:see:reports`, `section.basicdata.personalien:edit:all`), catalogued in `packages/shared/src/permissions.ts` and granted to roles through `role_permissions`.\
  Global roles carry the defaults; an organization can customize a role (it gets its own copy) or create its own, under Admin settings -> Roles & permissions.
- Authorization helpers in `access.ts`:

  | Helper | Passes for |
  | --- | --- |
  | `isOrgMember` | Any member of the org |
  | `can` | Callers holding a permission (`edit` implies `see`) |
  | `canSeeUserData` / `listableUserIds` | Self, the person's designated manager, or a grant covering them |
  | `reachesAll` / `canEditBeyondOwn` | Grants covering everyone / admin-only overrides |
  | `isManagerOf` | The specific manager of a member |
  | `canManageItem` / `canManageTeamMembers` | Team leads and project owners (scope `own`) |
  | `isOrgDeveloper` | The organization's form designers |
- "Manager of X" is the manager named by X's employee assignment in force (`employee_assignments`, dated, with department and function), so approvals route to the member's own manager, not to any manager in the org.\
  When the manager changes, pending requests move to the new one.
- Time writes additionally check a period lock: work time and absences `isPeriodLocked` (the working-time timesheet month is submitted or approved), project time `isProjectPeriodLocked` (that project's month in the project timesheet).\
  A locked month is read-only until it is reopened.

### Domain areas

The API keeps these concerns separate; each has its own controller/service and tables:

| Area | What it is | Where |
| --- | --- | --- |
| Work time | Check-in/check-out attendance | `work-time.*` |
| Work-time model | Daily targets: work schedules, canton and org holidays, approved absences | `work-time-model.service.ts`, `work-schedules.controller.ts`, `packages/shared/src/worktime.ts` |
| Working-time timesheet | Monthly attendance and absences, approved by the line manager; approval closes the month's balance | `timesheets.controller.ts` |
| Balances | Overtime (minutes) and vacation (days), by month and year, with carry-over, adjustments and a monthly alert report | `balances.*` |
| Calendar feeds | RFC 5545 iCalendar / WebCal live subscriptions (Apple, Outlook, Google) with capability tokens, scope filtering (`personal`, `team`, `all`) and cantonal holidays | `calendar-feed.*` |
| Project time | Hours booked against projects and subprojects, independent of attendance | `project-time.*`, `projects.controller.ts` |
| Project timesheet | Each person's monthly hours per project, approved by the project's owner (for billing) | `project-timesheets.controller.ts` |
| Expenses | Expense items and expense reports (private plugin) | `plugins/expenses/api/*` |
| Import & Export | Swiss payroll exports (Abacus AbaSalary Lohnarten CSV, Bexio, Generic XLSX) and dry-run bulk employee CSV import | `import-export.*` |
| Basic data | Personal data with an HR change-request/approval history | `basicdata.*` |
| Static data | Admin-editable dropdown vocabularies | `static-data.controller.ts` |
| Audit | Version history of changed rows | `versions.service.ts`, `audit.*` |

### Approval workflows and notifications

Timesheets, expense reports, absences, and timesheet reopen requests all go through `workflows.service.ts`.\
A submission is routed to the requester's manager; a project timesheet goes to the project's owner instead (approved right away when the person owns the project or it has none).\
Each state change creates a notification through `notifications.service.ts`.\
That service persists the row and pushes it to connected clients over the WebSocket gateway at `/ws/notifications`, which the web app consumes via `useNotifications.ts` and `NotificationBell`.

### Calendar feeds and integrations

- **Absence Calendar Feeds (RFC 5545 / WebCal)**:
  - Subscribable feed endpoint: `GET /api/v1/calendar/absences/:token.ics` (accessible via capability tokens, no session cookie needed by calendar daemons).
  - Scope options: `personal` (own absences), `team` (direct reports for managers), `all` (entire organization, permission-gated).
  - Integrates Swiss cantonal public holidays and organization-specific holidays directly into external calendar apps.
  - Native 1-click WebCal subscription or copyable URL directly in the Absences view.
- **Swiss Payroll Export**:
  - **Abacus (AbaSalary)**: Semicolon-delimited CSV mapped to Swiss standard wage types (Lohnarten: 1000 standard hours, 1010/1020 overtime & Überzeit, 1200 vacation days, 1210/1220 sick leave/unpaid leave, approved expenses).
  - **Bexio**: Compatible CSV export format for Swiss SME accounting.
  - **Generic Excel (XLSX) & CSV**: Full monthly payroll summaries with totals.
- **No organization ZIP**: there is no export or restore of a whole organization.\
  Recovery, and a leaving customer's data, are the operator's: a database dump, the documents volume and `DOCUMENTS_KEY`.
- **Bulk Employee Onboarding**:
  - CSV import with automatic column alias detection (English, German, French, Italian).
  - Interactive dry-run validation preview highlighting errors (malformed dates, unknown managers, invalid workloads) before database commit.

### AI assistant

`assistant.service.ts` uses Azure OpenAI in Switzerland (the app's only AI provider), with tool-calling.\
Each question is one reservation in the AI budget (`AiBudgetService`, kind `assistant`), like Cases and receipt recognition.\
Every tool runs the same authorization as its REST equivalent, using the caller's real identity, so the assistant can never see or do more than the user could through the UI.\
Without Azure OpenAI (key, budget and prices) it returns `{ ok: false, error: 'assistant-not-configured' }`.

### Graceful degradation

The API is built to start and answer even when pieces are missing:

- Without `DATABASE_URL` it runs in offline mode (a startup warning is logged) and every endpoint, including login, returns `{ ok: true, offline: true }`.\
  This looks like success but does nothing.
- Mail is best-effort and never fails a request.
- The assistant degrades as described above.

### Schema ownership

Liquibase owns the schema and Drizzle owns the queries.\
Changelogs in `infra/liquibase/changelog/` are the source of truth.\
`schema.ts` and `relations.ts` are regenerated from the migrated database with `npm run db:introspect`, never edited by hand.\
Details are in the next section.

## Database: Liquibase (schema) + Drizzle (queries)

**Liquibase owns the schema.**\
`infra/liquibase/changelog/` holds one file per logical change (`001-initial-schema.sql`, `002-worktime-extensions.sql`, …), written as Liquibase's *formatted SQL* changelogs (plain SQL with `--changeset author:id` headers), listed in order by `db.changelog-master.xml`.\
Liquibase tracks exactly which changesets have run inside the database itself (`databasechangelog` table), so applying the changelog is always safe to repeat — this is what makes environments stay in sync instead of quietly drifting from whatever `schema.sql` happened to look like when a given database was first created.

Applying it uses the official `liquibase/liquibase` Docker image with the Postgres JDBC driver baked in (`infra/liquibase/Dockerfile` — the base image ships without a driver):
- **Compose environments**: the `migrate` service in every `compose/docker-compose.*.yml` runs it automatically before `api`/Keycloak start (`depends_on: migrate: condition: service_completed_successfully`).
- **Outside compose** (a host-run API, or CI): `npm run db:migrate` — a thin Node wrapper (`infra/liquibase/migrate.mjs`) that builds the image and points it at `$DATABASE_URL`.

**Drizzle owns the query layer**, typed against whatever Liquibase has applied.\
`apps/api/src/db/schema.ts` and `relations.ts` are generated by introspecting the live database — never hand-edit them.\
`scripts/ fix-introspected-schema.mjs` patches what `drizzle-kit introspect` gets wrong (Postgres's `citext` type, used by `users.email`/`organizations.slug`/ etc., has no built-in mapping; some `COALESCE(... ::uuid)` index expressions come out truncated) so the command stays a single, rerunnable step.

**Making a schema change:**
1. Add a new changelog file (e.g. `003-my-change.sql`) with its own `--changeset` header(s); add it to `db.changelog-master.xml`.
2. Apply it: `npm run db:migrate` (or let the `migrate` compose service do it on next `up`).
3. Regenerate types: `npm run db:introspect` (from `apps/api`, or `npm run db:introspect` at the repo root).
4. Update the controller(s) using the new/changed columns.

Never edit `schema.ts`/`relations.ts` by hand, and never edit an already- applied changelog file — Liquibase checksums each changeset and will refuse to reapply a modified one; add a new changeset instead.

Seed data (`infra/postgres/seeds/seed.sql`) is separate from schema migrations and stays manual: `npm run db:seed`.\
It is additive and safe to re-run: it adds missing demo rows and keeps demo data changed since.\
A deployed instance is never seeded by `deploy`: use the `vps` workflow's `seed` (additive) or `reset-seed` (clean slate), or the `azure` workflow's `seed` / `initdb`.

## Host ports (8090+N keycloak, 5430+N pg, 3000+N web, 8000+N api)

| Env | N | pg | keycloak | web | api |
|---|---|----|----------|-----|-----|
| dev (pg+kc in containers, api+web local) | 1 | 5431 | 8091 | 3001 | 8001 |
| local (all dockerized) | 2 | 5432 | 8092 | 3002 | 8002 |
| VPS instances (one stack each; only `pg` is published, on `127.0.0.1:PG_PORT`, reachable via SSH tunnel) | — | 5436 production, 5434 preprod, 5437 demo (configured per server) | edge | edge | edge |

Azure uses Container Apps ingress, not host ports.\
On the VPS the shared edge proxy routes each instance's three hostnames (`WEB_SUB`, `API_SUB`, `AUTH_SUB` under `DOMAIN`; production uses `app`, `api`, `auth` under `apensum.ch`, the demo `appdemo`, `apidemo`, `authdemo`) to its web, API and Keycloak containers.

## Dev and Local deployment

Each environment has its own env file: `.env.dev` (N=1) and `.env.local` (N=2), copied once from `env.example.dev.cfg` / `env.example.local.cfg`.\
The `dev:*` and `local:*` npm scripts load that file for you (`scripts/with-env.mjs`; the file's values win over your shell's), on macOS, Linux and Windows alike.\
The base scripts underneath (`db:migrate`, `db:seed`, `start`, …) read only the process environment; CI and the deploys call them with config from GitHub.\
`db:seed` refuses to run without `DATABASE_URL`, and the API logs an OFFLINE warning at startup without it.

| Script | Does |
| --- | --- |
| `dev:up` / `dev:down` / `dev:logs` | pg + migrate + Keycloak + Mailpit in Docker |
| `dev:api` | build and start the API (http://localhost:8001) |
| `dev:web` | Vite (http://localhost:3001) |
| `dev:migrate` / `dev:seed` / `dev:introspect` | database tasks against the dev database |
| `dev:checkschema` / `local:checkschema` | check that the committed `schema.ts` / `relations.ts` match that database (`resetdb` and CI run it after migrating) |
| `dev:status` / `local:status` | read-only Liquibase check: changesets pending, applied but missing from this checkout (database ahead or on another branch), or edited after they ran (checksum); exit 1 on any. `db:status` takes `DATABASE_URL`, so it works against any reachable database |
| `dev:psql` | psql into the dev database |
| `dev:resetdb` | **Destructive.** Drop and recreate the dev database's `public` schema, migrate, seed (Keycloak's `auth` schema is kept) |
| `local:up` / `local:down` / `local:logs` | the whole stack in Docker behind Caddy |
| `local:migrate` / `local:seed` / `local:introspect` / `local:psql` | database tasks against the local database |
| `local:resetdb` | **Destructive.** The same reset for the local database |

To run any other command with an environment loaded: `node scripts/with-env.mjs dev <command> [args...]`.

### One command for every environment

`npm run stack -- <env> <steps...>` (`scripts/stack.mjs`) does the usual round in any environment: `dev`, `local`, a VPS instance (`prod`, `preprod`, `test`, … = its GitHub Environment) or `azure`.\
Steps always run in the same order, whatever order you give them:

| Step | dev / local | VPS instance / azure (through the GitHub workflows, `gh` CLI) |
| --- | --- | --- |
| `push` | `git push` of the current branch (commit first) | the same, then the plugin repositories cloned into `plugins/` |
| `build` | dev: `npm run build`; local: build the Docker images | wait for `build-push` of HEAD (dispatched off `main`); on `main` the push's own build, built again only when its log shows an older commit of a plugin |
| `reset` | **Destructive.** `dev:resetdb` / `local:resetdb` | **Destructive**, asks you to type the environment name: VPS `reset-seed`, or with `start` one `deploy-reset` run (migrations once); Azure drops and re-creates the Postgres server (`dropdb` + `initdb` with seed) |
| `start` | dev: Docker services, then API + web on the host (Ctrl-C stops both); local: `local:up` | deploy HEAD's `sha-xxxxxxx` images (`vps` deploy / `azure-deploy`), before any reset |
| `stop` | `dev:down` / `local:down` | — |
| `all` | `push build start` | the same |

`all` does not reset or seed the database.\
Add `--reset` to explicitly include the destructive reset step (`npm run stack -- <env> all --reset`); the `prod` environment cannot be reset.

```sh
npm run stack -- dev reset start         # fresh demo data, API + web on the host
npm run stack -- local all               # push, rebuild images, whole stack up
npm run stack -- local all --reset       # also reset and seed the local database
npm run stack -- test push build start   # deploy HEAD to the test VPS
npm run stack -- prod all                # push, build and deploy; no reset
npm run stack -- preprod all --reset     # also reset-seed (asks first; --yes skips that)
```

The remote steps only trigger and follow the workflows; their config stays in GitHub Environments.

**dev** (pg + Keycloak + Mailpit in Docker, API + web on the host):

```sh
cp env.example.dev.cfg .env.dev        # once; Windows: copy
npm install
npm run dev:up                         # pg + migrate + keycloak + mailpit
npm run dev:seed
npm run build
npm test
```

Then run the API and web app on the host (separate terminals), or use the "Development Full Stack: API + Web" VS Code launch config:

```sh
npm run dev:api    # http://localhost:8001
npm run dev:web    # vite, http://localhost:3001
```

**local** (everything in Docker, behind Caddy):

```sh
cp env.example.local.cfg .env.local    # once
npm run local:up
npm run local:seed
```

### Demo accounts

The live demo at [https://appdemo.apensum.ch](https://appdemo.apensum.ch) as well as local dev builds show a demo-account dropdown on the login screen with Admin, Manager (Marta), HR User (Ulla), User (Ueli) and Team Lead (Marco); picking one signs in.\
Each seeded `<name>@acme.com` user's password is `<name>` (e.g. `admin@acme.com` / `admin`).\
Its entries are global static data (entity `login`, enum `demo_accounts`; each value a JSON string `{"name","user","password"}`), served by the public `GET /api/v1/auth/demo-accounts`.\
On the VPS the dropdown is controlled per instance by the `SHOW_DEMO_ACCOUNTS` variable (default `false`); the Azure image always shows them.\
The accounts exist only after a seed (`reset-seed` on the VPS).\
Otherwise provision real Keycloak accounts; the realm import does not create users.\
Cases is on for Acme with one encrypted demo case (KESB-2026-0142).\
Admin, Marta, Marco and Ulla open it with the Cases passphrase `<name>-cases-demo` (e.g. `marta-cases-demo`); `plugins/cases/seed.sql` is generated by `npx tsx plugins/cases/scripts/generate-demo-seed.mts`.\
Someone who set up their own Cases passphrase before keeps it, and the case stays locked for them until `reset-seed`.\
Invite token `dev-invite-0001` accepts an invitation as `invited@acme.com`.

## Roles

Default grants of the global roles (organizations can change them, see Multi-tenancy and authorization above):

- `user`: own work time, absences, timesheets, project time and data.
- `manager`: + their reports' data and approvals, balance report, invitations, teams, subprojects (only if project owner).
- `hr`: + everyone's personal data and balances, adjustments.
- `admin`: + static data, organization settings (name/domains/SSO, work time, branding), roles & permissions, audit read.
- `owner`: everything.

## Auth

Keycloak realm `worktime` (see `infra/keycloak/realm-worktime.json`).

## Email

The API sends mail via [nodemailer](https://nodemailer.com), configured from `SMTP_HOST/PORT/FROM/USER/PASSWORD/SECURE` (see `env.example.dev.cfg`).\
Sends are best-effort: a missing or misconfigured server never fails a request.

| Environment | Where mail goes |
| --- | --- |
| `dev` | Own [Mailpit](https://github.com/axllent/mailpit) catcher: SMTP `localhost:1025`, inbox UI `:8025`. The host-run API points at it via `.env.dev`. |
| `local` | Own Mailpit: SMTP `:1026`, inbox UI `:8026` (offset so both can run at once). The `api` container is wired to it in the compose file. |
| `vps` | Without `SMTP_HOST`, the instance's own Mailpit (`apensum-<env>-mailpit`). Set `MAIL_SUB` to publish its inbox at `<MAIL_SUB>.<DOMAIN>` behind basic auth (user `admin`). |
| `azure` | `SMTP_HOST` is unset by default, so mail silently no-ops. See below to use a real relay. |

Mailpit has no auth and nothing real is sent.

**Real relay (e.g. on Azure):** set `SMTP_HOST/PORT/FROM/USER` as environment variables and `SMTP_PASSWORD` as a secret (plus `SMTP_SECURE=true` for an implicit-TLS relay, typically port 465). nodemailer negotiates STARTTLS/AUTH itself, so any standard relay (SES, SendGrid, Mailgun, etc.) works without code changes.

**Endpoints that trigger mail or account flows**

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/auth/register` | Welcome mail |
| `POST /api/v1/organizations/:id/invite` | Org-invite mail |
| `POST /api/v1/auth/reset` | Forgot password: mails a 30-minute, one-time link if the address has a password login (always `ok`) |
| `POST /api/v1/auth/reset/confirm` | Sets the new password from that link's token |

## CI

`.github/workflows/ci.yml` builds, tests, and — against a throwaway Postgres service container — runs `db:migrate` then `db:seed`, so a broken changelog fails the build before it reaches any real environment.

## Monitoring

Outside: `.github/workflows/monitor.yml` checks every 10 minutes the targets in the repository variable `MONITOR_TARGETS` (a JSON list of `{ id, url, kind: health | page }`: each instance's `GET health`, its web app, the websites) and their TLS certificates (`scripts/monitor.mjs`, logic in `scripts/monitor-lib.mjs`).\
A check failing twice in a row (20 minutes, so a demo reset or a blip mails nobody), its recovery and a certificate within 14 days of its end are mailed to `OPERATOR_EMAIL` of the `prod` environment (else prod's sender address) through prod's SMTP; the state between runs is in the Actions cache.\
The check job holds no secret and its public log shows only public addresses and ok/failed; the alert job uses the `prod` environment only when there is something to send.\
GitHub runs scheduled workflows best effort, sometimes a few minutes late.

Inside: the API (`monitor.service.ts`, every hour, `MONITOR=off` disables it) reports to the operators, by mail and as a notification in the Admin organization, at most once a day each: free disk space under 10 % or 2 GB (also shown under Super Admin → Instance) and a failing mail relay (as a notification only, since mail does not get through then).

## Backups

`.github/workflows/backup.yml` backs up a VPS instance every night at 01:30 UTC and every hour from 04:00 to 19:00 UTC, so at most an hour of work is lost (prod; an environment without `BACKUP_S3_ENDPOINT` is skipped): the whole database (`pg_dump`, Keycloak's `auth` schema included) and the documents volume, as two objects `<stamp>-db.dump.age` and `<stamp>-documents.tar.age` under `BACKUP_PATH/<environment>/` in an S3-compatible bucket (e.g. MinIO on another server).\
On the server (`infra/vps/backup.sh`, sent over SSH) both are encrypted with the [age](https://age-encryption.org) public key `BACKUP_AGE_RECIPIENT` while they are read: the runner and the storage see only ciphertext, and nothing on the server can decrypt it.\
The runner moves the files (AWS CLI, path-style addressing); the server has no key for the storage, so a compromised server can't delete the backups.\
Kept: every backup of the 48 hours before the newest, then the newest of each of the 7 newest days, 4 newest weeks and 12 newest months (`scripts/backup-retention.mjs`).\
A backup does not stop the instance: `pg_dump` reads a consistent snapshot while people work.\
A failed run is mailed to `OPERATOR_EMAIL` (else the sender address) through the environment's SMTP.

On the 1st of each month the workflow tests the newest backup (`verify`): it restores it into a scratch database on the server, checks it and drops it, and reads the documents archive through.\
`restore` (manual, confirmation `RESTORE <environment>`, from main) replaces the instance's database and documents with a backup (input `backup` = its stamp, empty = the newest): restored next to the live database first, then swapped while the API and Keycloak are stopped; the database before stays as `worktime_before_<time>` (the next restore drops it), the documents before as a tar in `~/apensum-<env>-db-backups`.\
A backup of an older version is brought up to date by the next `deploy` (its migrations).\
The documents stay encrypted with `DOCUMENTS_KEY` inside the backup: a restore needs that key too.\
`verify` and `restore` send the private key to the server for the run only.\
There is no restore of one organization (its rows hang together with everyone's): restore a backup into a scratch database, look up what is needed and enter it again.

Setup, once per environment (keys made on your own computer, never pasted anywhere but GitHub and the storage).\
The storage belongs on another server than the instance, its API (MinIO: port 9000) behind TLS, its console (9001) not open to the internet.\
On the storage, a bucket and a user that may use only that bucket (MinIO client `mc`):

```sh
mc alias set backup https://<host>:9000 <root user>      # asks for the root password
mc mb backup/apensum-backups
cat > apensum-backup-policy.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"], "Resource": ["arn:aws:s3:::apensum-backups"] },
  { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::apensum-backups/*"] } ] }
EOF
mc admin policy create backup apensum-backup apensum-backup-policy.json
mc admin user add backup apensum-backup                 # asks for its secret key (a long random one)
mc admin policy attach backup apensum-backup --user apensum-backup
```

Then in GitHub:

```sh
age-keygen -o apensum-backup.age          # prints the public key (age1...); keep the file in a password manager
gh secret set BACKUP_AGE_KEY --env prod < apensum-backup.age
gh variable set BACKUP_AGE_RECIPIENT --env prod --body age1...
gh variable set BACKUP_S3_ENDPOINT --env prod --body https://<host>:9000
gh variable set BACKUP_S3_BUCKET --env prod --body apensum-backups
gh variable set BACKUP_PATH --env prod --body apensum-backups      # optional, the default
gh secret set BACKUP_S3_ACCESS_KEY --env prod --body apensum-backup
gh secret set BACKUP_S3_SECRET_KEY --env prod                      # asks for the user's secret key
```

`BACKUP_S3_REGION` is optional (default `us-east-1`, MinIO's).\
Then run the workflow by hand (`backup`, then `verify`).\
The first run installs `age` on the server (`sudo apt-get install age`, else it says to run it once).\
Without the age private key the backups can't be read: it is in the secret and in the password manager only.

## Two-step login

Everyone who signs in with a password can add a second step in Settings: a code from an authenticator app (scan the QR code, confirm one code), with ten one-time recovery codes for a lost phone.\
An organization's admin decides under Organization settings → Security who must use it: nobody, admins and HR (Admin settings, HR's employment data or the data export), or everyone; the Admin organization always requires it.\
An account spans organizations, so the rule applies at login: whoever an organization requires it of sets it up before getting in (sessions already running last until they end, at most 12 hours), and nobody can turn it off while it is required.\
No organization can turn off or reset someone's second step; for a lost phone without recovery codes the operator runs `twofactor reset <e-mail>` on the server (check who is asking first).\
SSO logins keep their identity provider's own second step.\
The authenticator secrets are encrypted with a key derived from `API_JWT_SECRET`: changing that secret leaves everyone with their recovery codes only.

```sh
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js twofactor status <e-mail>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js twofactor reset <e-mail>
```

## Operator

An organization's owners decide who is owner, admin and HR; an organization without an owner gets one from the instance's operator, who also gives the licenses of paid modules, on the server (no GitHub workflow: this repository's run logs are public).

```sh
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js owner list <slug or id>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js owner set <slug or id> <e-mail>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license list <slug or id>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license grant <slug or id> <module> [--until YYYY-MM-DD]
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js license revoke <slug or id> <module>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators list
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators grant <e-mail>
docker exec apensum-<env>-api node apps/api/dist/cli/operator.js operators revoke <e-mail>
```

An owner has to be an active member.\
A license runs through the day given; without one the module is off and its data stays, and the organization's admin switches a licensed module on.\
Every change is in the organization's audit log.

The operators (superusers) are the active members of one fixed organization, "Apensum Admin" (`OPERATOR_ORG_ID` in `packages/shared/src/operator.ts`, changelog 098).\
In it they see only the Super Admin pages (`SuperAdmin.tsx`, API `operator/*` in `operator.controller.ts`): Instance (what runs and is configured, counts; no people's data), Licenses (every organization with its members, owners and licenses, granted, changed and removed), AI limits (each organization's monthly limit and this month's spend, the instance budget), Product news (written, published, sent to the newsletter; organizations only read it), Default lists (the static data every organization starts from: operators add values and lists and change translations, a migration's values stay; `operator-static-data.controller.ts`) and Superusers.\
The whole app has a thick red frame while the Admin organization is selected.\
They have no right inside any other organization, and the pages never show people's data.\
Nobody joins the Admin organization through registration, invitations or roles: only `operators grant` above or an operator on the Superusers page makes someone one (an existing account; the last one stays), and each change is in the Admin organization's audit log.\
The first grant creates the organization.\
Each VPS instance, the public demo included, also gets its own operator account on every deploy and reset (`remote.sh` `ensure_operator`, CLI `operators ensure`): `OPERATOR_EMAIL` (GitHub Environment variable, default `admin@admin.local`) with the password of the GitHub Environment secret `OPERATOR_PASSWORD` (at least 8 characters; without it, nothing happens).\
It is created when missing, its password set to the secret each time, and it belongs to the Admin organization alone; the password never appears in a command line or the (public) run logs.
On servers `PUBLIC_API_URL` (the API host, set by the VPS compose file) keeps the links in newsletter mails and calendar feeds on the public API.

## Deploy

The `vps` and `azure` workflows are manual (`workflow_dispatch`) and take all their config from GitHub Environments (Settings > Environments), not from files on a server or laptop.\
`dev` and `local` keep using `.env.dev` / `.env.local`.

### VPS

**One GitHub Environment = one instance.**\
Production is the environment named `prod`; create another (e.g. `preprod`) to get a second instance, on the same server or another one: production (`wt`), `preprod` (`wtpp`) and `test` (`wttest`) can all run on one host.

**Dolphin and Whale performance fixture**: manually dispatch `test-simulation.yml` from the dedicated `test/dolphin-whale-simulation` branch.\
Choose `test` or `preprod`; preprod also requires the exact confirmation `SIMULATE preprod`.\
For example, from this repository run `gh workflow run test-simulation.yml --ref test/dolphin-whale-simulation -f environment=preprod -f confirmation='SIMULATE preprod'`, then check the run with `gh run list --workflow test-simulation.yml --branch test/dolphin-whale-simulation`.\
It does not reset or redeploy the stack, and refuses to seed if either tenant exists or either requested admin email is already in use.\
It bulk-loads synthetic historical records (including distinct projects), then uses the real API for employee submissions, manager rejections and approvals, and HR expense processing.\
The workflow reports row counts and three serial loopback timings per endpoint; those are not a concurrency or browser load test.\
The company admins are `admin@dolphin.com` and `admin@whale.com`, both with the test-only password `admin`; the selected HR, manager and employee logins use an ephemeral shared password. These accounts are not exposed to the public demo login list, and no existing account is granted tenant access.\
A failed run after the history commits can leave both tenants present; inspect the failed stage before any retry.\
The app supports year-end snapshots starting in 2000; earlier attendance and monthly balances remain in the fixture.

**Secrets**

| Name | Notes |
| --- | --- |
| `VPS_SSH_KEY` | Private key, no passphrase |
| `POSTGRES_PASSWORD` | Hex only, it goes into a URL |
| `KEYCLOAK_ADMIN_PASSWORD` | |
| `API_JWT_SECRET` | |
| `SMTP_PASSWORD` | Optional |
| `GHCR_TOKEN` | Optional, `read:packages`, only for private images |

**Variables**

| Name | Notes |
| --- | --- |
| `VPS_HOST`, `VPS_USER` | Server and deploy user |
| `PG_PORT` | This instance's Postgres loopback port; unique per server, e.g. 5434/5435/5436 |
| `DOMAIN` | e.g. `apensum.ch` |
| `WEB_SUB`, `API_SUB`, `AUTH_SUB` | e.g. `apppp`, `apipp`, `authpp` |
| `KEYCLOAK_ADMIN` | |
| `SHOW_DEMO_ACCOUNTS` | Optional, `true`/`false` |
| `TWO_FACTOR` | Optional, `off` turns two-step login off on the instance (set on demo and test; never on prod or preprod) |
| `RESET_BACKUP` | Optional, `false` skips the backup before `reset-seed` (set on demo, preprod, test; only prod is backed up) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_PATH`, `BACKUP_AGE_RECIPIENT` | Optional, the nightly backup (see Backups); secrets `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_AGE_KEY` |
| `DEMO_RESET_EVERY_HOURS` | Optional, demo only (`2`): the app warns before `demo-reset.yml` resets it and waits through the reset |
| `GHCR_USERNAME` | Optional |
| `SMTP_HOST/PORT/FROM/USER/SECURE` | Optional |
| `MAIL_SUB` | Optional, publishes the instance's Mailpit inbox at `<MAIL_SUB>.<DOMAIN>` |
| `PORTAINER_SUB` | Optional, Portainer hostname `<PORTAINER_SUB>.<DOMAIN>`, default `portainer`. Set it per server when servers share a `DOMAIN`, e.g. `portainerpp`. |

**Workflow actions.**\
Run the `vps` workflow from `main`, naming the environment and an `image_tag` (prefer a `sha-` tag over `latest`):

| Action | What it does |
| --- | --- |
| `deploy` | Ships the deploy files over SSH and runs `infra/vps/remote.sh`. |
| `portainer` | (Re)deploys Portainer, the Docker UI for the whole server, at `portainer.<DOMAIN>`. It is its own stack in `/opt/edge/portainer`, so instance deploys never touch it. Run it once per server, with any environment of that server (it uses that environment's `DOMAIN`). |
| `portainer-remove` | Takes Portainer down and keeps its data volume. |
| `destroy` | **Destructive.** Removes the instance (containers, its Postgres and volume, `/opt/apensum-<env>`, its Caddy site, and its database on a leftover `edge-pg` if there is one). A last dump stays in the deploy user's home. The shared edge stack and other instances stay. Confirmation text: `DESTROY <environment>`. |
| `seed` | Loads the demo data into a deployed instance, adding only what is missing: nothing is dropped, and demo data changed since (passwords, reporting lines) is kept. Use it after a release adds demo rows. It creates demo users with known passwords, so not for production. Confirmation text: `SEED <environment>`. |
| `reset-seed` | **Destructive.** Backs up and recreates the `public` schema, migrates, loads the demo data and checks a demo login. Needs the confirmation text. A new instance has no users until you run it once. |
| `deploy-reset` | **Destructive.** `deploy` and `reset-seed` in one run: the new images are pulled, the schemas dropped (backed up unless `RESET_BACKUP=false`), the new containers started (the migrations run once, on the empty database), then the demo data. Same confirmation text as `reset-seed`. The demo's scheduled reset takes its image from the newest `deploy` or `deploy-reset`. |

**What `remote.sh` does.**\
It derives everything instance-specific from the environment name:

- Containers (`apensum-<env>-api`, ...), Compose project and `/opt/apensum-<env>`.
- Its own Postgres (`apensum-<env>-pg`, role and database `worktime`, volume per Compose project), bound to `127.0.0.1:PG_PORT` on the server.
- Its own Caddy site at the three hostnames.
- Writes `compose/.env` and `/opt/edge/.env`, creates the `edge` network if missing and brings up the edge stack (`infra/caddy/edge`: just the Caddy shared by all instances) before the instance's `pg`, `mailpit`, `migrate`, `api` and Keycloak.

Other things to know:

- The server keeps no git checkout and no hand-edited config.
- One web image serves every instance: its API and Keycloak URLs are filled in when the container starts.
- Values must not contain a single quote.
- A leftover `edge-pg` (the old shared Postgres) is not used any more: remove it with `docker rm -f edge-pg`.

**Server prerequisites**

- Docker with the compose plugin.
- `VPS_USER` is in the `docker` group and owns `/opt/edge` and each `/opt/apensum-*` directory.\
  `remote.sh` creates a missing one with passwordless `sudo` (as `ubuntu` has on cloud images); without it, run `sudo install -d -o "$USER" /opt/apensum-<env>` once (and `sudo chown -R "$USER": /opt/edge /opt/apensum-*` after anything root created).
- DNS A records pointing at the server for the three hostnames, `<PORTAINER_SUB>.<DOMAIN>` (default `portainer`) and, if set, each `MAIL_SUB` hostname.
- Create the Portainer admin right after its first start: it locks itself after 5 minutes without one (an existing admin survives the move out of the edge stack, because the data volume is reused).

**Reaching an instance's Postgres.**\
It listens on the server's loopback only, so use an SSH tunnel:

```sh
ssh -N -L 5434:127.0.0.1:<PG_PORT> <VPS_USER>@<VPS_HOST>
```

Then connect a normal client to `localhost:5434` as role `worktime`, database `worktime`, with that environment's `POSTGRES_PASSWORD`.

### Website (apensum.ch)

The marketing website is `apps/site`: static pages in German, French, Italian and English, built by a dependency-free Node script (texts in `apps/site/src/i18n/<lang>.mjs`, templates in `src/pages.mjs`).\
`npm run site:dev` previews it on http://localhost:3010 with rebuilds on save.\
`apps/site/site.config.mjs` holds the demo link (`demoUrl`, every "Demo" button), the contact address and the operator for the legal notice: fill in its street and postcode/place before the first deploy, the deploy's strict build fails without them.\
An optional portrait for the About page goes in `static/assets/` (`about.photo`).

Deploy with the `site` workflow (Actions -> site -> Run workflow): `environment` picks the server (that GitHub Environment's `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`; it must already run a Apensum instance, for the shared edge Caddy), `domain` the hostname, `app_url` the optional "Log in" target, `contact_url` the contact form's API.\
For the main domain (`apensum.ch`) `infra/site/remote.sh` installs it at `/opt/edge/apensum-site` as its own Caddy container (`apensum-site`) and adds `apensum-site.caddy` to the edge, which gets the certificates for the domain and `www.` (both DNS records must point at the server).\
Any other host is a preview that runs next to it as `apensum-site-<first label>`, without `www.` and sent with `X-Robots-Tag: noindex`.\
For preprod: `domain` `wwwpp.apensum.ch`, `app_url` `https://apppp.apensum.ch`, `contact_url` `https://apipp.apensum.ch/api/v1/public/contact`, and the preprod variable `CONTACT_SITE_ORIGINS` `https://wwwpp.apensum.ch` (the API accepts only listed origins; its mail goes to preprod's Mailpit).\
Each deploy is a new release in `www/releases/`, switched atomically via `www/current`; `remove` takes it down.

### Azure environment

The `azure` GitHub Environment uses the same names as `azure.yml` lists (`AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID`, `POSTGRES_PASSWORD`, …).\
AI (assistant, Cases, receipts) is Azure OpenAI in Switzerland only: its key is repo-level, the budget and prices are Environment variables (`infra/azure/ai-provision.sh github`); they reach the API when `azure.yml` provisions the apps (`azure-deploy` only swaps images, so rerun the apps phase after changing them).\
Environment values override repo-level ones, so existing repo secrets keep working until you move them.

### Releases

Push a `v*` tag to cut a release (`git tag v1.2.0 && git push origin v1.2.0`).\
`build-push` then publishes images tagged `v1.2.0`, without moving `latest`; deploy them by passing that as `image_tag`.\
Every image also records its nearest tag (`git describe`, so `v1.2.0-3-g97d21cd` for a later commit on main), commit and commit date, which the app shows under the user menu's **Information** (web and API separately, since they are deployed as separate images).\
Images built before any tag exists show as untagged; host builds as local.

### Azure Container Apps

The apps run as Container Apps in a plain Consumption environment (no custom VNet, which would add an always-on load balancer): `worktime3-auth` (Keycloak), `worktime3-api`, `worktime3-web`, plus the `worktime3-migrate` and `worktime3-seed` jobs.\
Postgres is an Azure Database for PostgreSQL Flexible Server (Burstable B1ms, public endpoint open only to Azure services, TLS required, `citext`/`uuid-ossp` allowlisted via `azure.extensions`).\
`build-push` publishes the extra `migrate`, `seed`, `dbtools` and `web-azure` images; `web-azure` has the Azure hostnames baked in from the repo variables `AZURE_API_URL` / `AZURE_KEYCLOAK_URL`.

First deploy, from Git Bash with the Azure CLI logged into the target tenant:

```sh
cp infra/azure/env.example.azure.cfg infra/azure/.env.azure   # fill in
bash infra/azure/provision.sh base     # network, Postgres, storage, environment; prints gh commands
#   set the printed repo variables, then run build-push and wait for it
bash infra/azure/provision.sh apps     # migrations, keycloak, api, web
bash infra/azure/provision.sh seed     # optional demo data, fresh database only
bash infra/azure/provision.sh github   # deploy identity; prints gh secret commands
bash infra/azure/provision.sh secrets  # copies .env.azure to the secrets the azure-* workflows read
```

After that, `azure-deploy` (manual) runs migrations and rolls api/web to an image tag.\
Backups are Flexible Server's built-in daily ones (7 days).

Day-to-day operations are `provision.sh` phases.\
Run them from the Actions tab with the single `azure` workflow: pick an action from the dropdown.\
They run from `main` only, which is the one ref the deploy identity trusts.\
A code rollout is the separate `azure-deploy` workflow.

| Action | What it does |
|---|---|
| `freeze` | Stops the apps and Postgres. Storage is still billed, and Azure restarts a stopped server after 7 days, so re-run it before then. |
| `unfreeze` | Starts Postgres and the apps. |
| `deepfreeze` | Stops the apps, dumps the database to the `db-dumps` blob container, then deletes the Postgres server. The server is kept if the dump fails. |
| `deepunfreeze` | Recreates the server, restores the newest dump, starts the apps. |
| `dropdb` | Stops the apps and deletes the server with no dump. All data is lost; you must type the server name in `confirm`. |
| `initdb` | Creates an empty server, runs migrations, starts the apps. Refuses if a server exists. The `seed` checkbox also loads the demo data. |
| `seed` | Loads the demo data, fresh database only. |
| `apps` | Re-applies the app specs after a config or secret change. |

`base` and `github` have no workflow: they need more rights than the deploy identity has.\
`azure-deploy` needs a running database, so unfreeze first.

To reach the database from a laptop (psql, DBeaver, ...), open the firewall for your IP while you need it, and close it again afterwards:

```sh
az postgres flexible-server firewall-rule create -g <rg> -n <server> -r laptop \
  --start-ip-address <your ip> --end-ip-address <your ip>
az postgres flexible-server firewall-rule delete -g <rg> -n <server> -r laptop --yes
```

Connect to `<server>.postgres.database.azure.com` as `worktime` with `POSTGRES_PASSWORD` and `sslmode=require`.

## License

Apensum is free software under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).\
You may use, change and run it, including as a hosted service; if you offer a changed version to users over a network, you must make that version's source code available to them under the same license.

### Cases interviews (local MVP)

Enable **Cases** for the organization and use an account with case access.\
An interview can be saved without audio or a transcript.\
Attach or record up to 25 MB of WAV, MP3, M4A, WebM or Ogg audio, the most Azure OpenAI Whisper takes in one request (recording needs microphone permission and HTTPS or localhost; the recorder offers speech quality, 32 kbit/s for about 90 minutes, or high quality, 128 kbit/s for about 25 minutes).\
Only users who can see that case can play its audio; only editors can replace it.\
Audio uses the local DocumentsService store; set `DOCUMENTS_KEY` for encryption at rest.\
Transcript and summary are stored in Postgres, not in the encrypted file store.\
Back up the database and local audio store together.\
With `local` Compose, audio persists in the `api-documents` volume; `docker compose down -v` removes it.

A case document's text (used by the assessment drafts) is read on upload when the text field is left empty: plain text as is, a PDF's text layer with `unpdf` (pdf.js, `case-document-text.ts`).\
A scanned PDF has no text layer and gives nothing (there is no OCR); the page then asks for the text by hand.

Transcription is Azure OpenAI Whisper (Switzerland North, `azure-transcribe.ts`) and **on by default** wherever the instance has Azure configured (`AZURE_OPENAI_*`, `AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT`, `AI_MONTHLY_BUDGET_CHF` and the prices; `infra/azure/ai-provision.sh local` fills `.env.dev`).\
Every call goes through the AI budget: the instance's monthly cap and the organization's limit.\
Whoever edits Organization settings can switch it off (Organization settings -> AI and costs); without Azure on the instance the interview page says transcription is not set up.\
There is no self-hosted transcription.

Transcription runs only when an editor requests a draft.\
Confirm or edit the draft before saving.\
The independent summary action extracts passages from a saved, current transcript; it does not invent conclusions or use an LLM.\
Review drafts for accuracy and context.\
Replacing audio preserves existing text but flags it for review; changing the transcript flags its saved summary.\
Stale text is not reused in new assessment drafts.\
Existing assessments are not rewritten.\
Email links to interviews are not part of this MVP.
