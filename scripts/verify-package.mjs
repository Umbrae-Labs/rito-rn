import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, verifyEngine } from './engine.mjs';

verifyEngine();
const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts'] : ['pack', '--dry-run', '--json', '--ignore-scripts'];
const result = JSON.parse(execFileSync(command, args, {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}))[0];
const names = new Set(result.files.map((file) => file.path));
for (const file of ['src/index.ts', 'app.plugin.js', 'plugin/index.js', 'android/build.gradle', 'android/CMakeLists.txt', 'RitoNitro.podspec', 'native/rito/Cargo.lock', 'native/rito/rito-source.json', 'native/rito/LICENSE', 'LICENSE', 'engine.lock.json']) {
  if (!names.has(file)) throw new Error(`Package is missing ${file}`);
}
for (const file of names) {
  if (/(^|\/)(target|node_modules|\.git|\.engine|upstream|build|\.cxx)(\/|$)/.test(file) || file.endsWith('.tsbuildinfo') || file.endsWith('.tgz')) throw new Error(`Build cache or development checkout leaked into package: ${file}`);
}
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'native/rito/rito-source.json'), 'utf8'));
for (const file of Object.keys(metadata.files)) if (!names.has(`native/rito/${file}`)) throw new Error(`Exported source omitted from npm package: ${file}`);
console.log(`Package verified: ${names.size} files, ${result.unpackedSize} bytes, profile ${metadata.profile}`);
