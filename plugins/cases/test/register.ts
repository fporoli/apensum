// What the API's loader does at start (apps/api/src/plugins.ts): the manifest's permission objects
// and module join the catalogue. Tests that check permissions import this first.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerPermissionObjects } from '@worktime3/shared/permissions';
import { registerModule } from '@worktime3/shared/modules';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).apensum;
registerPermissionObjects(manifest.permissions);
registerModule(manifest.module);
