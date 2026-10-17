import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = path.join(root, 'upstream/rito');
const lockPath = path.join(root, 'engine.lock.json');
const crates = ['rito-core', 'rito-ffi', 'rito-block', 'rito-fragment', 'rito-inline', 'rito-source', 'rito-style-contract', 'rito-stylo'];
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function registryPins(lockText) {
  return lockText.split('[[package]]').filter((entry) => /^source = /m.test(entry)).map((entry) => {
    const field = (name) => entry.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))?.[1] ?? '';
    return [field('name'), field('version'), field('source'), field('checksum')].join('|');
  });
}
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();

export function inside(parent, relative) {
  const result = path.resolve(parent, relative);
  const suffix = path.relative(parent, result);
  if (!suffix || suffix.startsWith('..') || path.isAbsolute(suffix)) throw new Error(`Invalid relative destination: ${relative}`);
  return result;
}

function removeGenerated(relative) {
  if (!relative.startsWith('.engine/') && relative !== 'native/rito') throw new Error(`Refusing to remove ${relative}`);
  const destination = inside(root, relative);
  // Every recursive replacement is confined to generated directories in this repository.
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('Generated directory is a symlink');
  fs.rmSync(destination, { recursive: true, force: true });
}

// Each adapter branch builds exactly one engine line: the fork branch of the same name.
export const profiles = { lunar: 'lunar', canary: 'dev', 'upstream-release': 'master' };

export function profileConfig(lock) {
  if (lock.schema !== 3) throw new Error('Unsupported engine.lock.json schema');
  const { profile: name, ref, commit } = lock;
  if (profiles[name] === undefined) throw new Error(`Unknown engine profile: ${name}`);
  if (profiles[name] !== ref) throw new Error(`Profile ${name} must track the fork branch ${profiles[name]}`);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Engine revisions must be full commit hashes');
  return { name, ref, commit };
}

function sourceReady(lock, profile) {
  if (!fs.existsSync(path.join(checkout, '.git'))) throw new Error('Run git submodule update --init --recursive first');
  if (git('remote', 'get-url', 'origin') !== lock.repository) throw new Error('Submodule origin differs from engine.lock.json');
  if (git('status', '--porcelain')) throw new Error('Commit kernel edits to the fork, then update the lock before exporting');
  try { git('cat-file', '-e', `${profile.commit}^{commit}`); }
  catch { git('fetch', '--no-tags', 'origin', profile.commit); }
}

