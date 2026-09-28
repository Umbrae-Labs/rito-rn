#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
package_root="$(cd "$(dirname "$0")/.." && pwd)"
source_root="${RITO_FFI_SOURCE_DIR:-$package_root/native/rito}"
output_dir="${PODS_CONFIGURATION_BUILD_DIR:?Xcode build environment required}/RitoNitro"
target_dir="${DERIVED_FILE_DIR:?Xcode build environment required}/rito-target"
mkdir -p "$output_dir"
if [[ -n "${RITO_FFI_IOS_LIBRARY_DIR:-}" ]]; then
  cp "$RITO_FFI_IOS_LIBRARY_DIR/librito_ffi.a" "$output_dir/librito_ffi.a"
  exit 0
fi
libraries=()
for arch in ${ARCHS:-arm64}; do
  case "${PLATFORM_NAME:-iphoneos}:$arch" in
    iphoneos:arm64) target=aarch64-apple-ios ;;
    iphonesimulator:arm64) target=aarch64-apple-ios-sim ;;
    iphonesimulator:x86_64) target=x86_64-apple-ios ;;
    *) echo "Unsupported Apple target: ${PLATFORM_NAME}:$arch" >&2; exit 1 ;;
  esac
  cargo +1.95.0 build --release --locked --target "$target" --target-dir "$target_dir" \
    --manifest-path "$source_root/crates/rito-ffi/Cargo.toml"
  libraries+=("$target_dir/$target/release/librito_ffi.a")
done
lipo -create "${libraries[@]}" -output "$output_dir/librito_ffi.a"
