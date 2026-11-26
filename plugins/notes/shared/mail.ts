/**
 * Forwarding a note by e-mail: which address is one, and how many at a time. The same rules in the browser (the dialog
 * marks a wrong address at once) and in the API (api/sharing.ts `parseAddresses`). Pure, erasable TypeScript.
 */

/** At most this many addresses per forward. */
export const MAX_MAIL_ADDRESSES = 10;

const EMAIL = /^[^\s@<>(),;:"[\]]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** Whether `value` is an e-mail address the forward accepts. */
export function isMailAddress(value: string): boolean {
  return value.length <= 200 && EMAIL.test(value);
}

/** Text as typed or pasted, split into addresses (commas, semicolons, spaces), trimmed and lower-case. */
export function splitAddresses(text: string): string[] {
  return text.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
}
