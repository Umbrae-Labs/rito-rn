require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RitoNitro"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"] || "https://github.com/Saramanda9988/Rito"
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :path => '.' }

  s.source_files = [
    "cpp/HybridRitoNitro.{hpp,cpp}",
    "cpp/RitoExecutor.{h,cpp}",
    "cpp/RitoOwnedBuffer.{h,cpp}",
    "cpp/RitoAbiExtensions.h",
    "cpp/RitoPinnedFontAbi.h",
  ]
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'HEADER_SEARCH_PATHS' => '$(PODS_TARGET_SRCROOT)/native/rito/crates/rito-ffi/include'
  }
  s.user_target_xcconfig = {
    'LIBRARY_SEARCH_PATHS' => '$(inherited) "$(PODS_CONFIGURATION_BUILD_DIR)/RitoNitro"',
    'OTHER_LDFLAGS' => '$(inherited) -lrito_ffi'
  }

  load 'nitrogen/generated/ios/RitoNitro+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)

  s.script_phase = {
    :name => 'Build Rito Rust library',
    :execution_position => :before_compile,
    :script => 'bash "${PODS_TARGET_SRCROOT}/scripts/build-ios.sh"',
    :input_files => ['$(PODS_TARGET_SRCROOT)/native/rito/rito-source.json', '$(PODS_TARGET_SRCROOT)/native/rito/Cargo.lock'],
    :output_files => ['$(PODS_CONFIGURATION_BUILD_DIR)/RitoNitro/librito_ffi.a']
  }
end
