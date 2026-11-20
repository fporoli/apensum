/**
 * Profile pictures. An uploaded picture is a document (DocumentsService: encrypted at rest); the user's
 * `avatar_url` then holds `doc:<document id>`, short enough for its varchar(1024), and responses turn it
 * into the public picture URL. Anything else in `avatar_url` (an http(s) or a small data URL, e.g. the
 * seeded demo portraits) is passed through as it is. Pure, so tests need no database.
 */

export const AVATAR_DOC_PREFIX = 'doc:';
/** The browser sends a 256 x 256 JPEG of a few dozen KB; this is the most the API takes. */
export const MAX_AVATAR_BYTES = 1_000_000;
/** The `documents.source_table` of a profile picture. */
export const AVATAR_SOURCE = 'users.avatar';

/** The document id of an uploaded picture, else null. */
export function avatarDocumentId(stored: string | null | undefined): string | null {
  const m = /^doc:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(stored ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** What a browser loads for `avatar_url`: the public picture URL of an upload, else the stored value. */
export function avatarUrlFor(stored: string | null | undefined, apiRoot: string): string | null {
  const id = avatarDocumentId(stored);
  if (id) return `${apiRoot}/public/avatars/${id}`;
  return stored || null;
}

/** The picture's type from its first bytes (PNG, JPEG or WebP; never SVG, which can carry script), else null. */
export function avatarImageType(bytes: Buffer): { mime: string; extension: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}
