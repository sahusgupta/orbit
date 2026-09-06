# Orbit Player iOS launch readiness

The current, machine-checkable submission package is [`APP_STORE_SUBMISSION.md`](./APP_STORE_SUBMISSION.md). Superseded Premium/IAP/private-game drafts were removed because those products are not in the conservative first release.

September 6 execution status: PR #25 was externally merged at `5b5b18ec92ed94feb125eb8afd0a0140fdfb4ff8`; [PR #26](https://github.com/sahusgupta/orbit/pull/26) carries attestation, native compiler, hosted-runtime, and subsequent release fixes. [The execution record](../docs/agent/tasks/player-release-execution.md) is authoritative for dated evidence. EAS and GitHub unsigned simulator apps compiled successfully. The GitHub interaction job was cancelled after hanging during CoreSimulator runtime discovery; no device-flow result or screenshot was produced. Corrected diagnostics and later source fixes remain local pending push approval. No signed build, TestFlight upload, API/rules promotion, or App Review submission is claimed.

Latest code candidate: `e4fcd7a36bba5fbdc76431d011421aa859e97aa5`. Its isolated full verification passes all 13 checks (1,353 root/API/Player tests, 209 Web, 85 sales-map), with browser QA and iOS JavaScript export passing. [The release evidence index](./submission/2026-09-06/README.md) names each access/approval owner, required action, location, and blocked milestone. Neither older native archive represents this candidate.

## Repository gates

- [x] Exact Node 22.16.0/npm 10.9.2 clean installs succeed for every package root.
- [x] `npm run verify` passes with production access disabled and an unreachable local API.
- [x] Player Web typecheck, lint, unit/component tests, rendered browser checks, and production build pass.
- [x] Firestore Emulator rule tests pass against the isolated `demo-orbit-release-ci` project.
- [x] Production Expo config validation, compatibility check, Expo Doctor, iOS export, permission/privacy checks, artwork checks, and JavaScript bundle scan pass.
- [x] Disposable iOS prebuild and generated-native scan pass in an isolated Linux environment.
- [ ] The same disposable iOS prebuild and generated-native scan pass on the exact pushed SHA in Ubuntu pull-request CI.
- [x] Icon and splash checks pass; the 1024×1024 app icon is opaque and the transparent splash mark renders on `#060C1A`.
- [x] Repository and exported source contain no private-game UI/data access, Premium/IAP client, venue checkout, social authentication, operational tournament registration, fabricated location, or notification promise.
- [x] Privacy/support/terms pages and the App Store package agree with the final code.
- [ ] Pull-request CI is green on the exact pushed SHA.

## Service and candidate work in progress

- [x] Verify the existing Expo project and dedicated iOS/Android/Web Firebase registrations.
- [x] Provision independent production log-hash, membership-QR, and deletion-pseudonym secrets through managed storage.
- [x] Register native App Attest and Web reCAPTCHA Enterprise providers, preserving existing clients and disabled enforcement.
- [x] Provision a separate referrer/API-restricted Player Web Firebase key and the required production Web configuration; verify accepted/rejected referrer behavior.
- [x] Compile and inspect EAS simulator build `cc64f693-fdf4-416c-8fdc-c2fcc3b9cd99`, source `dab4aa7183b6c4482310feb9b1c4f9df3bfcda41`.
- [ ] Complete exact-source native simulator interactions and capture evidence on both iPhone sizes.
- [ ] Merge final green follow-up source and deploy immutable API/Web candidates with recorded rollback targets.
- [ ] Deploy reviewed Firestore rules/indexes/TTL and verify candidate compatibility before promotion.
- [ ] Finish credential rotation after the pending metadata-access approval identifies dependent usage.
- [ ] Complete production synthetic-flow verification after deployment and approved deletion-policy configuration.
- [ ] After Apple access is provided, build the exact green source with the production EAS profile, inspect signing/entitlements and the aggregated archive privacy report, upload that build to TestFlight, and resolve technical processing errors.

These are engineering tasks. They are not human-only gates merely because they involve a provider.

## Human-controlled gates

- Legal classification, licensing, and territory approval.
- Caminus Labs, LLC seller/account verification and Apple agreements.
- Explicit confirmation that Expo owner `saussy`, slug `tabletalk-player`, EAS project `bb2059b7-91b3-4a6b-a66e-d5618e794fd3`, the Apple signing team, and the `com.orbit.player` App Store record are the intended Caminus Labs, LLC release identities.
- Respond to the pending automatic-approval questions for pushing the release fixes to existing PR #26, three production CORS preflights, Firebase key-restriction metadata, and metadata-only identification of the Vercel Firebase credential. Each rejected operation remains unexecuted.
- Supply counsel-approved deletion/retention dispositions and venue/territory authority. Production `ORBIT_ACCOUNT_DELETION_POLICY_JSON` is absent; the example is not approval.
- Authenticate the intended Apple team and provide signing/App Store Connect access through EAS or Apple's interface; the existing EAS account reports no iOS credentials or App Store Connect API keys.
- Grant the release operator access to place the sanitized reviewer account in App Store Connect without committing credentials.
- Privacy-owner classification of the constant `in-person` membership request channel, support/provider/IP retention, and conditional SDK device/diagnostic data.
- Account Holder approval of the final App Store privacy/age/export answers and physical-device TestFlight acceptance when a compatible iPhone is available. Signed building, archive inspection, privacy-report reconciliation, and upload remain engineering work after access is supplied.
- Approve the actual final screenshots and store copy after technical capture/review.

Do not treat Expo export, prebuild, or the compiled simulator app as a signed build. The active release request authorizes technical build/deployment work; App Review remains prohibited while ownership, legal, privacy, integrity, or critical QA gates are open.

## Future private-game gate

Player-hosted/private games remain excluded from every production-v1 surface and data path. Re-enabling any private-game publishing, browsing, API, Firestore, configuration, or store claim is blocked until one reviewed design implements and tests all of the following together: authentication, an explicit field allowlist, automatic expiry, host close/delete controls, moderation, objectionable-content filtering, reporting, user blocking, an owned abuse-response process, audience controls, and published support contact information. A partial implementation does not satisfy this gate.

## Exact candidate handling

The production EAS profile creates a store-distribution iOS build, pins `macos-sequoia-15.6-xcode-26.0`, and uses remote build-number auto-increment. After all repository and pull-request gates pass, the release operator records the exact pushed source SHA, EAS build ID, resolved build image, Xcode version/build, and iOS SDK version from the candidate build log. Stop if that evidence does not meet Apple's then-current upload minimum. Submission must use:

```text
npm run submit:testflight --prefix player-app -- --build-id <EAS_BUILD_ID> --source-sha <40_CHAR_PUSHED_SHA> --confirm UPLOAD_EXACT_TESTFLIGHT_BUILD
```

The command queries the requested EAS build, verifies its source commit/platform/status, and submits that ID only. No command in repository verification deploys or submits anything.
