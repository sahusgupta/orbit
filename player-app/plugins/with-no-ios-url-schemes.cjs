const { withInfoPlist } = require('@expo/config-plugins');

module.exports = function withNoIosUrlSchemes(config) {
  return withInfoPlist(config, (configuration) => {
    delete configuration.modResults.CFBundleURLTypes;
    delete configuration.modResults.NSLocationAlwaysAndWhenInUseUsageDescription;
    delete configuration.modResults.NSLocationAlwaysUsageDescription;
    delete configuration.modResults.NSMotionUsageDescription;
    if (Array.isArray(configuration.modResults.UIBackgroundModes)) {
      configuration.modResults.UIBackgroundModes = configuration.modResults.UIBackgroundModes.filter((mode) => mode !== 'location');
      if (!configuration.modResults.UIBackgroundModes.length) delete configuration.modResults.UIBackgroundModes;
    }
    return configuration;
  });
};
