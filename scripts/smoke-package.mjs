import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, verifyEngine } from './engine.mjs';

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tarball = path.resolve(process.argv[2] ?? path.join(root, 'artifacts', `umbrae-labs-rito-rn-${packageJson.version}.tgz`));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rito-package-smoke-'));
try {
  execFileSync('tar', ['-xf', tarball, '-C', temporary]);
  const unpacked = path.join(temporary, 'package');
  const source = path.join(unpacked, 'native/rito');
  verifyEngine(source);
  const metadata = JSON.parse(execFileSync('cargo', ['+1.95.0', 'metadata', '--locked', '--no-deps', '--format-version', '1', '--manifest-path', path.join(source, 'Cargo.toml')], { encoding: 'utf8' }));
  for (const pkg of metadata.packages) {
    if (!path.resolve(pkg.manifest_path).startsWith(source + path.sep)) throw new Error(`Manifest escapes the installed package: ${pkg.name}`);
    for (const target of pkg.targets) if (!fs.existsSync(target.src_path)) throw new Error(`Missing Cargo target source: ${target.src_path}`);
  }
  execFileSync('cargo', ['+1.95.0', 'check', '--locked', '--manifest-path', path.join(source, 'Cargo.toml'), '-p', 'rito-ffi', '--lib'], {
    env: { ...process.env, CARGO_TARGET_DIR: path.join(root, '.engine/cargo-target') }, stdio: 'inherit',
  });
  console.log(`Independent archive verified: ${metadata.packages.length} workspace crates and all declared Cargo target sources`);
} finally {
  if (!path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected smoke-test directory');
  fs.rmSync(temporary, { recursive: true, force: true });
}
