import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- a plain .mjs script without types
import { finishPluginSchema } from '../../apps/api/scripts/plugin-schemas.mjs';

const header = `import { pgTable, pgSchema, foreignKey, uuid, text, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const absence_status = pgEnum("absence_status", ['pending', 'approved', 'rejected'])
export const demo_kind = pgEnum("demo_kind", ['a', 'b'])

`;

test("a plugin's own schema: its tables stay, the core's tables it refers to are imported, unused enums dropped", () => {
  const src = `${header}export const demo = pgSchema("demo");

export const thingsInDemo = demo.table("things", {
	id: uuid().primaryKey().notNull(),
	organization_id: uuid().notNull(),
	kind: demo_kind(),
}, (table) => [
	foreignKey({ columns: [table.organization_id], foreignColumns: [organizations.id], name: "fk1" }),
]);

export const partsInDemo = demo.table("parts", {
	id: uuid().primaryKey().notNull(),
	thing_id: uuid().notNull(),
	document_id: uuid(),
}, (table) => [
	foreignKey({ columns: [table.thing_id], foreignColumns: [thingsInDemo.id], name: "fk2" }),
	foreignKey({ columns: [table.document_id], foreignColumns: [documents.id], name: "fk3" }),
]);
`;
  const out: string = finishPluginSchema({ id: 'demo', dbSchema: 'demo', tables: [] }, src);
  assert.match(out, /^\/\/ GENERATED .*\n\/\/ the tables of plugin "demo" \(package.json apensum.dbSchema "demo"\)/);
  assert.match(out, /import \{ demo_kind, documents, organizations \} from '@worktime3\/api\/schema';/, 'core tables and used enums, not its own tables');
  assert.doesNotMatch(out, /absence_status/);
  assert.doesNotMatch(out, /pgEnum/);
  assert.match(out, /export const demo = pgSchema\("demo"\);/);
  assert.match(out, /export const partsInDemo = demo\.table\("parts"/);
});

test('tables in public: the same, with apensum.tables in the header', () => {
  const src = `${header}export const demo_items = pgTable("demo_items", {
	id: uuid().primaryKey().notNull(),
	user_id: uuid().notNull(),
}, (table) => [
	foreignKey({ columns: [table.user_id], foreignColumns: [users.id], name: "fk" }),
]);
`;
  const out: string = finishPluginSchema({ id: 'demo', dbSchema: null, tables: ['demo_items'] }, src);
  assert.match(out, /package.json apensum.tables/);
  assert.match(out, /import \{ users \} from '@worktime3\/api\/schema';/);
});
