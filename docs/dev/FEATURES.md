# Features

Field configuration, modules, news, documents, directory, avatars, mail forwarding, personnel file, organization settings, reports, setup checklist, branding.\
Moved from CLAUDE.md as it was; CLAUDE.md keeps the rules that apply everywhere and points here.

- Configurable form fields (docs/FIELD_CONFIG.md): field definitions live in `packages/shared/src/fields.ts` (imported as `@worktime3/shared/fields`) and are rendered by `ConfigField` / `ConfigFieldGroup` (`ConfigField.tsx`).\
  Number entry and display go through `localeFormat.ts`; date pickers are MUI X with dayjs, set up once by `DatePickerLocalization` in `main.tsx`.\
  The basic-data and expense forms use them; other forms still have hand-written fields.
- Global (migrations only) and per-org templates (`field_config`, edited by the org's `developer` role) override the registry.\
  Merging, override checks (`checkFieldOverride`) and value validation (`validateFields`) live in `fields.ts` so the browser and the API apply the same rules.\
  A form page loads its merged template from `GET organizations/:orgId/forms/:formId`; a controller saving a configured form validates with `FieldsService.resolved()` + `validateFields`, as `basicdata.controller.ts` does.\
  In the web app, a page with a configured form uses `useFormTemplate` (`designMode.tsx`), wraps the form in `FieldDesignScope` and renders `FormDesignPanel` while designing, as `Home.tsx` does.
- Custom fields (defined by a template, `field_config.is_custom`) are stored in the form's `customStorage` JSON column.\
  Basic data keeps org-defined ones in `users.basicdata.orgs.<orgId>`: read basic data through `scopeToOrg` so one org never sees another's section.
- Modules (`packages/shared/src/modules.ts`): optional feature areas an org switches on or off (Organization settings -> Modules, `GET/PUT organizations/:id/modules`, stored in `organizations.settings.modules`, unset = the module's default).\
  A module owns permission objects; `permissionIdsOf` drops them when it is off, so its navbar entries disappear and every `can()` on them fails, with no per-endpoint module check.\
  A new module: a registry entry, its permission objects (with a changelog as usual) and i18n `modules.<id>` / `modules.<id>.description`.\
  A licensed module (`licensed: true`, e.g. the private `hr` plugin: salary continuation and protection periods, performance reviews filed in the personnel file) runs only with a valid license (`organization_licenses` 093, written by the operator CLI alone) and switched on by the admin (`module-licensed` without one); `resolveModules(stored, licenses)` decides, and SQL that reads the module switch of a licensed module also checks the license.\
  Show my screen (`screen-share.*`, `ScreenShare.tsx`) replaces impersonation: a person shows one colleague pictures of their tab (in memory, 30 min, the latest only); admin and HR may ask.\
  Never turn it into a token, a right or remote control.\
- News (module `news`, `nav.news`, 080/081; `news.controller.ts`, `News.tsx`, `NewsHomeCard.tsx` on Home, `packages/shared/src/news.ts`): admin and HR (`nav.news:edit:all`) write posts (title + Markdown per language, pictures as `![alt](doc:<document id>)` uploaded to the post, no SVG), publish them to everyone or some departments (audience worked out per call like request handlers), optionally by e-mail (a link, never the text's pictures), optionally asking readers to confirm (`require_ack`; editors see who read/confirmed).\
  Everyone but guests reads (`see:all`).\
  Markdown is `packages/shared/src/markdown.ts` (escapes everything; also used by the website's news posts).\
  Product news (082, `organization_id` NULL): an operator writes it for the admins (`nav.admin`) of every organization with the module on; it shows in each of their organizations' News, one notification per person (`news.product`); it is written only on the Super Admin pages (the same `NewsController` handlers at `operator/news`, `orgId` null), an organization's routes only read it; its pictures are documents of the Admin organization (older ones stay in the organization they were written in).\
  A product post marked public (083, `is_public`) is also on the website and can be sent to the newsletter's confirmed subscribers (`POST news/:id/newsletter`, operator, test mail to oneself first; `news-newsletter.ts`: HTML + text in the subscriber's language, pictures from `public/news/:id/images/...`, a signed never-expiring unsubscribe link and List-Unsubscribe one-click; `newsletter_deliveries` makes a send resumable and never mails anyone twice).
- Documents (`nav.documents`, `documents.controller.ts`, `Documents.tsx`, Personal navbar group): the caller's own documents only, as one list built per call: timesheet PDFs, monthly project reports, absence evidence, attachments of requests they sent, and plugin documents (`ApiPlugin.documents`, web `documentCategories`: expense receipts); downloads are checked against that same list.\
  `timesheet-documents.service.ts` (pdfkit, labels in the person's `users.locale`) issues a working-time timesheet PDF when that month is approved, and one project report per person and month (every project with its own approval status) whenever one of that month's projects is approved or reopened; the previous version gets `superseded_at` (`timesheet_documents`, 057/059).\
  Issuing is best effort and never fails an approval.\
  Opening Documents issues the current year's missing PDFs; `npm run db:documents` does it for everyone (run by `dev:seed` / `dev:resetdb`, dev only: the Docker stacks keep files in the API container).
- Directory (`nav.directory:see:all`, everyone, 058; `directory.controller.ts`, `Directory.tsx`): active members with avatar, e-mail, basic-data `phone1` (deliberately shown org-wide), position, department and manager and location of the assignment in force (manager card on hover), and a presence mark: an open check-in, else an approved absence today (shown as "absent until", never its type), else not checked in (only the grey ring: the card shows the location instead of that text).\
  Return nothing more from basic data or time records.\
  Demo users get fantasy portraits (`infra/postgres/seeds/avatars/*.svg`, URL-encoded in `seed.sql`: `users.avatar_url` is varchar(1024)) and internal phone numbers.
- Profile pictures (`avatars.ts`, `avatars.controller.ts`, `AvatarEditor.tsx` in the user menu's Settings): the browser crops and shrinks a photo to a 256 px JPEG and uploads it (`PUT users/me/avatar`, PNG/JPEG/WebP by their bytes, never SVG); it is a document (encrypted at rest, `source_table` `users.avatar`) and `users.avatar_url` holds `doc:<id>`, which responses turn into the public `public/avatars/:id` (no login, as an <img> cannot send the token; served only while it is someone's current picture, cached for a year since a new picture gets a new id).\
  Other `avatar_url` values pass through unchanged.
- "Send by e-mail" on requests and Approvals items (`ForwardMailDialog.tsx`, `POST flows/:id/forward`, `POST workflows/:id/forward`, `forward-mail.service.ts`): the server mails active members of the org only (max 20), Reply-To the sender, with a link back; whoever may see the item may send it.\
  It is the action itself, so a mail failure is returned as an error (dev: Mailpit on :8025).
- Documents are encrypted at rest (`document-crypto.ts`, 060): AES-256-GCM per file, its key wrapped with `DOCUMENTS_KEY` (env/secret, never in the DB).\
  Read files only through `DocumentsService.read`/`send`.\
  No key = stored plain with a startup WARNING.\
  `npm run db:encrypt-documents` encrypts plain files; rotation: new key in DOCUMENTS_KEY, old in DOCUMENTS_KEY_PREVIOUS, then `-- --rewrap`.\
  Losing the key loses the documents.
- Personnel file (`personnel_documents` 061, `section.people.documents` 062, HR edit:all only, not admin; `personnel-documents.controller.ts`, `PersonnelDocumentsPanel.tsx` on the Users page, "Mitarbeitende" in the navbar): HR's documents per person, each shared with the person (listed on their Documents page, notified) or HR only.\
  Access is the grant alone, not the reporting line; a person never edits their own file.\
  Each document (108) has a document date, a key date (`effective_date`, Stichtag), a follow-up date (`follow_up_date`, shown to HR only: the HR plugin's deadlines and tasks), and is shared separately with the person and with the person's manager in force (`visible_to_manager`, read only, never the rest of the line); HR may ask the person to confirm it (`require_ack`, only when shared with them; the person confirms once on their Documents page, `acknowledged_at`, the uploader is notified).\
  The categories are static data `personnel`/`document_category` (`packages/shared/src/personnelDocs.ts`), whose properties say what each asks for: `keyDate` required, `acknowledge`, `manager`, `followUpMonths` (defaults in the form; `personnelDocError` checked in the browser and the API).\
  The HR dashboard (hr plugin) shows the panel to HR and, read only, to the manager.
- Organization settings sections are collapsible (`SettingsSection.tsx`; a card uses `SectionPaper` so it shows its own title only outside a section).\
  AI and costs (`AiSettingsPanel`, plus plugins' parts via `within: 'org.ai'`) lives there.
- Reports (module `reports`, `nav.reports`, 063; `reports.controller.ts`, `Reports.tsx`): the catalogue, grouping and totals are `packages/shared/src/reports.ts` (a `balance` measure is each person's last month, summed over people).\
  Each report shows `listableUserIds` of its page object (project hours `nav.time`, attendance `nav.workTime`, absences `nav.absences`); a filter naming someone outside that is refused.\
  Attendance and absences come from `BalancesService.year`, so they match Time balances.\
  A report with a money measure keeps `alwaysGroupBy: ['currency']` and never totals across currencies (the expenses plugin's report); People (`section.people.employment`) is a snapshot on the period's last day.\
  Excel/CSV are built in the browser from the shown rows (`packages/shared/src/xlsx.ts`, no dependency); the PDF is the same table, labelled in the browser and laid out by `POST reports/pdf` (`report-pdf.ts`, pdfkit, nothing stored).\
  Saved reports (`saved_reports` 064, `saved-reports.controller.ts`): the owner edits; sharing with role names needs `nav.reports:edit` (admin, hr, manager); whoever opens one runs it with their own rights.\
  Report logic is `reports.service.ts`; labels and the table (page, PDF, Excel, scheduled files) are `packages/shared/src/reportTable.ts` with the texts in `reportTexts.ts` (spread into `dictionaries.ts`; the API uses them for scheduled files).\
  Dimension labels come from the definition (`labels`: static data or a text prefix), the project filter from `projectFilter`.\
  Plugins add reports (`ApiPlugin.reports` / `WebPlugin.reports`: one shared definition + texts, `registerReport`, `registerAvailablePluginTexts`; rows from the plugin, `report-sources.ts`, filtered by the core to the checked people).\
  The `workingTimeAct` report checks recorded attendance against the Working Hours Act (`working-time-act.ts`, pure: daily rest, breaks, 14-hour day, weekly maximum, yearly Überzeit, night and Sunday work; rules as SECO's 710.224.d summary states them; it lists findings, it does not judge permits or exceptions).\
  Schedules (065 `report_schedules` / `report_runs`, `report-schedules.service.ts`, math in `report-schedule.ts`): weekly or monthly at an hour in the owner's time zone; a job runner in the API (every minute, claims a due row by moving `next_run_at`, `REPORT_SCHEDULER=off` disables it) makes one file per recipient with that recipient's rights and language, stores it in Documents (category `report`) and notifies and mails a link, never the file.\
  Recipients other than oneself need `nav.reports:edit`; a recipient who may not see the report gets a run with the error.
- Setup checklist (`setup.controller.ts`, `SetupChecklist.tsx` on Home, `nav.orgSettings:edit` only): the steps of setting up a new organization (name, canton, work-time rules, departments with leaders, people, everyone's assignment with a manager; optional: schedules, projects, look), worked out from the data on every call (`setupSteps`, pure).\
  Only `organizations.settings.setupDismissed` is stored; Organization Settings shows it again.
- Organization look and feel (header/page/sidebar colors, logo as a data URL) lives in `organizations.settings.branding`, validated by `packages/shared/src/branding.ts` (API and browser), served by `GET/PUT organizations/:id/branding` (edit = `nav.orgSettings`).\
  App.tsx loads it per org into `BrandingContext`; `createAppTheme(mode, branding)` applies it.\
  Seeded logos are `infra/postgres/seeds/branding/*.svg`, base64-inlined in `seed.sql`.
