import nodemailer from 'nodemailer';

/**
 * SMTP sender: works unauthenticated against a local catcher (Mailpit/MailHog,
 * the `local`/`dev` compose profiles) and — once SMTP_USER/SMTP_PASSWORD are
 * set — against a real relay too (nodemailer negotiates STARTTLS/AUTH itself;
 * set SMTP_SECURE=true for implicit-TLS relays, typically port 465).
 * All sends should stay fire-and-forget from request handlers so a
 * misconfigured or unreachable relay never breaks the API.
 */

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  from?: string;
  /** Where answers go, e.g. the colleague who forwarded something (the sender stays the app). */
  replyTo?: string;
  /** An HTML part next to the text (news mails). */
  html?: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  secure: boolean;
  auth?: { user: string; pass: string };
}

export function smtpConfig(): SmtpConfig {
  // `||`, not `??`: compose passes unset vars through as empty strings
  // (`${SMTP_HOST:-}`), which are defined-but-falsy, not null/undefined.
  const user = process.env.SMTP_USER || undefined;
  const pass = process.env.SMTP_PASSWORD || undefined;
  return {
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT) || 1025,
    from: process.env.SMTP_FROM || 'worktime@localhost',
    secure: process.env.SMTP_SECURE === 'true',
    auth: user && pass ? { user, pass } : undefined,
  };
}

/**
 * The relay as last seen: by the startup check (verifySmtp) and every send since. Public in
 * GET health without any detail; the reason is only logged.
 */
export type SmtpStatus = 'unknown' | 'ok' | 'failed';
let smtpStatus: SmtpStatus = 'unknown';
export const lastSmtpStatus = (): SmtpStatus => smtpStatus;

/** The relay's error without anything secret: nodemailer messages name the response, not the password. */
function describe(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  return [e?.code, e?.responseCode, String(e?.message ?? err).replace(/\s+/g, ' ').slice(0, 300)].filter(Boolean).join(' ');
}

function transportFor(config: SmtpConfig, timeoutMs: number) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    // Local catchers rarely present a real cert; only demand one once real credentials are in play.
    tls: { rejectUnauthorized: !!config.auth },
  });
}

/** Startup check: connects and logs in (no mail sent), logs the outcome once. */
export async function verifySmtp(timeoutMs = 10_000): Promise<SmtpStatus> {
  const config = smtpConfig();
  const transport = transportFor(config, timeoutMs);
  try {
    await transport.verify();
    smtpStatus = 'ok';
    // eslint-disable-next-line no-console
    console.log(`SMTP ok: ${config.host}:${config.port}${config.auth ? ` as ${config.auth.user}` : ' (no login)'}`);
  } catch (err) {
    smtpStatus = 'failed';
    // eslint-disable-next-line no-console
    console.warn(`WARNING: SMTP ${config.host}:${config.port} not usable, mails will fail: ${describe(err)}`);
  } finally {
    transport.close();
  }
  return smtpStatus;
}

export async function sendMail(options: MailOptions, timeoutMs = 5000): Promise<void> {
  const config = smtpConfig();
  const transport = transportFor(config, timeoutMs);
  try {
    await transport.sendMail({
      from: options.from ?? config.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      headers: options.headers,
      replyTo: options.replyTo,
    });
    smtpStatus = 'ok';
  } catch (err) {
    smtpStatus = 'failed';
    // eslint-disable-next-line no-console
    console.warn(`Mail "${options.subject.slice(0, 60)}" via ${config.host}:${config.port} failed: ${describe(err)}`);
    throw err;
  } finally {
    transport.close();
  }
}
