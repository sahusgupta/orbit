# Orbit Player

Orbit Player is the Expo/React Native companion for participating poker venues. The first release supports factual venue/game/tournament discovery, operational waitlist and membership requests, free-event registration, nonbinding interest for paid events, short-lived membership check-in QR credentials, profile/data deletion, and consented on-device PDF417 field capture.

The first iOS release has no Player Premium subscription, in-app purchase, player-hosted/private-game surface, venue checkout, payment-method management, paid-event registration, social sign-in, general push notifications, or background location. These exclusions are build policy and are verified across production source, native configuration, and exported JavaScript. Search location supports an explicit foreground device fix or a manual point; neither point is sent to Orbit.

## Local development

Use the repository-pinned Node 22.16.0 and npm 10.9.2 toolchain:

```powershell
npm ci --prefix player-app
Copy-Item player-app/.env.example player-app/.env
npm run player:typecheck
npm run player:dev
```

The example environment uses a loopback API and no production secrets. Every `EXPO_PUBLIC_*` value is compiled into the client and must be treated as public. Production builds use the validated values in `eas.json`; `app.config.js` does not read the API `.env`.

On Windows, `metro.config.js` normalizes apparent symlinks from directory listings with `lstat` before Expo indexes files. This handles OneDrive cloud reparse points that otherwise cause `EINVAL: invalid argument, readlink`, followed by `Cannot read properties of undefined (reading 'exists')` on asset requests. Real symlinks remain unchanged. After updating this configuration, stop the existing Expo server and restart from `player-app` with `npx expo start --clear` to rebuild its cached file index.

## App navigation

First launch offers **Create account**, **Try sample account**, and **Sign in**. Real account setup uses Firebase Authentication with email verification and the existing private Firebase profile; passwords are never stored in profile documents. Profile fields center within the available screen height, with actions at the bottom. Short pages stretch to fill the viewport and remain scrollable on smaller screens.

**Games** opens a feed with current game, venue, city, and seat information. **Find games** opens Orbit Match; labeled, accessible icons in the bottom corner keep Events, Map, Clubs, and Profile one tap away. Match uses expanded stacked game cards and round Pass/Save/Details actions. The first card shows the game, venue, location and published availability; **Game info** opens tables, queue, fees and recommendation reasons when wanted.

Cash-game details start with a compact overview. **Rules**, **Structure** and the seat-request control open one section at a time. Opening a request section sends nothing; continue explicitly to the existing confirmation/access flow. Tournament cards likewise keep **Structure**, **Rules** and **Request** closed initially. **Register for free** joins the venue's entrant list only when its published entry, rebuy, and add-on terms require no payment and registration is open. Registration changes remain staff-managed. Paid events retain the explicit nonbinding interest action. Neither flow collects payment or creates a debt.

**Map** searches published venue addresses and locations, filters results, and frames matching venue coordinates. Location matches take precedence over similarly named venues elsewhere. Clearing search restores the venue extent; no new geocoding service or device-location request is involved.

**Clubs** shows a stacked membership wallet. Tap a card to isolate it, then tap it again to open the club pass with its published plan, expiry and check-in controls. **Back to wallet** restores the card stack. **Extend membership** opens the venue's published membership options and sends the existing access request; staff confirms extension and expiry. Current active access is preserved while that request is reviewed.

Orbit Match has **Discover**, **Saved**, and **Preferences** modes, with Back, Search and Filters in one header. Swipe or use Pass/Save, open details, and Undo the latest decision. Saving never joins a waitlist or registers for a tournament; existing requests require separate confirmation. Signed-in Match saves and preferences synchronize through the existing API and an owner-only listener, with a secure journal for pending changes. Device-only Match data stays separate and is not moved into an account on sign-in; its explanation is available in **Preferences**. Preference setup is optional during onboarding and remains available from Profile. See [Match persistence and privacy](../docs/architecture/ORBIT_MATCH_PERSISTENCE.md).

Profile starts with an account summary. **Sign in**, **Edit profile**, and **Preferences** expand when needed; identity, help, legal links, and account actions remain available. Match preferences and sample settings are in Profile. Navigation and the shared action controls use at least 44-point touch targets, and scrolling forms retain button taps while the keyboard is open. Onboarding avoids the iOS keyboard. The app follows the system light/dark appearance and respects reduced motion in Match.

## Sample account

Choose **Try sample account** during onboarding, from Profile, or from a loading/error screen. The sample account opens without an API URL or sign-in as Alex Example and always starts with eight fictional games at Wonderland Card House in Austin, Moonbeam Poker Club in Chicago, Cloud Nine Card House in Denver, and Stardust Sandbox Casino in Las Vegas, plus four upcoming events, two sample memberships, and a sample My Games request.

All sample data stays in memory. Open **Profile** for **Reset sample games**, which restores the catalog and clears saved/passed discoveries, or **Exit sample**, which restores the normal saved-profile flow. Dates also refresh each day and when returning from a suspended app. Venue requests, registrations, directions, identity verification, and check-in credentials are unavailable in the preview. The map may still load tiles from its normal map provider.

