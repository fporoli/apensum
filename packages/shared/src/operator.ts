// The instance's operators: the active members of one fixed organization, "Apensum Admin"
// (infra/liquibase/changelog/098-operator.sql). In it they get the Super Admin pages only.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

export const OPERATOR_ORG_ID = '00000000-0000-0000-0000-00000000a0a0';

/** The one permission members hold in the Admin organization: the Super Admin pages. Not in the catalogue, never grantable. */
export const OPERATOR_PERMISSION = 'nav.operator:edit:all';
