# Apensum — Comprehensive System Review & Architecture Assessment

**Author:** Antigravity Engineering Review  
**Date:** November 2026  
**Scope:** Core Web & API (`apps/web`, `apps/api`), Website (`apps/site`), Plugin Framework (`plugins/*`), Shared Core (`packages/shared`), Infrastructure & Deployment.

---

## 1. Executive Summary

Apensum has matured from an enterprise time-tracking application into a **modular, extensible Swiss enterprise framework and business suite**. It solves two core enterprise pain points simultaneously:
1. **Strict Swiss Regulatory & Payroll Precision:** Uncompromising adherence to Swiss labor law (ArG — Arbeitsgesetz), cantonal public holidays (26 cantons), Pensum proration, and standard Swiss payroll exports (Abacus AbaSalary, Bexio).
2. **Extensible Modular Architecture:** A clean plugin system (`plugins/<id>`) allowing organizations to add domain-specific business applications (e.g. legal/medical dossier assessments, expense management, project billing) without touching or destabilizing the core.

The code quality across all workspaces is notably high: typed throughout, modularized, highly automated with Liquibase changelogs, and supported by fast, isolated unit and integration tests.

---

## 2. Core Architecture Assessment

### 2.1 The Plugin System (`plugins/<id>`)
- **Design:** Plugins are folders loaded from `plugins/`, not independently installed npm workspaces.
  Their manifests declare the plugin API version (currently 3), optional module and permissions, database ownership, and API/web entry points.\
  `defineApiPlugin` and `defineWebPlugin` register the plugin's API, pages, texts, settings and extension points.
- **Extension points:** Plugins can contribute pages, reports, team views, payroll items, documents, workflow kinds, workflow actions, assistant tools, settings, and planned work-time minutes.\
  The core checks plugin API compatibility at API startup and web build, and validates namespaced plugin contributions.
- **Modules and licensing:** Organizations can enable or disable registered modules in Organization Settings.
  Disabled module permissions are removed from the effective permissions, which hides plugin pages and makes corresponding permission checks fail.\
  Licensed modules also require an operator-granted license before an organization can enable them.
- **Schema ownership:** A plugin can own a Postgres schema (`apensum.dbSchema`) or declare tables in `public` (`apensum.tables`).\
  Its Liquibase changelogs run after the core changelog, and declared tables are introspected into that plugin's `api/db/schema.ts`, not the core's generated schema.
- **Deployment:** Standard product builds include the private plugin code; core-only CI is a separate check that Apensum also runs without plugins.\
  A customer building from source needs the corresponding private plugin source trees or authorized repository access.\
  Installed code does not by itself enable a module or satisfy its license requirement.

### 2.2 Swiss Compliance & Business Logic
- **ArG Überzeit vs. Flextime:** Apensum tracks Überzeit (statutory overtime beyond 45 or 50 hours per week) in a distinct account from regular flextime, honoring Swiss labor law requirements.
- **Cantonal Holiday Engine:** Evaluates floating and fixed holidays across all 26 Swiss cantons, respecting regional variations and part-time employee workload percentages.
- **Payroll Interfaces:** Built-in payroll exports include Abacus wage types; other exports and plugin-provided payroll items are registered through the plugin API.
- **Absence Calendar Feeds:** Implements compliant RFC 5545 iCalendar feeds (`personal`, `team`, `all`) with secure capability tokens, allowing employees and managers to subscribe via Apple Calendar, Outlook, and Google Calendar.

### 2.3 Security, Privacy & Zero-Knowledge Dossier Encryption
- **Client-Side Envelope Encryption (`plugins/cases`):**
  - Encrypted case fields are sealed in the browser with the case's AES-256-GCM key; that key is wrapped to authorized members' RSA public keys.
  - Each document or interview audio file uses its own random file key, sealed in the corresponding row.
  - The user's RSA private key is wrapped under a key derived from their passphrase with PBKDF2; the server does not receive passphrases or unwrapped keys.
  - The server refuses plaintext writes to encrypted case records and does not index or process their stored fields.
  - When an authorized user invokes AI or PDF computation, the browser sends decrypted content for that stateless request; the server does not persist that plaintext.
  - This protects stored case content from database-only access, but does not make a compromised browser or delivery of malicious client code harmless.
- **Identity & Access Control:**
  - Integrated Keycloak OIDC authentication + local HS256 JWT fallback unified behind a single `jwt.guard.ts`.
  - Granular RBAC permissions with scoped checks (`own`, `team`, `reports`, `all`).
