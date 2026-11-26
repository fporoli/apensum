# CLAUDE.md

Modular Swiss Business Framework & Enterprise Suite: NestJS API (`apps/api`), React 18 + MUI + Vite web (`apps/web`), static marketing site (`apps/site`), extensible plugins (`plugins/<id>`, e.g. `cases`, `expenses`), Postgres, optional single sign-on through Dex or Keycloak (`SSO_PROVIDER`, none by default), Caddy edge proxy. npm workspaces, Node >= 24.\
`README.md` covers architecture and development, `docs/OPERATIONS.md` operations and deploys, `docs/dev/` each area (see below); `docs/PLUGINS.md` covers plugin authoring; `docs/BUILD_PROMPT.md` holds the product spec and architectural rules; `docs/DATABASE_SCHEMA.md` describes the tables; `docs/CASES_ENCRYPTION.md` details the zero-knowledge dossier envelope encryption.

## Commands

Run from the repo root unless noted.

```sh
cp env.example.dev.cfg .env.dev   # once; Windows: copy
npm install
npm run dev:up             # Docker: pg + migrate + mailpit (+ dex with COMPOSE_PROFILES=dex)
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
npm run stack -- <env> <push|build|reset|start|stop|all> [--reset]   # all excludes reset unless opted in; push includes the plugin repos; VPS start+reset = one deploy-reset run
node scripts/plugins.mjs build # build all plugins (plugins/*/api -> dist/api)
node scripts/plugins.mjs test  # run all plugin test suites
```

`npm run site:deploy -- [site|sitepp|all] [--remove]` (`scripts/site-deploy.mjs`) dispatches the `site` workflow for apensum.ch (prod) and/or the wwwpp.apensum.ch preview (preprod) and waits for it; it deploys what is pushed.\
`scripts/stack.mjs` wraps the scripts above for dev/local and only dispatches/follows the GitHub workflows (`gh`) for VPS instances and Azure; keep deploy logic in the workflows.

Single API test file: `cd apps/api && NODE_PATH=./node_modules npx tsx --conditions=source --test ../../test/api/orgs.test.ts` (`--conditions=source` makes `@worktime3/shared` resolve to its TypeScript sources).

Environments: **dev** (N=1, `.env.dev`, `compose/docker-compose.dev.yml`) runs only pg/Mailpit in Docker (Dex on 8091 with the `dex` profile), with the API and web on the host: pg 5431, web 3001, API 8001, Mailpit SMTP 1025 / inbox UI 8025.\
This is the day-to-day setup.\
**local** (N=2, `.env.local`) runs everything in Docker behind Caddy on 5432/8092 (Dex, profile `dex`)/3002/8002.\
The VS Code "Development …" launch configs debug the host-run API and web against `.env.dev` (the API launch first stops a leftover Node API on 8001, `scripts/free-port.mjs`; Chrome waits for the fresh API, `scripts/wait-for-api.mjs`); "Local Full Stack: Docker + Chrome" brings up the local compose stack (task `local: stack up`) and opens Chrome on 3002.\
Host processes must not run on local's ports, which Caddy holds.

