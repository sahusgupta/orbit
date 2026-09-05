# Orbit Player — App Store submission package

Package version: 1.0.0

Bundle identifier: `com.orbit.player`

Operator represented in repository-controlled material: Caminus Labs, LLC

Candidate state: repository package only; no signed build, TestFlight upload, or App Review submission is claimed

This file is the machine-checkable source of truth for the conservative first iOS submission. Items marked `EXTERNAL GATE` require human, provider, signed-build, or App Store Connect evidence and must not be converted to “complete” without that evidence.

## Listing metadata

App name: Orbit Player

Subtitle: Poker venue companion

Primary category recommendation: Lifestyle

Secondary category recommendation: Entertainment

Keywords: `poker,venues,waitlist,membership,tournaments,check-in,games,clubs`

Support URL: https://orbitapp-one.vercel.app/support

Privacy Policy URL: https://orbitapp-one.vercel.app/privacy

Terms of Use URL: https://orbitapp-one.vercel.app/terms

Marketing URL: leave blank unless a separately reviewed public product page is approved

Final description:

> Orbit Player is an operational companion for participating poker venues. Browse factual venue-published games and tournaments, request a place on a venue waitlist, submit a membership request, and express nonbinding interest in a tournament.
>
> Signed-in players can review current venue-reported activity, present a short-lived check-in QR when eligible, manage their profile, and start account deletion in the app. A just-in-time camera flow can read selected PDF417 identity fields after preview and confirmation; Orbit does not save or upload the ID image or raw barcode.
>
> Orbit does not take wagers, deposits, gaming stakes, entry fees, or prize funds. Tournament interest is not registration or a seat reservation. Venue staff independently controls and confirms participation.

The name and subtitle comply with Apple’s current 30-character limits. Reconfirm both in App Store Connect before submission: [App information reference](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/).

## App Review notes

Orbit is a venue discovery and operational companion. It does not accept wagers, stakes, deposits, entry fees, or prize funds. It does not extend gambling credit or settle prizes.

Every tournament action in this build is a nonbinding **Express interest** action. It does not register the player or reserve a seat, create a debt or payment obligation, or establish prize eligibility. Venue staff independently confirms any participation.

No private-game listings, Premium subscription, or venue checkout exist in this build. There is no player-hosted game feed, purchase screen, in-app purchase, or general push-notification feature. Phone delivery is used only for a one-time passcode when the reviewer deliberately chooses phone authentication.

The camera is requested only when the reviewer starts PDF417 scanning. The app previews selected fields before submission and does not retain or upload an image, the raw barcode, or a document number. The app does not request microphone, Photos, Contacts, device location, or tracking permission.

Some review flows require seeded, nonproduction venue data and server configuration. Use only the review account and environment recorded in App Store Connect; credentials do not belong in this repository. See the reviewer flow and external gates below.

Apple’s review criteria remain authoritative: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Reviewer flow

Review-data prerequisite (`EXTERNAL GATE — release operator`): create a nonproduction reviewer account whose immutable authentication UID is linked to sanitized review data. Record credentials only in App Store Connect. The review venue must publish at least one game, one membership option if membership is to be exercised, one open tournament-interest window, and an active reviewer membership for QR exercise. Do not use real player data or fabricate production state.

1. Launch Orbit Player and choose the adult-eligibility response. An under-18 response must stop account creation.
2. Sign in with the App Store Connect review account using email/password. Phone authentication is optional and should be tested only if a review-safe phone OTP path has been provisioned.
3. Open Games and Clubs. Verify venue name, address, game state, seat/waitlist values, membership options, and map pins appear only when the venue actually published those values. A venue pin requires a valid published coordinate. Distance remains unavailable because v1 has no player-origin coordinate.
4. Select a published game and send a waitlist/seat request. Verify the app reports the authoritative response or a visible error; it must not claim an offline retry was saved.
5. Select the seeded membership option and submit a request. The app does not collect payment.
6. Open Tournaments, select the seeded event, and choose **Express interest**. Verify the nonbinding disclosure appears and the player is not shown as registered.
7. Open the active membership and request a check-in QR. Verify its expiration is visible. Redemption requires the separately authenticated venue-scanner flow and the provisioned server signing secret.
8. Start PDF417 scanning, review the permission explanation, scan only an approved review credential or test barcode, inspect the preview, and cancel or confirm. Never enter a real reviewer’s identity document without their informed choice.
9. Open Profile/Settings. Exercise local-data deletion when signed out/local-only, or initiate authenticated account deletion with the review account. Recent authentication may be required to initiate the request. After the server accepts it, cleanup and finalization are server-resumable without user reauthentication; any pending or failed finalization state must be reported honestly rather than as complete.

