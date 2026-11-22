import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

// "Show my screen", instead of acting as someone: the person's browser sends a picture of what they
// chose to share about once a second and the one colleague they picked looks at it. Pictures only, so
// there is no token, no right and no click that passes over. In memory (one API process, like the
// receipt hand-off): only the latest picture, never stored or logged.

export const SHARE_MS = 30 * 60 * 1000;
/** Without a picture for this long the share is over (the tab was closed). */
export const SHARE_IDLE_MS = 60 * 1000;
export const MAX_FRAME_BYTES = 1024 * 1024;
/** The viewer asked for a picture this recently: they are watching. */
const WATCHING_MS = 5000;
const ASK_EVERY_MS = 60 * 1000;

export interface ScreenShare {
  id: string;
  orgId: string;
  sharerId: string;
  viewerId: string;
  until: number;
  alive: number;
  seen: number;
  frame: Buffer | null;
}

/** A JPEG by its first bytes, whatever the upload claims. */
export function isJpeg(bytes: Buffer): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

@Injectable()
export class ScreenShareService {
  private readonly shares = new Map<string, ScreenShare>();
  private readonly asked = new Map<string, number>();

  private sweep(now: number): void {
    for (const s of this.shares.values()) {
      if (now >= s.until || now - s.alive > SHARE_IDLE_MS) this.shares.delete(s.id);
    }
    for (const [key, at] of this.asked) if (now - at >= ASK_EVERY_MS) this.asked.delete(key);
  }

  /** One share per person: a new one ends the one before. */
  start(orgId: string, sharerId: string, viewerId: string, now = Date.now()): ScreenShare {
    this.sweep(now);
    for (const s of this.shares.values()) if (s.sharerId === sharerId) this.shares.delete(s.id);
    const share: ScreenShare = { id: randomUUID(), orgId, sharerId, viewerId, until: now + SHARE_MS, alive: now, seen: 0, frame: null };
    this.shares.set(share.id, share);
    return share;
  }

  /** The sharer's picture; null when the share is over or not theirs. */
  put(orgId: string, id: string, userId: string, frame: Buffer, now = Date.now()): { watching: boolean } | null {
    this.sweep(now);
    const s = this.shares.get(id);
    if (!s || s.orgId !== orgId || s.sharerId !== userId) return null;
    s.frame = frame;
    s.alive = now;
    return { watching: now - s.seen < WATCHING_MS };
  }

  /** The viewer's look; null when the share is over or not for them. */
  look(orgId: string, id: string, userId: string, now = Date.now()): { frame: Buffer | null } | null {
    this.sweep(now);
    const s = this.shares.get(id);
    if (!s || s.orgId !== orgId || s.viewerId !== userId) return null;
    s.seen = now;
    return { frame: s.frame };
  }

  /** Either of the two ends it. */
  stop(orgId: string, id: string, userId: string): ScreenShare | null {
    const s = this.shares.get(id);
    if (!s || s.orgId !== orgId || (s.sharerId !== userId && s.viewerId !== userId)) return null;
    this.shares.delete(id);
    return s;
  }

  /** At most one ask a minute per pair. */
  mayAsk(orgId: string, fromId: string, toId: string, now = Date.now()): boolean {
    this.sweep(now);
    const key = `${orgId}:${fromId}:${toId}`;
    if (this.asked.has(key)) return false;
    this.asked.set(key, now);
    return true;
  }
}