The base npm scripts (`db:migrate`, `db:seed`, `db:introspect`, `build`, `start`) are environment-agnostic: they read config only from the process environment, never from an env file, because CI and the VPS/Azure deploys run them with config from GitHub Environments.\
The `dev:*` / `local:*` scripts are thin wrappers for local development: `scripts/with-env.mjs <dev|local> <cmd>` loads `.env.dev` / `.env.local` (file values win over the shell's, `PG*` derived from `POSTGRES_*`) and runs a base script or `docker compose`.\
Add new local conveniences that way; never make CI, workflows or deploy scripts depend on them or on `.env` files.\
`db:seed` exits if `DATABASE_URL` is unset.\
The API still starts without it, in offline mode (logged as a WARNING at startup), and every endpoint, including login, then returns `{ ok: true, offline: true }`.\
That looks like success but does nothing.


## Tests

- Most tests are API tests in `test/api/*.test.ts`, using `node:test` + `node:assert`, run through `tsx` from the `apps/api` workspace.\
  No Nest boot, no database: controllers are constructed directly with hand-rolled mock `DbService`/service objects (see `project-time-auth.test.ts`), and pure helpers exported from controllers/services are tested directly (`nextMonthStart`, `isValidEmail`, `vacationDebitMinutes`, …).
- Some tests mirror logic instead of importing it (`rbac.test.ts`, `project-time.test.ts`).\
  Prefer importing the real function.
- Several tests do `import type { AuthenticatedRequest } from '../../apps/api/src/types'`, which does not exist (the type lives in `jwt.guard.ts`).\
  It works only because tsx strips type-only imports; use `jwt.guard` in new tests.
- `apps/web` and `packages/shared` tests are `src/*.test.mjs` run by `node --test`; they can import plain `.ts` files (Node strips types) but not `.tsx`.
- CI (`.github/workflows/ci.yml`) builds, tests, then runs `db:migrate` and `db:seed` against a fresh Postgres 16, so a broken changelog or seed fails CI.

## Database: Liquibase owns schema, Drizzle owns queries

- Schema changes go in a **new** file in `infra/liquibase/changelog/` (`NNN-description.sql`, formatted SQL with `--changeset author:id` headers), added to `db.changelog-master.xml`.\
  Never edit an existing changeset; Liquibase checksums them.
- Then run `npm run dev:migrate` and `npm run dev:introspect` (drizzle-kit 0.31, matching drizzle-orm 0.45), and commit the generated files (also a plugin's `api/db/schema.ts` for the tables its manifest lists in `apensum.tables`, or of the Postgres schema it owns, `apensum.dbSchema`; `scripts/plugin-schemas.mjs`).\
  `db:checkschema` (`apps/api/scripts/check-schema.mjs`) introspects into a scratch folder and compares, ignoring table/line order (which follows the database's history); `resetdb` runs it after migrating and CI fails on a mismatch.
- `apps/api/src/db/schema.ts` and `relations.ts` are **generated**.\
  Never hand-edit them.\
  `scripts/fix-introspected-schema.mjs` patches what drizzle-kit gets wrong after introspection (`citext` columns, truncated `COALESCE(... ::uuid)` index expressions); extend it rather than editing the output.
- The seed (`infra/postgres/seeds/seed.sql`) is separate from migrations and must run cleanly on a freshly migrated database, which CI checks.\
  Insert parents before children (e.g. `users` before `organizations`, which references them), and use `ON CONFLICT DO NOTHING` for rows that migrations already insert (system roles, permissions, some `static_data`).
- To reset a database, drop and recreate the `public` schema, then `db:migrate` and `db:seed` (`npm run dev:resetdb` / `local:resetdb` does all three, localhost only).\
  Don't just truncate: that deletes the reference data the migrations insert.\
  Keycloak's tables (instances with `SSO_PROVIDER=keycloak`) live in the `auth` schema; leave it alone.
- Regular tables have no `created_at`/`updated_at` columns.\
  Record history through `VersionsService.record(table, id, action, actorUserId, row)` after writes (fire-and-forget with `.catch(() => {})`), not with timestamp columns.

## API conventions (`apps/api/src`)

- Flat layout: `name.controller.ts` / `name.service.ts`, one controller per resource, all registered in `app.module.ts` (add new controllers and providers there).\
  Global prefix `api/v1`.
- **Every org-scoped handler authorizes itself**, using helpers from `access.ts`:
  1. `const db = this.db.getDb(); if (!db) return <offline/empty shape>;`
  2. `const userId = req.user ? await callerUserId(db, req.user) : null;` Never trust a user id from the body or query for the caller.
  3. Gate with permissions (below) via `can` / `canSeeUserData` / `listableUserIds` / `reachesAll` / `canEditBeyondOwn` / `canEditUserData`, plus `isOrgMember`, `isManagerOf`, `isSuperDeveloper`.\
     Projects & Teams uses `canManageItem` (scope `own` = teams you lead, projects you own).\
     Don't add checks on role names; `isOrgDeveloper` (form design) is the one left.
  4. Work-time and absence writes check `isPeriodLocked` (working-time timesheet month submitted/approved); project-time writes check `isProjectPeriodLocked` (that project's month in the project timesheet).
- Errors are returned, not thrown: `{ ok: false, error: 'kebab-code' }` (e.g. `forbidden`, `period-locked`, `unknown-user`); success is `{ ok: true, ... }`.\
  Read endpoints return empty shapes on denial.
- Degrade gracefully: no `DATABASE_URL` means offline/empty responses; mail (`mailer.ts`, nodemailer) is best-effort and never fails a request (failures are logged; the startup `verifySmtp` and each send set `smtp` in the public `GET health`); the assistant returns `{ ok: false, error: 'assistant-not-configured' }` without Azure OpenAI (key, budget and prices).

## Web conventions (`apps/web/src`)

- Flat folder of PascalCase page components.\
  Each page is an entry in `corePages.tsx` (section, hash, permission object, role fallback, navbar entry with optional parent and count, render), the same shape plugins use (`PluginPage`); `App.tsx` builds the navbar (`navigation.ts`), hashes and gating from the core's and the plugins' entries alike and owns session, org switcher and badges.
- Each page calls the API directly with `fetch(\`${API}/...\`, { headers: await authHeaders() })`, where `const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1'` is declared per file.
- Terms (one thing, one word, in the app, on the website, in the brochures and the support articles; new texts use only these):\
  **Flow** (der Flow, die Flows; FR le flow, IT il flow) = everything someone starts and others work on (an absence, an expense report, a timesheet, a request of the organization's own type); never Anfrage, Anliegen, Workflow or Freigabe for the thing.\
  **Art** (type) = what kind of flow, an organization's own one is a **Flow-Art** (FR type de flow, IT tipo di flow, EN flow type), added and renamed in the Flow-Designer (`PUT organizations/:orgId/flow-types/:key`, `withFlowType`, into the organization's copy of static data `flows`/`flow_type`); **Free Flow** (so in every language) = one without set steps, to the manager or a department; **Schritt** (step), **Baustein** (block), **Verlauf** (history).\
  **Flows** is the one page (`Flows.tsx`, `#/flows`, tabs Zu erledigen / Meine / Erledigt, "Neuer Flow" = a menu of the types with set steps, then a Free Flow to the manager or a department (`ComposePreset`); `#/approvals` and `#/requests?id=` open it); **Flow-Designer** is where the owner (or a role given `section.admin.workflows`) sets up the types and their steps (Admin settings).\
  The code says flow too (110/111): tables `flows`, `flow_messages` (attachments: `documents` naming the message), module `flows`, object `nav.flows`, kind `flows.flow` (definitions `flow:<type>`), forms `flow`/`flow.<type>`, static data `flows`/`flow_type`, texts `flow.*`, `FlowsService` in the plugin contract (PLUGIN_API_VERSION 3); a Free Flow is a row of `flows`.\
  What stays: the engine `workflows`, the Flows page's object `nav.approvals`, `requester` (whoever started a flow), `REQUEST_ALERTS`, and the hash `#/requests?id=` of mails already sent (it opens the Flows page).\
  The page's list is its own (`flowRows.ts`: requests and workflow items of the tab, a request's workflow item once, newest first, filter by type and search); the right side shows a flow's thread (`FlowDetail` `embedded.detailOnly`) or one workflow item as a card (`Approvals` `embedded.onlyId`), and the request forms' design mode and the new-flow dialog come from `FlowDetail` `embedded.designOnly`.\
  A flow with set steps shows them one under the other (`flowSteps.ts`, from the thread's step events since the last submission: done by whom and when, the current one with who did it so far and who is missing, sent back, skipped, to come).\
  `dictionaries.test.mjs` keeps to it: no German text says Anfrage, Anliegen or Workflow, no language says workflow (the assistant's requests to the AI excepted); the configured steps of a type are its Ablauf ("set steps"), the block `review` is Prüfen; Admin settings -> Workflows is the page titled Flow-Designer.
- Texts go through `const t = useT()` from `i18n.tsx`.\
  When you add a key, add it to all four dictionaries in `dictionaries.ts` (en/de/fr/it); `dictionaries.test.mjs` fails on missing keys or mismatched `{{placeholders}}`.
- Format dates, times and numbers with the app's `locale` from `useI18n()`, never the browser default (`toLocaleDateString()` with no argument), and in its Swiss variant: the `localeFormat.ts` helpers do it, direct `Intl`/`toLocale*` calls pass `swissLocale(locale)` (`de` -> `de-CH`: 2'848.77, 17.11.2026).\
  `locale` itself stays the language key (texts, labels).\
  Date pickers use dayjs `de-ch`/`fr-ch`/`it-ch` and a Swiss English `en-ch` (`ConfigField.tsx`).
- Tables search and sort through `TableView.tsx` (`useTableView(id, rows, columns)`, `SortHeader`, `TableSearch`; rules in `tableRows.ts`: every word in any searched column without case or accents, numbers as numbers, texts by the language with numbers in them, empty cells last, a third click back to the table's own order; kept per table in sessionStorage; in the plugin contract): use it for lists that grow (people, documents, records), not where the order is the point (a day's sessions, a week, a month's balances); a table the server pages through searches on the server instead.
- Buttons are the app's `Button` (`./Button`; plugins `@worktime3/web/plugin`), not MUI's: it adds the organization's colorful look (`docs/dev/FEATURES.md`).\
  A button's text comes from a key that names its action (`.save`, `.cancel`, `.delete`, `.send`, ... in `colorful.ts`), so it gets the right icon.
- Show API errors to the user.\
  Don't apply changes optimistically and then revert them silently.
- Re-resolve the user's role when they switch organizations.\
  Never cache one global role.

## Rules that apply everywhere

The areas are described in `docs/dev/` (below); these rules hold in all of them.

- Security baseline (`docs/dev/ACCESS.md`):\
  sessions are minted only by `mintSessionToken` (`session-state.ts`), which puts the password's stamp `pv` in the token; the guard and the WebSocket check it (`sessionHolds`), and a password reset calls `forgetSessions`.\
  Logins and registrations are limited (`password-reset.ts`), CORS goes to known origins only (`cors.ts`), the edge Caddy sends a strict CSP (never add inline scripts; a new origin the app talks to goes into its CSP).\
  `sql.raw` gets only text written in the code (`test/api/sql-raw.test.ts`); every org-scoped handler calls an access helper (`test/api/handler-auth.test.ts`).
- Permissions: no checks on role names.\
  A new object about other people's data is granted to HR and, by reporting line, to managers, never to admin, developer or owner.\
  Only an owner gives or takes owner, admin, hr, billing_admin and an organization's own roles, and only an owner changes what a role may do.\
  Operators are the members of the Admin organization and get only the Super Admin pages.\
  There is no impersonation: nobody gets a token of someone else's account.
- The audit log says that something happened, never what it says: no notes, reasons, file names or values of people's data in its metadata.\
  An invitation's link goes only to the invited address by mail, never into a response, log or history.\
  Ids from a request body (documents, people, rows) are checked against the organization and the caller before they are used.
- Documents are read only through `DocumentsService.read`/`send` (encrypted at rest with `DOCUMENTS_KEY`).\
  There is no ZIP export or restore of an organization: don't add one.
- AI is Azure OpenAI in Switzerland only, every call through `AiBudgetService`; assistant tools call the controllers, so they check what the caller may do (`docs/dev/AI.md`).\
  Cases data is end-to-end encrypted: never read, log or index an encrypted row's fields on the server, never store a passphrase or key (`docs/dev/CASES.md`, `docs/CASES_ENCRYPTION.md`).
- Holidays are counted per person (their location's), never from the organization's region alone (`docs/dev/TIME.md`).
- Modules can be switched off per organization and licensed modules need a license; the core must work without plugins, and a plugin imports the core only through the `plugin` contracts (`docs/dev/MODULES.md`, `docs/PLUGINS.md`).
- ntfy pushes to the operator never carry personal data.
- What the website says must match the app (`docs/dev/WEBSITE.md`).
- `seed.sql` stays re-runnable: fixed keys on every row, `ON CONFLICT DO NOTHING`, UPDATEs that only fill in unset values (`docs/dev/DEMO_DATA.md`).

## Where each area is described

| File | What it covers |
| --- | --- |
| `README.md` | Overview, architecture, development, roles |
| `docs/OPERATIONS.md` | Single sign-on, mail, monitoring, backups, two-step login, operators, deploys, VPS, Azure, the website's deploy |
| `docs/dev/ACCESS.md` | Sign-in and sessions, SSO, two-step login, invitations, operators, the permission catalogue, roles, reporting lines |
| `docs/dev/FLOWS.md` | Domain terms, the workflow engine, configurable workflows, static data, Free Flows and flow types |
| `docs/dev/TIME.md` | Work-time model, holidays, balances and year-end closing, vacation rules, the two timesheets, import/export |
| `docs/dev/FEATURES.md` | Field configuration, modules, news, documents, directory, avatars, mail forwarding, personnel file, reports, setup checklist, branding |
| `docs/dev/MODULES.md` | The plugin system and each plugin: billing, hrplus, whistle, notes, expenses |
| `docs/dev/AI.md` | Azure OpenAI, the budget, the assistant and its tools |
| `docs/dev/CASES.md` | The cases plugin and its encryption |
| `docs/dev/DEMO_DATA.md` | The seed's organizations, people and generated history |
| `docs/dev/ENVIRONMENTS.md` | Compose files, VPS instances, the demo's reset, Keycloak |
| `docs/dev/WEBSITE.md` | apensum.ch: pages, chatbot, contact form, newsletter |

Read the file of the area you change before changing it, and keep it up to date in the same commit.

## Other

- Markdown docs (README.md, CLAUDE.md, docs/*.md): every sentence is on its own line, never wrapped in the middle.\
  A sentence followed by another in the same paragraph or list item ends with a backslash (a Markdown hard line break), so the preview breaks there too.\
  Continuation lines are indented to the list item's text; code blocks and tables stay as they are.
- `packages/shared`: `index.ts` (role ids, RBAC matrix) mirrors API constants and is not imported yet; `fields.ts` (the field registry) is used by the web app and the API, as are `permissions.ts` and `branding.ts`.\
  Keep these to erasable TypeScript (no enums) so Node tests can import them.\
  Its `exports` map has a `source` condition (the `.ts` sources, used by Vite, the web type check and all tests) and a built `dist/` (used by the API, which is CommonJS and loads it via `require` of ESM).\
  The API's `build` script builds the shared package first.
