# Plugins

A plugin adds pages, API endpoints, settings and texts to Apensum without changing the core. It lives
in `plugins/<id>`; the core finds it there when it builds and starts. `plugins/notes` is the bundled
example plugin (in this repository, see its README): the smallest complete plugin, to copy for a new
module. Any other plugin is a clone of its own repository in that folder, e.g. the private `expenses`
(`fporoli/apensum-expenses`), `hr` (`fporoli/apensum-hr`) and `cases` (Assessments,
`fporoli/apensum-assessment`); the examples below that name their files are in those.

## Layout

```
plugins/<id>/
  package.json        name, license, and the manifest under "apensum" (below)
  tsconfig.json       editor + tests for api/ and test/ (core sources via the `source` condition)
  tsconfig.api.json   the build: api/ -> dist/api (against the core's built declarations)
  shared/             optional: code both parts import (e.g. a report's definition and texts)
  changelog/          Liquibase: db.changelog-master.xml + NNN-name.sql, run after the core's (below)
  api/index.ts        export default defineApiPlugin({ id, controllers, providers, reports, teamViews, payroll, workflows, documents, assistantTools, triggers })
  web/index.tsx       export default defineWebPlugin({ id, texts, pages, navGroups, orgSettings, publicRoutes, workflowKinds, notificationSections, projectDialog })
  web/tsconfig.json   editor only: extends apps/web/tsconfig.json
  web/texts.ts        the plugin's UI texts, en/de/fr/it with the same keys
  test/*.test.ts      API tests (tsx, node:test), like test/api
  test/*.test.mjs     plain Node tests (web helpers, texts)
```

```json
"apensum": {
  "id": "expenses",
  "apensumApi": 3,
  "legacyNames": true,
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
- `apensumApi` is the plugin API version the plugin was built for (`packages/shared/src/pluginApi.ts`,
  `PLUGIN_API_VERSION`). The API's start, the web build and `scripts/plugins.mjs` refuse a plugin with
  none or another one. The core bumps it when a change can break a plugin built against the previous
  version (something removed or renamed, a type or behavior changed), not for additions.
- `requires` (optional) lists the ids of the plugins this one needs, e.g. Billing's `["expenses"]` (it bills expenses and reads their tables).\
  The plugin then loads, migrates and seeds after them (otherwise every step goes by id), and the API's start, the web build and `scripts/plugins.mjs` stop with a clear message when one is not installed or when plugins require each other in a circle (`pluginOrder` in `packages/shared/src/pluginApi.ts`).\
  The order reaches the migrate image and the VPS seeder as an `ORDER` file written by `stage-changelogs` / `stage-seeds`.\
  It is about installation, not about the module switch: a required plugin's module may still be off in an organization, so code that reads another plugin's data copes with none.
- `module` (optional) appears under Organization settings -> Modules. Switching it off removes the
  listed permission objects for everyone in the organization, so the plugin's pages disappear and its
  endpoints refuse (`can()` fails). Its texts are `modules.<id>` and `modules.<id>.description`.
  `"licensed": true` makes it a paid module: off by default, on only with a license from the
  instance's operator (`organization_licenses`, the operator CLI) and switched on by the admin\
  (`PUT organizations/:id/modules` returns `module-licensed` without a license; SQL of your own that\
  looks at the module switch checks the license too).
- `permissions` (optional) adds permission objects to the catalogue (`packages/shared/src/permissions.ts`,
  `registerPermissionObjects`): the API grants and checks them, the roles editor lists them (navbar
  objects under Pages, sections under "Plugin sections"). Grant others' data to HR (and by reporting line to\
  managers), never to admin or developer; `owner` holds none. An id the core or another
  plugin already uses is refused. Their rows and default grants come from the plugin's changelog.
- `api` and `web` are both optional.

## Names

Every name a plugin adds starts with its id, so plugins never collide with each other or with the
core. For a plugin `cases`:

| What | Examples |
|---|---|
| tables (`apensum.tables`) | `cases`, `cases_documents` |
| its own Postgres schema (`apensum.dbSchema`) | `cases`, `cases_archive` (its tables: any name) |
| permission objects | `nav.cases`, `nav.casesTemplates`, `section.cases.notes` |
| module, report, team view, payroll item, document category | `cases`, `casesArchive` |
| workflow actions, source tables, record fields | `cases.approve`, `cases_reviews`, `cases_review` |
| pages and nav groups (web) | `cases`, `casesTemplates` |

The id is followed by nothing, `.`, `_`, `-` or a capital letter. The API's start and the web app check
it (`namespaceMismatch` in `packages/shared/src/pluginApi.ts`) and refuse a plugin that breaks it, naming
each offending name. Text keys need no prefix but may not override a core text.

`"legacyNames": true` turns the check off. It is only for a plugin carved out of the core that keeps
the names it had there (the expenses plugin: `expense_reports`, `nav.expenseReports`, ...).
A new plugin never sets it.

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
    ownOnly: { parent: 'myData', label: 'nav.myDashboard' }, // optional: where and how it shows for someone holding `object` only for themselves
    badge: async ({ orgId, authHeaders, permissions, roles }) => 3, // optional count, reloaded on notifications
  },
  render: (ctx) => <Expenses orgId={ctx.orgId} ... />,
}
```

