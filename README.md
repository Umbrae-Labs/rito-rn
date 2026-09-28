# rito-rn

> [!IMPORTANT]
> This is an unofficial, community-maintained adaptation layer for [Rito](https://github.com/Ringyuki/Rito)

React Native Nitro bindings for the [Rito](https://github.com/Ringyuki/Rito)

## Install

After publication:

```sh
pnpm add @umbrae-labs/rito-rn@0.2.0 react-native-nitro-modules@0.37.0
```

## Requirements

| Component | Current baseline |
| --- | --- |
| React Native | 0.86.3, New Architecture |
| Nitro Modules | 0.37.0 |
| Expo integration | SDK 57 |
| Rust | 1.95.0 |
| cargo-ndk | 4.1.2 |
| Android ABI | arm64-v8a |
| Package tooling | Node 22 or newer, pnpm 11.24.0 |

## Android

Add `@umbrae-labs/rito-rn` to the Expo `plugins` array. The plugin selects ARM64;
the library Gradle project owns Cargo and CMake tasks. Plain React Native uses
autolinking and `reactNativeArchitectures=arm64-v8a` in Gradle properties.

```sh
rustup toolchain install 1.95.0 --profile minimal
rustup target add aarch64-linux-android --toolchain 1.95.0
cargo +1.95.0 install cargo-ndk --version 4.1.2 --locked
pnpm exec expo prebuild --platform android
pnpm exec expo run:android
```

Configure SDK, NDK and JDK versions matching the host React Native version.
Rust builds use `--locked` and store caches under the module Android build
directory. `RITO_FFI_SOURCE_DIR` can select a full kernel workspace for local
development; normal installations use the packaged source.

## iOS

Autolinking loads the podspec, whose build phase compiles Rust for the active
Apple architecture and links the static library. On macOS, install:

```sh
rustup toolchain install 1.95.0 --profile minimal
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios --toolchain 1.95.0
```

An existing `librito_ffi.a` can be supplied with `RITO_FFI_IOS_LIBRARY_DIR`.
This setup was constructed on Windows; validate an Xcode host application before
adopting iOS support. VisionOS has no Rust target mapping in this package yet.

## Engine profiles

| Profile | Fixed source | Local patches | npm tag |
| --- | --- | --- | --- |
| lunar | Fork dev commit | Explicit patch series | latest |
| canary | Fork dev commit | None | canary |
| upstream-release | Fork master commit | None | upstream-release |

`engine.lock.json` records the build inputs. The generated
`native/rito/rito-source.json` records source hashes and attribution. Branch names
are resolved only by explicit update commands; builds use commit hashes.
The master profile represents an official upstream release only when its SHA is
pinned to that release. The Lunar profile includes the CSS sizing compatibility
fix; some content-based dimensions currently use automatic sizing.

## Development and publishing

See [CONTRIBUTING.md](CONTRIBUTING.md) for patch capture, upstream PRs, updates,
CI, fork synchronization and npm publication.

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm run engine:export
pnpm run check
pnpm run engine:test
pnpm pack --pack-destination artifacts
```

Generated Rust sources are excluded from adapter Git history and included in npm
packages. Source generation runs while packing, never during consumer installation.
The release action defaults to building an artifact; publishing is explicitly selected.

## License

AGPL-3.0-only. Rito and vendored Parley retain their license files. See LICENSE and NOTICE.
