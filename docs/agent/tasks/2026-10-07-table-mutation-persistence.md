# Table mutation persistence regression — 2026-10-07

## Findings and scope

Inspected branch: `fix/aggieland-account-data-recovery`; base HEAD: `fab9dbd8fe21039f662712ecae2d13ddba5ef0d6`. Existing changes to `branding.config.json` and `scripts/generate-pilot-key.cjs` were preserved. No commit, push, release, deployment, production access, or dependency change was performed.

The shared failure is confirmed in [main.tsx](../../../src/main.tsx), `persist()`: after adding usage telemetry, a proposed serialized state above 2,000,000 UTF-8 bytes returns before changing `stateRef`, React state, undo history, the recovery cache, or calling desktop persistence. Consequently seating/time balances and their operational records do not reach preload, IPC, or `POST /state`. The original handlers ignored this rejection and closed the picker or returned `true`. A characterization test passed against the original implementation before changes: an approximately 1,999,900-byte state plus a valid time action produced no desktop save and no balance change despite a successful handler result.

This proves a code failure matching the reported symptoms; it does **not** establish the payload size or installed version of the affected production venue. All data inspected during runtime testing was synthetic.

The September fixes in `45a78af31b2e1bd4205ce02c3d7da9b538688b63`, merge `5cdb81fb75f5d69f063aaa16853fc1be1d919013`, and [the prior review](../reviews/2026-09-10-table-action-time-lag.md) remain present. The supplied v0.1.77 source `b414450ef9a0ed9732e84926a7d056f397349028` is an ancestor of this checkout. Those tests addressed stale state, polling races, revisions, rounding, and domain rejection; they did not test renderer handlers awaiting an oversize or failed persistence Promise through real Electron IPC and authenticated API CAS.

An additional real Electron failure was reproduced in deduction: the native `window.prompt` path prevented the correction from reaching persistence. PokerTable now collects a required correction reason inline and passes it through the existing adapters; the legacy optional-reason handler signature remains compatible.

## Behavior and preserved boundaries

- Profile, typed-name, waitlist, and Quick Add seating construct transitions from `stateRef.current`; existing records are refreshed by ID.
- Table actions await the existing `persist`/`saveManagementState` path. Optimistic rendering remains immediate after accepted preflight, with an explicit saving state. Success is reported only after authoritative acceptance.
- The shared result and UI distinguish invalid transition, preflight rejection, busy/pending UI, authoritative success, revision conflict, and API/save failure. Authoritative success retains the separate publication outcome (published, pending, failed).
- Rejected seating retains the picker/waitlist and displays the error. Rejected time changes retain the form and drafts. Errors include the actual payload bytes and ceiling.
- Failed saves reload authoritative state and replace the rejected optimistic state and recovery cache together. Account, save-sequence, and state-reference guards reject overtaken reloads. Table/financial commands are **not automatically replayed** after conflict.
- Per-account save queues, stable mutation IDs, revision maps, API authentication/account isolation, server-managed fields, compare-and-swap transactions, and publication ownership are unchanged.
- September polling guards remain unchanged: pending-account saves suppress polling; overlapping reads are excluded; changed local references and non-authoritative cache responses are rejected; revision and balance/receipt coherence protections remain covered.
- Add time retains positive `timeFeeLogs` and `tableEvents`. Deduction retains a negative receipt and `correctionLog`; the existing correction command does not add a second time-added event. Seating retains `playerSessions`, seat count, seated interest, and check-in ledger entry.

## Byte budget and safe retention

The following is one **synthetic** Electron/API smoke measurement immediately before a rejected action, totaling 1,999,900 bytes. Contributions include each JSON property name/value, exclude the outer braces, and require 23 separators plus 2 braces to reproduce the total. Synthetic profile notes were deliberately padded to hit the boundary; this is not a diagnosis of any production collection.

| Top-level property | UTF-8 bytes |
| --- | ---: |
| profiles | 1,993,556 |
| interests | 323 |
| sessions | 273 |
| playerSessions | 356 |
| buyIns | 11 |
| timeFeeLogs | 996 |
| dropLogs | 13 |
| playerLedger | 249 |
| tableEvents | 795 |
| correctionLog | 253 |
| usageEvents | 16 |
| inAppNotifications | 23 |
| history | 12 |
| games | 135 |
| physicalTables | 119 |
| tournaments | 1,725 |
| dealerAssignments | 22 |
| handCountLogs | 18 |
| revenueTransactions | 24 |
| staffRequests | 18 |
| nightCloses | 16 |
| feedback | 13 |
| scriptTemplates | 20 |
| settings | 889 |

