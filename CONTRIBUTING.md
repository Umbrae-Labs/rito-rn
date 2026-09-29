# Development and engine ownership

The adapter and kernel have separate editing locations. Edit TypeScript, Nitro,
C++ and platform integration in this repository. Edit Rust in `upstream/rito`,
on a topic branch of the Rito fork. `native/rito`, `prebuilt` and `.engine` are generated.

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
for its base, patch series, toolchain and file hashes.

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
the selected profile on each build host, builds and link-checks the libraries,
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

The manual release action accepts a profile and unique version. By default it
uploads a tarball only. Enabling `publish` publishes through the `npm` GitHub
environment using npm trusted publishing with GitHub OIDC and the following dist-tag:

| Profile | npm tag | Version example |
| --- | --- | --- |
| lunar | latest | 0.2.0 |
| canary | canary | 0.3.0-canary.1 |
| upstream-release | upstream-release | 0.3.0-upstream.1 |

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

Preview profiles require a prerelease version. The release job runs on a
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

Once configured, run the release action with a new version, profile `lunar`, and
`publish` enabled. npm exchanges the GitHub OIDC identity for short-lived publish
credentials. Public GitHub repositories publishing public packages also receive
automatic provenance. After a successful OIDC release, remove any obsolete npm
publishing token and corresponding GitHub secret.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

Consumers pin a concrete version. The dist-tags identify release channels; they
are not reproducible build inputs. Lunar consumes the exact npm registry version
`@umbrae-labs/rito-rn@0.2.0`, so its repository builds without this development checkout.
