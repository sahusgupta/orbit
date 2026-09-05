# Player App Store Readiness

- Goal: conservative first iOS release with every repository-addressable P0/P1 blocker resolved and verified.
- Starting SHA: `1f8e06fee77c9d04868d33325abd80d15ac65559` (`origin/main`, fetched 2026-09-04).
- Branch: `codex/player-app-store-readiness`.
- Safety boundary: no production data access, backend/Firebase deployment, payment/message side effects, release publication, or secret inspection. Runtime checks use fixtures, emulators, or explicit local/unreachable endpoints.
- Toolchain observed at start: Node `v22.16.0`; npm `10.9.2`.

## Checkpoints

| Checkpoint | State | Evidence / next action |
| --- | --- | --- |
| Current-code audit | Complete | Verified the reported defects against current Player, API, Firestore, desktop scanner, release configuration, legal, store, and CI sources. No production system or secret was inspected. |
| Characterization coverage | Complete | Tests cover Clubs loading/empty/error/offline/stale/removed/malformed states, nonbinding interests, unavailable location facts, opaque QR boundaries, immutable deletion matching and retry, age/PDF417 minimization, configuration, legal copy, and generated-native contracts. |
| Player v1 implementation | Complete | Production Player source excludes private games, Premium/IAP, checkout, social sign-in, fabricated geography, operational registration, and unsupported notification promises. Native/Web account identity, deletion, interest, and published-data boundaries are covered. |
| API and Firestore hardening | Complete in repository | Interest, QR, deletion, immutable identifier, App Check, rate-limit, telemetry, provider cleanup, publication/deletion fencing, transaction-time eligibility, expired-job recovery, and emulator coverage are complete. Deployment and production provisioning remain external. |
| Release package | Complete in repository | Fail-closed production config, managed-iOS plugin/privacy manifest, asset and bundle scanners, legal/support pages, submission worksheet, exact-build TestFlight guard, rollback checklist, and Linux CI gates exist. No signed archive is claimed. |
| Full local verification | Complete | Clean installs, focused suites, `npm run verify`, browser suites, release/security gates, Expo config/check/Doctor/export, artwork, bundle scans, Firestore Emulator tests, and the disposable iOS prebuild/native inspection pass. The native inspection was reproduced in isolated Ubuntu WSL with the pinned CI toolchain because the primary host is Windows. |
| Pull request / CI | Final exact-SHA run pending; external security disposition pending | PR #25 is open. The full GitHub Actions matrix must pass on the final pushed SHA; that moving check result is recorded in the PR and handoff rather than embedded as a stale SHA here. GitGuardian still requires its workspace owner to resolve historical synthetic test-fixture detections in the dashboard without weakening scanning or rewriting history. |
| Signed TestFlight candidate | External gates remain | Attempt only after all repository and PR gates pass and configured Expo/Apple identity, production dependencies, Apple account state, signing authority, and review environment are confirmed. |

## Verification ledger

