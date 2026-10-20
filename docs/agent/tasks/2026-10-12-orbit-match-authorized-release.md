# Authorized Orbit Match backend release — 2026-10-12

The user explicitly authorized Firebase `tabletalk-server` and the production API. Managed Firebase project metadata resolves that display name to active project `tabletalk-s`, matching `.firebaserc` and the existing client configuration. Managed Vercel inspection resolves `https://orbitapp-one.vercel.app` to `orbit_app`, project `prj_2EEyDB2YImgK9dil3GK79Qy0UfVw`, team `team_CdmC6YZS1GNIoI0waQ2G01ED`, root directory `apps/api`. No credentials were requested, printed, copied, or pulled into a local environment file.

This permission covers the reviewed backend/rules/index release. It does not authorize synthetic production players/games, customer identity capture, payment/provider operations, venue waitlist mutations, a Git push, or a mobile-store release. Engineering app tests use the separate [isolated Android fixture](./2026-10-12-player-android-native-qa.md).

## Verification before release

Current rules/publication emulator run: **30 tests passed, two files, exit 0** (nine rules, fourteen target guards, seven actual integration cases), `out/orbit-match-publication-runtime-final.log`. This includes authoritative state revisions, canonical protocol-v2 publication, licensed public discovery, actual Expo decoding/ranking/saved resolution, availability/end/revocation changes, and privacy boundaries; local transport/auth fixtures are not real player sign-in.

API/presentation release checks: **130 passed, six files**. Aggregate `npm run verify`: **all 13 gates passed**, `out/orbit-match-verify-release.log`; root 235 files/1,769 tests passed with 16 ordinary emulator skips, Web 20 files/209 tests, sales 7 files/85 tests. Later mobile layout/harness work has its own final aggregate result in the main [implementation record](./2026-10-12-orbit-match.md); these are the checks actually completed before backend release.

## Firebase release

An index metadata comparison found live definitions beyond the repository baseline. The generated release configuration preserves **all 15 live composite indexes and both existing field exemptions**, adding only the five reviewed `orbitMatch` exemptions: `preferences`, `decisions`, `undo`, `events`, `recentMutationIds`. Existing unrelated indexes and baseline TTL configuration were not removed or introduced. The checked-in declarative file remains task-local; a future full deployment must reconcile existing live index drift rather than force deletion.

The generated rules are byte-identical to [the reviewed rules](../../../player-app/firestore.rules), SHA-256 `bd2db7387930dbd68ead7c4de1f2df6a89fe265d66eff144309fce1f1a5c721a`. Owner reads require the exact state path, verified contact and no deletion marker; direct client/receipt writes remain denied. Only `firestore:rules,firestore:indexes` were deployed with explicit `--project tabletalk-s`, no `--force`. Dry run and actual deploy both exited 0. Existing compiler warnings about request/resource names and an unused helper remain visible; compilation succeeded. Post-release metadata comparison passed: 15 composite indexes/both prior exemptions unchanged, all five new Match exemptions present.

Ignored evidence: `out/orbit-match-firebase-release/`, `out/orbit-match-firebase-dry-run.log`, `out/orbit-match-firebase-deploy.log`, before/after index metadata. No production data import, test seed, or player/club record mutation was performed for this validation.

## API release

A 71-file allowlisted runtime snapshot includes API package/lock/config, runtime JavaScript/CommonJS, public assets and the required root `branding.config.json`. It excludes tests, dependencies, dotenv files and privileged credential material. The separate ignored artifact Git repository preserves exact reviewed bytes, disables hooks/signing/global attributes and validates each committed blob against its SHA-256 manifest. Root workspace HEAD/index remain unchanged.

Runtime source digest: `064cc788b64026ff07e6609c1d652bc958941bdd64f9ebd8dbcf27fc3915b2c1`. Released artifact source commit: `610b16cddebfe95cfd2721fff3edc8e7e7fa9f1a`. Root workspace base `9680ee0dccd73405ea38964df6796e19c94e3a69` is historical provenance, not the feature release commit.

The first staged attempt was blocked by Vercel because its QA commit author lacked project permission. CLI 48.4.0 reported `UNKNOWN` and kept polling; isolated CLI 63.1.2 identified the actual blocked state. The artifact was then attributed to the authenticated deployment owner acting under the user's release authorization; source bytes/digest stayed unchanged. This changed no team permission or protection setting. The initial inherited line-ending normalization was also corrected and all 71 blobs verified before either release attempt. Failed/blocked attempts remain recorded separately.

The corrected build used production configuration with `--skip-domain`, finished **READY** in **1m52s**, and generated the Express `index` function, 3.57 MB, region `iad1`. Vercel selected Node **22.23.2**/npm **10.9.8** from the package's Node22 requirement, warning that exact local patch22.16/npm10.9.2 cannot be selected on that platform. No package versions or project runtime setting were changed. Successful startup and licensed discovery confirm `src/app.js` and outside-root branding were packaged.

Managed protected requests verified stage health200, version200/exact source SHA and unauthenticated Match401. Public data passed the actual Expo decoder/candidate/ranker: two clubs, eight games, two eligible recommendations, including one Aggieland recommendation; zero owner memberships/waitlists/notifications/interests exposed. Validation submitted no hosted player-state operation.

The exact origin is a verified production project domain. The tested production build was promoted successfully: `dpl_94znMhuJwpfW22Yo3P1g7QLhtHJA`, [deployment](https://orbit-5ms1najnb-sahoosegs-projects.vercel.app), [production API](https://orbitapp-one.vercel.app/health). After promotion, ordinary unauthenticated HTTP at the exact production origin passed health200, version200/exact artifact SHA, Match401 and current privacy200. The first privacy probe used an incorrect ISO-date expectation; it was corrected to the source's actual `October 12, 2026` format and passed. The actual public catalogue again fully decoded/ranked with the same aggregate counts. Runtime error-log/customer-data scans were not performed; no clean-log claim is made.

Ignored evidence: `out/orbit-match-api-release-evidence.json`, stage/owner-stage/promote logs, `out/orbit-match-production-http-probe.json`, `out/orbit-match-production-catalogue-probe.json`. Source/artifact commits exist only inside ignored output; no root commit/push, PR, tag, desktop release or mobile-store publication occurred.

## Remaining pilot gates

Aggieland is present and eligible, but the public record has **no authored coordinate**. No pin was inferred or written. The offline demo fixture uses actual source/native components with synthetic Firebase settings, an unreachable API and a network-disabled emulator. A separate [connected native fixture](./2026-10-12-player-android-connected-smoke.md) uses real SDKs against strictly local Auth/Firestore/API services. Neither fixture establishes production authentication/App Check, two physical-device account restoration, a real-club publication/request roundtrip or external map handoff. Existing live attestation policy was preserved, not reconfigured or proven by this release.

A controlled pilot still needs available test devices, an existing verified test-player session, confirmed attestation setup, venue-authored location metadata, an observed real venue publication revision and an explicitly authorized current-data/waitlist roundtrip. iOS signed-archive/privacy, screen-reader/ordinary physical-device frame evidence remain separate gates. Backend deployment success does not declare the full Match goal or Aggieland pilot complete.
