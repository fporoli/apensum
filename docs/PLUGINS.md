# Plugins

A plugin adds pages, API endpoints, settings and texts to Apensum without changing the core. It lives
in `plugins/<id>`; the core finds it there when it builds and starts. `plugins/expenses` is the
bundled reference plugin (in this repository); any other plugin, e.g. a private one, is a clone of its
own repository in that folder.

## Layout

```
plugins/<id>/
  package.json        name, license, and the manifest under "apensum" (below)
  tsconfig.json       editor + tests for api/ and test/ (core sources via the `source` condition)
  tsconfig.api.json   the build: api/ -> dist/api (against the core's built declarations)
  shared/             optional: code both parts import (e.g. a report's definition and texts)
  changelog/          Liquibase: db.changelog-master.xml + NNN-name.sql, run after the core's (below)
  api/index.ts        export default defineApiPlugin({ id, controllers, providers, reports, teamViews, payroll, backup, workflows, documents })
  web/index.tsx       export default defineWebPlugin({ id, texts, pages, navGroups, orgSettings, publicRoutes, workflowKinds, notificationSections })
  web/tsconfig.json   editor only: extends apps/web/tsconfig.json
  web/texts.ts        the plugin's UI texts, en/de/fr/it with the same keys
  test/*.test.ts      API tests (tsx, node:test), like test/api
  test/*.test.mjs     plain Node tests (web helpers, texts)
```

```json
"apensum": {
  "id": "expenses",
  "permissions": [
    { "id": "nav.expenses", "kind": "nav", "scopes": ["own", "team", "reports", "all"], "caption": "nav.expenses" },
    ...
  ],
  "module": { "id": "expenses", "caption": "modules.expenses", "defaultEnabled": true,
              "objects": ["nav.expenses", "nav.expenseReports", "nav.expenseProcessing"] },
  "api": "dist/api/index.js",
  "web": "web/index.tsx"
}
```

- `id` must equal the folder name.
- `module` (optional) appears under Organization settings -> Modules. Switching it off removes the
  listed permission objects for everyone in the organization, so the plugin's pages disappear and its
  endpoints refuse (`can()` fails). Its texts are `modules.<id>` and `modules.<id>.description`.
- `permissions` (optional) adds permission objects to the catalogue (`packages/shared/src/permissions.ts`,
  `registerPermissionObjects`): the API grants and checks them, the roles editor lists them (navbar
  objects under Pages, sections under "Plugin sections"), `owner` holds them. An id the core or another
  plugin already uses is refused. Their rows and default grants come from the plugin's changelog.
- `api` and `web` are both optional.

## Pages and the navbar

The core describes its own pages the same way (`apps/web/src/corePages.tsx`); the navbar, the location
hashes and who may open a page are built from the core's and the plugins' pages alike.

```tsx
{
  section: 'expenses',            // unique id
  hash: '#/expenses',
  object: 'nav.expenses',         // permission behind the page; none = everyone
  allowedByRole: (r) => r.isAdmin, // fallback until permissions load (or offline); default everyone
  nav: {
    group: 'expenses',            // a core group or one of the plugin's navGroups
    label: 'nav.expenses',        // i18n key
    icon: <ReceiptLongIcon fontSize="small" />,
    after: 'home',                // the entry it follows; at the end when unset/unknown
    parent: 'users',              // optional: a sub-entry of that page's entry
    showForChildren: true,        // optional: shown while one of its sub-entries is allowed
    badge: async ({ orgId, authHeaders, permissions, roles }) => 3, // optional count, reloaded on notifications
  },
  render: (ctx) => <Expenses orgId={ctx.orgId} ... />,
}
```

Core groups: `myWork`, `projectTracking`, `cases`, `organization`, `administration`, `personal`.

## Reports

A plugin adds reports to the Reports page (and so to saved and scheduled reports). Its definition and
texts live in one file both parts import (`plugins/expenses/shared/report.ts`); the API part adds the
rows (`plugins/expenses/api/expense-report.ts`):

```ts
// shared/report.ts
export const MY_REPORT = { definition: { id: 'myReport', object: 'nav.myPage', dimensions: [...], measures: [...],
  labels: { kind: { staticData: { entity: 'my', enum: 'my_kind' } }, status: { textPrefix: 'reports.myStatus.' } },
  projectFilter: true, ... }, texts: { en: { 'reports.report.myReport': '...', ... }, de: ..., fr: ..., it: ... } };
// api/index.ts
defineApiPlugin({ ..., reports: [{ ...MY_REPORT, rows: async ({ db, orgId, people, first, last, projectId }) => [...] }] });
// web/index.tsx
defineWebPlugin({ ..., reports: [MY_REPORT] });
```

