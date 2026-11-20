# APensum — Comprehensive System Review & Architecture Assessment

**Author:** Antigravity Engineering Review  
**Date:** November 2026  
**Scope:** Core Web & API (`apps/web`, `apps/api`), Website (`apps/site`), Plugin Framework (`plugins/*`), Shared Core (`packages/shared`), Infrastructure & Deployment.

---

## 1. Executive Summary

APensum has matured from an enterprise time-tracking application into a **modular, extensible Swiss enterprise framework and business suite**. It solves two core enterprise pain points simultaneously:
1. **Strict Swiss Regulatory & Payroll Precision:** Uncompromising adherence to Swiss labor law (ArG — Arbeitsgesetz), cantonal public holidays (26 cantons), Pensum proration, and standard Swiss payroll exports (Abacus AbaSalary, Bexio).
2. **Extensible Modular Architecture:** A clean plugin system (`plugins/<id>`) allowing organizations to add domain-specific business applications (e.g. legal/medical dossier assessments, expense management, project billing) without touching or destabilizing the core.

The code quality across all workspaces is notably high: typed throughout, modularized, highly automated with Liquibase changelogs, and supported by fast, isolated unit and integration tests.

---

## 2. Core Architecture Assessment

### 2.1 The Plugin System (`plugins/<id>`)
- **Design:** Plugins are first-class citizen packages (`@worktime3/<id>`) exporting `defineApiPlugin` (controllers, providers, workflow hooks, payroll hooks, document categories) and `defineWebPlugin` (pages, nav groups, texts, settings, badges).
- **Strict Namespacing:** Enforced by `packages/shared/src/pluginApi.ts`. Every plugin-contributed entity (database tables, custom schemas, permission objects, route paths, nav entries) must be prefixed with the plugin ID. This eliminates naming collisions and allows clean runtime loading.
- **Tenant Isolation & Module Toggles:** Org admins can toggle individual modules on or off in Organization Settings. The permission resolver (`permissionIdsOf`) dynamically masks off disabled module permissions, preventing access at both the API guard and UI layer.
- **Schema Ownership:** Plugins maintain their own Liquibase changelog tree (`plugins/<id>/changelog/`) and run after the core changelogs, isolating schema evolution.

### 2.2 Swiss Compliance & Business Logic
- **ArG Überzeit vs. Flextime:** APensum tracks Überzeit (statutory overtime beyond 45 or 50 hours per week) in a distinct account from regular flextime, honoring Swiss labor law requirements.
- **Cantonal Holiday Engine:** Evaluates floating and fixed holidays across all 26 Swiss cantons, respecting regional variations and part-time employee workload percentages.
- **Payroll Interfaces:** Built-in generators for Abacus AbaSalary Lohnarten CSV and Bexio payroll, ensuring direct integration with Swiss accounting systems.
- **Absence Calendar Feeds:** Implements compliant RFC 5545 iCalendar feeds (`personal`, `team`, `all`) with secure capability tokens, allowing employees and managers to subscribe via Apple Calendar, Outlook, and Google Calendar.

### 2.3 Security, Privacy & Zero-Knowledge Dossier Encryption
- **Client-Side Envelope Encryption (`plugins/cases`):**
  - Case files and sensitive assessment notes are encrypted using **AES-256-GCM**.
  - Symmetric Case Keys are derived using PBKDF2/Argon2id and wrapped per member with individual public/private key pairs.
  - The database only ever stores encrypted envelopes. Neither database administrators nor compromised host environments can inspect sensitive case contents.
- **Identity & Access Control:**
  - Integrated Keycloak OIDC authentication + local HS256 JWT fallback unified behind a single `jwt.guard.ts`.
  - Granular RBAC permissions with scoped checks (`own`, `team`, `reports`, `all`).
- **Comprehensive Audit Trail:** All critical operations (logins, role alterations, data modifications, exports) are recorded in an append-only `audit_log` with actor metadata and serialized state diffs.

### 2.4 AI Transcription & Synthesis Pipeline
- **Swiss Provider Only:** Azure OpenAI in Switzerland for audio transcription (Whisper) and LLM inference; no other AI provider receives data.
- **Cost & Budget Control:** Enforces monthly CHF budget limits per instance and per organization with automated circuit breakers to eliminate unexpected cloud billing.
- **Interview Workflow:** Audio interviews are uploaded, transcribed with Swiss German / German phonetic accuracy, and synthesized into structured assessment sections while maintaining strict citation of source notes.

