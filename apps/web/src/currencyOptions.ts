/**
 * Dropdown options for currencies, from the org's static_data row (entity "expenses", enum
 * "currency": ISO code -> English name, with names per language in `translation`).
 * Kept free of JSX so Node can import it in tests.
 */

export interface CurrencyOption {
  value: string;
  label: string;
}

/**
 * The org's currencies as options, "CHF – Swiss franc", the default currency first and the rest by
 * code. Codes in `keep` (the org default, the values of the expense being edited) are added when
 * the list lacks them, so an older expense still shows its currency.
 */
export function currencyOptions(
  values: Record<string, string>,
  translation: Record<string, Record<string, string>>,
  locale: string,
  defaultCurrency: string,
  keep: string[] = [],
): CurrencyOption[] {
  const codes = new Set(Object.keys(values).map((c) => c.toUpperCase()));
  for (const c of [defaultCurrency, ...keep]) if (/^[A-Za-z]{3}$/.test(c ?? '')) codes.add(c.toUpperCase());
  const name = (code: string) => translation[locale]?.[code] ?? values[code];
  return [...codes]
    .sort((a, b) => (a === defaultCurrency ? -1 : b === defaultCurrency ? 1 : a.localeCompare(b)))
    .map((code) => ({ value: code, label: name(code) ? `${code} – ${name(code)}` : code }));
}