- **Who is in it:** the core works out the people first (`listableUserIds` of the definition's `object`,
  narrowed by the filters) and passes them in `people`; rows of anyone else are dropped.
- **Rows:** one per finest combination of the dimensions, `person` = the person's id, `personName` from
  `people`; the core groups, totals and labels them (`packages/shared/src/reports.ts`, `reportTable.ts`).
- **Texts:** `reports.report.<id>`, `reports.report.<id>.description`, `reports.note.<id>`, and
  `reports.dim.<dim>` / `reports.measure.<key>` where the core has none yet. They are added to the web
  dictionaries and, for scheduled reports, to the API's texts (`registerAvailablePluginTexts`); a key the
  core already has with another text is refused.
- A saved report of a plugin that is no longer installed fails with `unknown-report`.

## Documents page

A plugin's files that belong to a person (expenses: receipts) appear on that person's Documents page:

- API: `documents: { '<category>': (db, orgId, userId) => ... }` in `defineApiPlugin` returns that
  person's own documents (`PersonalDocument`: document id, source id, file, date, context).
  The page lists them with the core's, and a download is allowed only for what the list holds.
- Web: `documentCategories: [{ category, color, after, staticData?, describe }]`; `describe` turns the
  context into the line under the file name; its name is the text `documents.category.<category>`.

## Team tab (TeamView)

A plugin page wrapped in `TeamView` (`kind` = its team view) gets the Team tab for managers and HR:

- API: `teamViews: [{ kind, object, rows }]` in `defineApiPlugin`. The core works out whose records the
  caller may see (`listableUserIds` of `object`, without the caller) and asks `rows(db, { orgId, userIds,
  from, toExclusive })` for that month; rows of anyone else are dropped (each row has `user_id`).
- Web: `teamViews: [{ kind, opensPerson?, table }]`. `table({ rows, month, t, locale, byUser, money, date })`
  returns the columns (`headers`, `cells(userId)`) and the expanded `details(userId)`; `StatusChip`,
  `TeamDetailTable` and `totalsByCurrency` from the contract keep it looking like the core's tables.

## Import/Export

- **Payroll export:** `payroll: [{ key, caption, amounts, abacus, columns }]` in `defineApiPlugin`.
  `amounts(db, { orgId, from, to })` gives each person's amount for the month; the core rounds it and
  adds an Abacus line (`abacus.wageType`, when above zero), a column in the Bexio CSV (before
  `Abteilung`), the generic CSV and the Excel file (at the end), and a preview column (`caption`).
- **Backup and restore:** `backup: { export, restore }`. `export(db, orgId)` returns the plugin's
  tables as files under `database/` plus counts for the manifest; `restore(db, ctx)` writes them back
  after the core's users, documents and projects, with `ctx.userIds` / `projectIds` / `subprojectIds`
  mapping old ids to new ones, and returns what it restored.

The expenses plugin's `api/import-export.ts` adds the expenses (wage type 3000) and backs up its
tables, exchange rates included.

## Approvals (Workflow page)

An approval a plugin owns is a workflow like the core's (`WorkflowsService`: `ensureDefinition`, `start`,
`findPending`, `resolve`; the plugin's controller starts it). The rest is declared in `defineApiPlugin`:

```ts
workflows: {
  // what a decision does to the record; `core` = { versions, audit }
  actions: { 'demo.approve': async (db, ctx, core) => ..., 'demo.reject': ... },
  sources: {
    demo_things: {
      organization: async (db, id) => orgId,     // admin override, audit, notifications, rerouting
      records: { field: 'demo_thing', load: async (db, ids) => [...] },  // GET workflows/assigned-to-me
    },
  },
  managerRouted: ['approve demo thing'],        // goes to the person's manager, follows manager changes
}
```

Its web part's `workflowKinds` entry (same `recordField` as `records.field`) gives the item its label,
title and Inspect dialog. `plugins/expenses/api/workflow.ts` and `web/ExpenseReportReview.tsx` do it.

Everything a plugin adds to the API is declared in `defineApiPlugin`, so its `api/index.ts` shows all of
it; the core registers it at startup (`plugins.ts`, `plugin-registrar.ts`). A plugin calls no
`register*` method itself.

## Database changes

A plugin with `changelog/db.changelog-master.xml` brings its own Liquibase changelog, with the same rules
as the core's (CLAUDE.md): a new `NNN-name.sql` per change, listed in the master, never edit an applied
changeset. Use the plugin id as changeset author.

- **Order:** the migrate image's entrypoint (`infra/liquibase/apensum-migrate.sh`) runs the core's
  changelog, then each plugin's, in one `migrate` step. Everything shares `DATABASECHANGELOG`; a plugin's
  changesets are recorded as `<id>/changelog/<file>`.
