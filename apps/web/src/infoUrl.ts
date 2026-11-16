/** The product website, in the app's language: where "More about Apensum" leads. */
export function infoUrl(locale: string, base: string = import.meta.env?.VITE_INFO_URL || 'https://www.apensum.ch'): string {
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(locale)}/`;
}
