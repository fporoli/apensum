// No imports: the plugin contract re-exports it, and plugin tests load the contract without decorators.

/**
 * A person's payroll details as `orgId` sees them: what it imported (`basicdata.orgs.<orgId>.personalien`)
 * over what imports once stored for the whole account.
 */
export function payrollPersonalien(basicdata: unknown, orgId: string): Record<string, any> {
  const object = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
  const data = object(basicdata);
  return { ...object(data.personalien), ...object(object(object(data.orgs)[orgId]).personalien) };
}
