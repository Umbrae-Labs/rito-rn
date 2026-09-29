# Rito for React Native

React Native bindings for the [Rito](https://github.com/Ringyuki/Rito) EPUB engine,
published as [`@umbrae-labs/rito-rn`](https://www.npmjs.com/package/@umbrae-labs/rito-rn).

> [!IMPORTANT]
> This is an unofficial, community-maintained adaptation of Rito, maintained by
> Umbrae Labs for [Lunar](https://github.com/Umbrae-Labs/lunar).

## Precompiled Rust engine

The release pipeline builds the Rust engine before publishing and includes the
libraries in the npm package. Application builds link these libraries and compile
the Nitro C++ bridge against the application's React Native and Nitro versions.
Consumers of binary releases can build their applications without installing Rust
or cargo-ndk. Standard Android or Xcode build tools are still required.

| Platform | Included Rust library | Architectures |
| --- | --- | --- |
| Android | `librito_ffi.a` | `arm64-v8a` |
| iOS device | Static library in `RitoFFI.xcframework` | ARM64 |
| iOS simulator | Static library in `RitoFFI.xcframework` | ARM64 and x86_64 |

Each library is checked against its engine source manifest and file checksums.
Missing or mismatched artifacts stop the build; source compilation is an explicit
development option.

> [!NOTE]
> Version 0.2.0 was published as a source-only package. Precompiled libraries become
> available in releases built with this publishing configuration. Upgrade the npm
> dependency to such a release to use them.

Android static-library and Nitro bridge builds have been validated locally.
Apple library builds and FFI link checks are configured in macOS CI; a complete
iOS application build and device testing remain to be validated. Platform support
currently covers Android and iOS.

## Installation

```sh
pnpm add @umbrae-labs/rito-rn react-native-nitro-modules@0.37.0
```

Use a native application build after installing or upgrading this package so the
native library changes are included.

| Component | Development baseline |
| --- | --- |
| React Native | 0.86.3 with the New Architecture |
| React | 19.2.3 |
| Nitro Modules | 0.37.0 |
| Expo integration | SDK 57 |
| Node.js | 22 or newer |

### Android

For Expo projects, add the plugin to the existing `plugins` array in the app
configuration. The plugin sets `reactNativeArchitectures` to `arm64-v8a`.

```json
{
  "expo": {
    "plugins": ["@umbrae-labs/rito-rn"]
  }
}
```

```sh
pnpm exec expo prebuild --platform android
pnpm exec expo run:android
```

For plain React Native projects, autolinking discovers the package. Set
`reactNativeArchitectures=arm64-v8a` in `android/gradle.properties`.

Configure the Android SDK, NDK and JDK for the host React Native version. The
bundled Rust library is built with NDK 27.1.12297006 and API 23; the application
must also meet React Native's minimum SDK requirement. Android x86_64 emulators
and 32-bit targets are outside the current package's supported architectures.

### iOS

On macOS, install pods using the application's usual CocoaPods command after
adding the package. Autolinking loads the podspec, which validates
`RitoFFI.xcframework`; CocoaPods selects the device or simulator library.

The Rust libraries target iOS 15.1 or newer. The application's minimum iOS version
must also satisfy its React Native version. The default pod configuration links
the bundled library without adding a Rust compilation phase.

## Source development

To modify the engine or use a source-only archive, enable
`RITO_BUILD_FROM_SOURCE=1`. Android also accepts `ritoBuildFromSource=true` in
Gradle properties. On iOS, set the environment variable when running `pod install`
and when building; rerun pod installation without it to return to precompiled mode.

Source builds require Rust 1.95.0 and the appropriate target toolchains. Android
also requires cargo-ndk 4.1.2. `RITO_FFI_SOURCE_DIR` selects a custom Rust workspace
and enables source mode. See [CONTRIBUTING.md](CONTRIBUTING.md) for kernel patches,
tooling checks and packaging commands.

| Directory | Purpose |
| --- | --- |
| `src` | TypeScript API, reader sessions and protocol handling |
| `cpp`, `android`, `ios` | Nitro bridge and platform integration |
| `upstream/rito` | Rito fork submodule for engine development |
| `patches` | Exported kernel patch series |
| `native/rito` | Generated Rust source included in npm packages |
| `prebuilt` | Generated Rust binaries and verification manifests |

## License

[AGPL-3.0-only](LICENSE). Rito and vendored Parley retain their license files.
See [NOTICE](NOTICE) for attribution.
