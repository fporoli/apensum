import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SHARE_IDLE_MS, SHARE_MS, ScreenShareService, isJpeg } from '../../apps/api/src/screen-share.service';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);

test('screen share: only the sharer sends, only the chosen viewer looks, either ends it', () => {
  const s = new ScreenShareService();
  const share = s.start('org', 'ueli', 'ulla', 0);
  assert.equal(s.look('org', share.id, 'admin', 1), null);
  assert.equal(s.look('org', share.id, 'ueli', 1), null, 'the sharer is no viewer');
  assert.equal(s.look('other', share.id, 'ulla', 1), null, 'nor in another organization');
  assert.deepEqual(s.look('org', share.id, 'ulla', 1), { frame: null });
  assert.equal(s.put('org', share.id, 'ulla', jpeg, 2), null, 'the viewer sends nothing');
  assert.deepEqual(s.put('org', share.id, 'ueli', jpeg, 2), { watching: true });
  assert.deepEqual(s.look('org', share.id, 'ulla', 3), { frame: jpeg });
  assert.equal(s.stop('org', share.id, 'admin'), null);
  assert.ok(s.stop('org', share.id, 'ulla'));
  assert.equal(s.look('org', share.id, 'ulla', 4), null);
});

test('screen share: it ends by itself, and a person has one at a time', () => {
  const s = new ScreenShareService();
  const idle = s.start('org', 'a', 'b', 0);
  assert.equal(s.look('org', idle.id, 'b', SHARE_IDLE_MS + 1), null);
  const long = s.start('org', 'a', 'b', 0);
  for (let at = 0; at < SHARE_MS; at += SHARE_IDLE_MS) assert.ok(s.put('org', long.id, 'a', jpeg, at));
  assert.equal(s.put('org', long.id, 'a', jpeg, SHARE_MS), null);
  const first = s.start('org', 'a', 'b', 0);
  s.start('org', 'a', 'c', 1);
  assert.equal(s.look('org', first.id, 'b', 2), null);
});

test('screen share: pictures are JPEG by their bytes, asks once a minute', () => {
  assert.equal(isJpeg(jpeg), true);
  assert.equal(isJpeg(Buffer.from('<svg onload=alert(1)>')), false);
  const s = new ScreenShareService();
  assert.equal(s.mayAsk('org', 'a', 'b', 0), true);
  assert.equal(s.mayAsk('org', 'a', 'b', 1000), false);
  assert.equal(s.mayAsk('org', 'a', 'b', 60000), true);
});