- **Audit Trail:** Security-sensitive actions and writes are audited, with metadata describing the event rather than storing sensitive values or notes.
  Row history is recorded separately through the versioning system.

### 2.4 AI Transcription & Synthesis Pipeline
- **Swiss Provider Only:** Azure OpenAI in Switzerland for audio transcription (Whisper) and LLM inference; no other AI provider receives data.
- **Cost & Budget Control:** Azure calls reserve and settle usage through the shared AI budget service, with instance and organization CHF limits, configurable prices, and a global kill switch.
- **Case AI:** Organization settings control transcription, summaries and assessment drafts.
  Drafts use a fixed grounding prompt, include documents and current interview material, and require evidence markers and source quotes for factual statements.\
  Assessment guidance can influence focus and structure but is explicitly lower priority than source documents and interviews.
- **Encrypted cases:** AI requests use a browser-decrypted, stateless compute path; the server stores neither the decrypted request content nor generated plaintext on the encrypted case.

---

## 3. Website & Product Positioning Review (`apps/site`)

### 3.1 Framework vs. Single App Narrative
- The website now clearly positions Apensum as a **Modular Swiss Business Suite & Framework**:
  - The core delivers time-tracking, ArG compliance, employee management, and payroll exports.
  - The site has a Modules navigation group for Cases & Assessments, Expenses & Receipts, and the plugin developer guide.
  - The standard product build includes private plugins for HR, HR Plus, roster planning, billing, whistleblowing and personal notes, alongside Cases and Expenses.
  - Module settings and, for licensed modules, operator-granted licenses determine which organizations can use those installed features.
- **Review point:** Keep public product claims aligned with the modules available and licensed for each organization.

### 3.2 Performance & Technical Architecture of `apps/site`
- **Zero-Hydration Static Generator:** Built with `build.mjs` and native Node.js. Generates 68 pre-rendered static HTML pages with zero client-side JavaScript bloat.
- **Lighthouse Performance:** Near-instantaneous loading times (sub-100ms TTFB), optimal for SEO and mobile discovery.
- **Multilingual Support:** High-quality translations across 4 languages (`de`, `en`, `fr`, `it`) adhering to Swiss orthography rules (no `ß`, correct quotation marks `«...»`).

---

## 4. Key Strengths & Technical Highlights

1. **Robust Build & CI Pipeline:** Fast builds across workspaces using Vite, Rolldown, and TypeScript. All tests run in milliseconds without heavyweight container overhead.
2. **High Database Discipline:** Liquibase enforces immutable, verifiable changelogs; Drizzle provides typed SQL queries without the performance overhead of full-featured ORMs.
3. **PWA Mobile-First Experience:** The web app functions as a native-feeling Progressive Web App with dedicated offline login support and 1-click mobile home-screen installation.
4. **Data Sovereignty:** Payroll and report exports as CSV and Excel; a whole organization's data comes from the operator's database dump.

---

## 5. Prioritized Roadmap & Recommendations

### Short-Term (Completed & Validated)
- [x] **Website Modules Submenu & Plugin Developer Page:** Marketing navigation groups Cases, Expenses, and the plugin guide under Modules.
- [x] **Correct VPS Port Documentation:** Updated `README.md` to accurately document `5436` for Production, `5434` for Preprod, and `5437` for Demo.
- [x] **Plugin API Compatibility:** The current plugin API version is checked at API startup and web build, and core-only CI validates operation without plugins.

### Medium-Term (Feature & Architecture Improvements)
- [ ] **Plugin CLI & Scaffolding Generator:** Add an `npm run plugin:create <name>` command that scaffolds a fully compliant plugin directory with manifest, sample controller, sample page, and test suite.
- [ ] **Offline PWA Time Logging:** Allow employees to log clock-in/out and basic notes when completely offline (e.g. in remote alpine areas or underground facilities) with background sync when connectivity returns.
- [ ] **WebHook / Event Dispatcher for Plugins:** Introduce an internal event bus allowing plugins to subscribe to core events (e.g., `user.created`, `timesheet.submitted`, `period.locked`).

### Long-Term (Ecosystem & Enterprise Scaling)
- [ ] **Public / Private Plugin Marketplace:** Provide a registry for verified external plugins (e.g. customized industry calculators, billing integrations, ERP connectors).
- [ ] **Enterprise SSO Provisioning (SCIM 2.0):** Implement SCIM endpoints to auto-provision and de-provision employees directly from Microsoft Entra ID (Azure AD) or Okta.
