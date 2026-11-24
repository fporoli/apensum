// No imports: the plugin contract re-exports it, and plugin tests load the contract without decorators.

/**
 * A person's payroll details as `orgId` sees them, in the order basic data shows them (scopeToOrg): what imports
 * once stored for the whole account (`basicdata.personalien`), the account's own fields (HR's form, e.g. the AHV
 * number), what this organization imported (`basicdata.orgs.<orgId>.personalien`) and its own fields
 * (`basicdata.orgs.<orgId>`, e.g. the personnel number HR entered). Never another organization's.
 */
export function payrollPersonalien(basicdata: unknown, orgId: string): Record<string, any> {
  const object = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
  const scalars = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v === null || typeof v !== 'object'));
  const data = object(basicdata);
  const own = object(object(data.orgs)[orgId]);
  return { ...object(data.personalien), ...scalars(data), ...object(own.personalien), ...scalars(own) };
}
