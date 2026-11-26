import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// SQL injection: every value goes into a query as a parameter (Drizzle's sql`...${value}`, the query builder, or $1 in
// the CLI). sql.raw() puts text into the SQL itself, so it may only ever get text from the code: no `${...}` inside it,
// except the helpers below that wrap a column name the code passes as a literal.
const ROOTS = [join(__dirname, '../../apps/api/src'), join(__dirname, '../../plugins')];
const ALLOWED = [
  /^const iso = \(column: string\) => sql\.raw\(`to_char\(\$\{column\}/,
  /^const day = \(column: string\) => sql\.raw\(`to_char\(\$\{column\}/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'dist', 'web', 'test', '.git'].includes(name)) return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.ts$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

test('sql.raw never gets text that is not written in the code', () => {
  const found: string[] = [];
  for (const file of ROOTS.flatMap(files)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const at = line.indexOf('sql.raw(');
      if (at < 0) return;
      const arg = line.slice(at);
      if (!arg.includes('${') && !/sql\.raw\(\s*[a-zA-Z_]/.test(arg)) return;
      if (ALLOWED.some((ok) => ok.test(line.trim()))) return;
      found.push(`${file.replace(/.*apensum\//, '')}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(found, [], `sql.raw with a value in it (use sql\`...\${value}\` or sql.identifier):\n${found.join('\n')}`);
});
