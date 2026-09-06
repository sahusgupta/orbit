# Orbit Player

Orbit Player is the Expo/React Native companion for participating poker venues. The conservative first release supports factual venue/game/tournament discovery, operational waitlist and membership requests, nonbinding tournament interest, short-lived membership check-in QR credentials, profile/data deletion, and consented on-device PDF417 field capture.

The first iOS release has no Player Premium subscription, in-app purchase, player-hosted/private-game surface, venue checkout, social sign-in, general push notifications, device-location request, or operational tournament registration. These exclusions are build policy and are verified across all production source and exported JavaScript.

## Local development

Use the repository-pinned Node 22.16.0 and npm 10.9.2 toolchain:

```powershell
npm ci --prefix player-app
Copy-Item player-app/.env.example player-app/.env
npm run player:typecheck
npm run player:dev
```

The example environment uses a loopback API and no production secrets. Every `EXPO_PUBLIC_*` value is compiled into the client and must be treated as public. Production builds use the validated values in `eas.json`; `app.config.js` does not read the API `.env`.

## Release verification

From the repository root:

```powershell
npm run player:release:verify
npm run player:config:verify
npm run player:expo:check
npm run player:expo:doctor
npm run player:export:ios
```

Managed iOS prebuild verification runs on Linux/macOS and in pull-request CI:

```text
npm run player:prebuild:ios
```

Run `npm run player:codegen:ios` on any supported Node host to exercise native schema/module-provider generation before a cloud build. CI also runs it. It catches build dependency API incompatibilities; CocoaPods and Xcode still require a macOS build host.

The command generates native files in a disposable operating-system temporary directory and inspects the bundle identifier, permissions, URL schemes, and app-owned privacy manifest. It does not create a signed archive. See [`PRIVACY_MANIFEST_AUDIT.md`](./PRIVACY_MANIFEST_AUDIT.md) for dependency evidence and [`APP_STORE_SUBMISSION.md`](./APP_STORE_SUBMISSION.md) for the current store package and external gates.

## Data and identity boundaries

Production clients initialize native App Check before Firebase Auth/Firestore and send attestation on protected API calls. The release uses App Attest on iOS with the production entitlement; its real provider requires signing and supported hardware. See [App Check architecture and staged activation](../docs/architecture/PLAYER_APP_CHECK.md) for native/Web settings, registrations, provider prerequisites, and rollback. Development can keep attestation disabled against isolated services; release builds cannot.

- Firebase authentication uses email/password or optional phone OTP. Social authentication is absent.
- A signed-in profile can store an optional phone number even when email/password is used.
- Optional home-area text is not a coordinate. V1 has no player-origin coordinate and never calculates or displays player-to-venue mileage.
- Venue map pins require valid venue-published coordinates. Opening Maps may send the displayed region, those coordinates, and ordinary request metadata to the platform map provider; Directions additionally opens or sends a factual published venue address. Orbit does not request device GPS or send a player-origin coordinate.
- PDF417 capture happens on device. The app previews and submits only confirmed full name, date of birth, and address; it does not store or upload the document image, raw barcode, or document number.
- Hosted Stripe Identity remains a conditional web/compatibility verification path. Stripe payment/checkout and RevenueCat client SDKs are absent from the iOS v1 binary.
- Tournament interest is stored separately from registrations and financial records. It does not change entrants, seats, ledgers, buy-ins, or prize pools.

## Firestore publication

The API is the only privileged state publisher. Desktop, API, and Player preserve sync protocol v2: child documents carry a `syncRevision`, and the parent club record is the commit marker. Player clients keep the last complete revision while another revision is being published.

Player-facing collections include venue-published clubs/games, player-scoped memberships and waitlists, authenticated mutation requests, tournament interests, and player profiles. Ordinary clients cannot publish authoritative venue projections. The executable rules suite runs against the isolated Firestore emulator with:

```text
npm run test:firestore-rules
```

Do not deploy rules, indexes, API code, or public pages without separate authorization.

## Cloud build and TestFlight

The `simulator` EAS profile inherits production code, environment, and the Xcode image, targets the iOS Simulator, and disables build-number auto-increment. It provides native compiler/QA evidence before Apple signing is available. Run the pinned CLI from `player-app`: `node ../node_modules/eas-cli/bin/run build --platform ios --profile simulator --non-interactive`. Record its committed source SHA and build ID. This artifact cannot be uploaded by the TestFlight submission guard, and it cannot prove real App Attest on supported hardware.

EAS accepts the exact Node version in each build profile but does not support an `npm` profile field. The `eas-build-pre-install` lifecycle hook therefore installs npm 10.9.2 and fails closed unless that exact version is active before EAS runs the lockfile-immutable dependency install. The production iOS profile pins Expo's SDK 54 image `macos-sequoia-15.6-xcode-26.0` so App Store uploads are configured for Xcode 26 and the iOS 26 SDK. The repository-locked EAS schema parses every iOS profile, while release checks require the exact reviewed production-image string. Expo's current image catalog and the eventual candidate build—not schema parsing alone—provide availability and toolchain evidence. Custom EAS workflows are rejected because EAS does not run lifecycle hooks automatically for custom builds.

`npm run build:testflight --prefix player-app` starts a remote signed build and is an external action. It is permitted only after the exact pushed SHA is green and credentials/project identity are verified. Upload uses an explicit EAS build ID and source SHA:

```text
npm run submit:testflight --prefix player-app -- --build-id <EAS_BUILD_ID> --source-sha <40_CHAR_PUSHED_SHA> --confirm UPLOAD_EXACT_TESTFLIGHT_BUILD
```

The guard verifies the selected EAS build record before submission and never selects “latest.” It does not submit the app for App Review.