- **Where the files come from:** compose (dev, local) and `npm run dev:migrate` mount `plugins/`; the
  Azure and VPS workflows copy the changelogs into the image first (`node scripts/plugins.mjs
  stage-changelogs`, into `infra/liquibase/plugins`).
- **`npm run dev:status`** checks the core's and every plugin's changelog. A changeset that no changelog
  of the checkout has (e.g. a plugin that was removed) is reported.
- **Permissions:** insert the `permissions` rows of the manifest's objects and the default grants on the
  global roles (`organization_id IS NULL`), with `ON CONFLICT DO NOTHING`; see
  `plugins/expenses/changelog/001-permissions.sql` and its test.
- **Tables** may live in `public`. List them in the manifest (`"tables": ["expenses", ...]`):
  `npm run dev:introspect` then leaves them out of the core's `schema.ts` and writes them into the
  plugin's own `api/db/schema.ts` (generated, never edit; it imports the core's tables it refers to
  from `@worktime3/api/schema`). `db:checkschema` checks both. The plugin imports its tables from
  `./db/schema`, the core's from `@worktime3/api/schema`.
- **Moving existing tables into a plugin** (as expenses did): the changesets that created them stay
  in the core's changelog, since applied changesets cannot move; new changes go into the plugin's.
  A database without the plugin still has the (empty) tables.

## Rules

- **Import the core only through the contracts.**
  - API: `@worktime3/api/plugin` (services, access helpers, AI budget, ...) and `@worktime3/api/schema` (tables).
  - Web: `@worktime3/web/plugin` (i18n, formatting, components, icons, form fields, TeamView, ...).

  If a plugin needs something more, add it to `apps/api/src/plugin.ts` or `apps/web/src/plugin.ts`.
  Those files are the public surface, so change them with care.
- **No dependencies of its own.** Plugins are not npm workspaces. React, MUI, Nest, drizzle and so on
  resolve from the repository's `node_modules`, so there is exactly one copy of each: two Reacts break
  hooks, two Nests break dependency injection. A cloned plugin therefore changes neither
  `package-lock.json` nor `npm ci`.
- **Authorization works as in the core** (CLAUDE.md): every org-scoped handler checks the caller with
  `callerUserId` + `can` / `canSeeUserData` / ... from the contract.
- **Texts are the plugin's own.** They are merged into the dictionaries at startup; a key may not
  override a core text (see `plugins/expenses/test/texts.test.mjs`).

## Developing a private plugin locally

```sh
git clone git@github.com:<you>/<plugin-repo>.git plugins/<id>   # gitignored in the core repo
npm run build --workspace=@worktime3/api    # builds the core API and every plugin's api/
npm run dev:api                             # log: "Loaded plugins: expenses, <id>"
npm run dev:web                             # Vite bundles plugins/*/web, with hot reload
npm test                                    # core tests, then each plugin's test/
```

- **Debugging:** VS Code's "Development Full Stack: API + Web" stops at breakpoints in `plugins/<id>/api`
  (source maps, `outFiles` includes `plugins/*/dist`) and in `plugins/<id>/web` (Chrome).
- **Git:** `plugins/<id>` is its own repository. VS Code's Source Control shows both, and commits there
  never touch the core repository.
- **Rebuilds:** after a change in `api/`, restart the API launch (its pre-launch task rebuilds). Web
  changes reload on their own.

## The core without plugins

The core must build, test and run with no plugin at all. CI's `core-only` job checks it with an empty
`APENSUM_PLUGINS_DIR` and `scripts/smoke-no-plugins.mjs`; locally:

```sh
mkdir -p /tmp/no-plugins && APENSUM_PLUGINS_DIR=/tmp/no-plugins npm run build && APENSUM_PLUGINS_DIR=/tmp/no-plugins npm test
```

Grants the database still holds for a missing plugin's objects grant nothing: a person's permissions
are limited to the catalogue (`mergePermissionRows` in access.ts).

## Builds and deploys

- The API image (`apps/api/Dockerfile`) and the web image (`apps/web/Dockerfile`) copy the repository,
  `plugins/` included, and build every plugin in it.
- A private plugin goes into an image when the workflow checks it out into `plugins/<id>` before the
  build, e.g. with `actions/checkout` using a deploy key or a token secret. Not wired up yet.
- An image that contains a private plugin contains its code, so push it to a **private** registry
  package.

## Not yet supported

- **Removing a plugin** leaves its tables in the database; the core's introspection then picks them
  up again (they are no longer listed by an installed plugin), so `db:checkschema` reports them.
