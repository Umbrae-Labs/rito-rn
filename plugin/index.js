const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withRitoNative(config) {
  return withGradleProperties(config, (mod) => {
    const other = mod.modResults.filter((item) => item.type !== 'property' || item.key !== 'reactNativeArchitectures');
    // The package currently ships the ARM64 Android adapter. Cargo and CMake
    // tasks belong to the library Gradle project, not the application project.
    mod.modResults = [...other, { type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' }];
    return mod;
  });
};
