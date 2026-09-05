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

`app.json` declares the required-reason APIs found above that can be aggregated into the reviewed non-Google iOS target:

| App-owned category | App-owned reasons | Evidence source |
| --- | --- | --- |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `0A2A.1`, `3B52.1`, `C617.1` | Expo FileSystem, AsyncStorage, React Native, cxxreact, boost, glog, RCT-Folly, base react-native-maps manifest |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `85F4.1`, `E174.1` | Expo FileSystem |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | React Native boost |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | Expo Constants and React Native core |

The app-owned manifest declares `NSPrivacyTracking` as false and makes the following conservative `NSPrivacyCollectedDataTypes` disclosure. Every entry is linked to the user and not used for tracking. The release and generated-native verifiers require the exact data types, linking/tracking flags, and purposes below; an absent, empty, extra, or changed declaration fails the repository gate.

| App-owned collected data type | Purposes | Repository behavior |
| --- | --- | --- |
| `NSPrivacyCollectedDataTypeName` | App functionality | Authenticated profile and user-confirmed identity name |
| `NSPrivacyCollectedDataTypeEmailAddress` | App functionality | Firebase-verified email account/contact path |
| `NSPrivacyCollectedDataTypePhoneNumber` | App functionality | Optional account phone and phone-authentication path |
| `NSPrivacyCollectedDataTypePhysicalAddress` | App functionality | User-confirmed PDF417 address; no image, raw barcode, or document number leaves the device |
| `NSPrivacyCollectedDataTypeCoarseLocation` | App functionality; product personalization | Optional saved home-area text and discovery preference; no GPS or player-origin coordinate |
| `NSPrivacyCollectedDataTypeOtherUserContent` | App functionality; product personalization | Saved game/stakes/favorite/availability preferences and user-entered availability text |
| `NSPrivacyCollectedDataTypeUserID` | App functionality | Firebase/player/request identifiers used for identity, isolation, and idempotency |
| `NSPrivacyCollectedDataTypePurchaseHistory` | App functionality | Selected membership option/price/duration and later status/history; Apple includes purchase tendencies in this category |
| `NSPrivacyCollectedDataTypeProductInteraction` | App functionality; product personalization | Membership, waitlist, check-in, tournament-interest, and favorite/preference activity and timestamps |
| `NSPrivacyCollectedDataTypeOtherDataTypes` | App functionality | Date of birth/adult state plus deletion, security, and audit state not covered by a narrower category |

The native membership request sends the constant channel `in-person`, never a card, bank account, payment credential, or user-selected payment instrument. The app-owned baseline therefore does not declare `NSPrivacyCollectedDataTypePaymentInfo`; because Apple lists “form of payment” as an example, the privacy owner must explicitly confirm that this constant is only a request channel or add the linked, non-tracking App Functionality declaration before submission. Native support opens the hosted support page and has no support-content form or API, so Customer Support is not duplicated in the app-owned manifest; App Store Connect answers must still account for actual support-provider intake and retention.

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
- [Apple: Adding data collection details to your privacy manifest](https://developer.apple.com/documentation/technotes/tn3184-adding-data-collection-details-to-your-privacy-manifest)
- [Apple: Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests)
- [Apple: Describing use of required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- [Expo: Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
