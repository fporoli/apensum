# Apensum — Modular Swiss Business Framework & Enterprise Suite

**Apensum** is a modular enterprise business framework and application suite engineered specifically for Swiss labor law (ArG) and enterprise requirements.\
It combines a robust time-tracking and organizational core with an extensible plugin architecture, business modules as plugins (Spesen/Expenses, Gutachten/Assessments and HR processes in private repositories; Notes, an open example plugin, bundled), and a high-performance marketing website.

Built with **NestJS** (API), **React 18 + MUI + Vite** (Web & PWA), **Postgres**, optional single sign-on through **Dex** or **Keycloak** (OIDC), and **Caddy** (edge reverse proxy).\
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
    |                                          |
    | optional SSO (OIDC code flow + PKCE)     | verifies the ID token once,
    v                                          v issues its own session token
  Dex or Keycloak (one per instance, SSO_PROVIDER; none by default)

Caddy fronts web, API (and Dex) in the `local` Compose environments. The VPS
stack uses the shared edge Caddy; `dev` accesses its host-run API and web app
directly.
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
| `infra/keycloak` | Realm export (`realm-worktime.json`) imported on Keycloak startup (VPS instances with `SSO_PROVIDER=keycloak`, Azure). |
| `infra/dex` | Dex configs for trying single sign-on on dev and local (Dex's test login); VPS instances get theirs from `remote.sh`. |
| `infra/caddy` | Environment-specific Caddyfiles plus the shared VPS edge proxy configuration. |
| `infra/vps` | `remote.sh`, the script the `vps` workflow runs on the server. |
| `infra/azure` | `provision.sh`, the Azure Container Apps provisioning phases. |
| `compose/docker-compose.{dev,local,vps}.yml` | Environment-specific stacks (see below). Azure has no compose file. |

**Compose stacks**

| File | What runs in Docker |
| --- | --- |
| `dev` | Postgres, migrations and Mailpit (Dex with the `dex` profile). API and web run on the host. |
| `local` | The full stack, including Caddy. |
| `vps` | One stack per instance (own Postgres, API, web, Dex or Keycloak if chosen) that joins the server's shared edge proxy network. |

#### Web (`apps/web/src`)

| Area | Files |
| --- | --- |
| Session and shell | `App.tsx` (session, org switcher, branding), `corePages.tsx` (pages and nav groups), `Login.tsx` (password, single sign-on, invite-accept), `Home`, `NotificationBell`, `UserMenu` |
| My work | `WorkTime` (check-in/out), `Absences` (requests, approvals, calendar, RFC 5545 iCal/WebCal subscriptions), `Timesheet` (monthly working-time timesheet for the line manager), `MyData` (`BasicDataPanel`), `BalancesPanel` (overtime/vacation by month) |
| Projects | `ProjectTime` (hours per project), `ProjectTimesheet` (monthly submission to each project's owner) |
| Expenses | `Expenses`, `ExpenseReports`, `ExpenseProcessing` |
| Organization | `Approvals`, `BalanceReport` (Time balances with alerts), `Management` (teams/projects/subprojects), `Users` (`WorkSchedulePanel`, `Invitations` nested in submenu), `ImportExport` (Payroll exports, employee CSV onboarding), `OrganizationSettings` (`WorkTimeSettings`, `BrandingSettings`) |
| Admin | `AdminSettings` (static-data enums), `RolesPermissions`, `FormDesigner`, `AuditLog` |
| Form fields | `ConfigField`, `designMode.tsx` (configurable forms, see `docs/FIELD_CONFIG.md`) |
| AI | `Assistant` (chat) |
| Support modules | `auth.ts` (single sign-on: OIDC code flow with PKCE, `oidc-client-ts`), `aggregate.ts` (daily/weekly/monthly bucketing), `i18n.tsx` (en/de/fr/it) |

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
| `jwt.ts` / `jwt.guard.ts` | Session tokens are local HS256 tokens, checked by one global guard (routes opt out with `@Public()`); `jwt.ts` also verifies an SSO provider's ID token (JWKS) for the one-time exchange. |
| `db.service.ts` | Wraps a single `pg.Pool` and exposes a typed Drizzle client via `getDb()`. |
| `db/schema.ts`, `relations.ts` | **Generated, not hand-written** (see Database below). |

### Request flow

1. The web app obtains a token (a local HS256 token from the password login, or from `auth/sso/exchange` after single sign-on, see `auth.ts`) and sends it as a bearer token on every call.\
   Each page calls the API directly under the global prefix `/api/v1`; there is no shared client layer or state store.
2. The global `JwtAuthGuard` validates the token (local secret) and attaches `req.user`.\
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
- **Compose environments**: the `migrate` service in every `compose/docker-compose.*.yml` runs it automatically before `api` (and Keycloak) start (`depends_on: migrate: condition: service_completed_successfully`).
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

## Host ports (8090+N single sign-on, 5430+N pg, 3000+N web, 8000+N api)

| Env | N | pg | Dex (profile `dex`) | web | api |
|---|---|----|----------|-----|-----|
| dev (pg in a container, api+web local) | 1 | 5431 | 8091 | 3001 | 8001 |
| local (all dockerized) | 2 | 5432 | 8092 | 3002 | 8002 |
| VPS instances (one stack each; only `pg` is published, on `127.0.0.1:PG_PORT`, reachable via SSH tunnel) | — | 5436 production, 5434 preprod, 5437 demo (configured per server) | edge | edge | edge |

Azure uses Container Apps ingress, not host ports.\
On the VPS the shared edge proxy routes each instance's three hostnames (`WEB_SUB`, `API_SUB`, `AUTH_SUB` under `DOMAIN`; production uses `app`, `api`, `auth` under `apensum.ch`, the demo `appdemo`, `apidemo`, `authdemo`) to its web and API containers and, when it has single sign-on, to Dex or Keycloak.

## Dev and Local deployment

Each environment has its own env file: `.env.dev` (N=1) and `.env.local` (N=2), copied once from `env.example.dev.cfg` / `env.example.local.cfg`.\
The `dev:*` and `local:*` npm scripts load that file for you (`scripts/with-env.mjs`; the file's values win over your shell's), on macOS, Linux and Windows alike.\
The base scripts underneath (`db:migrate`, `db:seed`, `start`, …) read only the process environment; CI and the deploys call them with config from GitHub.\
`db:seed` refuses to run without `DATABASE_URL`, and the API logs an OFFLINE warning at startup without it.

| Script | Does |
| --- | --- |
| `dev:up` / `dev:down` / `dev:logs` | pg + migrate + Mailpit in Docker (Dex with `COMPOSE_PROFILES=dex`) |
| `dev:api` | build and start the API (http://localhost:8001) |
| `dev:web` | Vite (http://localhost:3001) |
| `dev:migrate` / `dev:seed` / `dev:introspect` | database tasks against the dev database |
| `dev:checkschema` / `local:checkschema` | check that the committed `schema.ts` / `relations.ts` match that database (`resetdb` and CI run it after migrating) |
| `dev:status` / `local:status` | read-only Liquibase check: changesets pending, applied but missing from this checkout (database ahead or on another branch), or edited after they ran (checksum); exit 1 on any. `db:status` takes `DATABASE_URL`, so it works against any reachable database |
| `dev:psql` | psql into the dev database |
| `dev:resetdb` | **Destructive.** Drop and recreate the dev database's `public` schema, migrate, seed (an `auth` schema, Keycloak's, is kept) |
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

**dev** (pg + Mailpit in Docker, API + web on the host):

```sh
cp env.example.dev.cfg .env.dev        # once; Windows: copy
npm install
npm run dev:up                         # pg + migrate + mailpit
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
Otherwise accounts come from registering, invitations or single sign-on.\
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

The API keeps the accounts and issues every session: password login (with optional two-step login), registration, invitations and password reset are its own.\
Single sign-on, two-step login and the operator are described in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## CI

`.github/workflows/ci.yml` builds, tests, and — against a throwaway Postgres service container — runs `db:migrate` then `db:seed`, so a broken changelog fails the build before it reaches any real environment.

## Operations

Running and deploying an instance is in [docs/OPERATIONS.md](docs/OPERATIONS.md): single sign-on, e-mail, monitoring, backups, two-step login, the operator, deploys to a VPS, moving an instance, the website, Azure, releases, and the cases interviews.\
Setting up a server is in [docs/SERVER_SETUP.md](docs/SERVER_SETUP.md).

## License

Apensum is free software under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).\
You may use, change and run it, including as a hosted service; if you offer a changed version to users over a network, you must make that version's source code available to them under the same license.

The core is also available under a commercial license (dual licensing), for those who cannot or will not meet the AGPL's conditions:\
modules of their own that stay confidential while others use them (customers, clients, the companies of a group), Apensum run under another name (white label), or operation for third parties without publishing changes.\
The commercial license comes with support and commitments on the plugin contract (`PLUGIN_API_VERSION`, [docs/PLUGINS.md](docs/PLUGINS.md)); ask through the [contact form](https://apensum.ch/de/kontakt/).

The optional modules (Assessments, Expenses, HR, HR plus, Customer invoicing, Reporting office, Shift plan) are not part of this repository and not open source; they are licensed separately.

Contributions to the core are welcome under the [Contributor License Agreement](docs/CLA.md), which keeps the dual licensing possible; see [CONTRIBUTING.md](CONTRIBUTING.md).