Core groups: `myWork`, `projectTracking`, `organization`, `administration`, `personal`.

A project dialog part (`projectDialog`: `{ id, render(ctx) }`) adds fields below the core's in the project and subproject dialogs of Projects & Teams (`ProjectDialogContext`: `orgId`, `authHeaders`, `kind`, `projectId`, `subprojectId`, `onSave`).\
A project action (`projectActions`: `{ id, render(ctx) }`, `ProjectActionContext`: `orgId`, `authHeaders`, `projectId`, `subprojectId`) is a button wherever a page shows a project or subproject through the core's `ProjectActions` (a plugin's page too: the cases plugin's case card); it renders nothing where it does not apply (billing's "Rechnung erstellen" for whoever may edit billing, the project having a customer).\
The customers are the core's (`customers`, `customer_contacts`, the projects' customer fields, docs/dev/FEATURES.md): a plugin reads them, opens `CustomerDialog`, and names them as the organization does with `useTermT` / `termKeyOf` (its texts' `.client` / `.principal` variants).\
The API's `ProjectsService` (plugin contract) gives the customers with their projects and makes a customer project or a subproject (its customer reference and contact checked against the project's customer, recorded in the versions); the plugin authorizes first (the cases plugin: a case's time tracking).\
It renders nothing where it does not apply (its API refuses, the module is off), and registers with `onSave(fn)` what to save once the core saved the project (`fn({ projectId, subprojectId })` returns an error text or null, shown after the save; `onSave(null)` when it unmounts); e.g. Billing's customer, rate and reference.

A settings section (`orgSettings`) is a section of Organization settings of its own, or with
`within: 'org.ai'` a part of the core's "AI and costs" (the cases plugin's providers).

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

## Static data properties

A plugin's static data lists may map each key to properties instead of a label (labels then in the list's translations), as the expenses plugin's categories do (their expense account and default VAT type):

- Describe them in your changelog: add `"<entity>.<list>.<property>": { "type": "checkbox" | "radio" | "select" | "text", ... }` (radio: one value of the list) to the global list `static_data` / `properties` (core changeset 101) and their labels to its translations, in all four languages.\
  A `checkbox` may set `"default": true` (it is stored only when it differs), a `select` names the list its choices come from (`"list": "<entity>.<list>"`, a static data list of its own), a `text` may set a `pattern`; `"sort"` orders them.\
  Admin settings → static data shows a control for each, with no code of the plugin's; the core describes absence and request types the same way, and the list describes its own fields, so the same editor edits it.\
  The expenses plugin's changeset 010 is an example.
- Read labels with `staticValueLabel` (a property object is never a label) and the properties from the values; check them where they are used, since an organization's copy holds whatever its admin saved.

## Notifications, mail and balances

