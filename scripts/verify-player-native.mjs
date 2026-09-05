import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  reviewedPlayerCollectedDataTypes,
  reviewedPlayerPrivacyEntryKeys
} from './player-privacy-manifest.mjs';

const playerRequire = createRequire(new URL('../player-app/package.json', import.meta.url));
const plist = playerRequire('@expo/plist').default;

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

function plistStringValue(plistText, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return plistText.match(new RegExp(`<key>${escapedKey}<\\/key>\\s*<string>([^<]+)<\\/string>`))?.[1];
}

function normalizedBuildSetting(value) {
  return value.trim().replace(/^"|"$/g, '');
}

const reviewedPrivacyReasons = Object.freeze({
  NSPrivacyAccessedAPICategoryFileTimestamp: ['0A2A.1', '3B52.1', 'C617.1'],
  NSPrivacyAccessedAPICategoryDiskSpace: ['85F4.1', 'E174.1'],
  NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1'],
  NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1']
});

function appPrivacyReasonMap(plistText) {
  const entries = [...plistText.matchAll(
    /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>([^<]+)<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>([\s\S]*?)<\/array>/g
  )];
  return Object.fromEntries(entries.map((match) => [
    match[1],
    [...match[2].matchAll(/<string>([^<]+)<\/string>/g)].map((reason) => reason[1]).sort()
  ]));
}

function appPrivacyManifest(plistText) {
  const parsed = plist.parse(plistText);
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['NSPrivacyAccessedAPITypes', 'NSPrivacyCollectedDataTypes', 'NSPrivacyTracking', 'NSPrivacyTrackingDomains'],
    'Generated app privacy manifest must contain only the reviewed top-level keys.'
  );
  assert.deepEqual(
    parsed.NSPrivacyTrackingDomains,
    [],
    'Generated app privacy manifest must not declare any tracking domains.'
  );
  assert.ok(Array.isArray(parsed.NSPrivacyCollectedDataTypes), 'Generated app privacy manifest must declare collected data types.');
  for (const entry of parsed.NSPrivacyCollectedDataTypes) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), 'Every collected-data declaration must be a dictionary.');
    assert.deepEqual(
      Object.keys(entry).sort(),
      reviewedPlayerPrivacyEntryKeys,
      'Every collected-data dictionary must contain exactly Apple\'s four reviewed keys.'
    );
  }
  return JSON.parse(JSON.stringify(parsed));
}

