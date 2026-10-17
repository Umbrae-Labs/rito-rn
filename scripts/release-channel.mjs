import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileConfig, root } from './engine.mjs';

// npm dist-tag and version form for each engine line. Only the upstream release
// line publishes plain versions, so a semver range never resolves to Lunar or
// canary builds whose bindings the upstream engine lacks.
export const channels = {
  'upstream-release': { tag: 'latest', version: /^\d+\.\d+\.\d+$/ },
  canary: { tag: 'canary', version: /^\d+\.\d+\.\d+-canary\.\d+$/ },
  lunar: { tag: 'lunar', version: /^\d+\.\d+\.\d+-lunar\.\d+$/ },
};

export function releaseChannel(lock, version, branch) {
  const profile = profileConfig(lock);
  if (branch !== undefined && branch !== profile.ref) throw new Error(`Branch ${branch} builds the ${profile.ref} engine line; release from ${profile.ref}`);
  const channel = channels[profile.name];
  if (!channel.version.test(version)) throw new Error(`Version ${version} does not match the ${profile.name} line (${channel.version})`);
  return { profile: profile.name, tag: channel.tag };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'engine.lock.json'), 'utf8'));
    const { profile, tag } = releaseChannel(lock, process.argv[2] ?? '', process.argv[3]);
    console.log(`profile=${profile}\ntag=${tag}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