export function materialize() {
  const lock = json(lockPath);
  const profile = profileConfig(lock);
  const { name } = profile;
  sourceReady(lock, profile);
  const relative = `.engine/workspaces/${name}`;
  removeGenerated(relative);
  const workspace = inside(root, relative);
  fs.mkdirSync(workspace, { recursive: true });
  const archive = path.join(root, '.engine', `${name}.tar`);
  execFileSync('git', ['-C', checkout, 'archive', '--format=tar', '-o', archive, profile.commit]);
  execFileSync('tar', ['-xf', archive, '-C', workspace]);
  fs.unlinkSync(archive);
  return { lock, profile, workspace };
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

export function fileHashes(directory) {
  const files = {};
  function visit(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === 'target' || item.name === 'rito-source.json' || item.name === '.npmignore') continue;
      const file = path.join(current, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink in generated source: ${file}`);
      if (item.isDirectory()) visit(file);
      else files[path.relative(directory, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file));
    }
  }
  visit(directory);
  return files;
}

export function exportEngine() {
  const { lock, profile, workspace } = materialize();
  const { name } = profile;
  const stage = inside(root, `.engine/export/${name}`);
  removeGenerated(`.engine/export/${name}`);
  fs.mkdirSync(stage, { recursive: true });
  let manifest = fs.readFileSync(path.join(workspace, 'Cargo.toml'), 'utf8');
  manifest = manifest.replace(/members\s*=\s*\[[\s\S]*?\]/, `members = [\n${crates.map((crate) => `  "crates/${crate}",`).join('\n')}\n]`);
  fs.writeFileSync(path.join(stage, 'Cargo.toml'), manifest);
  for (const file of ['Cargo.lock', 'LICENSE']) copy(path.join(workspace, file), path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'rust-toolchain.toml'), `[toolchain]\nchannel = "${lock.rustVersion}"\nprofile = "minimal"\n`);
  fs.writeFileSync(path.join(stage, '.npmignore'), 'target/\n**/target/\n');
  for (const crate of [...crates, 'vendor/parley']) {
    const base = path.join(workspace, 'crates', crate);
    for (const item of ['Cargo.toml', 'src', 'include', 'examples', 'build.rs', 'LICENSE', 'LICENSE-APACHE', 'LICENSE-MIT']) {
      if (fs.existsSync(path.join(base, item))) copy(path.join(base, item), path.join(stage, 'crates', crate, item));
    }
  }
  // Removing workspace members can remove optional dependencies from Cargo.lock.
  // Resolve that change during export while preserving all upstream registry pins.
  const originalPins = new Set(registryPins(fs.readFileSync(path.join(stage, 'Cargo.lock'), 'utf8')));
  execFileSync('cargo', [`+${lock.rustVersion}`, 'update', '--workspace', '--manifest-path', path.join(stage, 'Cargo.toml')], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const pin of registryPins(fs.readFileSync(path.join(stage, 'Cargo.lock'), 'utf8'))) {
    if (!originalPins.has(pin)) throw new Error(`Export would change an upstream dependency pin: ${pin}`);
  }
  const provenance = { schema: 3, profile: name, repository: lock.repository, ref: profile.ref, commit: profile.commit, rustVersion: lock.rustVersion, files: fileHashes(stage) };
  writeJson(path.join(stage, 'rito-source.json'), provenance);
  removeGenerated('native/rito');
  copy(stage, path.join(root, 'native/rito'));
  console.log(`Exported ${name}: ${profile.ref} at ${profile.commit}`);
  return provenance;
}

// Installed packages and unpacked archives have no submodule entry, so the pointer check is skipped there.
function recordedCheckout() {
  try {
    const entry = execFileSync('git', ['-C', root, 'ls-files', '--stage', '--', 'upstream/rito'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return entry.startsWith('160000 ') ? entry.split(/\s+/)[1] : null;
  } catch { return null; }
}

export function verifyEngine(directory = path.join(root, 'native/rito')) {
  const provenance = json(path.join(directory, 'rito-source.json'));
  const actual = fileHashes(directory);
  if (JSON.stringify(actual) !== JSON.stringify(provenance.files)) throw new Error('Generated Rust sources changed; edit the fork and regenerate');
  const lock = json(lockPath);
  const profile = profileConfig(lock);
  if (provenance.schema !== 3 || profile.name !== provenance.profile || profile.commit !== provenance.commit || profile.ref !== provenance.ref || lock.repository !== provenance.repository || lock.rustVersion !== provenance.rustVersion) throw new Error('Export is stale relative to engine.lock.json');
  if (directory === path.join(root, 'native/rito')) {
    const recorded = recordedCheckout();
    if (recorded && recorded !== profile.commit) throw new Error('upstream/rito pointer differs from engine.lock.json; run engine:update or check out the locked commit and stage the submodule');
  }
  console.log(`Verified ${Object.keys(actual).length} Rust source files (${provenance.profile})`);
  return provenance;
}

async function main() {
  const command = process.argv[2];
  if (command === 'export') exportEngine();
  else if (command === 'verify') verifyEngine();
  else if (command === 'update') {
    const lock = json(lockPath);
    const profile = profileConfig(lock);
    sourceReady(lock, profile);
    git('fetch', 'origin', profile.ref);
    lock.commit = git('rev-parse', 'FETCH_HEAD');
    const old = fs.readFileSync(lockPath);
    writeJson(lockPath, lock);
    try { exportEngine(); } catch (error) { fs.writeFileSync(lockPath, old); throw error; }
    git('checkout', '--detach', lock.commit);
    execFileSync('git', ['-C', root, 'add', 'upstream/rito']);
    console.log('Review engine.lock.json, the submodule pointer, compatibility tests and generated package before committing');
  } else if (command === 'test') {
    const { lock, workspace } = materialize();
    const env = { ...process.env, CARGO_TARGET_DIR: path.join(root, '.engine/cargo-target') };
    for (const params of [
      ['test', '--locked', '-p', 'rito-block', '-p', 'rito-core', '-p', 'rito-stylo', '-p', 'rito-style-contract', '--lib'],
      ['test', '--locked', '-p', 'rito-stylo', '--test', 'layout_style'],
      ['check', '--locked', '-p', 'rito-ffi', '--lib'],
    ]) execFileSync('cargo', [`+${lock.rustVersion}`, ...params], { cwd: workspace, env, stdio: 'inherit' });
  } else throw new Error('Usage: engine.mjs export|verify|update|test');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
