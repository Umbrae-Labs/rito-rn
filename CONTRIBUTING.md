# Development and engine ownership

The adapter and kernel have separate editing locations. Edit TypeScript, Nitro,
C++ and platform integration in this repository. Edit Rust in `upstream/rito`,
a submodule of the Rito fork. `native/rito`, `prebuilt` and `.engine` are generated.

## Branches

The adapter and the fork have the same three lines. Each adapter branch builds
only the fork branch of the same name, so bindings one line adds never reach
the packages of another.

| Adapter and fork branch | Engine | Adapter content | npm tag | Version |
| --- | --- | --- | --- | --- |
| `master` | Mirror of Ringyuki/Rito `master` | Upstream release support | `latest` | `0.3.0` |
| `dev` | Mirror of Ringyuki/Rito `dev` | Upstream development support | `canary` | `0.4.0-canary.1` |
| `lunar` | Upstream `dev` plus Lunar kernel commits | `dev` plus Lunar bindings | `lunar` | `0.3.0-lunar.1` |

Fork `dev` and `master` carry no fork commits; update them only by
fast-forwarding to Ringyuki/Rito. Fork fix branches start from `dev`, one
upstream PR each.

Changes flow in one direction in both repositories: `dev` into `lunar`, and
`dev` into `master` when upstream releases. Adapter support for upstream
protocol changes is made on `dev`; bindings for Lunar-only kernel changes are
made on `lunar` and never merged back. Never rebase or force-push any of the
three branches: released packages pin adapter and fork commits by SHA.

## Initial checkout

```sh
git clone --recurse-submodules --branch <dev|lunar|master> <adapter-repository>
cd <adapter-repository>
pnpm install --frozen-lockfile
pnpm run engine:export
pnpm run check
```

`engine.lock.json` names the branch's engine profile, the fork branch it tracks
and the exact commit built from it. The branch name is used only by the explicit
update command. Neither installation nor ordinary export fetches a moving
branch. A shallow development checkout may fetch a missing pinned commit by its
full SHA.

The recorded submodule pointer always equals the locked commit; `engine:verify`
rejects any other committed or staged pointer. Working branches only move the
checked-out commit. Do not stage `upstream/rito` by hand; record a new commit
through `engine:update`.

## Changing the kernel

Lunar-only kernel changes are committed to fork `lunar`. A fix meant for
upstream starts from fork `dev` on its own branch, opens a PR against
Ringyuki/Rito `dev`, and is merged into fork `lunar` when Lunar needs it before
upstream releases it. Once upstream merges the PR, the next `dev` merge brings
it back to `lunar`.

```sh
git switch lunar
git -C upstream/rito switch -c fix/my-change origin/dev
# Edit, test and commit; push the branch and open the upstream PR.
git -C upstream/rito switch lunar
git -C upstream/rito merge fix/my-change
git -C upstream/rito push origin lunar
git -C upstream/rito checkout --detach
pnpm run engine:update
# Adapt src/protocol and the Nitro bridge if the change adds bindings.
pnpm run engine:test
pnpm run check
```

Every engine build input must be a pushed fork commit; CI fetches it by SHA.

## Updating from upstream

Sync the fork mirrors, then update the adapter's `dev` first:

```sh
gh repo sync Saramanda9988/Rito --branch dev
gh repo sync Saramanda9988/Rito --branch master
git switch dev
pnpm run engine:update
# Adapt src/protocol to the engine changes and refresh src/protocol/rito2.
pnpm run engine:test
pnpm run check
git add engine.lock.json upstream/rito
git commit
```

Then bring the same change to `lunar`. Merge fork `dev` into fork `lunar`
first, then merge adapter `dev` into adapter `lunar` without committing. The
lock file conflicts by design; keep `lunar`'s. The submodule pointer may
conflict or silently take `dev`'s commit; `engine:update` records the new fork
`lunar` commit either way, and `engine:verify` rejects a pointer that differs
from the lock:

```sh
git -C upstream/rito switch lunar
git -C upstream/rito merge origin/dev
git -C upstream/rito push origin lunar
git -C upstream/rito checkout --detach
git switch lunar
git merge --no-commit dev
git checkout --ours engine.lock.json
git add engine.lock.json
pnpm run engine:update
pnpm run engine:test
pnpm run check
git commit
```

When upstream releases, bring `dev` into `master` the same way: merge adapter
`dev` into adapter `master` without committing, keep `master`'s lock file and
run `engine:update`, which records the synced fork `master`.

An update resolves the branch head to a full commit and exports a candidate; a
failed export restores the old lock file. The update also detaches the submodule
at the new commit and stages its pointer. A changed engine can change the wire
protocol. Review the commits between the old and new engine for `RITO*` message,
`READER_PROTOCOL_VERSION` and `RITODL1` changes, update `src/protocol` with
them, and refresh `src/protocol/rito2` and its fixtures from the same upstream
commit.

The scheduled adapter action checks out each branch and proposes a lock update
against it. It does not update the fork itself; sync `dev` and `master` first.

## Tests and package checks