| When | Command | Result |
| --- | --- | --- |
| Untouched baseline | `npm run verify` | Pass: root/API/Electron TypeScript, Player and Player Web TypeScript, Player Web lint, 118 Player Web tests, 85 sales-map tests, 912 root/API/Player tests, and all three production builds. Existing ExcelJS `eval` and large-chunk warnings remained. |
| Interest implementation | `npx vitest run apps/api/src/tournamentInterestService.test.js apps/api/src/routes/player.test.js apps/api/src/firebasePublisher.test.js` | Pass: 3 files / 27 tests. Interest remains separate from entrants and financial state; legacy Player registration is rejected. |
| QR + interest backend slice | `npx vitest run apps/api/src/membershipQrService.test.js apps/api/src/tournamentInterestService.test.js apps/api/src/routes/player.test.js apps/api/src/server.routes.test.js` | Pass: 4 files / 33 tests. QR issue/redeem is opaque, expiring, tenant-bound, single-use, and committed with check-in through the authoritative revision boundary. |
| Release configuration | `npx vitest run scripts/player-release-config.test.js` | Pass: production origin/flag checks fail closed, redact supplied values, remove unneeded map/audio configuration, and reject any attempt to strip a non-empty collected-data declaration. |
| Player deletion race hardening | `npx vitest run player-app/src/data/orbitSyncApi.boundary.test.ts player-app/src/application/usePlayerIdentity.test.ts`; `npm run player:typecheck` | Pass: 2 files / 74 tests; Player TypeScript passes. A resolved SDK sign-out is accepted only when the raw Firebase UID is actually absent, and same-UID reappearance is durably marked for cleanup. |
| Desktop QR staff-session binding | `npx vitest run src/lib/membershipQr.test.ts src/lib/nightCloseLifecycle.test.tsx`; `npx tsc -p tsconfig.renderer.json --noEmit` | Pass: 2 files / 13 tests; renderer TypeScript passes. Redemption uses the exact authorized token and cannot clear a newer reauthenticated session. |
| Module boundaries | `npm run audit:module-graph` | Pass after moving native random-identifier generation into `player-app/src/security/`; 232 modules, 698 edges, no cycles, boundary violations, or unresolved imports. |
| Production export | `npm run player:export:ios` | Pass: production Expo export and bundle scan; Hermes bundle about 4.74 MB, inspectable JavaScript about 3.42 MB, 19 assets. No signed archive is implied. |
| Final local matrix | `npm run verify` with production access disabled and an unreachable local API | Pass: four TypeScript boundaries; 212 test files across root/API/Player/Player Web/sales map with 1,513 passing and 7 skipped tests; Player Web, sales-map, and desktop production builds. Existing ExcelJS `eval` and large-chunk warnings remain. |
| Rendered browser checks | `npm run e2e:management`; `npm run e2e:public`; `npm run web:e2e` | Pass: isolated management flow; eight public pages on desktop/mobile; 15 Player Web routes across six viewports (90 screenshots) plus 42 interaction checks, with clean route metadata and no reported browser failures. Two consecutive production-build Player Web runs pass after serializing fixture-cookie installation behind old-document teardown, which removes a Firebase-disabled AuthProvider race without weakening production session cleanup. The optional landing-parity harness was not asserted because its external reference app was not supplied. |
| Release/static gates | `npm run check:independent-locks`; `npm run audit:module-graph`; `npm run check:release-controls`; `npm run check:brand`; `npm run check:renderer-bundle`; `npm run check:public-site`; `npm run security:dependencies` | Pass. Renderer initial JavaScript is 618,748 bytes / 189,924-byte gzip within budget. Root/API/Web production advisories are zero; eight Player build-chain advisories are reviewed exceptions with mandatory review by 2026-09-30. |
| Expo/native local gates | `npm run player:config:verify`; `npm run player:expo:check`; `npm run player:expo:doctor`; `npm run player:assets:verify`; `npm run player:export:ios`; isolated Ubuntu `npm run player:prebuild:ios` | Pass: production config/permissions, dependency alignment, Expo Doctor 18/18, artwork, Hermes and inspectable exports, source/bundle exclusions, generated bundle identity/version, camera-only permission, absent URL scheme, empty entitlements, and reviewed app privacy manifest. CocoaPods/archive aggregation remains a signed-candidate gate. |
| Firestore rules | `npm run test:firestore-rules` with Java 21 and `DEBUG` cleared | Pass after source freeze: 7 isolated Emulator tests against `demo-orbit-release-ci`; demo configuration rejects non-emulated service access. |
| Sensitive paths | `npm run security:paths`; tracked-path cross-check | The path-only local check reports 11 ignored user artifacts and therefore exits nonzero by design; zero are tracked. Contents were not inspected. CI passes on its clean checkout; the local owner must migrate/rotate and remove those artifacts outside this task. |

## External gates

- Release/backend owners must deploy the exact reviewed API, public legal site, Firestore rules/indexes, and App Check client/enforcement configuration after PR approval.
- Security/legal owners must provision independent log-hash, QR-signing, and deletion-pseudonym secrets and approve the deletion/tombstone/provider disposition. Values must never enter this repository.
- Infrastructure owners must provision a shared multi-instance rate-limit boundary before horizontally scaled production use.
- The Apple Account Holder must confirm Caminus Labs, LLC seller authority, agreements/tax/banking, App Store record, territories, age/privacy/export answers, and legal classification.
- Release/QA owners must seed sanitized review data, record reviewer credentials only in App Store Connect, capture real screenshots, inspect the signed archive privacy report, and pass physical-device TestFlight acceptance.
- Expo/Apple owners must confirm the repository project ID/owner/slug and signing team before an exact-SHA EAS build. No signed candidate is claimed while the production deployment and Apple gates above remain open.
- The GitGuardian workspace owner must classify the earlier synthetic redaction-fixture detections as test credentials or false positives in the GitGuardian dashboard. Required evidence is a green GitGuardian check on the final PR SHA; repository ignores and history rewriting are explicitly not acceptable substitutes.
- The local-environment owner must inventory and remove the ignored credential artifacts from synced/project directories and rotate any credential exposed to the earlier local Firebase debug trace. No value may be copied into a ticket, log, commit, or handoff.

## Audited release boundaries

- Tournament participation is being split from operational registrations: Player may create or remove a bounded, idempotent interest record, but it cannot alter entrants, buy-ins, ledgers, seats, or prize pools.
- Player-hosted/private games, Player Premium, card-house checkout, and social sign-in are excluded from the production-v1 code path, configuration, permissions, and store material.
- Membership QR moves from a replayable identifier string to an opaque, expiring, venue-scoped, single-use server credential. Local tests use test-only signing material; production secret provisioning and backend deployment cannot be invented here.
- Cloud deletion matches only authenticated immutable identifiers, must be resumable/idempotent, and must explicitly handle historical state. No name/email/phone destructive fallback is allowed.
- Published coordinates are optional factual data. Missing or malformed coordinates produce unavailable map/distance behavior, never synthesized geography.
- App Check and rules changes are code-and-emulator work only in this task; activation/deployment remains an external production gate.
- Managed iOS prebuild inspection runs on Linux/macOS. It passes in isolated Ubuntu WSL and CI, but that unsigned generated-project result must not be described as a signed build.
