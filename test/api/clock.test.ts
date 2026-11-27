import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { clock, todayIn } from '../../apps/api/src/clock';

test('the clock is the real time, another one only inside clock.at, also across awaits', async () => {
  const before = Date.now();
  assert.ok(Math.abs(clock.now().getTime() - before) < 1000);
  assert.equal(clock.isSet(), false);
  const seen = await clock.at(new Date('2018-03-05T09:30:00Z'), async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return [clock.now().toISOString(), todayIn('Europe/Zurich'), clock.isSet()];
  });
  assert.deepEqual(seen, ['2018-03-05T09:30:00.000Z', '2018-03-05', true]);
  assert.equal(clock.isSet(), false, 'set only inside');
});

test('clock.at with a function: time that runs on (the simulation)', () => {
  let t = Date.parse('2020-01-31T22:58:00Z');
  const days = clock.at(() => new Date((t += 60_000)), () => [todayIn('Europe/Zurich'), todayIn('Europe/Zurich')]);
  assert.deepEqual(days, ['2020-01-31', '2020-02-01'], '23:59 and 00:00 in Zurich');
});

const ROOT = join(__dirname, '../..');
const TIME = /(?<![\w.])now\(\)|\bCURRENT_DATE\b|new Date\(\)|Date\.now\(\)/i;

/** The API's and the plugins' own code (not the generated schema, not tests, not the clock itself). */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'db' && name !== 'node_modules' && name !== 'dist') walk(path);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'clock.ts') out.push(path);
    }
  };
  walk(join(ROOT, 'apps/api/src'));
  const plugins = join(ROOT, 'plugins');
  for (const id of existsSync(plugins) ? readdirSync(plugins) : []) if (existsSync(join(plugins, id, 'api'))) walk(join(plugins, id, 'api'));
  return out;
}

// Business time goes through the clock (clock.now(), sqlNow(), sqlToday()); a line that reads the real time on
// purpose (sessions, tokens, rate limits, licenses, caches) says why: `// real time: <why>` (`-- real time:` in SQL).
test('the API reads the real time only where it says why', () => {
  const offenders: string[] = [];
  for (const file of sources()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
      if (TIME.test(line) && !/(\/\/|--) real time: \S/.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${code.slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, [], 'use the business clock, or say `// real time: <why>`');
});