export function verifyPlayerNative(iosRoot) {
  assert.ok(fs.existsSync(iosRoot), `Generated iOS directory does not exist: ${iosRoot}`);
  const files = filesUnder(iosRoot);
  const plistFiles = files.filter((filePath) => path.basename(filePath) === 'Info.plist');
  const projectFiles = files.filter((filePath) => filePath.endsWith('project.pbxproj'));
  const entitlementFiles = files.filter((filePath) => filePath.endsWith('.entitlements'));
  const privacyFiles = files.filter((filePath) => path.basename(filePath) === 'PrivacyInfo.xcprivacy');
  assert.ok(plistFiles.length >= 1, 'Generated iOS project must contain an app Info.plist');
  assert.equal(projectFiles.length, 1, 'Generated iOS project must contain one Xcode project file');
  assert.ok(privacyFiles.length >= 1, 'Generated iOS app target must contain PrivacyInfo.xcprivacy');

  const nativeText = files
    .filter((filePath) => /\.(?:entitlements|pbxproj|plist|xcprivacy)$/.test(filePath))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  const cameraPurpose = 'Allow Orbit Player to scan the PDF417 barcode on your government ID. Orbit does not save a photo.';
  const appPlists = plistFiles
    .map((filePath) => ({ filePath, text: fs.readFileSync(filePath, 'utf8') }))
    .filter(({ text }) => text.includes(cameraPurpose));
  assert.equal(appPlists.length, 1, 'Generated iOS project must contain one app Info.plist with the reviewed camera purpose.');
  const appInfoPlist = appPlists[0].text;
  const projectText = fs.readFileSync(projectFiles[0], 'utf8');
  const bundleIdentifiers = [...projectText.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)]
    .map((match) => normalizedBuildSetting(match[1]));
  assert.ok(bundleIdentifiers.length >= 1, 'Generated app target must declare PRODUCT_BUNDLE_IDENTIFIER.');
  assert.deepEqual(
    [...new Set(bundleIdentifiers)],
    ['com.orbit.player'],
    'Every generated app-target build configuration must use bundle identifier com.orbit.player.'
  );
  assert.equal(
    plistStringValue(appInfoPlist, 'CFBundleShortVersionString'),
    '1.0.0',
    'Generated app marketing version must be 1.0.0.'
  );
  assert.equal(
    plistStringValue(appInfoPlist, 'CFBundleVersion'),
    '1',
    'Disposable generated app build number must be 1; EAS production builds use the reviewed remote auto-increment source.'
  );
  const configuredEntitlementPaths = [...projectText.matchAll(/CODE_SIGN_ENTITLEMENTS\s*=\s*"?([^";]+)"?;/g)]
    .map((match) => match[1].trim().replaceAll('\\', '/'));
  const configuredEntitlementFiles = [...new Set(configuredEntitlementPaths)].map((configuredPath) => {
    const normalized = configuredPath.replace(/^\$\(SRCROOT\)\//, '');
    const match = entitlementFiles.find((filePath) => filePath.replaceAll('\\', '/').endsWith(`/${normalized}`));
    assert.ok(match, `Configured app entitlements file is missing: ${configuredPath}`);
    return match;
  });
  for (const entitlementFile of configuredEntitlementFiles) {
    const entitlementText = fs.readFileSync(entitlementFile, 'utf8');
    const entitlementKeys = [...entitlementText.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);
    assert.deepEqual(entitlementKeys, [], `Generated app target has unapproved entitlements in ${path.basename(entitlementFile)}.`);
  }
  assert.match(appInfoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\s*\/>/);
  assert.ok(!appInfoPlist.includes('<key>CFBundleURLTypes</key>'), 'Generated app Info.plist must not expose an unused URL scheme.');
  const usageDescriptionKeys = [...appInfoPlist.matchAll(/<key>(NS[A-Za-z0-9]+UsageDescription)<\/key>/g)]
    .map((match) => match[1]);
  assert.deepEqual(
    [...new Set(usageDescriptionKeys)],
    ['NSCameraUsageDescription'],
    'Generated app Info.plist may contain only the reviewed camera usage-description key.'
  );
  for (const prohibited of [
    'aps-environment',
    'com.apple.developer.associated-domains',
    'com.apple.developer.healthkit',
    'com.apple.developer.homekit',
    'com.apple.developer.in-app-payments',
    'com.apple.developer.nfc.readersession.formats',
    'com.apple.developer.siri',
    'AirGoogleMaps',
    'GoogleMapsPrivacy.bundle'
  ]) {
    assert.ok(!nativeText.includes(prohibited), `Generated iOS project unexpectedly contains ${prohibited}`);
  }

  const appPrivacyPath = path.join(path.dirname(appPlists[0].filePath), 'PrivacyInfo.xcprivacy');
  assert.ok(fs.existsSync(appPrivacyPath), 'Generated app target must own PrivacyInfo.xcprivacy beside its Info.plist.');
  assert.ok(projectText.includes('PrivacyInfo.xcprivacy'), 'Generated app target must include its privacy manifest in the Xcode project.');
  const appPrivacy = fs.readFileSync(appPrivacyPath, 'utf8');
  const parsedAppPrivacy = appPrivacyManifest(appPrivacy);
  assert.deepEqual(
    Object.fromEntries(Object.entries(appPrivacyReasonMap(appPrivacy)).map(([category, reasons]) => [category, reasons])),
    Object.fromEntries(Object.entries(reviewedPrivacyReasons).map(([category, reasons]) => [category, [...reasons].sort()])),
    'Generated app privacy manifest must declare exactly the reviewed required-reason APIs and category-specific reasons.'
  );
  assert.equal(parsedAppPrivacy.NSPrivacyTracking, false, 'Generated app privacy manifest must explicitly disable tracking.');
  assert.deepEqual(
    parsedAppPrivacy.NSPrivacyCollectedDataTypes,
    reviewedPlayerCollectedDataTypes,
    'Generated app privacy manifest must declare exactly the reviewed linked, non-tracking Player data types and purposes.'
  );
  console.log('Generated Orbit Player iOS identity, permissions, URL schemes, and app privacy manifest passed.');
  console.log(configuredEntitlementFiles.length ? 'Generated app target entitlements are present and empty.' : 'Generated app target declares no entitlements file.');
  console.log('CocoaPods/archive privacy aggregation remains a signed-candidate evidence gate.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = process.argv.indexOf('--ios-dir');
  verifyPlayerNative(path.resolve(argument >= 0 ? process.argv[argument + 1] : 'player-app/ios'));
}
