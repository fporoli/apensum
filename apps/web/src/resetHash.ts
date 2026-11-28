/** `#/reset/<token>?lang=de`: the page a password-reset e-mail links to (API password-reset.ts). */
export function parseResetHash(hash: string): { token: string; lang: string | null } | null {
  const m = /^#\/reset\/([\w-]+\.[\w-]+)(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  return { token: m[1], lang: new URLSearchParams(m[2] ?? '').get('lang') };
}

/** `#/verify/<token>?lang=de`: the page a registration e-mail links to (API password-reset.ts verifyLink). */
export function parseVerifyHash(hash: string): { token: string; lang: string | null } | null {
  const m = /^#\/verify\/([\w-]+\.[\w-]+)(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  return { token: m[1], lang: new URLSearchParams(m[2] ?? '').get('lang') };
}
