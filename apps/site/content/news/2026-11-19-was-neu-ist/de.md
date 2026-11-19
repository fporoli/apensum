---
title: Was neu ist in Apensum
summary: Module, Spesen mit Belegerkennung, Fälle und Gutachten und vieles mehr – die Änderungen der letzten Tage.
draft: true
---

ROHFASSUNG: unten die letzten 50 Änderungen aus Git (git log), noch auf Englisch. Bitte durch einen eigenen Text ersetzen und dann `draft: true` entfernen.

Ein Bild kommt so in den Text: Datei in diesen Ordner legen und `![Beschreibung](bild.jpg)` allein auf eine Zeile schreiben.

## Die letzten 50 Änderungen

- 2026-11-19: feat(site): sell the app, not the framework
- 2026-11-19: feat(site): news by e-mail with double opt-in and unsubscribe
- 2026-11-19: feat(site): Modules submenu and a "build your own module" page
- 2026-11-19: feat(site): position Apensum as modular framework with free cases and expenses modules
- 2026-11-19: feat(plugins): Cases becomes a plugin
- 2026-11-19: feat(plugins): a plugin may own a Postgres schema
- 2026-11-19: refactor(ai): the AI budget and limit are the core's, not Cases'
- 2026-11-19: feat(plugins): plugin seeds; the expense demo data moves to the plugin
- 2026-11-19: refactor(plugins): the last expense code leaves the core
- 2026-11-19: feat(plugins): plugin names start with the plugin's id
- 2026-11-19: feat(plugins): plugin API version in the manifest
- 2026-11-19: refactor(plugins): everything a plugin adds to the API is declared in defineApiPlugin
- 2026-11-19: ci(plugins): the core without plugins; plugin tests in CI
- 2026-11-19: feat(plugins): plugin-owned tables; the expense tables move to the plugin's schema
- 2026-11-19: feat(plugins): payroll items and backup parts; expense import/export moves to the plugin
- 2026-11-19: feat(plugins): plugin team tables; the expenses team views move to the plugin
- 2026-11-19: feat(plugins): plugin documents on the Documents page; expense receipts move to the plugin
- 2026-11-19: feat(plugins): approvals API without expense code in the core
- 2026-11-19: feat(plugins): plugin reports; the expenses report moves to the plugin
- 2026-11-19: feat(plugins): plugin-owned permissions and Liquibase changelogs
- 2026-11-19: refactor(web): core pages in the plugin page format; generic navbar
- 2026-11-19: feat(plugins): workflow kinds; expense report review moves to the plugin
- 2026-11-19: feat(plugins): plugin architecture, expenses as the first plugin
- 2026-11-19: feat(site): KESB case video, expense features; fix stale Azure connections
- 2026-11-19: feat(expenses): leaner form with foreign-currency checkbox and manual override
- 2026-11-19: feat(expenses): exchange rates, mileage and AI receipt recognition
- 2026-11-19: fix(docker): improve JDBC driver download command for reliability
- 2026-11-19: feat: add Azure AI integration for transcription and summaries
- 2026-11-18: perf(api): cache Intl.DateTimeFormat per time zone
- 2026-11-18: feat: add transcription feature with Whisper integration
- 2026-11-18: feat(cases): enhance case creation with permission checks and required field validation feat(db): add role permissions for cases across all roles in the database
- 2026-11-18: fix(db): drop cases schema alongside public on reset-db
- 2026-11-18: feat(cases): add Case Management & Assessment plugin in dedicated cases schema
- 2026-11-18: feat(setup): implement setup checklist and related functionality for organization setup
- 2026-11-18: feat: update localization slugs and add GitHub button functionality
- 2026-11-18: feat: add Working Hours Act compliance features
- 2026-11-18: feat(site-deploy): add site deployment script and update README instructions
- 2026-11-18: feat: enhance reporting line logic and permissions for user data access across various components
- 2026-11-18: feat(requests): add request type, urgency, and link functionality
- 2026-11-18: feat: add mobile PWA demo instructions and call-to-action in multiple languages
- 2026-11-18: feat: enhance README and localization files with Swiss payroll and calendar feed features
- 2026-11-18: feat(calendar-feed): implement calendar feed controller and service
- 2026-11-18: feat: enhance navigation with expandable sub-items and improve user interface in Invitations and Users pages
- 2026-11-18: feat: add Import/Export functionality and related permissions
- 2026-11-18: fix(theme): update primary color values and adjust component styles for improved UI consistency
- 2026-11-17: feat: add open source information and links across the site
- 2026-11-17: Refactor expense handling and static data management
- 2026-11-17: fix(docs): update stack command usage to clarify --reset option
- 2026-11-17: fix(config): update SMTP_HOST to use Mailpit for outgoing mail
- 2026-11-17: fix(db): drop index operator classes from the introspected schema
