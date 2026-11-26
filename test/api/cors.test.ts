import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { corsOrigins } from '../../apps/api/src/cors';

test('CORS: the web app, the website and extra origins; every origin without APP_BASE_URL', () => {
  assert.equal(corsOrigins({}), true);
  assert.deepEqual(corsOrigins({ APP_BASE_URL: 'https://app.apensum.ch/', CONTACT_SITE_ORIGINS: 'https://apensum.ch, https://wwwpp.apensum.ch', CORS_EXTRA_ORIGINS: 'https://x.example.ch,nonsense' }),
    ['https://app.apensum.ch', 'https://apensum.ch', 'https://wwwpp.apensum.ch', 'https://x.example.ch']);
  assert.deepEqual(corsOrigins({ APP_BASE_URL: 'http://localhost:3001' }), ['http://localhost:3001', 'https://apensum.ch', 'https://www.apensum.ch', 'http://localhost:3010']);
});
