import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, hash, inside, verifyEngine } from './engine.mjs';

export const platforms = ['android', 'ios'];
const ndkVersion = '27.1.12297006';
const appleMinimum = '15.1';
const required = {
  android: ['arm64-v8a/release/librito_ffi.a'],
  ios: ['RitoFFI.xcframework/Info.plist',
    'RitoFFI.xcframework/ios-arm64/librito_ffi.a',
    'RitoFFI.xcframework/ios-arm64/Headers/rito_ffi.h',
    'RitoFFI.xcframework/ios-arm64_x86_64-simulator/librito_ffi.a',
    'RitoFFI.xcframework/ios-arm64_x86_64-simulator/Headers/rito_ffi.h'],
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonical = (value) => JSON.stringify(value, (_key, entry) => entry && !Array.isArray(entry) && typeof entry === 'object'
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
export const sourceDigest = (source) => hash(canonical(source));

function tree(directory) {
  const files = {};
  function visit(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink in prebuilt artifacts: ${file}`);
      if (item.isDirectory()) visit(file);
      else if (file !== path.join(directory, 'manifest.json')) files[path.relative(directory, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file));
    }
  }
  visit(directory);
  return files;
}

export function verifyPrebuilt(packageRoot = root, selected = platforms) {
  const source = readJson(path.join(packageRoot, 'native/rito/rito-source.json'));
  for (const platform of selected) {
    if (!platforms.includes(platform)) throw new Error(`Unknown prebuilt platform: ${platform}`);
    const directory = path.join(packageRoot, 'prebuilt', platform);
    const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${platform} prebuilt library. Use an official binary package or explicitly enable RITO_BUILD_FROM_SOURCE=1.`);
    const manifest = readJson(manifestPath);
    if (manifest.schema !== 1 || manifest.platform !== platform || manifest.sourceSha256 !== sourceDigest(source)) throw new Error(`Stale ${platform} prebuilt library: engine profile, patches or sources differ`);
    if (!manifest.files || typeof manifest.files !== 'object') throw new Error('Missing binary hashes');
    for (const file of Object.keys(manifest.files)) inside(directory, file);
    for (const file of required[platform]) {
      if (!manifest.files[file]) throw new Error(`Missing required prebuilt artifact: ${file}`);
    }
    if (canonical(tree(directory)) !== canonical(manifest.files)) throw new Error(`Prebuilt file checksum mismatch: ${platform}`);
    const header = 'crates/rito-ffi/include/rito_ffi.h';
    if (hash(fs.readFileSync(path.join(packageRoot, 'native/rito', header))) !== source.files[header]) throw new Error('Packaged FFI header differs from the engine manifest');
    if (platform === 'ios') {
      for (const file of required.ios.filter((file) => file.endsWith('/rito_ffi.h'))) {
        if (manifest.files[file] !== source.files[header]) throw new Error('XCFramework header differs from the engine manifest');
      }
    }
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function build(platform) {
  if (!platforms.includes(platform)) throw new Error('Choose android or ios');
  if (platform === 'ios' && process.platform !== 'darwin') throw new Error('Apple prebuilts require macOS and Xcode');
  const source = verifyEngine();
  const directory = inside(root, `prebuilt/${platform}`);
  // Confine replacement to this platform's generated artifact directory.
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('Prebuilt output is a symlink');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  const targetDir = path.join(root, '.engine/prebuilt-target');
  const headers = path.join(root, 'native/rito/crates/rito-ffi/include');
  const cargoArgs = ['build', '--release', '--locked', '--lib', '-p', 'rito-ffi', '--manifest-path', path.join(root, 'native/rito/Cargo.toml'), '--target-dir', targetDir];
  const smoke = path.join(root, '.engine/prebuilt-link.c');
  fs.mkdirSync(path.dirname(smoke), { recursive: true });
  fs.writeFileSync(smoke, '#include "rito_ffi.h"\nint main(void) { rito_owned_buffer buffer = {0}; rito_buffer_free(&buffer); return 0; }\n');
  // Disable inherited developer flags; release artifacts must use the declared configuration.
  const env = { ...process.env, RUSTFLAGS: '', CARGO_ENCODED_RUSTFLAGS: '', CARGO_INCREMENTAL: '0' };
  let toolchain;
  if (platform === 'android') {
    const ndk = process.env.ANDROID_NDK_HOME ?? path.join(process.env.ANDROID_HOME ?? '', 'ndk', ndkVersion);
    if (!fs.readFileSync(path.join(ndk, 'source.properties'), 'utf8').includes(`Pkg.Revision = ${ndkVersion}`)) throw new Error(`Prebuilds require NDK ${ndkVersion}`);
    env.ANDROID_NDK_HOME = ndk;
    run('cargo', [`+${source.rustVersion}`, 'ndk', '-t', 'arm64-v8a', '--platform', '23', ...cargoArgs], { env, cwd: path.join(root, 'native/rito') });
    const destination = path.join(directory, required.android[0]);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(targetDir, 'aarch64-linux-android/release/librito_ffi.a'), destination);
    const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
    const clang = path.join(ndk, 'toolchains/llvm/prebuilt', host, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang');
    run(clang, ['--target=aarch64-linux-android23', '-shared', '-fPIC', smoke, '-I', headers, destination, '-ldl', '-lm', '-llog', '-Wl,--no-undefined', '-Wl,-z,max-page-size=16384', '-o', path.join(targetDir, 'link-smoke.so')]);
    toolchain = { rust: source.rustVersion, ndk: ndkVersion, api: 23, targets: ['aarch64-linux-android'] };
  } else {
    env.IPHONEOS_DEPLOYMENT_TARGET = appleMinimum;
    const targets = ['aarch64-apple-ios', 'aarch64-apple-ios-sim', 'x86_64-apple-ios'];
    for (const target of targets) {
      run('cargo', [`+${source.rustVersion}`, ...cargoArgs, '--target', target], { env });
      const simulator = target !== 'aarch64-apple-ios';
      const sdk = simulator ? 'iphonesimulator' : 'iphoneos';
      const arch = target.startsWith('x86_64') ? 'x86_64' : 'arm64';
      const sysroot = execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-path'], { encoding: 'utf8' }).trim();
      run('xcrun', ['--sdk', sdk, 'clang', '-target', `${arch}-apple-ios${appleMinimum}${simulator ? '-simulator' : ''}`, '-isysroot', sysroot, smoke, '-I', headers, path.join(targetDir, target, 'release/librito_ffi.a'), '-liconv', '-framework', 'Security', '-framework', 'CoreFoundation', '-o', path.join(targetDir, `link-smoke-${target}`)]);
    }
    const sim = path.join(targetDir, 'simulator/librito_ffi.a');
    fs.mkdirSync(path.dirname(sim), { recursive: true });
    run('lipo', ['-create', ...targets.slice(1).map((target) => path.join(targetDir, target, 'release/librito_ffi.a')), '-output', sim]);
    run('xcodebuild', ['-create-xcframework', '-library', path.join(targetDir, targets[0], 'release/librito_ffi.a'), '-headers', headers, '-library', sim, '-headers', headers, '-output', path.join(directory, 'RitoFFI.xcframework')]);
    toolchain = { rust: source.rustVersion, xcode: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim(), minimumIos: appleMinimum, targets };
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ schema: 1, platform, sourceSha256: sourceDigest(source), toolchain, files: tree(directory) }, null, 2) + '\n');
  verifyPrebuilt(root, [platform]);
  console.log(`Built and link-checked ${platform} prebuilts (${source.profile})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, platform] = process.argv.slice(2);
  if (command === 'build') build(platform);
  else if (command === 'verify') { verifyPrebuilt(root, platform ? [platform] : platforms); console.log('Prebuilt libraries verified'); }
  else throw new Error('Usage: prebuilt.mjs build android|ios OR verify [android|ios]');
}
