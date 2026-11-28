import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db.service';
import type { Response } from 'express';
import { documents } from './db/schema';
import { currentMasterKey, decryptDocument, encryptDocument, masterKeys } from './document-crypto';
import { clock } from './clock';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** One line of a person's Documents page (documents.controller.ts). */
export interface PersonalDocument {
  /** The `documents` row. */
  documentId: string;
  /** The core's ('timesheet', 'project_timesheet', 'absence', 'flow', 'personnel', 'report') or a plugin's. */
  category: string;
  /** The record it belongs to (timesheet period, absence, request, ...; the month for a project report). */
  sourceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** The date the document is about (month, absence start, message day, ...). */
  date: string;
  addedAt: string;
  superseded: boolean;
  /** Context for the list: absence type and end, request subject, ... (the web part describes it). */
  context: Record<string, string | number | null>;
}

/** A plugin's documents of one person (DocumentsService.registerPersonalDocuments). */
export type PersonalDocumentSource = (db: Db, orgId: string, userId: string) => Promise<PersonalDocument[]>;
// Resolved relative to this compiled file (dist/documents.service.js), so storage location
// doesn't depend on the process's working directory. Override with DOCUMENTS_DIR.
export const DOCUMENTS_ROOT = process.env.DOCUMENTS_DIR ?? join(__dirname, '..', 'data', 'documents');

/**
 * Generic evidence-document storage (local disk + a `documents` metadata row), reused by any
 * record that needs at most one attachment — an absence's doctor's note, an expense's pay slip.
 * The owning record (absences/expenses) holds a nullable `document_id` FK; this service doesn't
 * know or care which table that is.
 *
 * Files are encrypted at rest when DOCUMENTS_KEY is set (document-crypto.ts); reading always goes
 * through `read`/`send`, which decrypt. Without the key files are stored plain (warned at startup).
 */
/** A document's row as `rowsOf` gives it: what `read`/`send` take, and whom it belongs to (its source). */
export interface DocumentRow {
  id: string; file_name: string; mime_type: string; size_bytes: number | null; storage_path: string; encrypted_key: string | null; key_id: string | null;
  source_table: string | null; source_table_id: string | null;
}

@Injectable()
export class DocumentsService {
  private readonly personalSources = new Map<string, PersonalDocumentSource>();

  /**
   * Adds a plugin's documents to every person's Documents page (and so to what they may download
   * there): `list` returns that person's own documents of `category`, nobody else's.
   */
  registerPersonalDocuments(category: string, list: PersonalDocumentSource): void {
    this.personalSources.set(category, list);
  }

  /** The registered plugin sources (documents.controller.ts merges them into the list). */
  personalDocumentSources(): ReadonlyMap<string, PersonalDocumentSource> {
    return this.personalSources;
  }
  /**
   * Writes the file to disk and inserts its metadata row; returns the new document id.
   * `sourceTable`/`sourceTableId` are a diagnostic-only reverse pointer to whatever row this
   * upload is for (e.g. `('absences', <absence id>)`) — access control still goes through that
   * row's own `document_id` FK, not through these.
   */
  async upload(
    db: Db,
    organizationId: string,
    uploadedByUserId: string,
    file: Express.Multer.File,
    source: { table: string; id: string },
  ): Promise<string> {
    return this.store(db, organizationId, uploadedByUserId, { name: file.originalname, mimeType: file.mimetype, buffer: file.buffer }, source);
  }

  /** Like `upload`, for a file the API made itself (e.g. a timesheet PDF). */
  async store(
    db: Db,
    organizationId: string,
    uploadedByUserId: string | null,
    file: { name: string; mimeType: string; buffer: Buffer },
    source: { table: string; id: string },
  ): Promise<string> {
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-200) || 'document';
    const storedName = `${randomUUID()}-${safeName}`;
    const relativePath = join(organizationId, storedName);
    const master = currentMasterKey();
    const sealed = master ? encryptDocument(file.buffer, master) : null;
    await mkdir(join(DOCUMENTS_ROOT, organizationId), { recursive: true });
    await writeFile(join(DOCUMENTS_ROOT, relativePath), sealed ? sealed.file : file.buffer);

    const [row] = await db
      .insert(documents)
      .values({
        organization_id: organizationId,
        file_name: file.name,
        mime_type: file.mimeType,
        size_bytes: file.buffer.length,
        storage_path: relativePath,
        source_table: source.table,
        source_table_id: source.id,
        uploaded_by_user_id: uploadedByUserId,
        encrypted_key: sealed?.encryptedKey ?? null,
        key_id: sealed?.keyId ?? null,
        created_at: clock.now().toISOString(),
      })
      .returning({ id: documents.id });
    return row.id;
  }

  /** A document's content, decrypted. */
  /** The organization's documents with these ids, as `read` takes them (for a plugin that holds their ids). */
  async rowsOf(db: Db, orgId: string, ids: readonly string[]): Promise<DocumentRow[]> {
    const ok = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ok.length) return [];
    const rows = await db.execute(sql`SELECT id, file_name, mime_type, size_bytes, storage_path, encrypted_key, key_id, source_table, source_table_id
      FROM documents WHERE organization_id = ${orgId}::uuid AND id = ANY(${`{${ok.join(',')}}`}::uuid[])`);
    return rows.rows as unknown as DocumentRow[];
  }

  async read(doc: { storage_path: string; encrypted_key: string | null; key_id: string | null }): Promise<Buffer> {
    const file = await readFile(join(DOCUMENTS_ROOT, doc.storage_path));
    return doc.encrypted_key && doc.key_id ? decryptDocument(file, doc.encrypted_key, doc.key_id, masterKeys()) : file;
  }

  /** Sends a document as a download (the caller has checked access); 404 when the file is gone. */
  /** Sends the file; `publicCache` (public news pictures) lets browsers and proxies keep it and shows it inline. */
  async send(
    res: Response,
    doc: { file_name: string; mime_type: string; storage_path: string; encrypted_key: string | null; key_id: string | null },
    options: { publicCache?: string } = {},
  ): Promise<void> {
    let content: Buffer;
    try {
      content = await this.read(doc);
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException)?.code === 'ENOENT';
      if (!missing) {
        // eslint-disable-next-line no-console
        console.error(`document ${doc.storage_path} could not be read: ${err instanceof Error ? err.message : err}`);
      }
      res.status(missing ? 404 : 500).json({ ok: false, error: missing ? 'not-found' : 'document-unreadable' });
      return;
    }
    res.set({
      'Content-Type': doc.mime_type,
      'Content-Disposition': `${options.publicCache ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': options.publicCache ?? 'private, no-store',
    });
    res.send(content);
  }

  async get(db: Db, documentId: string) {
    const [row] = await db.select().from(documents).where(eq(documents.id, documentId));
    return row;
  }

  /** Deletes the metadata row and best-effort removes the file. Safe to call with a stale/missing id. */
  async remove(db: Db, documentId: string): Promise<void> {
    const [row] = await db.select({ storage_path: documents.storage_path }).from(documents).where(eq(documents.id, documentId));
    await db.delete(documents).where(eq(documents.id, documentId));
    if (row) await unlink(join(DOCUMENTS_ROOT, row.storage_path)).catch(() => {});
  }
}
