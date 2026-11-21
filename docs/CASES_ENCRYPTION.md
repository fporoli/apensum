# Cases: end-to-end encryption

The Cases plugin (`plugins/cases`) encrypts a case in the browser. The server stores ciphertext, public keys and
wrapped keys, and never holds a passphrase, a private key or a case key. A database dump, a backup or an
administrator with server access reads no case content.

## Keys

```
passphrase --PBKDF2-SHA256 (600 000)--> KEK --AES-GCM--> user's RSA-OAEP 3072 private key   (stored wrapped)
case key   (random AES-256-GCM)  --RSA-OAEP, one copy per member--> cases.case_keys
file key   (random, one per document / audio) --sealed inside that file's row (enc)
```

- Code: `plugins/cases/shared/caseCrypto.ts` (WebCrypto only, no dependency, same file in browser and Node tests).
- A user sets a passphrase the first time they open Cases (`CaseKeyControl`). The unlocked private key and case keys
  live in memory only (`web/caseKeyring.ts`): gone on reload, on lock and after 30 minutes without use.
- **A lost passphrase cannot be recovered**, not even by an administrator. The cases a person alone holds are then
  unreadable to them, and there is no reset of the key pair (that would need a new feature). Colleagues who hold the
  case key still read it, so share important cases with a second person. The setup dialog says so before the
  passphrase is chosen.
- Changing the passphrase re-seals the same private key; case keys stay valid.

## What is encrypted

Each encrypted row carries an `enc` envelope `{v, iv, ct}` (AES-GCM, bound to `cases:<kind>:<row id>` so the server
cannot move a secret to another row). The plaintext columns are blanked (`''`, `{}`, NULL).

| Row | Sealed in `enc` | Readable on purpose |
| --- | --- | --- |
| case | title, subject name and date of birth, metadata, custom fields | reference number, domain, status, lead, confidentiality |
| interview | name, transcript, summary, tags, audio type and key | role, date, duration, interviewer |
| assessment | title, section texts, custom fields | status, template, version |
| document | title, extracted text, file name and type, file key | category |

Files (documents, interview audio) are stored as ciphertext named `document.bin` / `interview-audio.bin`, under their
own key, which is sealed in the row. Fields list: `shared/caseVault.ts`.

## Who holds a key

`cases.case_keys` has one wrapped copy of the case key per member. The server enforces who may hold one
(`api/case-keys.controller.ts`): the first key is made by someone who may edit the case, for themselves; after that a
holder gives it to an organization member who has set up keys and may see the case. Access to the row (`nav.cases`
scopes) still applies on top: a key alone opens nothing the person may not list.

**Removing a member** replaces the case key (`POST cases/:id/rotate`): the browser opens every row with the old key,
seals it with a new one, wraps that for those who stay, and the server swaps everything in one transaction. It
refuses with `case-changed` if the case was edited meanwhile, and requires every row exactly once. Files are not
touched (own keys). A removed person keeps what they already read.

## What the server cannot do for an encrypted case

It cannot read the case, so these run in the browser or as stateless jobs:

- **Rule-based draft** (`shared/caseDraft.ts`) and **Word export** (`shared/caseDocx.ts`): browser only.
- **Transcription, summary, AI draft, PDF, PDF text extraction** (`POST cases/:id/compute/*`): the browser sends the
  decrypted content with that one request; the server works in memory, stores nothing and returns the result, which the
  browser seals before saving. Same access checks, AI consent and `AiBudgetService` as for a plain case. Plaintext is
  therefore in server memory (and at the AI provider, if one is chosen) for the length of that call, on the user's click.
- The plain endpoints for these jobs refuse an encrypted case with `case-encrypted`. A plain write to an encrypted row
  is refused the same way; an envelope sent for a plain case with `case-not-encrypted` (`api/case-encryption.ts`).
- Search covers the reference number on the server; encrypted cases are always returned and the browser filters
  them by their opened title and subject.

Every new case is encrypted: the create dialog has no opt-out and the API refuses a case created without an envelope
(`case-must-be-encrypted`). Cases that existed before encryption are not converted; the plaintext code paths remain only for them.

## Custom fields

An organization defines extra fields for cases and assessments in design mode on the Cases page, like any
configurable form (docs/FIELD_CONFIG.md): templates of the forms `cases.case` and `cases.assessment`
(`shared/forms.ts`, `field_config`; the old `settings.cases.customFields` were moved there by the plugin's
changeset 006). Only the definitions are plain; values live in the `custom` column, or inside `enc` for an
encrypted case. `customValuesErrors` checks them against the template: the API for plain rows, the browser
for encrypted ones. They are not in the PDF/Word export yet.

## Database

Changelogs in `plugins/cases/changelog/`: `002` (`user_keys`, `case_keys`), `003` (`enc`, `custom` on cases, interviews,
assessments), `004` (`enc` on documents).

## Tests

`plugins/cases/test/`: `case-crypto` (key wrapping, tampering, passphrase change), `case-keys` (who may hold a key),
`case-encryption` (write rules, rotation coverage, compute content), `case-draft`, `case-docx`, `cases`. Run by `npm test`.

## Claims

The product pages must say only what is true above: the server cannot read an encrypted case at rest; during
transcription, summaries, AI drafts and PDF the content is processed in server memory for that request; there is no
password recovery.
