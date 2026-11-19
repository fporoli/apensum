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
  api/index.ts        export default defineApiPlugin({ id, controllers, providers })
  web/index.tsx       export default defineWebPlugin({ id, texts, pages, navGroups, orgSettings, publicRoutes, workflowKinds, notificationSections })
  web/tsconfig.json   editor only: extends apps/web/tsconfig.json
  web/texts.ts        the plugin's UI texts, en/de/fr/it with the same keys
  test/*.test.ts      API tests (tsx, node:test), like test/api
  test/*.test.mjs     plain Node tests (web helpers, texts)
```

```json
"apensum": {
  "id": "expenses",
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
- `api` and `web` are both optional.

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

## Builds and deploys

- The API image (`apps/api/Dockerfile`) and the web image (`apps/web/Dockerfile`) copy the repository,
  `plugins/` included, and build every plugin in it.
- A private plugin goes into an image when the workflow checks it out into `plugins/<id>` before the
  build, e.g. with `actions/checkout` using a deploy key or a token secret. Not wired up yet.
- An image that contains a private plugin contains its code, so push it to a **private** registry
  package.

## Not yet supported

- **Plugin-owned database changes.** The expense tables are still in the core's Liquibase changelogs
  and in `apps/api/src/db/schema.ts`. A plugin with its own tables needs:
  - its own changelog list (in its own schema, like `cases`)
  - `migrate.mjs` / compose / the Liquibase image including `plugins/*/changelog`
  - its own drizzle table definitions
- **Plugin parts of core pages.**
  - The Workflow page already has an extension point: `workflowKinds` gives an approval kind its label,
    source, title and Inspect dialog (expenses: the expense report review).
  - The API side is still in the core: `workflows.service.ts` and `GET workflows/assigned-to-me` join the
    expense report.
  - Reports, Documents, Team overview and Import/Export still show expense data themselves (the tables
    are core). Each needs its own extension point.
