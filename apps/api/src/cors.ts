import { allowedOrigins } from './site-contact.controller';

/**
 * Which browser origins may call the API (CORS): the web app (APP_BASE_URL) and the website (CONTACT_SITE_ORIGINS:
 * its chat, news and newsletter), plus CORS_EXTRA_ORIGINS (comma-separated) when an instance needs more. Requests
 * without an Origin (calendar apps, curl, the server itself) are not affected. Without APP_BASE_URL every origin stays
 * allowed, as before, so an instance that never set it keeps working. The session is a bearer token, never a cookie,
 * so this narrows who may read answers in a browser; it is not what keeps anyone out.
 */
export function corsOrigins(env: NodeJS.ProcessEnv = process.env): true | string[] {
  if (!env.APP_BASE_URL?.trim()) return true;
  const origin = (url: string) => {
    try { return new URL(url.trim()).origin; } catch { return null; }
  };
  const list = [
    origin(env.APP_BASE_URL),
    ...allowedOrigins(env.CONTACT_SITE_ORIGINS).map(origin),
    ...(env.CORS_EXTRA_ORIGINS ?? '').split(',').filter((s) => s.trim()).map(origin),
  ].filter((o): o is string => !!o);
  return [...new Set(list)];
}
