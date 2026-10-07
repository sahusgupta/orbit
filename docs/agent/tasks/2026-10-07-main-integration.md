# Main integration — 2026-10-07

The user requested merging all current work into an up-to-date main.

## Integrated source

- Fetched `origin/main` at `1336cea` (`agent/expo sdk 57 (#29)`).
- Included recovery commits `b414450` and `fab9dbd` from the existing recovery branch.
- Preserved the user's public-key edit in `750acc6` (`chore: preserve updated pilot license public key`). The pilot-key script had no normalized content difference; no private key was accessed or generated.
- Committed the reviewed mutation fix, tests, diagnostics, and CI gates as `fb7c824` (`fix: propagate durable table mutation results`). Its investigation is recorded in [the mutation task](2026-10-07-table-mutation-persistence.md).
- Merged fetched main without conflicts into `integration/main-2026-10-07` at `157c71797ea92af4fcc1c77b3c5e83e7aab33a7b`. Both histories are preserved. Local main will advance by fast-forward after verification.

This task changes Git history and adds this record; it adds no runtime source changes or new behavioral tests. Existing regression and integration tests verify the combined tree. No force push, history rewrite, production access, deployment, dependency remediation, or release occurred.

## Verification

- `npm ci --prefix player-app`: passed using the fetched SDK 57 lockfile. No tracked lockfile changed. npm reported 25 audit findings (24 high, one critical); no audit fix was run.
- Focused mutation, synchronization-race, UI, and Electron composition tests: 11 files / 105 tests passed.
- `npm run e2e:management:mutations`: passed from a fresh production renderer build, real preload/IPC/Electron transport, and synthetic authenticated local memory-test API. Seating, visual time addition/deduction, saved records, 409 reconciliation, API failures, and no IPC/API on oversized preflight were verified.
- `npm run check:release-controls`: passed.
- `npm run check:independent-locks`: passed.
- `npm run verify`: completed with exit code 1; 9 of 13 checks passed.
  - Passed: root TypeScript (renderer, tests, Electron, and API projects), Player Web TypeScript/lint/focused tests/build, internal sales map TypeScript/tests/build, and desktop renderer build.
  - Failed: player TypeScript, player release contract, player artwork verification, and unit tests. The first three come from fetched main as detailed below.
  - Unit tests: 243 files passed, three failed, one skipped; 1,830 tests passed, three failed, eight skipped. The same three failures occurred before integrating main: the expired membership-window fixture in `apps/api/src/orbitCore.membership.test.js`, its generated duplicate under ignored `out/release-20260906/api-diagnostic-retry-8mYr6Q/`, and a stale authentication-error assertion in that generated tree's `apps/api/src/server.routes.test.js`. No test was skipped or excluded to obtain a pass.

All runtime validation used local/test endpoints with Firebase sync disabled. Generated output, dependency directories, caches, credentials, and logs are not committed.

## Incoming main failures

The player tree and release-verification scripts match fetched `origin/main` exactly (`git diff --exit-code origin/main HEAD -- player-app scripts/verify-player-release.mjs scripts/verify-player-assets.mjs` passed).

Full verification reports incoming SDK 57 incompatibilities:

- Player strict TypeScript: 16 diagnostics for missing Node module types, an inferred callback type, and removed `StyleSheet.absoluteFillObject` references under the fetched React Native types.
- Player release contract: checks still require SDK 54 versions and the removed top-level splash configuration.
- Player artwork check: reading the removed `expo.splash.image` throws.

These failures are preserved and reported. The merge does not weaken checks, change dependency versions beyond fetched main, or alter player application behavior to hide them.

## Git handoff

The verified source merge is `157c71797ea92af4fcc1c77b3c5e83e7aab33a7b`, with parents `fb7c824` (all local fixes) and `1336cea` (fetched main). This record is the only subsequent change. Local main is to advance to the integration tip by fast-forward, preserving both histories. The final main commit and clean-worktree status are reported in the handoff.

No push was performed during integration. Repository instructions require explicit authorization to push; local main and remote main publication are reported separately.