A separate regression constructs 5,000 usage events with 500-byte metadata each, exceeding the limit despite the existing count cap. Byte-aware compaction keeps the newest telemetry prefix that fits and preserves the current action. It does not mutate its input or delete operational records. If retained non-telemetry state plus the current event cannot fit, it rejects visibly.

| State class | Treatment |
| --- | --- |
| Authoritative operational/accounting: profiles, interests, sessions, playerSessions, buyIns, fees, drops, revenue, ledger, dealer/hand records | Preserve; no pruning |
| Audit/reconciliation: correctionLog, tableEvents, history, nightCloses, membership/payment/manual-edit evidence | Preserve; no pruning |
| Derived/reconstructable: seat counts, analytics, dashboards, display projections | Preserve existing persisted shape; no schema change |
| Disposable telemetry: usageEvents | Existing best-effort/newest-first/count-capped contract extended with byte-aware oldest-event retention |
| Naturally expiring candidates: notifications, staff requests, closed interests, auth expiry | No new deletion policy; expiry alone does not authorize destroying retained records |

Operational-history growth needs a separately reviewed archival/per-record persistence design, including retention, backup/export, authorization, migration, and publication/revision compatibility. Raising the ceiling or silently truncating accounting/audit history is not implemented. The workflow directs staff to export a backup and arrange safe archival.

## Runtime test and release gate

Run `npm run e2e:management:mutations` from the repository root. It builds the production renderer transforms with `envDir: false`, enables only the existing guarded localhost fixture mode, launches the real Electron main/preload, and uses the real Express routes/database CAS against memory-test storage on 127.0.0.1:4185. It inherits only OS/runtime environment fields, supplies scoped synthetic authentication, disables Electron/renderer Firebase sync and the embedded backend, blocks external renderer requests, and uses a unique temporary Electron user-data directory. No dotenv file or service credential is loaded. Owned temporary user data is removed; a synthetic failure screenshot may remain in the OS temp directory. Fixed local ports 4185/5173 must be free.

The Windows CI job exercises the shipped desktop platform with its OS-backed cache encryption; it does not weaken production sandbox/encryption settings to accommodate a headless Linux runtime.

The test verifies visual seating, +30/+60/custom time balances, deduction balance, authenticated persistence requests, positive/negative receipts, table events/corrections, real 409 handling without replay, authoritative reload, injected 401/403/503 rejection, and oversize preflight with no IPC or API request. Existing transport tests also cover timeouts and stale revision responses.

The existing browser management smoke and launcher were reviewed. This checkout already runs that smoke in CI/release, although the historical instructions describe an older configuration. Its permissive stub API does not exercise real preload, authentication, CAS, or server record persistence. The new Electron smoke is required in a dedicated Windows CI job and the Windows release workflow, and enforced by release-control verification. It remains separate from `npm run verify` because it starts isolated runtime services.

## Changed files

Renderer/persistence: [main.tsx](../../../src/main.tsx), [managementStatePayload.ts](../../../src/app/persistence/managementStatePayload.ts), [mutationResult.ts](../../../src/application/management/mutationResult.ts), [PokerTable.tsx](../../../src/components/PokerTable.tsx), [TableView.tsx](../../../src/components/TableView.tsx), [FloorView.tsx](../../../src/components/FloorView.tsx).

Electron: [main.cjs](../../../electron/main.cjs), [orbitApiClient.cjs](../../../electron/orbitApiClient.cjs).

Regression tests: [managementStatePayload.test.ts](../../../src/app/persistence/managementStatePayload.test.ts), [mutationResult.test.ts](../../../src/application/management/mutationResult.test.ts), [PokerTable.test.tsx](../../../src/components/PokerTable.test.tsx), [managementPersistenceDesktop.test.tsx](../../../src/lib/managementPersistenceDesktop.test.tsx), [electronOrbitApiClient.test.ts](../../../src/lib/electronOrbitApiClient.test.ts).

