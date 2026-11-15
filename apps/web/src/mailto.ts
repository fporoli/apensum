/**
 * "Send by e-mail" on requests and approvals: a mailto: link that opens the person's own mail
 * program with recipients, subject and text filled in. Nothing goes through the server, so the
 * mail comes from their own address and they can still edit it before sending.
 */

/** Long bodies get cut by some mail programs and browsers (URL length); keep well below that. */
export const MAX_MAILTO_BODY = 1800;

export function mailtoHref(opts: { to?: readonly (string | null | undefined)[]; cc?: readonly (string | null | undefined)[]; subject: string; body: string }): string {
  const list = (xs?: readonly (string | null | undefined)[]) => [...new Set((xs ?? []).map((x) => (x ?? '').trim()).filter((x) => x.includes('@')))];
  const to = list(opts.to).map(encodeURIComponent).join(',');
  const params: string[] = [];
  const cc = list(opts.cc);
  if (cc.length) params.push(`cc=${cc.map(encodeURIComponent).join(',')}`);
  params.push(`subject=${encodeURIComponent(opts.subject)}`);
  let body = opts.body.replace(/\r?\n/g, '\r\n');
  if (body.length > MAX_MAILTO_BODY) body = `${body.slice(0, MAX_MAILTO_BODY - 1)}…`;
  params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to}?${params.join('&')}`;
}

/** A link back into the app, e.g. `appLink('#/requests', { id })`. */
export function appLink(hash: string, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  if (typeof window === 'undefined') return `${hash}${query}`;
  return `${window.location.origin}${window.location.pathname}${hash}${query}`;
}
