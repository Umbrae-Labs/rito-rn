# Rito-rn

> [!IMPORTANT]
> This is an unofficial, community-maintained adaptation layer for [Rito](https://github.com/Ringyuki/Rito)

React Native Nitro bindings for the [Rito](https://github.com/Ringyuki/Rito)

## Install

Install a published version:

```sh
pnpm add @umbrae-labs/rito-rn react-native-nitro-modules@0.37.0
```

## Requirements

| Component | Current baseline |
| --- | --- |
| React Native | 0.86.3, New Architecture |
| Nitro Modules | 0.37.0 |
| Expo integration | SDK 57 |
| Rust, for source builds and maintainers | 1.95.0 |
| cargo-ndk, for Android source builds and maintainers | 4.1.2 |
| Android ABI | arm64-v8a |
| Package tooling | Node 22 or newer, pnpm 11.24.0 |

Releases built from this revision include the Rust FFI binaries. Version 0.2.0
was source-only; these changes take effect after publishing and installing a new
version. App developers still need the usual Android or Xcode toolchain to build
the Nitro bridge and application. Using a binary release does not require Rust.

## Android

Add `@umbrae-labs/rito-rn` to the Expo `plugins` array. The plugin selects ARM64;
the library Gradle project verifies the bundled ARM64 static library and links
it through CMake. Plain React Native uses
autolinking and `reactNativeArchitectures=arm64-v8a` in Gradle properties.

```sh
pnpm exec expo prebuild --platform android
pnpm exec expo run:android
```

Configure SDK, NDK and JDK versions matching the host React Native version.
The binary is built with NDK 27.1.12297006 and API 23. Only arm64-v8a is currently
supported. Missing or mismatched binaries stop the build with an actionable
error rather than automatically starting Cargo.

## iOS

Autolinking loads the podspec, which verifies and links `RitoFFI.xcframework`.
It contains an ARM64 device library and an ARM64/x86_64 simulator library built
for iOS 15.1 or newer; the host React Native version may require a newer minimum.
CocoaPods selects the matching slice. Run `pod install` after upgrading the package.

The release CI builds and link-checks all three Rust targets on macOS. A complete
React Native Xcode build and device behavior still require platform validation.
VisionOS is not supported.

## Building Rust from source

For engine development, explicitly opt in with `RITO_BUILD_FROM_SOURCE=1`.
On Android, `ritoBuildFromSource=true` in Gradle properties is also supported.
On iOS, set the environment variable **when running pod install** so the podspec
selects its Rust build phase, then keep it set while building. Run pod install
again without it to return to the bundled XCFramework.

Install the tools for the platform being built:

```sh
rustup toolchain install 1.95.0 --profile minimal
rustup target add aarch64-linux-android --toolchain 1.95.0
cargo +1.95.0 install cargo-ndk --version 4.1.2 --locked
# On macOS, for Apple targets:
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios --toolchain 1.95.0
```

Rust builds use `--locked`. `RITO_FFI_SOURCE_DIR` selects a custom kernel workspace
and also enables source mode. Set it during pod installation and Xcode builds on
iOS. In source mode, an existing Apple `librito_ffi.a` can be supplied with
`RITO_FFI_IOS_LIBRARY_DIR`; it must match the active platform and architectures.

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
# Build on the appropriate hosts and collect both prebuilt directories first:
pnpm run native:build android
# On macOS:
pnpm run native:build ios
pnpm run native:verify
pnpm pack --pack-destination artifacts
```

Generated Rust sources and binaries are excluded from adapter Git history and
included in npm packages. Source generation runs while packing, never during
consumer installation. `prebuilt/<platform>/manifest.json` records artifact hashes,
build tool versions, and a digest of the engine source manifest, including its
profile, patches and header hashes. Packing requires both platforms by default.
See CONTRIBUTING.md for an explicit source-only development archive.
The release action defaults to building an artifact; publishing is explicitly selected.
GitHub releases authenticate through npm trusted publishing with OIDC. Register
`Umbrae-Labs`, repository `rito-rn`, workflow `release.yml`, and environment `npm`
in the npm package settings. A new package needs one interactive initial publish
before this trust relationship can be registered; see CONTRIBUTING.md.

## License

AGPL-3.0-only. Rito and vendored Parley retain their license files. See LICENSE and NOTICE.
