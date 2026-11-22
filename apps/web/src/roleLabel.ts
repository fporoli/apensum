import { DICTIONARIES, type Locale } from './dictionaries';

/** A role as GET organizations/:orgId/roles returns it (the fields every picker needs). */
export interface OrgRole {
  id: string;
  name: string;
  description: string | null;
  translations: Record<string, string> | null;
  scope: 'global' | 'override' | 'custom';
  /** Only an owner hands it out (`owner`, or a role with an HR-only right). */
  ownerOnly?: boolean;
}

function builtin(kind: 'builtin' | 'builtinDescription', name: string, locale: string): string | undefined {
  return DICTIONARIES[locale as Locale]?.[`roles.${kind}.${name}`];
}

/** The role's display name in `locale`: its own translation, a standard role's name, else its name. */
export function roleLabel(role: Pick<OrgRole, 'name' | 'translations'>, locale: string): string {
  return role.translations?.[locale] || builtin('builtin', role.name, locale) || role.name;
}

/**
 * The role's description in `locale`. A standard role whose description is still the default
 * (the English text the migrations insert) is translated; one an org rewrote is shown as written.
 */
export function roleDescription(role: Pick<OrgRole, 'name' | 'description'>, locale: string): string {
  const description = role.description ?? '';
  if (description && description === builtin('builtinDescription', role.name, 'en')) {
    return builtin('builtinDescription', role.name, locale) ?? description;
  }
  return description;
}

/** Roles the pickers offer: everything except owner, which owners hand over with "Make owner". */
export function assignableRoles<T extends Pick<OrgRole, 'name'>>(roles: T[]): T[] {
  return roles.filter((r) => r.name !== 'owner');
}
