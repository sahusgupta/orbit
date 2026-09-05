# Orbit Player iOS privacy-manifest audit

This is repository evidence for the installed managed Expo dependency tree. It is not a substitute for the exact signed archive’s Xcode privacy report.

## Inspected manifest inventory

The paths and declarations below were read from the locked `player-app/node_modules` installation. Every listed non-map manifest declares an empty collected-data array.

| Exact installed source | Required-reason declarations | Collected-data declaration |
| --- | --- | --- |
| `node_modules/@react-native-async-storage/async-storage/ios/PrivacyInfo.xcprivacy` | File timestamp `C617.1` | Empty |
| `node_modules/expo-constants/ios/PrivacyInfo.xcprivacy` | User defaults `CA92.1` | Empty |
| `node_modules/expo/node_modules/expo-file-system/ios/PrivacyInfo.xcprivacy` | File timestamp `0A2A.1`, `3B52.1`; disk space `E174.1`, `85F4.1` | Empty |
| `node_modules/react-native/React/Resources/PrivacyInfo.xcprivacy` | File timestamp `C617.1`; user defaults `CA92.1` | Empty |
| `node_modules/react-native/ReactCommon/cxxreact/PrivacyInfo.xcprivacy` | File timestamp `C617.1` | Empty |
| `node_modules/react-native/third-party-podspecs/boost/PrivacyInfo.xcprivacy` | File timestamp `C617.1`; system boot time `35F9.1` | Empty |
| `node_modules/react-native/third-party-podspecs/glog/PrivacyInfo.xcprivacy` | File timestamp `C617.1` | Empty |
| `node_modules/react-native/third-party-podspecs/RCT-Folly/PrivacyInfo.xcprivacy` | File timestamp `C617.1` | Empty |
| `node_modules/react-native-maps/ios/PrivacyInfo.xcprivacy` | File timestamp `C617.1` | Precise location, unlinked, not tracking, app functionality |
| `node_modules/react-native-maps/ios/AirGoogleMaps/Resources/GoogleMapsPrivacy.bundle/PrivacyInfo.xcprivacy` | Disk space `85F4.1`; file timestamp `C617.1`; system boot time `35F9.1`; user defaults `1C8F.1` | Crash, device ID, performance, product interaction, and user ID declarations; analytics/app-functionality purposes; user ID linked; none marked tracking |

The locked `expo-crypto` `15.0.9` package was also inspected after it became the native source of security-sensitive UUIDs. It ships no `PrivacyInfo.xcprivacy`; its iOS implementation uses the operating system's `SecRandomCopyBytes` and adds no app-owned required-reason declaration. The signed-archive gate below still controls the final aggregated result.

## App-owned declaration mapping

`app.json` declares only the reasons found above that can be aggregated into the reviewed non-Google iOS target:

| App-owned category | App-owned reasons | Evidence source |
| --- | --- | --- |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `0A2A.1`, `3B52.1`, `C617.1` | Expo FileSystem, AsyncStorage, React Native, cxxreact, boost, glog, RCT-Folly, base react-native-maps manifest |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `85F4.1`, `E174.1` | Expo FileSystem |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | React Native boost |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | Expo Constants and React Native core |

The app-owned manifest declares `NSPrivacyTracking` as false. It intentionally does not declare `NSPrivacyCollectedDataTypes`; the app does collect linked account, identity, coarse home-area text, and operational activity off device when authenticated flows are used. Those answers live in [`APP_STORE_SUBMISSION.md`](./APP_STORE_SUBMISSION.md) and must be reconciled with the signed candidate. An empty collected-data array would misleadingly imply that Orbit collects nothing.

## Map SDK finding and blocking archive gate

Orbit Player does not request device location and has no player-origin coordinate in v1. It therefore does not calculate player-to-venue mileage. Venue pins render only for valid venue-published coordinates. When the user opens Maps, the platform map provider may receive the displayed region, those venue-published coordinates, and ordinary network/device request metadata; Directions additionally opens or sends a factual published venue address.

Despite that app behavior, the installed base `react-native-maps` manifest declares unlinked precise location for app functionality. The separately installed `AirGoogleMaps` bundle makes the additional analytics and required-reason declarations shown above. Production config removes the iOS Google Maps key, and disposable generated-native verification fails if `AirGoogleMaps` or `GoogleMapsPrivacy.bundle` appears. A prebuild source scan still does not prove what CocoaPods and Xcode aggregate into a signed archive.

Before TestFlight, generate the Xcode privacy report from the exact signed archive and record:

- Every bundled `PrivacyInfo.xcprivacy` path and its owning target/subspec.
- Whether the base `react-native-maps` and `AirGoogleMaps` manifests were aggregated.
- Any App Store Connect privacy warning.
- Final App Privacy answers reconciling SDK declarations with Orbit’s actual no-device-location behavior.

This is a blocking external candidate gate until signed-archive evidence exists. Do not assume that removing a key omitted a subspec, and do not suppress an SDK declaration because Orbit itself does not request GPS.

## Primary sources

- [Apple: Adding a privacy manifest to your app or third-party SDK](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk)
- [Apple: Describing use of required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- [Expo: Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
