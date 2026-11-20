import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarDocumentId, avatarImageType, avatarUrlFor } from '../../apps/api/src/avatars';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('an uploaded picture is stored as doc:<id> and loaded from the public picture URL', () => {
  assert.equal(avatarDocumentId(`doc:${ID}`), ID);
  assert.equal(avatarDocumentId(`doc:${ID.toUpperCase()}`), ID);
  assert.equal(avatarDocumentId('doc:nope'), null);
  assert.equal(avatarUrlFor(`doc:${ID}`, 'https://api.example.ch/api/v1'), `https://api.example.ch/api/v1/public/avatars/${ID}`);
  // Anything else (seeded demo portraits, an external URL) is passed through; empty means initials.
  assert.equal(avatarUrlFor("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", 'x'), "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>");
  assert.equal(avatarUrlFor('', 'x'), null);
  assert.equal(avatarUrlFor(null, 'x'), null);
});

test('only PNG, JPEG and WebP are taken, by their bytes (never SVG)', () => {
  assert.equal(avatarImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime, 'image/png');
  assert.equal(avatarImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime, 'image/jpeg');
  assert.equal(avatarImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))?.mime, 'image/webp');
  assert.equal(avatarImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(avatarImageType(Buffer.from('GIF89a')), null);
});
