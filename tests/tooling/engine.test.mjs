import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileHashes, hash, inside, profileConfig, registryPins } from '../../scripts/engine.mjs';

test('generation rejects escaping destinations and floating revisions', () => {
  assert.throws(() => inside(os.tmpdir(), '../outside'));
  assert.throws(() => inside(os.tmpdir(), '.'));
  assert.throws(() => profileConfig({ profiles: { lunar: { commit: 'dev', patches: [] } } }, 'lunar'));
  assert.throws(() => profileConfig({ profiles: {} }, 'missing'));
});

test('registry pin audit retains name, version, source and checksum', () => {
  const text = 'version = 4\n[[package]]\nname = "local"\nversion = "0.0.0"\n[[package]]\nname = "dependency"\nversion = "1.2.3"\nsource = "registry+https://example.test"\nchecksum = "abc"\n';
  assert.deepEqual(registryPins(text), ['dependency|1.2.3|registry+https://example.test|abc']);
  assert.notDeepEqual(registryPins(text.replace('1.2.3', '1.2.4')), registryPins(text));
});

test('source manifest catches edits and omits build caches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rito-source-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'target'));
    fs.writeFileSync(path.join(dir, 'target/cache'), 'cache');
    fs.writeFileSync(path.join(dir, 'lib.rs'), 'before');
    assert.deepEqual(fileHashes(dir), { 'lib.rs': hash('before') });
    fs.writeFileSync(path.join(dir, 'lib.rs'), 'after');
    assert.deepEqual(fileHashes(dir), { 'lib.rs': hash('after') });
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
