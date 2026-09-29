import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceDigest, verifyPrebuilt } from '../../scripts/prebuilt.mjs';
import { hash } from '../../scripts/engine.mjs';

const header = 'crates/rito-ffi/include/rito_ffi.h';
const library = 'arm64-v8a/release/librito_ffi.a';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rito-prebuilt-test-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (file, contents) => {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  };
  const source = { schema: 1, profile: 'lunar', commit: 'a'.repeat(40), rustVersion: '1.95.0', patches: [{ sha256: 'b'.repeat(64) }], files: { [header]: hash('header') } };
  const manifest = { schema: 1, platform: 'android', sourceSha256: sourceDigest(source), files: { [library]: hash('archive') } };
  const saveSource = () => put('native/rito/rito-source.json', JSON.stringify(source));
  const saveManifest = () => put('prebuilt/android/manifest.json', JSON.stringify(manifest));
  put(`native/rito/${header}`, 'header');
  put(`prebuilt/android/${library}`, 'archive');
  saveSource();
  saveManifest();
  return { root, put, source, manifest, saveSource, saveManifest };
}

test('binary verification accepts the selected platform and rejects an incomplete release', (t) => {
  const f = fixture(t);
  assert.doesNotThrow(() => verifyPrebuilt(f.root, ['android']));
  assert.throws(() => verifyPrebuilt(f.root), /Missing ios prebuilt/);
});

test('binary checksums catch modified archives and undeclared files', (t) => {
  const f = fixture(t);
  f.put(`prebuilt/android/${library}`, 'corrupt');
  assert.throws(() => verifyPrebuilt(f.root, ['android']), /checksum mismatch/);
  f.put(`prebuilt/android/${library}`, 'archive');
  f.put('prebuilt/android/stale.a', 'old');
  assert.throws(() => verifyPrebuilt(f.root, ['android']), /checksum mismatch/);
});

test('changing patches or source hashes invalidates the binary', (t) => {
  const f = fixture(t);
  f.source.patches[0].sha256 = 'c'.repeat(64);
  f.saveSource();
  assert.throws(() => verifyPrebuilt(f.root, ['android']), /Stale android/);
});

test('manifest cannot omit the required ABI or escape its directory', (t) => {
  const f = fixture(t);
  delete f.manifest.files[library];
  f.saveManifest();
  assert.throws(() => verifyPrebuilt(f.root, ['android']), /Missing required/);
  f.manifest.files['../../outside.a'] = hash('outside');
  f.saveManifest();
  assert.throws(() => verifyPrebuilt(f.root, ['android']), /Invalid relative destination/);
});

test('consumer header must match the binary source manifest', (t) => {
  const f = fixture(t);
  f.put(`native/rito/${header}`, 'changed declaration');
  assert.throws(() => verifyPrebuilt(f.root, ['android']), /FFI header differs/);
});

test('source digest is independent of object insertion order across build hosts', () => {
  assert.equal(sourceDigest({ profile: 'lunar', files: { z: '1', a: '2' } }), sourceDigest({ files: { a: '2', z: '1' }, profile: 'lunar' }));
  assert.notEqual(sourceDigest({ patches: ['first', 'second'] }), sourceDigest({ patches: ['second', 'first'] }));
});

test('XCFramework requires both device and simulator libraries with matching headers', (t) => {
  const f = fixture(t);
  const files = {
    'RitoFFI.xcframework/Info.plist': 'plist',
    'RitoFFI.xcframework/ios-arm64/librito_ffi.a': 'device',
    'RitoFFI.xcframework/ios-arm64/Headers/rito_ffi.h': 'header',
    'RitoFFI.xcframework/ios-arm64_x86_64-simulator/librito_ffi.a': 'simulator',
    'RitoFFI.xcframework/ios-arm64_x86_64-simulator/Headers/rito_ffi.h': 'header',
  };
  const manifest = { schema: 1, platform: 'ios', sourceSha256: sourceDigest(f.source), files: {} };
  for (const [file, bytes] of Object.entries(files)) {
    f.put(`prebuilt/ios/${file}`, bytes);
    manifest.files[file] = hash(bytes);
  }
  f.put('prebuilt/ios/manifest.json', JSON.stringify(manifest));
  assert.doesNotThrow(() => verifyPrebuilt(f.root));
  const simHeader = 'RitoFFI.xcframework/ios-arm64_x86_64-simulator/Headers/rito_ffi.h';
  f.put(`prebuilt/ios/${simHeader}`, 'different');
  manifest.files[simHeader] = hash('different');
  f.put('prebuilt/ios/manifest.json', JSON.stringify(manifest));
  assert.throws(() => verifyPrebuilt(f.root), /XCFramework header differs/);
});