A plugin's providers and controllers may inject the core's `NotificationsService` (`notifyMany`: one row per recipient, pushed live; `changed(userIds, table, id)`: a silent push so their open lists load again, `useLive` in the web contract; the web part's `notificationSections` maps the source table to the section a click opens) and `BalancesService` (a person's `year` and `closings`, the year-end closings of the Time balances page), and `WorkTimeModelService` (a person's `model` and day `targets`: schedule, holidays of their location, approved absences; with `dayTargets` of `@worktime3/shared/worktime`).\
The business clock comes from the contract too (`clock`, `sqlNow`, `sqlToday`, `todayIn`): a plugin's "now" and "today" are `clock.now()` and, in SQL, `sqlNow()` / `sqlToday()`, and its inserts write their times; real time only where it must be real, marked `// real time: <why>` (the core's `clock.test.ts` checks the plugins' code as well).\
`sendMail` sends through the instance's SMTP and `appBaseUrl()` gives the web app's address for links; mail is best effort: catch and log, never fail a request on it, and never send a document itself, only a link.

Tasks for people go through the flows module (`FlowsService`, injected like the others): `openTask({ organizationId, source: '<id>', key: '<id>:...', section, departmentId, subject, message, dueDate, flowType?, aboutUserId?, data? })` opens one Free Flow per key to a department, or brings an open one up to date (with `flowType` naming a type that has its own steps, the task goes through them; `aboutUserId` is the person it is about, `data` the values of its steps' e-mail templates, see `docs/dev/FLOWS.md`); `closeTasks(db, orgId, '<id>', keepKeys, dueFrom)` resolves the open ones that no longer apply.\
The flow shows the module's name (`modules.<id>`) as its sender and an "Open in" button for `section`; past its due date an open task mails its handlers once.\
A task resolved or archived by a person is never opened again; `flows-off` means the organization has the flows module off (the HR plugin's tasks are the example).

## Team tab (TeamView)

A plugin page wrapped in `TeamView` (`kind` = its team view) gets the Team tab for managers and HR:

- API: `teamViews: [{ kind, object, rows }]` in `defineApiPlugin`. The core works out whose records the
  caller may see (`listableUserIds` of `object`, without the caller) and asks `rows(db, { orgId, userIds,
  from, toExclusive })` for that month; rows of anyone else are dropped (each row has `user_id`).
- Web: `teamViews: [{ kind, opensPerson?, table }]`. `table({ rows, month, t, locale, byUser, money, date })`
  returns the columns (`headers`, `cells(userId)`) and the expanded `details(userId)`; `StatusChip`,
  `TeamDetailTable` and `totalsByCurrency` from the contract keep it looking like the core's tables.

## Forms and the Home page

- **Configurable forms** (docs/FIELD_CONFIG.md): `forms: [MY_FORM]` in `defineApiPlugin` registers the
  form (`registerForm`, checked by `formDefinitionProblems`), so its org templates (field_config) work as
  the core's; the web part renders it with `useFormTemplate(orgId, MY_FORM, ...)`. Keep the definition in
  `shared/` (expenses: `shared/form.ts`).
- **Home quick action:** `homeAction: { label, icon, after }` on a page adds a button to the Home page for
  whoever may open the page (`after`: `time`, `absences`, `timesheet` or another page's section).

## Expense list pagination

The Expenses and Expense Reports pages request 25 records at a time. On the organization-scoped `GET expenses` and `GET expense-reports` routes, supply zero-based `page` and `pageSize` (1–100) for `{ entries, hasMore }`. Paginated entries are newest first with an ID tie-breaker; calls without either parameter retain the original response and order. An unfiltered single-person paginated report list returns the active editable `draft` separately from its history. The draft's expense picker uses `unmapped=true` to page only unattached expenses. HR Expense Processing is unchanged.

## Seed (demo data)

A plugin's `seed.sql` (in its folder) runs after the core's `infra/postgres/seeds/seed.sql`, in the same
psql session and transaction: Acme, its people and projects exist, and the core's `pg_temp.seed_*`
helpers (deterministic ids and random values, working days, managers) can be used. Same rules as the
core's seed: fixed or md5-derived ids, `ON CONFLICT DO NOTHING`, re-runnable.

- `npm run dev:seed` / `db:seed` (`infra/postgres/run-seed.mjs`) adds every plugin's seed.
- The VPS and Azure seeders get them staged (`node scripts/plugins.mjs stage-seeds`, into
  `infra/postgres/seeds/plugins`) by the `vps` and `build-push` workflows.

## Import/Export

- **Payroll export:** `payroll: [{ key, caption, amounts, abacus, columns }]` in `defineApiPlugin`.
  `amounts(db, { orgId, from, to })` gives each person's amount for the month; the core rounds it and
  adds an Abacus line (`abacus.wageType`, when above zero), a column in the Bexio CSV (before
  `Abteilung`), the generic CSV and the Excel file (at the end), and a preview column (`caption`).

The expenses plugin's `api/import-export.ts` adds the expenses (wage type 3000).

## Target working time from a plan

`plannedMinutes(db, { orgId, userId, from, toExclusive })` in `defineApiPlugin` returns minutes per day that a plan sets for a person (e.g. a published shift plan; 0 = a day off).\
Such a day's target is the plan's instead of the work schedule's, and a holiday doesn't reduce it (the plan decided who works it); a day with an approved absence keeps the schedule's, so vacation and sickness are credited and debited as before.\
Days the plugin leaves out keep the schedule.\
The core's work-time model reads it (`WorkTimeModelService.model`, `WorkTimeModel.planned`, `dayTargets`), so balances, timesheets, reports and the day view all follow; a plugin that fails is logged and left out.\
Split a shift that passes midnight across both days, as attendance is.

## Approvals (Workflow page)

An approval a plugin owns is a workflow like the core's (`WorkflowsService`: `ensureDefinition`, `start`,
`findPending`, `resolve`; the plugin's controller starts it). The rest is declared in `defineApiPlugin`:

```ts
workflows: {
  // what a decision does to the record; `core` = { versions, audit }
  actions: { 'demo.approve': async (db, ctx, core) => ..., 'demo.reject': ... },
  sources: {
    demo_things: {
      records: { field: 'demo_thing', load: async (db, ids) => [...] },  // GET workflows/assigned-to-me
    },
  },
  managerRouted: ['approve demo thing'],        // goes to the person's manager, follows manager changes
}
```

Its web part's `workflowKinds` entry (same `recordField` as `records.field`) gives the item its label,
title and Inspect dialog. `plugins/expenses/api/workflow.ts` and `web/ExpenseReportReview.tsx` do it.\
A kind whose steps are done on the plugin's own page gives it as `page: { sourceTable, hash: (id) => ... }`: the notification of a step opens the record there instead of on the Flows page, and the item gets an "Open" button (the expenses plugin's payment runs, `#/expense-payout?id=`); with `ownOnly` (a page of one's own records, such as one's expense reports, `#/expense-reports?id=`) the button is on the items one submitted, and notifications stay on the Flows page.

### Configurable workflows

A plugin can let each organization arrange its workflow (Admin settings -> Workflows, owners only): it declares a kind in `workflows.kinds` and starts it with `WorkflowsService.start(db, { kind, organizationId, sourceTableUuid, actorUserId, workflowData, notification })` instead of `ensureDefinition` + `createWorkflow`.\
A kind is a catalogue (`@worktime3/shared/workflowConfig`, `WorkflowKindCatalogue`): its building blocks (the action each runs, `returnAction` when it can be sent back, which assignees it allows, `once`, `after`, `last`), the facts a condition may test (with their types), the reject modes and the default configuration; plus `facts(db, id)`, which reads a record's facts when a step with a condition comes up.\
The organization's JSON only arranges what the catalogue offers; the checker (`validateWorkflowConfig`) refuses anything else, in the editor and in the API.\
When the plugin's own page does a block's work, it calls `completeBlock(db, table, id, block, eventKey, callerId)`.\
A kind can also have variants (`variants(db, orgId)`: one configuration each, e.g. per type of record; a variant without one has no workflow and `start` returns null), a catalogue per organization (`catalogueFor`, e.g. facts from the organization's form fields) and `onFinished(db, id, actorUserId)` when its last step is done.\
Assignees name departments and teams by their code (`department:<code>`, `team:<code>`), if the block allows them.\
`EXPENSE_REPORT_KIND` in `plugins/expenses/api/workflow.ts` is the example.

## AI assistant tools

`assistantTools: [{ name, description, parameters, object?, run(args, ctx) }]` gives the assistant
(header sparkle button) tools for the plugin's data. Names start with the plugin's id (`expenses_add`).
A tool is offered only to whoever may see `object` (a module switched off hides it). `run` calls the
plugin's own controller method as the caller, `ctx.get(MyController).create(ctx.orgId, body, ctx.req)`,
so the endpoint's checks run unchanged; it returns `{ data, action? }` (`data` goes to the model,
`action` is a line in the "done" list). `ctx` also has `today`, `timeZone`, `instant(date, 'HH:MM')`,
`local(iso)`, `findPerson(name)` and `findProject(name)`. Never read or write the database around the
controller's checks. `plugins/notes/api/assistant-tools.ts` is the short example (list, add, delete one's notes);
`plugins/expenses/api/assistant-tools.ts`, `roster`, `billing`, `hrplus` and `hr` have their own.
Leave out what must not reach the model: the cases module (end-to-end encrypted) and the reporting office have no tools.

`triggers` (a `TriggerSource`, types in the contract): events for Auslöser, the core's triggers (docs/dev/FLOWS.md).\
Its `events` have ids that start with the plugin's id (`hr.anniversary`), labels in four languages, the placeholders they give the flow types' e-mail templates, a default lead time (`false`: as soon as known), the section their flows link to (`?user=<id>`) and `sensitive` (a permission object: only who edits it for everyone sees and sets up their triggers).\
`templates` (optional, `TriggerTemplate` from `@worktime3/shared/triggerTemplates`) are Vorlagen for its own events: the Auslöser tab offers them while the module is on, and the core creates the flow type with its e-mail step and the trigger.\
`due(db, orgId, today, horizons)` returns the occurrences of the events asked for (key, the person, date, optional due date and department, values, `text(lang)`); the core opens, updates and closes the flows, and runs a plugin's events only while its module (`triggers.module`, else the plugin's id) is on.\
The web part may show the same panel (`FlowTriggers` in `@worktime3/web/plugin`), e.g. in its settings.\
`permitReminders(db, orgId)` (deprecated): true when the plugin reminds of residence permits ending itself; an enabled `permitExpires` trigger silences the core's reminder now.\
A plugin that changes someone's personal data does it through `BasicDataService` (in the contract), so the core keeps its history.

Everything a plugin adds to the API is declared in `defineApiPlugin`, so its `api/index.ts` shows all of
it; the core registers it at startup (`plugins.ts`, `plugin-registrar.ts`). A plugin calls no
`register*` method itself.

## Database changes

A plugin with `changelog/db.changelog-master.xml` brings its own Liquibase changelog, with the same rules
as the core's (CLAUDE.md): a new `NNN-name.sql` per change, listed in the master, never edit an applied
changeset. Use the plugin id as changeset author.

- **Order:** the migrate image's entrypoint (`infra/liquibase/apensum-migrate.sh`) runs the core's
  changelog, then each plugin's, in one `migrate` step: an `update` is a single Liquibase run over a master
  that includes them all. Everything shares `DATABASECHANGELOG`; a plugin's changesets are recorded as
  `<id>/changelog/<file>`, the same whether they run together or one by one.
- **Where the files come from:** compose (dev, local) and `npm run dev:migrate` mount `plugins/`; the
  Azure and VPS workflows copy the changelogs into the image first (`node scripts/plugins.mjs
  stage-changelogs`, into `infra/liquibase/plugins`).
- **`npm run dev:status`** checks the core's and every plugin's changelog. A changeset that no changelog
  of the checkout has (e.g. a plugin that was removed) is reported.
- **Permissions:** insert the `permissions` rows of the manifest's objects and the default grants on the
  global roles (`organization_id IS NULL`), with `ON CONFLICT DO NOTHING`; see
  `plugins/notes/changelog/001-notes.sql` and its test.
- **Tables** may live in `public`. List them in the manifest (`"tables": ["expenses", ...]`):
  `npm run dev:introspect` then leaves them out of the core's `schema.ts` and writes them into the
  plugin's own `api/db/schema.ts` (generated, never edit; it imports the core's tables it refers to
  from `@worktime3/api/schema`). `db:checkschema` checks both. The plugin imports its tables from
  `./db/schema`, the core's from `@worktime3/api/schema`.
- **Or a schema of its own** (`"dbSchema": "cases"`, instead of `tables`): the plugin's changelog creates
  the Postgres schema and its tables; introspection leaves the whole schema out of the core and writes it
  into the plugin's `api/db/schema.ts` (`export const cases = pgSchema("cases")`, tables named
  `<table>In<Schema>`). The schema's name starts with the plugin's id; its tables need no prefix.
  A plugin uses either `tables` or `dbSchema`, not both.
- **Moving existing tables into a plugin** (as expenses did): the changesets that created them stay
  in the core's changelog, since applied changesets cannot move; new changes go into the plugin's.
  A database without the plugin still has the (empty) tables.

## Encrypted objects (the vault)

A plugin that encrypts records end to end declares them in `vaultObjects` (`{ kind: '<id>.<kind>', module, access }`,
`access` says whether a person may see or edit one): the core's vault keeps the key pairs and each object's keys, lets a
holder share them and lists who may be given one (docs/VAULT.md). The web part uses the contract's keyring
(`objectKeyFor`, `newObjectKey`, `shareObjectKey`, ...) and `VaultControl`; the API uses `VaultService` (e.g. `grant` for
an object's first key, `replaceKeys` in its rotation). The cases plugin is the example.

## Billables

A plugin offers what may be billed to a customer (`billables: BillableSource[]` in its API plugin; `apps/api/src/billables.service.ts`):
each source has a `kind` (named like the plugin, e.g. `expenses`), an optional `module` that must be on, `open` (what is ready
to bill on given projects, one subproject, up to a date) and `byIds` (its records by id, for what was billed or written off).\
Whoever bills (the billing plugin) asks `BillablesService` (`open`, `byIds`, `kinds`), never the owner's tables; a source of a
module switched off offers nothing, one that fails is logged and left out.\
An item carries the project, the date, the text the customer may see (never an internal note), amount and currency, the person,
and its receipt (a core `documents` id, read through `DocumentsService`).

## Rules

- **Import the core only through the contracts.**
  - API: `@worktime3/api/plugin` (services, access helpers, AI budget, ...) and `@worktime3/api/schema` (tables).
  - Web: `@worktime3/web/plugin` (i18n, formatting, components, icons, form fields, TeamView, ...).

  If a plugin needs something more, add it to `apps/api/src/plugin.ts` or `apps/web/src/plugin.ts`.
  Those files are the public surface, so change them with care.
- **Another module only through the core.** A plugin reads its own tables and the core's, never another plugin's
  (its manifest's `tables` or `dbSchema`), and imports no other plugin's code; `test/api/plugin-boundaries.test.ts`
  fails on either. What one module offers another goes through an interface of the core: billables (below), document
  categories, reports, the web's slots (`projectDialog`, `projectActions`). A module then works without the other.
- **The core's data through its services.** A plugin reads and writes the core's data through the services of the
  contract, not its tables: `PeopleService` (names, members, profiles, basic data), `CustomersService` (customers,
  contacts, the term), `ProjectsService` (projects with their owner and cost item, subprojects, names, those matching a
  word, "Ihre Referenz"/"z. H.", who booked, project time with its approval), `OrganizationsService` (the organization,
  its modules and settings), `StructureService` (departments, teams, leaders, management), `EmploymentService` (start,
  probation and exit, assignments and managers, workloads, work permits), `AbsencesReadService` (`approved`, `list`),
  `TimesheetsReadService` (the working-time and project months' status), `PersonnelFilesService` (follow-ups, entries,
  filing a document), `BalancesService` (`year`, `closings`, `yearClosings`), `StaticDataService` (an entry, the
  organization's own values), `WorkflowsService` (`latestOf`, `latestIds`, `finishPendingSteps`), `DocumentsService`
  (`rowsOf`, `read`), `VersionsService` (histories), `BillablesService`, `VaultService` (encrypted objects' keys); the queries are the same, they run in the core.
  `test/api/plugin-boundaries.test.ts` fails on any SQL of a plugin on a core table and on any import of the core's
  generated schema. A service a plugin needs is added to the core.
- **No dependencies of its own.** Plugins are not npm workspaces. React, MUI, Nest, drizzle and so on
  resolve from the repository's `node_modules`, so there is exactly one copy of each: two Reacts break
  hooks, two Nests break dependency injection. A cloned plugin therefore changes neither
  `package-lock.json` nor `npm ci`.
- **Authorization works as in the core** (CLAUDE.md): every org-scoped handler checks the caller with
  `callerUserId` + `can` / `canSeeUserData` / ... from the contract.
- **Texts are the plugin's own.** They are merged into the dictionaries at startup; a key may not
  override a core text (see `plugins/notes/test/texts.test.mjs`).

## Licence of a plugin

A plugin imports the core's contract (`@worktime3/api/plugin`, `@worktime3/web/plugin`) and runs in the core's process, so the core and the plugin are one work under the core's licence, the GNU AGPL-3.0.\
What that means for a plugin of your own:

- You may write, run and change plugins without asking and without paying, in a private repository too.
- Run only by you for your own people, nothing has to be published; the people who use it may ask you for its source (AGPL section 13).
- Offered to others over the network (customers, clients, the other companies of a group, a hosted service), the plugin's source goes to those users under the AGPL-3.0, like the core's.
- Keeping a plugin confidential while others use it, running Apensum under another name, or operating it for third parties without publishing needs the commercial licence of the core (dual licensing, README "License").

A plugin's own `package.json` names its licence (`"license"`): `AGPL-3.0-only` for an open one; a confidential one under the commercial licence states its own (the private modules say `UNLICENSED`).\
The core's licence never depends on the plugins installed: it runs without any (CI job `core-only`).

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
- **Private plugins** are named in the repository variable `PRIVATE_PLUGINS`, separated by spaces or
  new lines: `<id>=<owner>/<repo>[@<ref>]`, e.g. `hr=fporoli/apensum-hr`. The secret `PLUGINS_TOKEN`
  (a fine-grained token with read access to their contents) lets `.github/actions/private-plugins`
  clone them into `plugins/<id>`:
  - `build-push` before building, so they are in the api, web, migrate and seed images;
  - `vps` before staging, so their changelogs and seeds reach the server.

  CI (`ci.yml`) leaves them out: the core's CI tests the core and the bundled example plugin, and its logs
  are public. A private plugin has its own CI that checks the core out and itself into
  `plugins/<id>` (e.g. the hr plugin's `.github/workflows/test.yml`).
- The standard product build includes the configured private plugins.
  A customer rebuilding from source needs the supplied plugin source trees or authorized access to their
  private repositories; the public core checkout alone is not the complete product source.
- An image that contains a private plugin contains its code, so its registry package must be
  **private**. `build-push` refuses to build while one of those images can be pulled anonymously.
  Make the GHCR packages `api`, `web`, `migrate`, `seed` and `web-azure` private (package settings),
  then the VPS environments need `GHCR_USERNAME` (variable) and `GHCR_TOKEN` (secret, `read:packages`)
  to pull them; Azure has them already.
- A plugin's module that is `licensed` stays off in every organization until the operator licenses it and an admin
  switches it on there, so deploying it changes nothing for customers who have not bought it.

## Not yet supported

- **Removing a plugin** leaves its tables in the database; the core's introspection then picks them
  up again (they are no longer listed by an installed plugin), so `db:checkschema` reports them.