`pnpm run check` runs adapter types, protocol/session tests, tooling tests,
source-integrity checks and npm file-list checks. `pnpm run engine:test` tests a
full generated engine workspace with upstream fixtures and fonts; the smaller
npm export is validated separately by Cargo and the native build.
Export prunes Cargo.lock for the smaller workspace and verifies that every
remaining registry dependency retains its upstream version and checksum.
`pnpm run package:smoke` unpacks the tarball outside this repository and verifies
all source and binary hashes. It also executes the installed binary verifier
without requiring Cargo or the development checkout.

CI builds release-mode Android ARM64 and Apple device/simulator static libraries,
links small FFI clients, and packages the Apple slices into an XCFramework. Native
device behavior remains part of Lunar's adoption testing. An engine update is
not an automatic Lunar dependency upgrade.

## Publishing

Use a new package version for every changed artifact. The package version belongs
to the adapter and need not equal the engine version. Review `native/rito/rito-source.json`
for its fork branch, commit, toolchain and file hashes.

```sh
pnpm run engine:export
pnpm run check
# On an Android build host with Rust 1.95.0, cargo-ndk 4.1.2 and NDK 27.1.12297006:
pnpm run native:build android
# On macOS with Xcode and the three Apple Rust targets installed:
pnpm run native:build ios
# Collect both hosts' prebuilt directories in this checkout:
pnpm run native:verify
pnpm pack --pack-destination artifacts
pnpm run package:smoke
```

`native-prebuilds.yml` is a reusable action called by CI and release. It exports
the branch's engine on each build host, builds and link-checks the libraries,
and uploads `prebuilt-android` and `prebuilt-ios`. The packaging job downloads both,
checks their source identity, then packs and verifies the resulting npm archive.
The C++ Nitro bridge remains source-built against the consuming application's
React Native and Nitro versions. All binaries come from this release run;
consumer installation does not download separate GitHub artifacts.

Ordinary `pnpm run check` allows absent binary directories for engine editing,
but validates every binary directory that is present. An engine change invalidates
older prebuilts: rebuild them or remove the generated `prebuilt` directory before
running source-only checks. Normal `pnpm pack` requires both platforms. For a
local source-only development archive, remove generated prebuilts and set
`RITO_PACKAGE_MODE=source` while running `pnpm pack` and `pnpm run package:smoke`.
Consumers of that archive must enable `RITO_BUILD_FROM_SOURCE=1`. Public release
automation always requires binaries; keep source-only archives for development.

The manual release action runs on the selected branch and accepts a unique
version of that branch's form (see [Branches](#branches)); `scripts/release-channel.mjs`
rejects any other branch, profile or version form before native builds start.
Only `master` publishes plain versions, so a semver range never resolves to a
`lunar` or `canary` build whose bindings the upstream engine lacks. By default
the action uploads a tarball only. Enabling `publish` publishes through the
`npm` GitHub environment using npm trusted publishing with GitHub OIDC and the
branch's dist-tag. If the `npm` environment restricts deployment branches, allow
`master`, `dev` and `lunar`.

After npm publication succeeds, a separate job creates a GitHub Release named
`v<version>` and attaches the same verified npm archive. Its tag targets the
commit used by the run; release notes include the engine profile, npm package
link and GitHub-generated change notes. Prerelease versions are marked as
prereleases and do not replace GitHub's latest release. With `publish` disabled,
the archive remains an Actions artifact only.

The GitHub Release job alone receives `contents: write` through `GITHUB_TOKEN`;
it needs no additional repository secret. If this job fails after npm publication,
rerun the failed job rather than starting another npm publication of that version.
If GitHub created a partial release before the failure, inspect that release and
its assets before retrying creation.

The release job runs on a
GitHub-hosted runner with Node 24, checks npm >=11.5.1, and grants `id-token: write`.
It uses no `NPM_TOKEN` secret. Package-manager caching is disabled for this job.

### First publication

npm requires the package to exist before a trusted publisher can be registered.
For a new package, run the release action with `publish` left false, download the
verified tarball artifact, and publish it from an interactive local npm session:

```sh
npm login
npm publish ./umbrae-labs-rito-rn-0.2.0.tgz --access public --tag latest
```

Complete npm's interactive authentication and two-factor verification when
prompted. The account needs publishing permission for the `@umbrae-labs` scope.
Publish the tested artifact; subsequent versions must use a new version number.

### Registering the trusted publisher

In the npm package's Settings, choose Trusted Publisher and GitHub Actions:

| Field | Value |
| --- | --- |
| Organization or user | Umbrae-Labs |
| Repository | rito-rn |
| Workflow filename | release.yml |
| Environment name | npm |
| Allowed actions | Allow npm publish |

Create the `npm` environment in the GitHub repository as well. Values are
case-sensitive; the workflow field is the filename without `.github/workflows/`.
Keep `package.json` repository.url set to
`git+https://github.com/Umbrae-Labs/rito-rn.git`.

Once configured, run the release action on a branch with a new version and
`publish` enabled. npm exchanges the GitHub OIDC identity for short-lived publish
credentials. Public GitHub repositories publishing public packages also receive
automatic provenance. After a successful OIDC release, remove any obsolete npm
publishing token and corresponding GitHub secret.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

Consumers pin a concrete version. The dist-tags identify release channels; they
are not reproducible build inputs. Lunar pins an exact npm registry version in
`apps/mobile/package.json`, so its repository builds without this development checkout.

The release action sets the package version from its input without committing it.
After a publication, set `package.json` on the released branch to the published
version so each branch names its latest release.
