# Orbit Player iOS launch readiness

The current, machine-checkable submission package is [`APP_STORE_SUBMISSION.md`](./APP_STORE_SUBMISSION.md). Superseded Premium/IAP/private-game drafts were removed because those products are not in the conservative first release.

## Repository gates

- [x] Exact Node 22.16.0/npm 10.9.2 clean installs succeed for every package root.
- [x] `npm run verify` passes with production access disabled and an unreachable local API.
- [x] Player Web typecheck, lint, unit/component tests, rendered browser checks, and production build pass.
- [x] Firestore Emulator rule tests pass against the isolated `demo-orbit-release-ci` project.
- [x] Production Expo config validation, compatibility check, Expo Doctor, iOS export, permission/privacy checks, artwork checks, and JavaScript bundle scan pass.
- [ ] Disposable iOS prebuild and generated-native scan pass on Ubuntu pull-request CI; the Windows host cannot generate an iOS project.
- [x] Icon and splash checks pass; the 1024×1024 app icon is opaque and the transparent splash mark renders on `#060C1A`.
- [x] Repository and exported source contain no private-game UI/data access, Premium/IAP client, venue checkout, social authentication, operational tournament registration, fabricated location, or notification promise.
- [x] Privacy/support/terms pages and the App Store package agree with the final code.
- [ ] Pull-request CI is green on the exact pushed SHA.

## External gates

- Legal classification, licensing, and territory approval.
- Caminus Labs, LLC seller/account verification and Apple agreements.
- Explicit confirmation that Expo owner `saussy`, slug `tabletalk-player`, EAS project `bb2059b7-91b3-4a6b-a66e-d5618e794fd3`, the Apple signing team, and the `com.orbit.player` App Store record are the intended Caminus Labs, LLC release identities.
- Production API/site deployment, Firebase rules/App Check activation, and required server-secret provisioning.
- Sanitized reviewer account/data placed in App Store Connect without committing credentials.
- Privacy-owner classification of the constant `in-person` membership request channel, support/provider/IP retention, and conditional SDK device/diagnostic data.
- Signed EAS archive, Xcode privacy aggregation report reconciled to the app-owned ten-type baseline, App Store privacy/age/export answers, and physical-device TestFlight acceptance.
- Real candidate screenshots captured at Apple-accepted dimensions.

Do not treat Expo export or prebuild as a signed build. Do not create an EAS build, upload to TestFlight, deploy, or press Submit for Review until the applicable authority and evidence exist.

## Exact candidate handling

The production EAS profile creates a store-distribution iOS build and uses remote build-number auto-increment. After all repository and pull-request gates pass, the release operator records the exact pushed source SHA and EAS build ID. Submission must use:

```text
npm run submit:testflight --prefix player-app -- --build-id <EAS_BUILD_ID> --source-sha <40_CHAR_PUSHED_SHA> --confirm UPLOAD_EXACT_TESTFLIGHT_BUILD
```

The command queries the requested EAS build, verifies its source commit/platform/status, and submits that ID only. No command in repository verification deploys or submits anything.
