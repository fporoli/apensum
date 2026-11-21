/** The web app's address for links in mails (APP_BASE_URL), without a trailing slash. */
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}
