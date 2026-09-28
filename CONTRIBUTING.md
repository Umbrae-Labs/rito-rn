# Development and engine ownership

The adapter and kernel have separate editing locations. Edit TypeScript, Nitro,
C++ and platform integration in this repository. Edit Rust in `upstream/rito`,
on a topic branch of the Rito fork. `native/rito` and `.engine` are generated.

## Initial checkout

```sh
git clone --recurse-submodules <adapter-repository>
cd <adapter-repository>
pnpm install --frozen-lockfile
pnpm run engine:export
pnpm run check
```

The submodule records the default profile's public base commit. `engine.lock.json`
records the exact base for each profile, plus ordered exported patches and their
SHA-256 checksums. Branch names are used only by the explicit update command.
Neither installation nor ordinary export fetches a moving branch. A shallow
development checkout may fetch a missing pinned commit by its full SHA.

## Editing a kernel patch

Start a topic branch at the `lunar.commit` in `engine.lock.json`. On a fresh
checkout, apply the profile's existing patches in manifest order with `git am`
before adding further commits. A local branch containing the current patch
stack can also be used. Keep each upstream candidate focused and tested.

```sh
git -C upstream/rito switch -c fix/my-change <locked-base-sha>
git -C upstream/rito am ../../patches/<existing-patch>.patch
# Edit and test the Rust sources, then commit in upstream/rito.
pnpm run engine:capture -- --profile lunar --head fix/my-change
git -C upstream/rito checkout --detach <locked-base-sha>
pnpm run engine:export
pnpm run engine:test
pnpm run check
```

Capture replaces the profile's complete patch series with the linear commits
between its base and `--head`; include all patches that should remain. Patch
files are generated transport artifacts, not a second hand-edited source tree.
Their `sourceCommit` and subject identify the original commits. This also makes
CI builds possible before a new topic branch has been pushed to the fork.

Push a focused topic branch to the fork when ready to open an upstream PR.
Record its URL in the corresponding patch's `upstreamPr` field. When the fix is
included in a later base, remove that patch entry before exporting the upgrade.
An already-applied or conflicting patch intentionally stops the upgrade for review.

The initial CSS fix is available locally on `fix/css-sizing-fallback`, commit
`d5b620862d9d330fe5326e1974ee7ed05ab8967b`. Its generated patch is included in this
repository. No remote push is required to build it.

## Updating the base

```sh
pnpm run engine:update -- --profile lunar --ref dev
pnpm run engine:test
pnpm run check
git add engine.lock.json upstream/rito
```

For other profiles use `canary` with `dev`, or `upstream-release` with `master`.
An update resolves a full commit, checks every patch and exports a candidate.
A patch failure restores the old lock file. Existing releases remain identified
by their package version and provenance manifest.

The scheduled adapter action proposes changes from the fork. Install
`templates/sync-fork.yml` in the fork as `.github/workflows/sync-upstream.yml`
to update its `master` and `dev` branches from Ringyuki/Rito. The action fast-forwards
where possible and otherwise merges, preserving the fork's automation commit.
Conflicts stop the action; neither branch is force-pushed. Keep kernel fixes on
topic branches so each upstream PR has an isolated change set.

## Tests and package checks

`pnpm run check` runs adapter types, protocol/session tests, tooling tests,
source-integrity checks and npm file-list checks. `pnpm run engine:test` tests a
full generated engine workspace with upstream fixtures and fonts; the smaller
npm export is validated separately by Cargo and the native build.
Export prunes Cargo.lock for the smaller workspace and verifies that every
remaining registry dependency retains its upstream version and checksum.
`pnpm run package:smoke` unpacks the tarball outside this repository, verifies
its file hashes and builds the FFI crate with `--locked`.

CI also checks the Android ARM64 and Apple device/simulator Rust targets. Native
device behavior remains part of Lunar's adoption testing. An engine update is
not an automatic Lunar dependency upgrade.

## Publishing

Use a new package version for every changed artifact. The package version belongs
to the adapter and need not equal the engine version. Review `native/rito/rito-source.json`
for its base, patch series, toolchain and file hashes.

```sh
pnpm run engine:export
pnpm run check
pnpm pack --pack-destination artifacts
```

The manual release action accepts a profile and unique version. By default it
uploads a tarball only. Enabling `publish` publishes through the `npm` GitHub
environment, using that environment's `NPM_TOKEN` and the following dist-tag:

| Profile | npm tag | Version example |
| --- | --- | --- |
| lunar | latest | 0.2.0 |
| canary | canary | 0.3.0-canary.1 |
| upstream-release | upstream-release | 0.3.0-upstream.1 |

Preview profiles require a prerelease version. Configure npm access for
`@umbrae-labs` and the GitHub environment before the first publish. Set the
package's repository URL after uploading this independent repository.

Consumers pin a concrete version. The dist-tags identify release channels; they
are not reproducible build inputs. Lunar temporarily consumes the packed tarball
from `vendor`, so its repository builds without this development checkout.