Integration fixtures/gate: [launcher](../../../scripts/run-management-mutation-smoke.mjs), [smoke](../../../tests/e2e/management-mutation-smoke.mjs), [state fixture](../../../tests/e2e/fixtures/management-mutation-state.mjs), [API fixture](../../../tests/e2e/fixtures/management-mutation-api.mjs), [Vite config](../../../tests/e2e/fixtures/management-mutation-vite.config.mjs), [package.json](../../../package.json), [CI](../../../.github/workflows/ci.yml), [release](../../../.github/workflows/release.yml), [release controls](../../../scripts/verify-release-controls.mjs), and this record.

## Diagnostics and installed-build check

Existing redacted Electron `orbit-api.log` / telemetry records now identify handler entry, domain acceptance, preflight acceptance/rejection, local pending, persistence invocation, IPC save, API request/result, and reconciliation. Metadata includes byte counts, collection contribution counts on rejection, revision, result, account hash, shortened mutation hash, request ID, and elapsed reconciliation time. No auth key, pilot code, player identity, full state, or correction text is added to diagnostic fields.

Electron logs `desktop-build` with installed app version and source SHA, and trusted `getUpdateStatus` returns additive `appVersion`/`sourceSha` fields. The approved release workflow stamps `orbitSourceSha` from its pinned source input. Unstamped development builds report `development`; package version here remains 0.1.15 until the release workflow applies its approved version.

Remaining production follow-up, requiring separately authorized access: obtain the affected installed app version/source SHA, safe byte-contribution diagnostics, and revision/auth/API-result categories. Do not assume a reported installation matches this branch or the supplied v0.1.77 source. Publication success against real Firebase and installer packaging/deployment were not exercised.

## Verification record

- Before changes: five characterization/preserved-behavior files, 71 tests passed.
- Final affected regression command: `npx --no-install vitest run src/lib/managementPersistenceDesktop.test.tsx src/components/PokerTable.test.tsx src/app/persistence/managementStatePayload.test.ts src/lib/electronOrbitApiClient.test.ts src/application/management/mutationResult.test.ts src/application/management/sync/useManagementPlayerUpdateSync.test.ts src/application/management/sync/useManagementPlayerUpdateSync.race.test.tsx src/components/TableView.test.tsx src/lib/quickAddInterest.test.tsx src/components/FloorCollectionCallbacks.test.tsx src/lib/electronComposition.test.ts` — 11 files, 105 tests passed.
- `npm run typecheck`: all four strict projects passed (renderer, root tests, Electron, API), including the final-source rerun.
- `npm run e2e:management:mutations`: final fresh production-build run passed seating, visual +30/+60/custom addition and deduction balances, saved operational records, real 409/no replay/reload, injected 401/403/503, installed-build metadata, and preflight/no IPC/no API. The proposed action measured 2,000,683 bytes against the 2,000,000-byte ceiling.
- `npm run e2e:management`: the existing browser production-bundle smoke passed.
- `npm run check:release-controls`: passed after finalizing the dedicated Windows CI gate and release-source metadata.
- Earlier `npm test`: failed in unchanged date-sensitive membership tests (an Aug 27–Sep 26 active-window fixture is expired on Oct 7), a transient 5-second staging timeout (passed when rerun in the focused invocation), and tests discovered in an existing ignored `out/release-20260906/api-diagnostic-retry-8mYr6Q` tree (duplicate expired-window failure and API-startup timeout). No tests were excluded or weakened and no existing generated artifact was removed.
- During development, regression failures exposed missing callback results, outdated logging expectations, and fixture selection/body-observation mistakes; those were corrected and rerun. Default/sandbox runners also failed before checks could execute (runner setup / esbuild ancestor access); the authorized isolated shell runner executed the checks.
- Full `npm run verify`: unit gate completed with 243 files/1,830 tests passing, three failures in unchanged source (expired membership window, its generated duplicate, and an outdated player-auth error assertion in the generated release tree); one file/eight tests skipped. All other 12 gates passed, including strict checks, Player contracts/assets, Player Web lint/tests/build, sales-map checks/build, and desktop renderer build. Overall exit code 1; no unrelated failure was hidden.
