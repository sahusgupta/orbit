import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reviewedPlayerCollectedDataTypes } from './player-privacy-manifest.mjs';
import { verifyPlayerNative } from './verify-player-native.mjs';

const temporaryRoots = [];
const privacyReasons = {
  NSPrivacyAccessedAPICategoryFileTimestamp: ['0A2A.1', '3B52.1', 'C617.1'],
  NSPrivacyAccessedAPICategoryDiskSpace: ['85F4.1', 'E174.1'],
  NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1'],
  NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1']
};

function privacyEntries(reasonMap) {
  return Object.entries(reasonMap).map(([category, reasons]) => `<dict>
<key>NSPrivacyAccessedAPIType</key><string>${category}</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array>${reasons.map((reason) => `<string>${reason}</string>`).join('')}</array>
</dict>`).join('');
}

function collectedDataEntries(entries) {
  return entries.map((entry) => `<dict>
<key>NSPrivacyCollectedDataType</key><string>${entry.NSPrivacyCollectedDataType}</string>
<key>NSPrivacyCollectedDataTypeLinked</key><${entry.NSPrivacyCollectedDataTypeLinked ? 'true' : 'false'}/>
<key>NSPrivacyCollectedDataTypeTracking</key><${entry.NSPrivacyCollectedDataTypeTracking ? 'true' : 'false'}/>
<key>NSPrivacyCollectedDataTypePurposes</key><array>${entry.NSPrivacyCollectedDataTypePurposes.map((purpose) => `<string>${purpose}</string>`).join('')}</array>
</dict>`).join('');
}

