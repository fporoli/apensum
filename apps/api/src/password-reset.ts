import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Password reset by e-mailed link. The link carries a signed token: the user, an expiry and a stamp
 * of the password hash it may replace. Setting the password changes the hash, so a link works once,
 * and only until the password changes some other way. Nothing is stored: no table, no cleanup.
 */

export const RESET_TTL_SEC = 30 * 60;
/** Reset mails per address and per client IP within an hour (in memory, per API process). */
export const RESET_LIMIT_PER_EMAIL = 3;
export const RESET_LIMIT_PER_IP = 10;

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Short fingerprint of a password hash: binds a token to the password it was issued for. */
export function passwordStamp(passwordHash: string | null | undefined): string {
  return createHash('sha256').update(passwordHash ?? '').digest('hex').slice(0, 16);
}

export function mintResetToken(key: Buffer, userId: string, passwordHash: string | null | undefined, nowSec: number, ttlSec = RESET_TTL_SEC): string {
  const payload = b64url(Buffer.from(JSON.stringify({ u: userId, s: passwordStamp(passwordHash), e: nowSec + ttlSec })));
  return `${payload}.${b64url(createHmac('sha256', key).update(payload).digest())}`;
}

/** The token's user and password stamp, or null when it is malformed, forged or expired. */
export function readResetToken(key: Buffer, token: unknown, nowSec: number): { userId: string; stamp: string } | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = createHmac('sha256', key).update(payload).digest();
  const given = fromB64url(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const body = JSON.parse(fromB64url(payload).toString('utf8')) as { u?: unknown; s?: unknown; e?: unknown };
    if (typeof body.u !== 'string' || typeof body.s !== 'string' || typeof body.e !== 'number') return null;
    if (body.e < nowSec) return null;
    return { userId: body.u, stamp: body.s };
  } catch {
    return null;
  }
}

/** The page that sets the new password: the web app renders it without signing in (main.tsx). */
export function resetLink(appBaseUrl: string, token: string, locale: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/#/reset/${token}?lang=${encodeURIComponent(locale)}`;
}

const MAIL: Record<string, { subject: string; text: (name: string, link: string) => string }> = {
  en: {
    subject: 'Apensum: reset your password',
    text: (name, link) => `Hello ${name}\n\nSomeone (hopefully you) asked to reset the password of your Apensum account. Set a new password here:\n\n${link}\n\nThe link is valid for 30 minutes and can be used once. If you did not ask for this, ignore this e-mail: your password stays unchanged.\n`,
  },
  de: {
    subject: 'Apensum: Passwort zurücksetzen',
    text: (name, link) => `Grüezi ${name}\n\nJemand (hoffentlich Sie) möchte das Passwort Ihres Apensum-Kontos zurücksetzen. Hier legen Sie ein neues Passwort fest:\n\n${link}\n\nDer Link ist 30 Minuten gültig und funktioniert einmal. Falls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail: Ihr Passwort bleibt unverändert.\n`,
  },
  fr: {
    subject: 'Apensum : réinitialiser votre mot de passe',
    text: (name, link) => `Bonjour ${name}\n\nQuelqu’un (vous, espérons-le) a demandé à réinitialiser le mot de passe de votre compte Apensum. Définissez un nouveau mot de passe ici :\n\n${link}\n\nLe lien est valable 30 minutes et ne fonctionne qu’une fois. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.\n`,
  },
  it: {
    subject: 'Apensum: reimposta la password',
    text: (name, link) => `Buongiorno ${name}\n\nQualcuno (speriamo lei) ha chiesto di reimpostare la password del suo account Apensum. Imposti una nuova password qui:\n\n${link}\n\nIl link è valido 30 minuti e funziona una sola volta. Se non ha fatto lei la richiesta, ignori questa e-mail: la password resta invariata.\n`,
  },
};