---

## 3. Website & Product Positioning Review (`apps/site`)

### 3.1 Framework vs. Single App Narrative
- The website now clearly positions APensum as a **Modular Swiss Business Suite & Framework**:
  - The core delivers time-tracking, ArG compliance, employee management, and payroll exports.
  - Modules extend the suite: **Fälle & Gutachten (Cases & Assessments)** and **Spesen & Quittungen (Expenses & Receipts)** are highlighted as bundled, production-ready modules.
- **Opportunities:**
  - Create a dedicated **Modules** dropdown in the site navigation, housing:
    - *Cases & Assessments* (Dossier management, audio recording, AI transcription)
    - *Expenses & Receipts* (Multi-currency, OCR receipts, multi-step approvals)
    - *Plugin Developer Guide* ("Build a custom module in TypeScript in 5 steps")
  - Remove redundant feature sections from the core Features page to avoid dilution.

### 3.2 Performance & Technical Architecture of `apps/site`
- **Zero-Hydration Static Generator:** Built with `build.mjs` and native Node.js. Generates 68 pre-rendered static HTML pages with zero client-side JavaScript bloat.
- **Lighthouse Performance:** Near-instantaneous loading times (sub-100ms TTFB), optimal for SEO and mobile discovery.
- **Multilingual Support:** High-quality translations across 4 languages (`de`, `en`, `fr`, `it`) adhering to Swiss orthography rules (no `ß`, correct quotation marks `«...»`).

---

## 4. Key Strengths & Technical Highlights

1. **Robust Build & CI Pipeline:** Fast builds across workspaces using Vite, Rolldown, and TypeScript. All tests run in milliseconds without heavyweight container overhead.
2. **High Database Discipline:** Liquibase enforces immutable, verifiable changelogs; Drizzle provides typed SQL queries without the performance overhead of full-featured ORMs.
3. **PWA Mobile-First Experience:** The web app functions as a native-feeling Progressive Web App with dedicated offline login support and 1-click mobile home-screen installation.
4. **Data Sovereignty:** Full organization backup into single ZIP archives containing relational JSON dumps and encrypted documents with one-click disaster recovery restore.

---

## 5. Prioritized Roadmap & Recommendations

### Short-Term (Completed & Validated)
- [x] **Website Modules Submenu & Plugin Developer Page:** Marketing website navigation features a dedicated "Modules" (`Module`) dropdown containing *Cases* (`/faelle-gutachten`), *Expenses* (`/spesen`), and the *Plugin Developer Guide* (`/plugins`), with clean removal of redundant sections from the core Features page.
- [x] **Correct VPS Port Documentation:** Updated `README.md` to accurately document `5436` for Production, `5434` for Preprod, and `5437` for Demo.
- [x] **Preserve Clean Plugin Format:** Plugins remain CommonJS to seamlessly match NestJS runtime resolution and Drizzle ORM typing without dual-package hazards.

### Medium-Term (Feature & Architecture Improvements)
- [ ] **Plugin CLI & Scaffolding Generator:** Add an `npm run plugin:create <name>` command that scaffolds a fully compliant plugin directory with manifest, sample controller, sample page, and test suite.
- [ ] **Offline PWA Time Logging:** Allow employees to log clock-in/out and basic notes when completely offline (e.g. in remote alpine areas or underground facilities) with background sync when connectivity returns.
- [ ] **WebHook / Event Dispatcher for Plugins:** Introduce an internal event bus allowing plugins to subscribe to core events (e.g., `user.created`, `timesheet.submitted`, `period.locked`).

### Long-Term (Ecosystem & Enterprise Scaling)
- [ ] **Public / Private Plugin Marketplace:** Provide a registry for verified external plugins (e.g. customized industry calculators, billing integrations, ERP connectors).
- [ ] **Enterprise SSO Provisioning (SCIM 2.0):** Implement SCIM endpoints to auto-provision and de-provision employees directly from Microsoft Entra ID (Azure AD) or Okta.
