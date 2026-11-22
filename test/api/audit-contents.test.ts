import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AbsencesController } from '../../apps/api/src/absences.controller';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

// Admins read the audit log: it says that something happened, never what it says.

const root = join(import.meta.dirname, '..', '..');

/** The arguments of every `audit.record(...)` in the API and in the plugins that are here. */
function auditCalls(): { file: string; args: string }[] {
  const dirs = [join(root, 'apps/api/src')];
  if (existsSync(join(root, 'plugins'))) {
    for (const id of readdirSync(join(root, 'plugins'))) if (existsSync(join(root, 'plugins', id, 'api'))) dirs.push(join(root, 'plugins', id, 'api'));
  }
  const calls: { file: string; args: string }[] = [];
  for (const dir of dirs) {
    for (const file of readdirSync(dir, { recursive: true }) as string[]) {
      if (!file.endsWith('.ts') || /node_modules|dist/.test(file)) continue;
      const source = readFileSync(join(dir, file), 'utf8');
      for (const m of source.matchAll(/\baudit\??\s*\.record\(/g)) {
        const from = m.index! + m[0].length;
        let depth = 1;
        let to = from;
        for (; depth > 0 && to < source.length; to++) depth += source[to] === '(' ? 1 : source[to] === ')' ? -1 : 0;
        calls.push({ file, args: source.slice(from, to - 1) });
      }
    }
  }
  return calls;
}

test('no audit entry carries notes, reasons, subjects or the values of people data', () => {
  const calls = auditCalls();
  assert.ok(calls.length > 35, `found only ${calls.length} calls`);
  // The organization's own setup is no person's data, so those entries may say what it was set to.
  const setup = /'(department|location|organization|role|sso)\./;
  for (const { file, args } of calls) {
    assert.doesNotMatch(args, /\b(note|reason|subject|fileName|absenceType|dateStart|dateEnd|last_day|lastDay|startDate|start_date|as_of)\b/, `${file}: ${args}`);
    if (!setup.test(args)) assert.doesNotMatch(args, /\.\.\.|,\s*(values|checked|row|patch|logged)\s*$/, `${file}: ${args}`);
  }
});

test('cancelling an absence is logged in its organization, without contents', async () => {
  const logged: unknown[][] = [];
  const db: any = {
    select: () => db,
    from: () => db,
    where: async () => [{ organization_id: 'org-1', user_id: 'person-1', status: 'pending' }],
    delete: () => ({ where: async () => undefined }),
  };
  const controller = new AbsencesController(
    { getDb: () => db } as any,
    { record: async (...args: unknown[]) => void logged.push(args) } as any,
    {} as any,
    { findPending: async () => null } as any,
    {} as any,
  );
  const req = { user: { kind: 'local', sub: 'person-1' } } as AuthenticatedRequest;
  assert.deepEqual(await controller.cancel('absence-1', req), { ok: true });
  assert.deepEqual(logged, [['org-1', 'person-1', 'absence.cancel', 'absence', 'absence-1']]);
});
