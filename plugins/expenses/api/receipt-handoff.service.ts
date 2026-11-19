import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/** How long a QR code stays usable. */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;
/** Open hand-offs per person; a new one beyond that replaces the oldest. */
export const MAX_OPEN_HANDOFFS_PER_USER = 3;
/** What a phone may send: photos and PDFs (a receipt from a banking or shop app). */
export const HANDOFF_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;

export interface HandoffFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

interface Handoff {
  userId: string;
  organizationId: string;
  expiresAt: number;
  file: HandoffFile | null;
  /** The creator has the file; kept until expiry so the phone can say it was sent. */
  taken: boolean;
}

export type PhoneStatus = 'open' | 'used' | 'expired';
export type OwnerStatus = 'waiting' | 'ready' | 'expired';

/**
 * "Take the photo with your phone": the PC asks for a hand-off and shows its token as a QR code;
 * the phone, which is not signed in, sends one file to that token; the PC fetches it and puts it in
 * its form like any other file, so it is stored through the normal (authorized) upload. The token
 * (192 random bits) is the phone's only credential: it accepts one file, for ten minutes, and only
 * its creator can read the file back. Nothing is written to the database or disk; a restart drops
 * open hand-offs. In memory, so it assumes one API instance (as every deployment here runs).
 */
@Injectable()
export class ReceiptHandoffService {
  private readonly items = new Map<string, Handoff>();
  /** Replaceable in tests. */
  now: () => number = () => Date.now();

  create(userId: string, organizationId: string): { token: string; expiresAt: number } {
    this.sweep();
    const mine = [...this.items.entries()].filter(([, h]) => h.userId === userId).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    while (mine.length >= MAX_OPEN_HANDOFFS_PER_USER) this.items.delete(mine.shift()![0]);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + HANDOFF_TTL_MS;
    this.items.set(token, { userId, organizationId, expiresAt, file: null, taken: false });
    return { token, expiresAt };
  }

  /** What the phone sees before sending. */
  phoneStatus(token: string): PhoneStatus {
    const h = this.live(token);
    if (!h) return 'expired';
    return h.file || h.taken ? 'used' : 'open';
  }

  /** The phone's single upload. */
  deposit(token: string, file: HandoffFile): { ok: true } | { ok: false; error: string } {
    const h = this.live(token);
    if (!h) return { ok: false, error: 'handoff-expired' };
    if (h.file || h.taken) return { ok: false, error: 'handoff-used' };
    if (!HANDOFF_MIME.test(file.mimeType)) return { ok: false, error: 'unsupported-type' };
    h.file = { name: safeName(file.name, file.mimeType), mimeType: file.mimeType, buffer: file.buffer };
    return { ok: true };
  }

  /** What the PC polls; another person's token reads as expired. */
  ownerStatus(token: string, userId: string): { status: OwnerStatus; fileName?: string } {
    const h = this.live(token);
    if (!h || h.userId !== userId || h.taken) return { status: 'expired' };
    return h.file ? { status: 'ready', fileName: h.file.name } : { status: 'waiting' };
  }

  /** Hands the file to its creator once; the memory is freed at once. */
  take(token: string, userId: string): HandoffFile | null {
    const h = this.live(token);
    if (!h || h.userId !== userId || !h.file) return null;
    const file = h.file;
    h.file = null;
    h.taken = true;
    return file;
  }

  cancel(token: string, userId: string): void {
    const h = this.items.get(token);
    if (h && h.userId === userId) this.items.delete(token);
  }

  private live(token: string): Handoff | null {
    const h = typeof token === 'string' ? this.items.get(token) : undefined;
    if (!h) return null;
    if (h.expiresAt <= this.now()) {
      this.items.delete(token);
      return null;
    }
    return h;
  }

  private sweep(): void {
    const now = this.now();
    for (const [token, h] of this.items) if (h.expiresAt <= now) this.items.delete(token);
  }
}

/** Phones send "image.jpg" or a random camera name: keep a plain, dated one. */
export function safeName(name: string | undefined, mimeType: string): string {
  const cleaned = (name ?? '').replace(/[^\w.\- ]+/g, '').trim().slice(0, 100);
  if (cleaned && !/^(image|blob|photo)\.\w+$/i.test(cleaned)) return cleaned;
  const ext = mimeType === 'application/pdf' ? 'pdf' : (mimeType.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `receipt-${stamp}.${ext}`;
}
