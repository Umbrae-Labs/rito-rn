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

export function profileConfig(lock, name) {
  const profile = lock.profiles[name];
  if (!profile || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Unknown engine profile: ${name}`);
  if (!/^[a-f0-9]{40}$/.test(profile.commit)) throw new Error('Engine revisions must be full commit hashes');
  for (const patch of profile.patches) {
    if (!patch.file.startsWith('patches/') || !/^[a-f0-9]{64}$/.test(patch.sha256)) throw new Error('Invalid patch record');
    inside(root, patch.file);
  }
  return profile;
}

function sourceReady(lock, profile) {
  if (!fs.existsSync(path.join(checkout, '.git'))) throw new Error('Run git submodule update --init --recursive first');
  if (git('remote', 'get-url', 'origin') !== lock.repository) throw new Error('Submodule origin differs from engine.lock.json');
  if (git('status', '--porcelain')) throw new Error('Commit kernel edits on a topic branch, then run engine:capture before exporting');
  try { git('cat-file', '-e', `${profile.commit}^{commit}`); }
  catch { git('fetch', '--no-tags', 'origin', profile.commit); }
}

export function materialize(name) {
  const lock = json(lockPath);
  const profile = profileConfig(lock, name);
  sourceReady(lock, profile);
  const relative = `.engine/workspaces/${name}`;
  removeGenerated(relative);
  const workspace = inside(root, relative);
  fs.mkdirSync(workspace, { recursive: true });
  const archive = path.join(root, '.engine', `${name}.tar`);
  execFileSync('git', ['-C', checkout, 'archive', '--format=tar', '-o', archive, profile.commit]);
  execFileSync('tar', ['-xf', archive, '-C', workspace]);
  fs.unlinkSync(archive);
  execFileSync('git', ['init', '--quiet', workspace]);
  for (const patch of profile.patches) {
    const file = inside(root, patch.file);
    if (hash(fs.readFileSync(file)) !== patch.sha256) throw new Error(`Patch checksum mismatch: ${patch.file}`);
    execFileSync('git', ['-C', workspace, 'apply', '--check', file]);
    execFileSync('git', ['-C', workspace, 'apply', file]);
  }
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

export function exportEngine(name) {
  const { lock, profile, workspace } = materialize(name);
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
  const provenance = { schema: 1, profile: name, repository: lock.repository, commit: profile.commit, rustVersion: lock.rustVersion, patches: profile.patches, files: fileHashes(stage) };
  writeJson(path.join(stage, 'rito-source.json'), provenance);
  removeGenerated('native/rito');
  copy(stage, path.join(root, 'native/rito'));
  console.log(`Exported ${name}: ${profile.commit} + ${profile.patches.length} patches`);
  return provenance;
}

export function verifyEngine(directory = path.join(root, 'native/rito')) {
  const provenance = json(path.join(directory, 'rito-source.json'));
  const actual = fileHashes(directory);
  if (JSON.stringify(actual) !== JSON.stringify(provenance.files)) throw new Error('Generated Rust sources changed; edit the fork and regenerate');
  const lock = json(lockPath);
  const profile = profileConfig(lock, provenance.profile);
  if (profile.commit !== provenance.commit || lock.repository !== provenance.repository || lock.rustVersion !== provenance.rustVersion || JSON.stringify(profile.patches) !== JSON.stringify(provenance.patches)) throw new Error('Export is stale relative to engine.lock.json');
  for (const patch of profile.patches) if (hash(fs.readFileSync(inside(root, patch.file))) !== patch.sha256) throw new Error(`Patch checksum mismatch: ${patch.file}`);
  console.log(`Verified ${Object.keys(actual).length} Rust source files (${provenance.profile})`);
  return provenance;
}

function capture(name, revision) {
  const lock = json(lockPath);
  const profile = profileConfig(lock, name);
  sourceReady(lock, profile);
  const head = git('rev-parse', '--verify', `${revision}^{commit}`);
  git('merge-base', '--is-ancestor', profile.commit, head);
  const commits = git('rev-list', '--reverse', `${profile.commit}..${head}`).split('\n').filter(Boolean);
  if (!commits.length) throw new Error('No patch commits to capture');
  if (git('rev-list', '--merges', `${profile.commit}..${head}`)) throw new Error('Capture a linear topic branch with focused commits');
  fs.mkdirSync(path.join(root, 'patches'), { recursive: true });
  profile.patches = commits.map((commit, index) => {
    const file = `patches/${name}-${String(index + 1).padStart(4, '0')}-${commit.slice(0, 12)}.patch`;
    const bytes = execFileSync('git', ['-C', checkout, 'format-patch', '-1', '--stdout', '--binary', '--no-signature', commit], { maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(path.join(root, file), bytes);
    return { file, sha256: hash(bytes), sourceCommit: commit, subject: git('show', '-s', '--format=%s', commit), upstreamPr: null };
  });
  writeJson(lockPath, lock);
  console.log(`Captured ${commits.length} commits; the topic branch remains available for an upstream PR`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const lock = json(lockPath);
  const name = option('--profile', lock.defaultProfile);
  if (command === 'export') exportEngine(name);
  else if (command === 'verify') verifyEngine();
  else if (command === 'capture') capture(name, option('--head', 'HEAD'));
  else if (command === 'update') {
    const profile = profileConfig(lock, name);
    sourceReady(lock, profile);
    const ref = option('--ref', profile.ref);
    if (!/^[a-zA-Z0-9][\w./-]*$/.test(ref)) throw new Error('Invalid Git ref');
    git('fetch', 'origin', ref);
    profile.commit = git('rev-parse', 'FETCH_HEAD');
    profile.ref = ref;
    const old = fs.readFileSync(lockPath);
    writeJson(lockPath, lock);
    try { exportEngine(name); } catch (error) { fs.writeFileSync(lockPath, old); throw error; }
    if (name === lock.defaultProfile) git('checkout', '--detach', profile.commit);
    console.log('Review engine.lock.json, the submodule pointer, compatibility tests and generated package before committing');
  } else if (command === 'test') {
    const { workspace } = materialize(name);
    const env = { ...process.env, CARGO_TARGET_DIR: path.join(root, '.engine/cargo-target') };
    for (const params of [
      ['test', '--locked', '-p', 'rito-block', '-p', 'rito-core', '-p', 'rito-stylo', '-p', 'rito-style-contract', '--lib'],
      ['test', '--locked', '-p', 'rito-stylo', '--test', 'layout_style'],
      ['check', '--locked', '-p', 'rito-ffi', '--lib'],
    ]) execFileSync('cargo', [`+${lock.rustVersion}`, ...params], { cwd: workspace, env, stdio: 'inherit' });
  } else throw new Error('Usage: engine.mjs export|verify|update|capture|test [--profile lunar|canary|upstream-release] [--ref dev] [--head branch]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
