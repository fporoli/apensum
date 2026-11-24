#!/usr/bin/env node
// Which backups to delete on the backup host (.github/workflows/backup.yml). A backup is the pair
// <stamp>-db.dump.age and <stamp>-documents.tar.age, stamp = YYYYMMDDTHHMMSSZ (UTC). Kept: the newest
// backup of each of the 7 newest days, of the 4 newest ISO weeks and of the 12 newest months that have one.
// Counted over the days that have a backup, not the calendar, so backups that stop for a while are not
// all deleted. Names that are not backups are left alone.
//
//   node scripts/backup-retention.mjs < listing     prints the file names to delete, one per line
import { readFileSync } from 'node:fs';

const NAME = /^(\d{8}T\d{6}Z)-(db\.dump|documents\.tar)\.age$/;
export const KEEP = { daily: 7, weekly: 4, monthly: 12 };

/** Monday of the stamp's ISO week, as YYYY-MM-DD. */
function weekOf(stamp) {
  const d = new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The stamps to keep, newest first. */
export function stampsToKeep(stamps, keep = KEEP) {
  const sorted = [...new Set(stamps)].sort().reverse();
  const kept = new Set();
  for (const [period, n] of [
    [(s) => s.slice(0, 8), keep.daily],
    [weekOf, keep.weekly],
    [(s) => s.slice(0, 6), keep.monthly],
  ]) {
    const seen = new Set();
    for (const s of sorted) {
      const p = period(s);
      if (seen.has(p)) continue;
      if (seen.size >= n) break;
      seen.add(p);
      kept.add(s);
    }
  }
  return sorted.filter((s) => kept.has(s));
}

/** The file names (base names) of `names` to delete. */
export function filesToDelete(names, keep = KEEP) {
  const files = names.map((n) => n.trim().split('/').pop()).filter((n) => NAME.test(n));
  const kept = new Set(stampsToKeep(files.map((n) => n.match(NAME)[1]), keep));
  return [...new Set(files)].filter((n) => !kept.has(n.match(NAME)[1])).sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const name of filesToDelete(readFileSync(0, 'utf8').split('\n'))) console.log(name);
}