export function resetMail(locale: string, name: string, link: string): { subject: string; text: string } {
  const m = MAIL[locale] ?? MAIL.en;
  return { subject: m.subject, text: m.text(name.replace(/[\r\n]+/g, ' ').trim(), link) };
}

/** A registration's e-mail link: valid a day, bound to the password it was issued for (registration.ts, auth.controller). */
export const VERIFY_TTL_SEC = 24 * 60 * 60;

/** The page that confirms the address and signs in: the web app renders it without a session (main.tsx). */
export function verifyLink(appBaseUrl: string, token: string, locale: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/#/verify/${token}?lang=${encodeURIComponent(locale)}`;
}

const VERIFY_MAIL: Record<string, { subject: string; text: (name: string, link: string) => string }> = {
  en: {
    subject: 'Apensum: confirm your e-mail address',
    text: (name, link) => `Hello ${name}\n\nWelcome to Apensum. Please confirm that this address is yours; the link signs you in:\n\n${link}\n\nThe link is valid for 24 hours. If you did not create an account, ignore this e-mail: without the confirmation nobody can sign in with it.\n`,
  },
  de: {
    subject: 'Apensum: E-Mail-Adresse bestätigen',
    text: (name, link) => `Grüezi ${name}\n\nWillkommen bei Apensum. Bitte bestätigen Sie, dass diese Adresse Ihnen gehört; der Link meldet Sie gleich an:\n\n${link}\n\nDer Link ist 24 Stunden gültig. Falls Sie kein Konto angelegt haben, ignorieren Sie diese E-Mail: Ohne Bestätigung kann sich niemand damit anmelden.\n`,
  },
  fr: {
    subject: 'Apensum : confirmez votre adresse e-mail',
    text: (name, link) => `Bonjour ${name}\n\nBienvenue sur Apensum. Veuillez confirmer que cette adresse est la vôtre ; le lien vous connecte directement :\n\n${link}\n\nLe lien est valable 24 heures. Si vous n’avez pas créé de compte, ignorez cet e-mail : sans confirmation, personne ne peut s’y connecter.\n`,
  },
  it: {
    subject: 'Apensum: confermi il suo indirizzo e-mail',
    text: (name, link) => `Buongiorno ${name}\n\nBenvenuto in Apensum. Confermi che questo indirizzo è suo; il link la collega subito:\n\n${link}\n\nIl link è valido 24 ore. Se non ha creato un account, ignori questa e-mail: senza conferma nessuno può accedere.\n`,
  },
};

export function verifyMail(locale: string, name: string, link: string): { subject: string; text: string } {
  const m = VERIFY_MAIL[locale] ?? VERIFY_MAIL.en;
  return { subject: m.subject, text: m.text(name.replace(/[\r\n]+/g, ' ').trim(), link) };
}

/** Sliding one-hour window of request times per key. */
export class HourlyLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number) {}

  /** Records a hit for `key` and says whether it is within the limit. */
  allow(key: string, nowMs: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < 3600_000);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (!v.some((t) => nowMs - t < 3600_000)) this.hits.delete(k);
    }
    return true;
  }

  /** Whether `key` has reached the limit, without recording anything (to count only failures, check first, record after). */
  full(key: string, nowMs: number): boolean {
    return (this.hits.get(key) ?? []).filter((t) => nowMs - t < 3600_000).length >= this.max;
  }
}

/**
 * Failed password logins allowed per hour: per account and address together (one person mistyping, or someone trying
 * one account), per address (someone trying many accounts) and per account from anywhere (many addresses trying one
 * account, high so that nobody can lock a colleague out on purpose). Only failures count; a success clears nothing.
 */
export const LOGIN_FAILS_PER_ACCOUNT_AND_IP = 10;
export const LOGIN_FAILS_PER_IP = 50;
export const LOGIN_FAILS_PER_ACCOUNT = 200;
/** Registrations per address and hour. */
export const REGISTRATIONS_PER_IP = 5;
