import { Controller, Get, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { pluginsDir, readPluginManifests } from './plugins';
import { DbService } from './db.service';
import { callerUserId, isOperator, type Executor } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

const STARTED_AT = new Date().toISOString(); // real time: server start and time

/** Baked into the image by build-push (see apps/api/Dockerfile) — unset on a host build. */
export function buildInfo(env: Record<string, string | undefined> = process.env) {
  return { release: env.BUILD_RELEASE || null, commit: env.BUILD_COMMIT || null, date: env.BUILD_DATE || null };
}

export interface PluginInfo {
  id: string;
  /** i18n key of its module's name, if it has a module. */
  caption: string | null;
  /** Its package.json version. */
  version: string | null;
  commit: string | null;
  date: string | null;
}

/**
 * Each installed plugin's version and the commit it was built from: `build-info.json` (written by the image
 * build's private-plugins step, the clone's .git is gone), else its git checkout (development), else the core's
 * build (a bundled plugin, e.g. expenses, is part of the core's commit).
 */
export function pluginInfos(dir = pluginsDir(), env: Record<string, string | undefined> = process.env): PluginInfo[] {
  return readPluginManifests(dir).map(({ dir: pluginDir, manifest }) => {
    let version: string | null = null;
    try {
      version = (JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')) as { version?: unknown }).version as string ?? null;
    } catch { /* no version */ }
    let commit: string | null = null;
    let date: string | null = null;
    const infoFile = join(pluginDir, 'build-info.json');
    try {
      if (existsSync(infoFile)) {
        const info = JSON.parse(readFileSync(infoFile, 'utf8')) as { commit?: unknown; date?: unknown };
        commit = typeof info.commit === 'string' ? info.commit : null;
        date = typeof info.date === 'string' ? info.date : null;
      }
    } catch { /* unreadable: try the others */ }
    if (!commit) {
      try {
        // Its own clone, or (bundled) the core's checkout around it; no git in an image.
        const [sha, when] = execFileSync('git', ['-C', pluginDir, 'log', '-1', '--format=%H %cI'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(' ');
        commit = sha || null;
        date = when || null;
      } catch {
        commit = env.BUILD_COMMIT || null;
        date = env.BUILD_DATE || null;
      }
    }
    return { id: manifest.id, caption: manifest.module?.caption ?? null, version, commit, date };
  });
}

/** Read once: the plugins do not change while the API runs. */
let plugins: PluginInfo[] | null = null;

/** Whether the database answers, and the last changeset Liquibase applied to it. */
export async function databaseInfo(db: Executor | null) {
  if (!db) return { status: 'offline', lastChangeset: null };
  try {
    const rows = await db.execute(sql`SELECT filename FROM databasechangelog ORDER BY orderexecuted DESC LIMIT 1`);
    return { status: 'ok', lastChangeset: (rows.rows[0]?.filename as string) ?? null };
  } catch {
    return { status: 'unavailable', lastChangeset: null };
  }
}

@Controller('about')
export class AboutController {
  constructor(private readonly db: DbService) {}

  /**
   * Behind the global JWT guard, unlike `health`. Registration is open, so anyone signed in reads the build, times and
   * whether the database answers; the server's name, Node version, environment and the last migration only the
   * instance's operators (they help find a fault, and they tell an attacker which version runs where).
   */
  @Get()
  async about(@Req() req?: AuthenticatedRequest) {
    const db = this.db.getDb();
    const userId = db && req?.user ? await callerUserId(db, req.user) : null;
    const operator = !!db && !!userId && (await isOperator(db, userId));
    const database = await databaseInfo(db);
    return {
      ok: true,
      build: buildInfo(),
      server: {
        ...(operator ? { hostname: hostname(), environment: process.env.NODE_ENV || null, nodeVersion: process.version } : {}),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        startedAt: STARTED_AT,
        time: new Date().toISOString(), // real time: server start and time
      },
      database: operator ? database : { status: database.status },
      plugins: (plugins ??= pluginInfos()),
    };
  }
}
