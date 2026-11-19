import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, defaultClientConditions, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { pluginApiMismatch } from '../../packages/shared/src/pluginApi.ts';

/**
 * `virtual:apensum-plugins`: imports the web entry (package.json `apensum.web`) of every plugin
 * under <repo>/plugins/<id> and exports them as an array (apps/web/src/plugins.ts reads it), and
 * `permissions`: the permission objects of every plugin's manifest (`apensum.permissions`).
 * A plugin is part of the bundle when its folder is there at build time; docs/PLUGINS.md.
 */
function apensumPlugins(): Plugin {
  const id = 'virtual:apensum-plugins';
  const resolved = `\0${id}`;
  const dir = resolve(import.meta.dirname, process.env.APENSUM_PLUGINS_DIR?.trim() || '../../plugins');
  const manifests = () => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(dir, e.name, 'package.json')))
      .map((e) => ({ name: e.name, manifest: JSON.parse(readFileSync(join(dir, e.name, 'package.json'), 'utf8')).apensum }))
      .filter((p) => p.manifest)
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    name: 'apensum-plugins',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(source) {
      if (source !== resolved) return undefined;
      const found = manifests();
      for (const p of found) {
        const mismatch = pluginApiMismatch(p.manifest.id ?? p.name, p.manifest.apensumApi);
        if (mismatch) throw new Error(mismatch);
      }
      const files = found.filter((p) => p.manifest.web).map((p) => join(dir, p.name, p.manifest.web));
      const permissions = found.flatMap((p) => p.manifest.permissions ?? []);
      return [
        ...files.map((f, i) => `import plugin${i} from ${JSON.stringify(f)};`),
        `export default [${files.map((_, i) => `plugin${i}`).join(', ')}];`,
        `export const permissions = ${JSON.stringify(permissions)};`,
      ].join('\n');
    },
  };
}

export default defineConfig({
  plugins: [react(), apensumPlugins()],
  // `source` makes @worktime3/shared resolve to its TypeScript sources, so the web build never needs it built first.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: { port: 3001, proxy: { '/api': 'http://localhost:8001' } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /\/node_modules\/(react|react-dom|scheduler)\// },
            { name: 'mui-charts', test: /\/node_modules\/(@mui\/x-charts|d3-)/ },
            { name: 'mui-pickers', test: /\/node_modules\/(@mui\/x-date-pickers|dayjs)\// },
            { name: 'mui-core', test: /\/node_modules\/(@mui\/|@emotion\/)/ },
            { name: 'i18n-dictionaries', test: /\/src\/dictionaries\.ts$/ },
          ],
        },
      },
    },
  },
});
