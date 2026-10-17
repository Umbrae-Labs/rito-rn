import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseChannel } from '../../scripts/release-channel.mjs';

const lock = (profile, ref) => ({ schema: 3, profile, ref, commit: 'a'.repeat(40) });

test('each engine line publishes under its own tag and version form', () => {
  assert.deepEqual(releaseChannel(lock('upstream-release', 'master'), '0.3.0', 'master'), { profile: 'upstream-release', tag: 'latest' });
  assert.deepEqual(releaseChannel(lock('canary', 'dev'), '0.4.0-canary.2', 'dev'), { profile: 'canary', tag: 'canary' });
  assert.deepEqual(releaseChannel(lock('lunar', 'lunar'), '0.3.0-lunar.1', 'lunar'), { profile: 'lunar', tag: 'lunar' });
});

test('a release must run on its own branch with a version of its line', () => {
  assert.throws(() => releaseChannel(lock('lunar', 'lunar'), '0.3.0-lunar.1', 'dev'), /release from lunar/);
  assert.throws(() => releaseChannel(lock('lunar', 'lunar'), '0.3.0', 'lunar'), /does not match/);
  assert.throws(() => releaseChannel(lock('upstream-release', 'master'), '0.3.0-canary.1', 'master'), /does not match/);
  assert.throws(() => releaseChannel(lock('canary', 'dev'), '0.3.0-lunar.1', 'dev'), /does not match/);
});

test('a profile cannot build another line\'s fork branch', () => {
  assert.throws(() => releaseChannel(lock('lunar', 'dev'), '0.3.0-lunar.1'), /must track/);
});
