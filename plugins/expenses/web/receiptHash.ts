/** `#/receipt/<token>?lang=de`: the page a phone opens from the expense form's QR code. */
export function parseReceiptHash(hash: string): { token: string; lang: string | null } | null {
  const m = /^#\/receipt\/([\w-]+)(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  return { token: m[1], lang: new URLSearchParams(m[2] ?? '').get('lang') };
}

/** The link the expense form's QR code holds: the app's own page for one hand-off, in the person's language. */
export function handoffLink(origin: string, pathname: string, token: string, locale: string): string {
  return `${origin}${pathname}#/receipt/${encodeURIComponent(token)}?lang=${encodeURIComponent(locale)}`;
}
