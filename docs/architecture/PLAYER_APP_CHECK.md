# Player App Check and activation

The native app, Player Web, and Express API have separate attestation responsibilities. App Check supplements Firebase user authentication, per-account/club authorization, deletion blocks, and shared quotas; it never replaces them.

## Client implementation

- Native production builds require `EXPO_PUBLIC_APP_CHECK_ENABLED=true`. React Native Firebase App/App Check are pinned to 26.4.0 (native Firebase 12.18.0 and JavaScript Firebase 12.17.1). Expo 54's `expo-build-properties` 1.0.10 configures static CocoaPods linkage; New Architecture is explicit. The only app-owned entitlement is production App Attest. No debug provider or debug token is configured.
- `player-app/src/data/firebase/playerAppCheck.native.ts` initializes App Attest on iOS and Play Integrity on Android. A Firebase JavaScript `CustomProvider` bridges the native token and its real JWT expiry into the existing Auth/Firestore SDK before those services initialize. The JavaScript and native app IDs match. Parsing expiry controls caching only; Firebase and the API verify signatures.
- Protected native API operations, including both phone-auth calls and deletion, send `X-Firebase-AppCheck`. Attestation failures stop the operation with a generic message and a ten-second bound. The transport rechecks the user after asynchronous token acquisition.
- Player Web uses `NEXT_PUBLIC_APP_CHECK_ENABLED=true` and public `NEXT_PUBLIC_APP_CHECK_SITE_KEY` with reCAPTCHA Enterprise. Its Auth and Firestore instances initialize after App Check. API calls carry the token; the protected-route proxy forwards the browser's separate attestation cookie. The SDK refresh listener refreshes that cookie, and sign-out removes both route-guard cookies. The API still validates both supplied tokens.
- Disabled development clients do not request attestation. They must use isolated test services. A production native build cannot disable App Check. App Attest needs a signed, supported physical device; do not add a debug token to make a simulator impersonate a production client.

## Registered clients and current state

Verified project: `tabletalk-s`, number `133175572500`.

| Client | Firebase App ID | Provider |
| --- | --- | --- |
| iOS, `com.orbit.player` | `1:133175572500:ios:46a75e002225158dfd8f01` | App Attest |
| Android, `com.orbit.player` | `1:133175572500:android:522b4cfc8de1a770fd8f01` | Play Integrity |
| Dedicated Player Web | `1:133175572500:web:5e1055ff74e92d29fd8f01` | reCAPTCHA Enterprise |
| Existing management/shared Web registration | `1:133175572500:web:77d0d79a654f4becfd8f01` | Existing clients must be inventoried separately |

The three dedicated Player registrations were added on 2026-09-06. Native service configuration files are public Firebase client configuration, not Admin credentials. Player Web defaults to its dedicated App ID. The initial provider inventory reports an App Attest token TTL of one hour; this setting alone does not prove device attestation works. DeviceCheck and reCAPTCHA are unconfigured. Initial Firebase service enforcement is Off for every listed service. No enforcement was activated during registration.

The pinned Firebase CLI exposes read-only inventory with `FIREBASE_CLI_EXPERIMENTS=appcheckadmin` and `appcheck:providers:list --app <app-id> --project tabletalk-s --non-interactive` / `appcheck:services:list --project tabletalk-s --non-interactive`. The environment flag enables the local CLI surface only. Never list or print debug tokens as release evidence.

## Ordered activation gates

1. Confirm the intended Apple team and signing identity; finish Firebase Apple-team metadata/provider setup and verify genuine App Attest on the signed candidate. Finish Play Integrity signing/Play Console linkage for any active Android client. Configure the dedicated Web app's Enterprise provider and restrict its site key to verified Player Web domains.
2. Deploy the reviewed clients. Exercise valid, absent, expired, malformed, and wrong-app attestation against an isolated API; retain only result codes and App IDs. Verify account-switch, refresh, sign-out, QR, and deletion flows.
3. Set the API's `ORBIT_PLAYER_APP_CHECK_APP_IDS` to exactly the verified active Player App IDs and enable `ORBIT_REQUIRE_PLAYER_APP_CHECK=true` only on the candidate deployment. Smoke every protected client before promotion. Keep production untouched if any supported client fails.
4. Firebase Auth/Firestore enforcement is a separate project-wide decision. The management renderer also reads Firestore using the existing shared registration; enabling global enforcement before that active client has support would break it. Inventory and migrate every affected active client before enabling those Firebase service switches. API-only enforcement must not be reported as Firebase enforcement.

Rollback before activation: revert client code/configuration and remove only the newly created unused registrations. After activation, first restore the previously verified enforcement state and deployment if a critical client fails; never relax user authentication, authorization, QR validation, or rules. Record all actual provider/deployment changes in the release manifest.

## Privacy and verification

Apple/Google process device/app attestation material and short-lived App Check tokens for abuse prevention. The API does not store them in application records or logs. SDKs cache tokens on device. Web route-guard cookies are Secure on HTTPS, SameSite=Lax, expire after at most one hour, and are cleared at sign-out; their tokens are verified server-side and are not independent authorization. Firebase documents provider-specific retention and token handling in its [privacy information](https://firebase.google.com/support/privacy). No Analytics, Crashlytics, or advertising SDK was added.

Repository tests cover expiry parsing, missing/error/hanging providers, HTTP headers, account switching, cookie deletion and proxy forwarding, production flags, native identity, entitlement restrictions, and provider initialization order. Expo config/export checks are source evidence. They do not replace native compilation, real provider accept/reject evidence, or the signed archive's aggregated privacy report.

Primary integration references: [React Native Firebase App Check](https://rnfirebase.io/app-check/usage), [React Native Firebase Expo configuration](https://rnfirebase.io/), and [Firebase custom providers](https://firebase.google.com/docs/app-check/web/custom-provider).
