# Vault: end-to-end encryption in the core

The vault encrypts a module's records in the browser, so the server stores only ciphertext, public keys and wrapped keys.\
It came from the cases plugin (docs/CASES_ENCRYPTION.md describes what Cases seals) and serves any module that declares encrypted objects.\
The server never holds a passphrase, a private key or an object key.

## Keys

```
passphrase --PBKDF2-SHA256 (600 000)--> KEK --AES-GCM--> the person's RSA-OAEP 3072 private key   (vault_user_keys)
object key (random AES-256-GCM, one per encrypted object) --RSA-OAEP, one copy per holder--> vault_object_keys
file key   (random, one per file) --sealed inside its row's envelope
```

- Code: `packages/shared/src/vault.ts` (`@worktime3/shared/vault`, WebCrypto only, the same file in browser and Node tests).\
  The cases plugin's `shared/caseCrypto.ts` re-exports it.
- A person has one key pair for every organization (`vault_user_keys`, keyed by user).\
  A lost passphrase cannot be recovered, not even by an administrator; changing it re-seals the same private key, so every object key stays valid.
- An object is `<module>.<kind>` and its id (`cases.case` and the case's id).\
  `vault_object_keys` holds one wrapped copy of its key per holder, with the organization and who granted it.\
  A module's object rows carry the envelope `{v, iv, ct}` (AES-GCM, bound to the row) and blanked plaintext columns.

## Two levels

An object's level is fixed when it is created and never changes (a different level means a new object):

- **Confidential** (end to end): the object's key is wrapped for each holder (`vault_object_keys`); only holders read it, not even the operator, and opening it needs the passphrase.
- **Standard**: the same envelopes, but the server holds the key, sealed with the instance's master key (`DOCUMENTS_KEY`, `vault_object_escrow`, changeset 131, rotated by `db:encrypt-documents -- --rewrap`).\
  Whoever the module lets see the object gets the key from the server (`objects/:kind/:id/keys` answers `standard: true` and the key), without a passphrase; there are no holders to share with or remove.\
  A database dump or backup alone stays unreadable; the operator could read it.\
  Without `DOCUMENTS_KEY` there is no level Standard (`VaultService.standardAvailable`).
- The browser code is the same for both: `objectKeyFor` and `objectKeyFromList` take a Standard key as it comes, `newStandardObjectKey` makes one for a new object.

## Who may hold a key

A plugin declares its objects in `ApiPlugin.vaultObjects`: the kind (its id as prefix), the module that must be on, and `access(db, {orgId, objectId, userId, action})`, which says whether the person may see or edit the object (null: no such object).\
The core's routes (`vault.controller.ts`, `organizations/:orgId/vault/...`) store the keys and enforce the rule:

- `me` (GET, PUT), `me/passphrase` (POST): the caller's own key pair, for any member of the organization.
- `users/:userId`: a member's public key.
- `objects/:kind/:id/keys`: who holds the key and the caller's own copy, empty for someone who may not see the object.
- `objects/:kind/:id/keys/:userId` (PUT): the first key is made by someone who may edit the object, for themselves; after that a holder gives one to a member who may see it and has a key pair, never replacing someone else's.
- `objects/:kind/:id/candidates`: who may be given the key, for a sharing dialog.

Removing a holder replaces the object's key: the module re-seals its own rows and swaps the keys with `VaultService.replaceKeys` in the same transaction (the cases plugin's `POST cases/:id/rotate`).\
A module reads and writes keys only through `VaultService` (plugin contract: `keyRecord`, `holders`, `wrappedFor`, `grant`, `replaceKeys`), never the tables (`test/api/plugin-boundaries.test.ts`).

## In the browser

- `apps/web/src/vaultKeyring.ts` (plugin contract): the unlocked private key and object keys live in memory only, gone on reload, on lock, on logout and after the organization's idle minutes without use.
- `VaultControl` (plugin contract), where a module shows encrypted data, shows "Entsperren" while the keys are locked and "Verschlüsselung einrichten" the first time; once unlocked it shows nothing.
- While the keys are unlocked, the header shows a key after the logo (`VaultIndicator.tsx`): its tooltip says in how many minutes they lock themselves, a click offers "Jetzt sperren".
- The user menu's Security (`SecurityDialog.tsx`) shows the two secrets side by side: the password (sign in, changed through a link by e-mail, two-step login) and the encryption passphrase (set up, unlock, lock now, change; the `VaultDialog`).\
  A new passphrase re-seals only the private key, so no object is decrypted or encrypted again, however many there are.\
  Modules still ask for it where it is needed (Cases' "Entsperren").
- Organization settings -> End-to-end encryption sets the idle minutes (`organizations.settings.vault.idleMinutes`, 5 to 480, default 30; `GET/PUT organizations/:orgId/vault/settings`, `nav.orgSettings`).

## Database

Core changeset 130 (`vault_user_keys`, `vault_object_keys`).\
The cases plugin's changeset 011 copied its `cases.user_keys` and `cases.case_keys` into them (same records, nothing re-encrypted) and removes a deleted case's keys by trigger; its old tables stay one release, unused, then a later changeset drops them.

## Tests

`test/api/vault.test.ts` (who may hold a key, own key pair, idle minutes, the sharing list); the crypto itself is tested by the cases plugin's `test/case-crypto.test.ts`.