The sample account is an explicit preview; it never substitutes fictional venues into a connected account. Real published data still requires `EXPO_PUBLIC_ORBIT_API_URL`. No backend sample account, production data seed, or deployment is required.

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

The current iPhone bundle is `com.caminuslabs.orbit`, aligned with its separately registered public Firebase iOS configuration in `tabletalk-s`. Android remains `com.orbit.player`. Earlier `com.orbit.player` iOS source/build records are historical and remain preserved. The new registration alone does not configure App Attest, authorize its App ID in the protected API, create Apple provisioning, or establish an installable iPhone build; those candidate gates remain explicit.

- Firebase authentication uses email/password or optional phone OTP. Social authentication is absent.
- A signed-in profile can store an optional phone number even when email/password is used.
- Optional home-area text is not a coordinate. Distance requires both a chosen, valid search origin and a valid venue-published coordinate; otherwise it remains unavailable. Device location is requested only by **Use my device location**, expires after 15 minutes, and stays in secure storage for the current local owner. Manual points stay until cleared or local account data is deleted. Sample points stay in memory and never request device location. See [local search location](../docs/architecture/PLAYER_LOCAL_LOCATION.md).
- Connected venue map pins require valid venue-published coordinates; the explicit sample account uses clearly labeled fictional locations. Opening Maps or the manual map picker may send the displayed region, published venue coordinates, selected manual markers, and ordinary request metadata to the platform map provider. The picker starts at the published venue extent or a neutral world view and never centers on the device origin. Directions opens or sends a factual published venue address in connected sessions. Search origins are not sent to Orbit APIs, profiles, Match operations, or analytics.
- PDF417 capture happens on device. The app previews and submits only confirmed full name, date of birth, and address; it does not store or upload the document image, raw barcode, or document number.
- Hosted Stripe Identity remains a conditional web/compatibility verification path. Stripe payment/checkout and RevenueCat client SDKs are absent from the iOS v1 binary.
- Tournament interest remains separate from registrations and financial records. Free-event registration uses the existing venue entrant shape with zero buy-in, rebuys and add-ons. Private discovery returns only the signed-in player's registration; public discovery never returns entrant identities. No payment, debt, or ledger entry is created.

## Firestore publication

The API is the only privileged state publisher. Desktop, API, and Player preserve sync protocol v2: child documents carry a `syncRevision`, and the parent club record is the commit marker. Player clients keep the last complete revision while another revision is being published.

Player-facing collections include venue-published clubs/games, player-scoped memberships and waitlists, authenticated mutation requests, tournament interests, and player profiles. Ordinary clients cannot publish authoritative venue projections. The executable rules suite runs against the isolated Firestore emulator with:

```text
npm run test:firestore-rules
```

Do not deploy rules, indexes, API code, or public pages without separate authorization.

## Cloud build and TestFlight

The `simulator` EAS profile inherits production code, environment, and the Xcode image, targets the iOS Simulator, and disables build-number auto-increment. It provides native compiler/QA evidence before Apple signing is available. Run the pinned CLI from `player-app`: `node ../node_modules/eas-cli/bin/run build --platform ios --profile simulator --non-interactive`. Record its committed source SHA and build ID. This artifact cannot be uploaded by the TestFlight submission guard, and it cannot prove real App Attest on supported hardware.

EAS accepts the exact Node version in each build profile but does not support an `npm` profile field. The `eas-build-pre-install` lifecycle hook therefore installs npm 10.9.2 and fails closed unless that exact version is active before EAS runs the lockfile-immutable dependency install. The production iOS profile pins Expo's stable `macos-tahoe-26.6-xcode-27.0` image with Xcode 27.0 (`27A266a`); inherited simulator and physical test profiles use the same pin. SDK 58 requires Xcode 26.4 or newer and includes the UIKit scene lifecycle required by iOS 27. See [SDK 58 requirements](https://docs.expo.dev/versions/v58.0.0/), [SDK 58 release notes](https://expo.dev/changelog/sdk-58), and [build server images](https://docs.expo.dev/build-reference/infrastructure/). The repository-locked EAS schema parses every iOS profile, while release checks require the exact reviewed image. Actual candidate logs/archive must confirm the resolved toolchain and applicable Apple upload requirements; schema parsing alone proves no compiler or signing success. Custom EAS workflows are rejected because EAS does not run lifecycle hooks automatically for custom builds.

`npm run build:testflight --prefix player-app` starts a remote signed build and is an external action. It is permitted only after the exact pushed SHA is green and credentials/project identity are verified. Upload uses an explicit EAS build ID and source SHA:

```text
npm run submit:testflight --prefix player-app -- --build-id <EAS_BUILD_ID> --source-sha <40_CHAR_PUSHED_SHA> --confirm UPLOAD_EXACT_TESTFLIGHT_BUILD
```

The guard verifies the selected EAS build record before submission and never selects “latest.” It does not submit the app for App Review.