function nativeFixture({
  appCollectedDataTypes = reviewedPlayerCollectedDataTypes,
  appPrivacyReasons = privacyReasons,
  buildNumber = '1',
  bundleIdentifier = 'com.orbit.player',
  infoAddition = '',
  marketingVersion = '1.0.0',
  projectAddition = '',
  sdkPrivacyReasons = []
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-native-verifier-'));
  temporaryRoots.push(root);
  const appRoot = path.join(root, 'OrbitPlayer');
  fs.mkdirSync(appRoot);
  fs.writeFileSync(path.join(appRoot, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleShortVersionString</key><string>${marketingVersion}</string>
<key>CFBundleVersion</key><string>${buildNumber}</string>
<key>ITSAppUsesNonExemptEncryption</key><false/>
<key>NSCameraUsageDescription</key><string>Allow Orbit Player to scan the PDF417 barcode on your government ID. Orbit does not save a photo.</string>
${infoAddition}
</dict></plist>`);
  fs.writeFileSync(path.join(appRoot, 'project.pbxproj'), `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier};\nPrivacyInfo.xcprivacy\n${projectAddition}`);
  fs.writeFileSync(path.join(appRoot, 'PrivacyInfo.xcprivacy'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>NSPrivacyTracking</key><false/>
<key>NSPrivacyCollectedDataTypes</key><array>${collectedDataEntries(appCollectedDataTypes)}</array>
<key>NSPrivacyAccessedAPITypes</key><array>${privacyEntries(appPrivacyReasons)}</array>
</dict></plist>`);
  if (sdkPrivacyReasons.length) {
    const sdkRoot = path.join(root, 'VendorSdk');
    fs.mkdirSync(sdkRoot);
    fs.writeFileSync(path.join(sdkRoot, 'PrivacyInfo.xcprivacy'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>NSPrivacyTracking</key><false/>
<key>NSPrivacyAccessedAPITypes</key><array>${privacyEntries(sdkPrivacyReasons)}</array>
</dict></plist>`);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('generated Orbit Player native verifier', () => {
  it('accepts the reviewed bundle identity, encryption declaration, camera purpose, and privacy reasons', () => {
    expect(() => verifyPlayerNative(nativeFixture())).not.toThrow();
  });

  it('rejects the wrong app-target bundle identifier even when the expected identifier occurs elsewhere', () => {
    expect(() => verifyPlayerNative(nativeFixture({
      bundleIdentifier: 'com.example.wrong',
      infoAddition: '<key>UnusedExpectedIdentifier</key><string>com.orbit.player</string>'
    }))).toThrow(/bundle identifier com\.orbit\.player/);
  });

  it('rejects the wrong generated marketing version', () => {
    expect(() => verifyPlayerNative(nativeFixture({ marketingVersion: '0.9.0' }))).toThrow(/marketing version/);
  });

  it('rejects the wrong generated build number', () => {
    expect(() => verifyPlayerNative(nativeFixture({ buildNumber: '2' }))).toThrow(/build number/);
  });

  it('does not let an SDK manifest mask a missing app-owned privacy reason', () => {
    expect(() => verifyPlayerNative(nativeFixture({
      appPrivacyReasons: {
        ...privacyReasons,
        NSPrivacyAccessedAPICategoryUserDefaults: []
      },
      sdkPrivacyReasons: privacyReasons
    }))).toThrow(/exactly the reviewed required-reason APIs/);
  });

  it('rejects an empty app-owned collected-data declaration', () => {
    expect(() => verifyPlayerNative(nativeFixture({ appCollectedDataTypes: [] })))
      .toThrow(/exactly the reviewed linked, non-tracking Player data types and purposes/);
  });

  it('rejects incorrect linking, tracking, or purposes in collected-data declarations', () => {
    const linked = reviewedPlayerCollectedDataTypes.map((entry, index) => index === 0
      ? { ...entry, NSPrivacyCollectedDataTypeLinked: false }
      : entry);
    const tracking = reviewedPlayerCollectedDataTypes.map((entry, index) => index === 1
      ? { ...entry, NSPrivacyCollectedDataTypeTracking: true }
      : entry);
    const purposes = reviewedPlayerCollectedDataTypes.map((entry, index) => index === 2
      ? { ...entry, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'] }
      : entry);

    for (const entries of [linked, tracking, purposes]) {
      expect(() => verifyPlayerNative(nativeFixture({ appCollectedDataTypes: entries })))
        .toThrow(/exactly the reviewed linked, non-tracking Player data types and purposes/);
    }
  });

  it('rejects a reviewed reason declared under the wrong required-reason API category', () => {
    expect(() => verifyPlayerNative(nativeFixture({
      appPrivacyReasons: {
        ...privacyReasons,
        NSPrivacyAccessedAPICategoryDiskSpace: ['85F4.1', 'E174.1', 'CA92.1'],
        NSPrivacyAccessedAPICategoryUserDefaults: []
      }
    }))).toThrow(/category-specific reasons/);
  });

  it('rejects an unapproved purpose key', () => {
    expect(() => verifyPlayerNative(nativeFixture({
      infoAddition: '<key>NSContactsUsageDescription</key><string>Access contacts</string>'
    }))).toThrow(/NSContactsUsageDescription/);
  });

  it('rejects photo-library add access as well as read access', () => {
    expect(() => verifyPlayerNative(nativeFixture({
      infoAddition: '<key>NSPhotoLibraryAddUsageDescription</key><string>Save photos</string>'
    }))).toThrow(/NSPhotoLibraryAddUsageDescription/);
  });

  it('rejects an unapproved native capability', () => {
    expect(() => verifyPlayerNative(nativeFixture({
      projectAddition: 'SystemCapabilities = { com.apple.developer.healthkit = { enabled = 1; }; };'
    }))).toThrow(/com\.apple\.developer\.healthkit/);
  });

  it('rejects any key in an app-target entitlements plist', () => {
    const root = nativeFixture({ projectAddition: 'CODE_SIGN_ENTITLEMENTS = OrbitPlayer/OrbitPlayer.entitlements;' });
    fs.writeFileSync(path.join(root, 'OrbitPlayer', 'OrbitPlayer.entitlements'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>com.apple.developer.icloud-services</key><array><string>CloudDocuments</string></array></dict></plist>`);
    expect(() => verifyPlayerNative(root)).toThrow(/unapproved entitlements/);
  });

  it('rejects a missing false encryption declaration', () => {
    const root = nativeFixture();
    const plist = path.join(root, 'OrbitPlayer', 'Info.plist');
    fs.writeFileSync(plist, fs.readFileSync(plist, 'utf8').replace(
      '<key>ITSAppUsesNonExemptEncryption</key><false/>',
      '<key>ITSAppUsesNonExemptEncryption</key><true/>'
    ));
    expect(() => verifyPlayerNative(root)).toThrow(/ITSAppUsesNonExemptEncryption/);
  });

  it('rejects an unused app URL scheme', () => {
    expect(() => verifyPlayerNative(nativeFixture({
      infoAddition: '<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>com.orbit.player</string></array></dict></array>'
    }))).toThrow(/unused URL scheme/);
  });
});
