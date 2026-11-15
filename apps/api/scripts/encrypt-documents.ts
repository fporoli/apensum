/**
 * Encrypts stored documents that are still plain (uploaded before encryption, or while DOCUMENTS_KEY
 * was unset), and with `--rewrap` re-wraps the data keys of documents encrypted with an older master
 * key (DOCUMENTS_KEY_PREVIOUS) under the current DOCUMENTS_KEY, so the old key can then be dropped.
 * Reads DATABASE_URL, DOCUMENTS_KEY(_PREVIOUS) and DOCUMENTS_DIR from the environment; run it where
 * the API's files are (dev: this machine; Docker stacks: inside the API container).
 * Each file is written to `<file>.enc-tmp`, then its row is marked encrypted, then the file is renamed
 * over the plain one. A run interrupted between the last two steps leaves the `.enc-tmp` file; the next
 * run finishes those renames first, then continues with what is left.
 *
 * Usage (from the repo root): npm run db:encrypt-documents [-- --rewrap]
 */
import { Pool } from 'pg';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DOCUMENTS_ROOT } from '../src/documents.service';
import { currentMasterKey, encryptDocument, masterKeys, rewrapKey } from '../src/document-crypto';

async function main() {
  const url = process.env.DATABASE_URL;
  const master = currentMasterKey();
  if (!url || !master) {
    console.error('db:encrypt-documents: DATABASE_URL and DOCUMENTS_KEY must be set');
    process.exit(1);
  }
  const rewrap = process.argv.includes('--rewrap');
  const pool = new Pool({ connectionString: url });
  let encrypted = 0;
  let rewrapped = 0;
  let missing = 0;
  try {
    // Finish renames an interrupted run left behind (row already encrypted, file still plain).
    const done = await pool.query<{ storage_path: string }>('SELECT storage_path FROM documents WHERE encrypted_key IS NOT NULL');
    for (const doc of done.rows) {
      const path = join(DOCUMENTS_ROOT, doc.storage_path);
      const exists = await access(`${path}.enc-tmp`).then(() => true, () => false);
      if (exists) await rename(`${path}.enc-tmp`, path);
    }
    const plain = await pool.query<{ id: string; storage_path: string }>('SELECT id, storage_path FROM documents WHERE encrypted_key IS NULL ORDER BY id');
    for (const doc of plain.rows) {
      const path = join(DOCUMENTS_ROOT, doc.storage_path);
      let content: Buffer;
      try {
        content = await readFile(path);
      } catch {
        missing += 1;
        continue;
      }
      const sealed = encryptDocument(content, master);
      await writeFile(`${path}.enc-tmp`, sealed.file);
      await pool.query('UPDATE documents SET encrypted_key = $1, key_id = $2 WHERE id = $3 AND encrypted_key IS NULL', [sealed.encryptedKey, sealed.keyId, doc.id]);
      await rename(`${path}.enc-tmp`, path);
      encrypted += 1;
    }
    if (rewrap) {
      const keys = masterKeys();
      const old = await pool.query<{ id: string; encrypted_key: string; key_id: string }>(
        'SELECT id, encrypted_key, key_id FROM documents WHERE encrypted_key IS NOT NULL AND key_id <> $1',
        [master.id],
      );
      for (const doc of old.rows) {
        const next = rewrapKey(doc.encrypted_key, doc.key_id, keys, master);
        await pool.query('UPDATE documents SET encrypted_key = $1, key_id = $2 WHERE id = $3', [next.encryptedKey, next.keyId, doc.id]);
        rewrapped += 1;
      }
    }
    console.log(`db:encrypt-documents: encrypted ${encrypted}, re-wrapped ${rewrapped}, files missing ${missing}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
