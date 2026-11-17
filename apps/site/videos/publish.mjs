// Uploads the recorded demo videos, posters and feature screenshots (apps/site/media) to the `site-media` GitHub release,
// replacing older ones. The `site` workflow downloads them from there before it builds, so they
// reach the website with the next deploy without being committed. Needs the GitHub CLI (`gh`),
// logged in with push access. The release is a pre-release, so it never shows as the latest one.
//   npm run site:videos:publish
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIA = join(dirname(fileURLToPath(import.meta.url)), '..', 'media');
const TAG = 'site-media';
const gh = (args, opts = {}) => spawnSync('gh', args, { encoding: 'utf8', ...opts });

const files = readdirSync(MEDIA)
  .filter((f) => /^(demo|feature)-[\w-]+\.(mp4|jpg)$/.test(f))
  .map((f) => join(MEDIA, f));
if (files.length === 0) {
  console.error('site:videos:publish: nothing in apps/site/media, record first (npm run site:videos)');
  process.exit(1);
}

if (gh(['release', 'view', TAG]).status !== 0) {
  const created = gh(
    ['release', 'create', TAG, '--prerelease', '--latest=false', '--title', 'Website media',
      '--notes', 'Demo videos for the website (apps/site/videos). Not a software release: the site workflow ships these files.'],
    { stdio: 'inherit' },
  );
  if (created.status !== 0) process.exit(created.status ?? 1);
}
const up = gh(['release', 'upload', TAG, ...files, '--clobber'], { stdio: 'inherit' });
if (up.status !== 0) process.exit(up.status ?? 1);
console.log(`site:videos:publish: ${files.length} files in release ${TAG}; deploy the site to show them.`);