Unavailable data must render an explicit empty, loading, error, offline, or unavailable state. It must not generate fallback facts.

## App Privacy worksheet

This worksheet describes repository behavior; the App Store Connect Account Holder or Admin must validate the signed candidate and submit the answers. Apple defines “collect” as transmitting data off-device for longer than needed to service the request in real time: [App privacy details](https://developer.apple.com/app-store/app-privacy-details/).

| Apple data category | Data in Orbit | Collected off device | Linked to identity | Tracking | Purpose / condition |
| --- | --- | --- | --- | --- | --- |
| Contact Info — Name | Account name; confirmed PDF417 full name | Yes for signed-in profiles and submitted identity fields | Yes | No | Authentication support, profile, venue-request functionality, fraud/security |
| Contact Info — Email Address | Email stored in a local profile or authenticated account | Only when the user signs in, saves it to a cloud account, or directs an applicable venue request; a local-only value that stays on device is not collected | Yes when transmitted | No | Authentication, account support, security, and venue-request functionality when Firebase verifies the claim |
| Contact Info — Phone Number | Optional phone stored in a local profile or authenticated account; OTP destination when phone auth is selected | When saved to a cloud account or transmitted in an applicable authenticated flow; Twilio receives it when phone auth is selected | Yes when transmitted | No | Account functionality, authentication, and security |
| Contact Info — Physical Address | User-entered home area and confirmed PDF417 address | When the signed-in user saves/submits it | Yes | No | Discovery preference and venue-request identity context |
| Location — Coarse Location | Optional home-area text | When saved by a signed-in user | Yes | No | Profile/discovery preference; this build has no user-origin coordinate and does not request device GPS |
| Identifiers — User ID | Firebase UID, player ID, venue-scoped request and mutation IDs | Yes | Yes | No | Authentication, tenant isolation, idempotency, security |
| User Content — Customer Support | Content the user sends to support | Only when the user contacts support | Usually | No | Support |
| Usage Data — Product Interaction / Other Usage Data | Membership, waitlist, seat/check-in, and tournament-interest activity and timestamps | Yes when authenticated actions are used | Yes | No | App functionality, integrity, security |
| Diagnostics — Crash Data / Performance Data | SDK or service diagnostics, if enabled in the signed candidate | `EXTERNAL GATE — inspect archive and provider settings` | Determine from signed candidate | No | App functionality and diagnostics only if actually present |
| Other Data | Confirmed date of birth, adult/provisional age state, pseudonymous completed deletion-job state, security/audit metadata; a raw Firebase Auth UID may appear transiently in a `finalizing` job while Auth removal needs replay and remains in the document path of a server-only anti-resurrection tombstone after completion; a separate deletion marker is pseudonymous | Yes when the applicable authenticated flow is used | Yes | No | Eligibility, security, deletion integrity, legal compliance |

Local-only profile data that never leaves the device is not marked as collected. The app does not save or upload the ID image, raw PDF417 barcode, or document number. It does not sell data, use data for behavioral advertising, or track people across other companies’ apps or websites.

### Venue-directed payload inventory

| Operation | Exact off-device fields and conditions |
| --- | --- |
| Membership request | Authenticated Firebase UID and display name; Firebase-verified email when the token provides one or Firebase-verified phone for phone authentication; selected venue; opaque request ID; selected published option ID/name, duration, displayed price label, optional venue-published plan classification, in-person payment method, and request/status timestamps; bounded optional home-area text, search-radius preference, preferred games/stakes, favorite venues, and typical availability. |
| Waitlist or seat request | Authenticated identity fields under the same verified-claim rules; selected venue/game and optional table; join/cancel action; arrived/confirmed/interested attendance choice; optional expected-arrival time; optional availability start/end; typical-availability note when present; opaque request ID and request/status timestamps. |
| Tournament interest | Authenticated Firebase UID; selected venue and tournament; express/withdraw action; interested/withdrawn status; created, updated, and conditional withdrawn timestamps; opaque idempotency ID. No registration, seat, payment, or prize record is created. |
| Membership QR | Issue sends authenticated Firebase UID, selected venue, and opaque mutation ID. The short-lived QR token contains no personal information. After authenticated redemption, venue staff receive the linked display name and check-in status; Orbit records the token ID, purpose, issue/expiration times, and redemption state. |
| Confirmed PDF417 fields | Full name, date of birth, address, capture method/time, and provisional or staff-review status enter venue-authoritative state only after the user previews and confirms them. No image, raw barcode, or document number is sent or stored by this path. |

Client-supplied contact claims do not override Firebase identity: a phone-authenticated request discards a client-supplied email, and a venue-authoritative email is present only when the Firebase token provides the verified claim.

Conditional recipients are Google Firebase/Google Cloud; Vercel; Twilio for chosen phone OTP; Stripe Identity only when the separately configured hosted Player Web compatibility flow is deliberately started; Apple Maps or Google Maps when the user opens the Maps tab or Directions; Expo/Apple for build and distribution; the venue selected by the user; and support/email providers. A map provider may receive the displayed region, validated venue-published coordinates, and ordinary network/device request metadata while Maps is open; Directions additionally opens or sends the factual venue address. Orbit does not request device GPS or send a player-origin coordinate. RevenueCat and Stripe payment/checkout client SDKs are absent from the iOS binary. The hosted Stripe Identity flow is separate from the iOS v1 on-device PDF417 preview; Stripe may process an identity document and verification data under its own privacy terms, while Orbit receives bounded verification results and provider-session metadata.

Privacy-manifest audit: [`PRIVACY_MANIFEST_AUDIT.md`](./PRIVACY_MANIFEST_AUDIT.md) records every inspected dependency manifest and required-reason code. The installed `react-native-maps` manifest declares unlinked precise location for app functionality even though Orbit does not request device location. The signed archive’s aggregated privacy report must be inspected before questionnaire submission; unresolved aggregation is a blocking gate, not permission to omit a disclosure. See Apple’s [privacy manifest](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk) and [required-reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api) guidance and Expo’s [privacy manifest guide](https://docs.expo.dev/guides/apple-privacy/).

## Age-rating worksheet

Repository recommendation: make the product available only to adults (18+) because onboarding requires an adult declaration and the app concerns real-world poker venues. App Store Connect computes the displayed rating from the questionnaire; the Account Holder must answer based on the final binary and territory advice using Apple’s current [age-rating workflow](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/).

| Questionnaire topic | Repository evidence | Proposed answer / gate |
| --- | --- | --- |
| Real-money gambling transactions | No wager, stake, deposit, entry-fee, credit, prize-fund, or payout handling | None in app; legal reviewer must confirm classification |
| Simulated gambling | No poker gameplay or simulated betting | None |
| Contests | No contest entry or prize administration | None |
| User-generated content | Player-hosted/private games and social posting are absent | None |
| Messaging/chat | No general player-to-player or game-update messaging | None |
| Advertising | No advertising SDK or ad inventory | None |
| Unrestricted web access | Only reviewed legal/support links and platform actions | None; reconfirm resolved links in signed build |
| Mature themes | Venue-published information concerns poker | `EXTERNAL GATE — legal/App Store owner selects the truthful frequency and resulting rating` |

Do not lower the product’s adult onboarding rule merely because App Store Connect computes a lower rating.

## Territory and legal review

No territory is preapproved in this repository. Before enabling a storefront, legal counsel must determine whether venue discovery, published buy-in/prize information, waitlist/membership requests, tournament interest, QR check-in, and identity handling are lawful there and whether any license, geofencing, disclaimer, or venue contract is required.

Checklist (`EXTERNAL GATE — legal counsel and Account Holder`):

- Record approved storefront countries/regions and the dated legal rationale.
- Verify Caminus Labs, LLC’s seller/account relationship; do not claim a gambling license, payment-processor status, DBA, or governmental permission without evidence.
- Confirm each participating venue’s authority to publish its facts and receive player requests.
- Confirm the privacy policy, deletion treatment, identity-field disclosure, retention disposition, and support contact for each approved territory.
- Confirm tournament-interest wording cannot be treated as entry, registration, wagering, or prize eligibility.
- Record any territory-specific age, identity, accessibility, consumer-protection, or poker/gambling restriction.

## Encryption and export compliance

The Expo configuration declares `ITSAppUsesNonExemptEncryption` as `false`. Repository code uses standard platform/network encryption for HTTPS, Firebase authentication, and secure storage and does not implement proprietary cryptography. The release operator must inspect the generated Info.plist and signed archive, then answer App Store Connect’s export-compliance questions truthfully under Apple’s current [export compliance guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

Gate: `EXTERNAL GATE — Account Holder/export reviewer` must record the final questionnaire answer and any required documentation. This repository does not assert a legal classification.

## Screenshot capture matrix

No mockup is acceptable as submission evidence. Capture the real signed/release candidate with sanitized, review-safe seeded data. Apple currently accepts 6.9-inch iPhone portrait screenshots at 1260×2736, 1290×2796, or 1320×2868 pixels, requires 1–10 screenshots, and does not accept alpha: [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

Primary capture target: 6.9-inch iPhone, portrait, 1320×2868 PNG or JPEG.

Optional localization/size targets: only those App Store Connect requires after the primary set is uploaded.
Current evidence status: `EXTERNAL GATE — no simulator/device captures are claimed`.

| Order | Real app state | Required evidence | Safety check |
| --- | --- | --- | --- |
| 1 | Signed-in Games discovery | Venue-published game cards, factual venue pins, and honest unavailable-distance state | No invented venue, coordinate, mileage, seat, or status; v1 has no player-origin coordinate |
| 2 | Game detail / waitlist request | Operational request and venue attribution | No wager/payment or notification promise |
| 3 | Clubs / membership request | A real seeded option or explicit unavailable state | No invented pass/product or checkout |
| 4 | Tournament detail | **Express interest** and full nonbinding disclosure | No registration/seat/prize guarantee |
| 5 | My Orbit | Venue-reported memberships, requests, and interests | Sanitized names and identifiers |
| 6 | Check-in QR | Short-lived token and visible expiry | Token from isolated review backend; never publish a redeemable production token |
| 7 | PDF417 preview | Selected fields and confirmation step | Approved synthetic/test credential; no raw barcode/image/document number |
| 8 | Profile/Settings deletion | Local and authenticated deletion entry points | No credentials or real personal data |

## Permission inventory

| Protected capability | Requested by reviewed config | Purpose text / status |
| --- | --- | --- |
| Camera | Yes, just in time | “Allow Orbit Player to scan the PDF417 barcode on your government ID. Orbit does not save a photo.” |
| Microphone | No | Expo Camera plugin sets `microphonePermission: false`; Android audio recording is disabled |
| Photos | No | No purpose string or reviewed feature |
| Contacts | No | No purpose string or reviewed feature |
| Device location/GPS | No | Users may enter home-area text. Venue pins use only validated venue-published coordinates; distance remains unavailable because v1 has no player origin. Opening Maps may send the displayed region, venue coordinates, and ordinary request metadata to the platform map provider; Directions additionally opens or sends the factual venue address. Orbit does not request device GPS or send a player-origin coordinate |
| Tracking/ATT | No | `NSPrivacyTracking` is false and there is no tracking purpose string |
| Push notifications | No | No push entitlement or v1 feature |

The generated iOS project must pass `npm run player:prebuild:ios`; the signed archive must independently confirm entitlements and aggregated privacy manifests. Expo Camera defaults can add microphone/audio access unless disabled, so the release pins explicit false settings per the [Expo Camera SDK 54 documentation](https://docs.expo.dev/versions/v54.0.0/sdk/camera/).

## TestFlight acceptance

Repository and CI gates before any cloud build:

- [x] Exact Node 22.16.0/npm 10.9.2 clean installs for root, API, Player, and Player Web.
- [x] TypeScript, root/API/Player/Player Web tests, and relevant rendered regression tests pass.
- [x] Firestore Emulator allow/deny tests pass against `demo-orbit-release-ci`.
- [x] Production config, Expo compatibility/Doctor, iOS export, permission/privacy checks, artwork checks, and JavaScript bundle scan pass.
- [ ] Disposable managed iOS prebuild and generated-native scan pass on Ubuntu pull-request CI; the Windows host cannot produce that evidence.
- [ ] Pull-request CI is green on the exact pushed 40-character source SHA.
- [ ] Legal, privacy, age-rating, territory, Maps/provider, App Check/rules deployment, signing, and review-data gates have evidence.

Signed candidate (`EXTERNAL GATE — release operator/Expo`): use EAS production profile only after the checklist above passes. Record source SHA, EAS build ID and URL, marketing version, build number, bundle identifier, signing team, build status, and archive privacy report. Apple’s current upload requirements are in [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds).

TestFlight device acceptance (`EXTERNAL GATE — release operator/tester`): install that exact build on a physical supported iPhone; exercise onboarding, sign-in, empty/error/offline recovery, discovery, waitlist/membership, tournament interest, QR issue/redeem/expiry/replay rejection, PDF417 denial/recovery/preview, and both deletion modes. Record device/OS, result, defect links, and tester sign-off. TestFlight overview: [Apple TestFlight](https://developer.apple.com/testflight/).

Upload only the reviewed build ID:

```text
npm run submit:testflight --prefix player-app -- --build-id <EAS_BUILD_ID> --source-sha <40_CHAR_PUSHED_SHA> --confirm UPLOAD_EXACT_TESTFLIGHT_BUILD
```

The guard invokes the repository-pinned EAS CLI, queries the selected build, and verifies its exact ID, source SHA, EAS project identity (project ID, owner, and slug), iOS platform, finished status, production profile, Store distribution, physical-device target, bundle identifier, marketing version, and positive build number before invoking `eas submit --id`. It never uses an ambient `eas` executable or `--latest`. Expo documents build-ID submission in [EAS Submit for iOS](https://docs.expo.dev/submit/ios/) and [EAS CLI](https://docs.expo.dev/eas/cli/).

## Rollback plan

TestFlight/App Store rollback is a forward build, never a history rewrite or reuse of an old build number.

1. Stop further tester distribution or App Review submission; record the exact rejected EAS build ID/source SHA.
2. Select the last verified source commit and create a new fix/rollback commit on a reviewed branch. Do not force-push.
3. Rerun every repository and pull-request gate on the new exact SHA.
4. Create a new EAS production build with a higher remote iOS build number; do not resubmit an older binary as though it were new.
5. Record the superseded and replacement build IDs, SHAs, versions/build numbers, reason, verification links, and approver.
6. Upload the replacement only through the explicit build-ID guard above. Remove the defective build from tester groups when the release operator confirms the replacement.

If a production backend incompatibility is discovered, stop distribution. Backend or Firebase deployment is a separately authorized external operation; do not deploy from this package.

## External launch gates

| Gate | Owner | Exact action | Evidence required |
| --- | --- | --- | --- |
| Legal classification/licensing | Qualified counsel | Review poker companion, identity, deletion, venue, and territory behavior | Dated written scope and approved territories/restrictions |
| Apple seller/account state | Account Holder | Confirm seller is authorized to distribute Orbit Player | App Store Connect team/seller confirmation without exposing credentials |
| Agreements/tax/banking | Account Holder | Complete any applicable Apple agreements | App Store Connect status screenshot or recorded approval |
| Expo/Apple project identity | Release operator + Account Holder | Confirm Expo owner `saussy`, slug `tabletalk-player`, EAS project `bb2059b7-91b3-4a6b-a66e-d5618e794fd3`, Apple signing team, and `com.orbit.player` App Store Connect record all belong to the intended Caminus Labs, LLC release account before starting a build | Dated owner/team/app-record confirmation and EAS project page; no credential values |
| Production config/URLs | Release + backend owners | Deploy reviewed API/site/config and verify canonical HTTPS pages | Deployment SHA, health evidence, rendered privacy/support/terms checks |
| Firebase rules/App Check | Backend + native/Web owners | Register native iOS and operational Player Web Firebase Apps with appropriate App Check providers; make every active client send `x-firebase-appcheck` on phone-auth and all protected Player calls (or intentionally disable Player Web operations); validate every exact app ID in the nonproduction allowlist; only then enable fail-closed production enforcement | Project-specific deployment record, per-client nonproduction accept/reject evidence, exact allowlisted App IDs, and App Check enforcement evidence |
| Shared production rate limit | Backend/security owners | Replace or front the process-local limiter with a provisioned shared durable boundary before running multiple API replicas | Selected architecture, configuration/deployment record, multi-instance/retry tests, and operational monitoring evidence |
| Log/audit identifier hashing | Security/backend owners | Provision an independent `ORBIT_LOG_HASH_SECRET` of at least 32 characters in the hosted runtime; do not reuse another service secret | Secret-presence attestation (never the value), fail-closed startup evidence, and a sanitized log/outbox sample containing only protected references |
| QR/deletion secrets and policy | Security/legal/backend owners | Provision an independent `ORBIT_MEMBERSHIP_QR_SECRET` of at least 32 characters, record the bounded 30–300 second `ORBIT_MEMBERSHIP_QR_TTL_MS`, provision the deletion pseudonym secret, and approve the deletion/tombstone retention disposition | Secret-presence attestations (never values), deployed TTL, policy version, isolated issue/expiry/redeem/replay smoke evidence, and deletion-finalizer evidence |
| Maps setup | Mobile owner | Confirm whether the final iOS binary includes a Maps provider/subspec and provision only required public key restrictions | Signed archive dependency/privacy report and provider-console restriction evidence |
| Signed archive privacy | Mobile/privacy owners | Inspect Xcode privacy report and all bundled SDK manifests | Archived report mapped to App Privacy answers; no unresolved SDK declaration |
| Age rating and privacy answers | Account Holder/privacy owner | Submit answers matching the final signed binary | App Store Connect answer export/screenshots and reviewer sign-off |
| Review account/data | Backend/release owners | Seed sanitized nonproduction review data and place credentials in App Store Connect only | Flow checklist, expiry/cleanup owner, successful isolated test |
| Physical-device acceptance | QA owner | Run the TestFlight checklist on the exact build | Device/OS, build ID, source SHA, dated results |
| Screenshots | Product/QA owner | Capture real rendered candidate at accepted dimensions | Original PNG/JPEG files, capture build ID/SHA, sanitization review |
| TestFlight build/upload | Release operator | Build and upload exact green SHA after all prerequisites | EAS build URL/ID, App Store build number, CI URL, upload status |
| App Review submission | Account Holder | Review final metadata and explicitly press Submit for Review | Human approval; this repository task does not authorize submission |

Apple explains the final submission workflow in [Submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app). A passing Expo export or prebuild is not a signed candidate and must never be reported as TestFlight evidence.

## Version-sensitive source index

- Expo public environment variables are compiled into the app and must not contain secrets: [Expo environment variables](https://docs.expo.dev/guides/environment-variables/).
- EAS build-profile environment behavior: [EAS environment variables](https://docs.expo.dev/eas/environment-variables/usage/).
- Local export and dependency compatibility checks: [Expo CLI](https://docs.expo.dev/more/expo-cli/).
- Disposable native generation: [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/).
- Remote app/build version behavior: [App versions](https://docs.expo.dev/build-reference/app-versions/).
- EAS profile schema: [Configure EAS Build with eas.json](https://docs.expo.dev/build/eas-json/).
- Apple account-deletion requirement: [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
