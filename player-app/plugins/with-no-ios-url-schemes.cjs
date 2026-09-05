const { withInfoPlist } = require('@expo/config-plugins');

module.exports = function withNoIosUrlSchemes(config) {
  return withInfoPlist(config, (configuration) => {
    delete configuration.modResults.CFBundleURLTypes;
    return configuration;
  });
};
