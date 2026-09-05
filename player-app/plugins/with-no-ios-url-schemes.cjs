const fs = require('node:fs');
const path = require('node:path');
const { IOSConfig, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');

const collectedDataKey = 'NSPrivacyCollectedDataTypes';

function withoutExpoDefaultEmptyCollectedDataDeclaration(contents) {
  const keyTag = `<key>${collectedDataKey}</key>`;
  const keyCount = contents.split(keyTag).length - 1;
  if (keyCount === 0) return contents;
  if (keyCount !== 1) {
    throw new Error(`Generated iOS privacy manifest must contain at most one ${collectedDataKey} key.`);
  }

  const emptyDeclaration = new RegExp(
    `[ \\t]*<key>${collectedDataKey}<\\/key>\\s*(?:<array\\s*\\/\\s*>|<array>\\s*<\\/array>)[ \\t]*(?:\\r?\\n)?`
  );
  if (!emptyDeclaration.test(contents)) {
    throw new Error(`Refusing to remove a non-empty or malformed ${collectedDataKey} declaration.`);
  }
  return contents.replace(emptyDeclaration, '');
}

module.exports = function withNoIosUrlSchemes(config) {
  const withoutUrlSchemes = withInfoPlist(config, (configuration) => {
    delete configuration.modResults.CFBundleURLTypes;
    return configuration;
  });

  return withXcodeProject(withoutUrlSchemes, (configuration) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(configuration.modRequest.projectRoot);
    const privacyPath = path.join(
      configuration.modRequest.platformProjectRoot,
      projectName,
      'PrivacyInfo.xcprivacy'
    );
    if (!fs.existsSync(privacyPath)) {
      throw new Error('Generated iOS app privacy manifest is missing.');
    }
    const contents = fs.readFileSync(privacyPath, 'utf8');
    const reviewedContents = withoutExpoDefaultEmptyCollectedDataDeclaration(contents);
    if (reviewedContents !== contents) fs.writeFileSync(privacyPath, reviewedContents);
    return configuration;
  });
};

module.exports.withoutExpoDefaultEmptyCollectedDataDeclaration = withoutExpoDefaultEmptyCollectedDataDeclaration;
