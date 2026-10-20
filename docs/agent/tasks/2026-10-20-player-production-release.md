# Player/API and GitHub production release

The user explicitly authorized production changes, API publication, GitHub synchronization and a triggered/published release after the [completed iPhone build](2026-10-20-player-iphone-build.md). Scope is the existing native Player/Match/UI work and its API/desktop compatibility changes. No unrelated redesign, dependency upgrade, provider setup, account/payment mutation or Firebase index migration is planned.

## Selected targets and source

- Dedicated branch: `release/player-ui-api-20261020`, based on GitHub main `f5e6006b05cd9b7bd3cffa6ad189d7ebddacba4c` (same file tree as the previous local base).
- GitHub repository: `sahusgupta/orbit`. Latest published stable is `v0.1.79`; `v0.1.80` was confirmed unused. The normal workflow overrides the packaging version, so no source package-version bump is needed.
- API: `orbit_app`, project `prj_2EEyDB2YImgK9dil3GK79Qy0UfVw`, team `team_CdmC6YZS1GNIoI0waQ2G01ED`, root directory `apps/api`, production origin `https://orbitapp-one.vercel.app`. Existing managed CLI project inspection confirmed these values. The connector could not resolve this project, so the existing authenticated CLI is used.
- API Git auto-deployment remains disabled. An exact-source production candidate will retain withheld aliases until health, version, privacy, routing and public-data checks pass.
- The completed physical iPhone EAS job remains `959ce769-d6d7-4155-87d8-6f4fca253b58`, version `1.0.0` build `1`, source snapshot `8f7aa626b777d0699bec3c4db68d1cb9a9da5df6`. Its provenance is preserved.

Compared with the previously deployed 71-file API runtime, only privacy, terms and player discovery changed; the free-event registration route and service are new. Existing Match services, publication and cleanup behavior already match the prior deployed artifact. Registration adds an existing entrant shape and retains authentication/App Check, verified identity, age, active-account, club/license, current-revision, free-payment-terms, open-window and idempotency checks. Paid events remain interest only. Already-live Match rules/index exemptions remain untouched; the complete repository index file contains unrelated baseline proposals and must not be deployed blindly.

## Necessary release-gate correction

`npm run audit:module-graph` initially found one data-to-application type import. The exact six-method `MatchPersistencePort` declaration moved to the existing domain types module; its controller re-export remains compatible. Only three native source files changed, with no runtime statement, persisted shape or dependency change. The existing 55 controller/repository tests passed before and after; native strict TypeScript and module-graph checks passed. TypeScript emission of the actual completed EAS snapshot versus current versions of all three files is identical. This is compiler erasure evidence, not a newly built Expo artifact; the phone build is not relabeled as a later commit.

## Verification and operational boundaries

The initial dependency advisory gate passed: root/API/Web reported no production advisories; the Player graph retains its 18 previously reviewed exceptions, due for review on October 22. Independent lockfile and release-control checks passed; module graph reports zero violations, cycles, unresolved imports or unpackaged runtime files. The fresh full `npm run verify` after the type-only correction passed all 13 checks, recorded in `out/player-ui-api-release-20261020-verify.log`.

## CI-required SDK and compiler alignment

Source commit `156410b05e330b955feac27785c50aeb3f598246` was pushed and PR [33](https://github.com/sahusgupta/orbit/pull/33) opened through the connected GitHub app after the CLI token denied PR creation. Initial CI run `39404532918` passed the independent-lockfile check and Windows desktop mutations, but online Expo compatibility required six newer SDK 57 patches. Only Expo, Asset, Constants, Crypto, Location and Splash were updated to the exact compatible patches. The release verifier's corresponding pins and two reviewed dependency versions were updated after the [current dependency review](../reviews/2026-10-20-player-sdk57-dependencies.md); no advisory/name allowlist or deadline was expanded.

During lock regeneration from the repository root, npm injected an unwanted `table_manager: file:..` dependency. That temporary graph was not committed or published. Its verified parent junction and exact metadata were removed; regeneration and clean installation from the Player directory preserve all unrelated direct selections and the root lock. The final independent dependency check passes. Online Expo compatibility, all 21 Expo Doctor checks, native TypeScript, 56 focused release/runtime tests, and a fresh production iOS export with all JavaScript/asset scanners pass. The new dependency graph requires a fresh phone build; the earlier EAS job retains its original provenance.

Initial simulator run `39404532881` failed in the native Expo JSI build with Xcode 26.0.1/Swift 6.2 rejecting immutable weak references. [Swift SE-0481](https://raw.githubusercontent.com/swiftlang/swift-evolution/main/proposals/0481-weak-let.md) identifies Swift 6.3 support. The [GitHub macOS 26 image inventory](https://raw.githubusercontent.com/actions/runner-images/main/images/macos/macos-26-Readme.md) provides Xcode 26.6, matching the already successful physical EAS compiler. The simulator workflow is aligned to that runner/compiler; checks, timeouts and network isolation remain intact. A new aggregate and CI run will validate the final SDK/toolchain source before publication.

The local sensitive-path gate identified existing ignored private-key/debug-log paths. Their contents were not read, copied or changed. They are excluded from the Git candidates and will not enter the clean release checkout; the gate must pass against that clean checkout and in CI. The candidate-path review found only source, tests, documentation and public configuration, with no generated artifacts or credential-like literals.

Existing request middleware may resume durable account-deletion/Identity cleanup and write quota counters, including on health/public requests. This was already deployed behavior and falls within the user's explicit current production authorization. Probes will not create a player/event or submit an authenticated registration/payment/provider flow. Public catalogue bodies and personal values will be processed in memory; evidence will contain counts/statuses only.

Production environment metadata has no external operational alert webhook configured. The user has explicitly requested production publication; this task will use existing Vercel/GitHub observations and preserve that monitoring gap rather than invent an alert recipient or add an integration. External alert delivery, real device App Attest/account acceptance and a positive real-player/event registration are not claimed by these release checks. Existing deployment metadata confirms the actual Lambda runtime is `nodejs22.x`; the project-level Node 24 hint is not the compiled function runtime, so no runtime setting change is needed.

## Execution status

Source commit/CI integration, API candidate/promotion, desktop candidate/promotion, published artifact verification and final Git synchronization are pending. The established desktop process uses two serialized manual dispatches of the same exact source/version/channel: candidate first, then promotion with the required `PROMOTE` confirmation after reviewing the candidate. No workflow gate will be removed or bypassed.
