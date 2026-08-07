# Agent Journal

## 2026-08-05 — TYPE-001 compiler/runtime boundary investigation

- Confirmed a clean worktree on `chore/prepare-codex-workflow`; no work occurred on `main`.
- Confirmed `TYPE-001` directly gates `TYPE-005`, `TYPE-006`, and `TYPE-012`, and transitively gates `TYPE-007`.
- Recorded the untouched root baseline: `npm run typecheck` exited 2 with 94 diagnostics in 6 files.
- Traced renderer, Electron main/preload, Player, API, Vitest, e2e, Vite, tooling, and CI ownership from actual entrypoints and imports.
- Found that root TypeScript has 26 declared root files but checks 29 repository files after following `branding.config.json` and two root-test imports into Player domain source.
- Found that unspecified root `types` admits Node globals and both root/Player React declarations into the browser program.
- Proved from locked tooling that Electron 42.1.0 uses Chromium 148.0.7778.97 and Vite 7.3.5's default build floor is Chrome/Edge 107, Firefox 104, and Safari 16.
- Proved with a read-only compiler probe that ES2022 libraries plus explicit Vite globals remove exactly the six `TYPE-001` diagnostics: 94 -> 88, with no new diagnostic.
- Probed the broader recommended check-JS boundary. It exposes 3 Electron, 2 root tooling, 2 e2e, 7 API, and 2 download-site diagnostics.
- Did not change compiler/runtime/test code because comprehensive coverage exceeds `TYPE-001`'s allowed areas, while the narrow change alone does not satisfy the request's all-runtime coverage condition.
- Marked `TYPE-001` `review_required`; did not mark any downstream task ready.
- Final verification: `npm run typecheck` retained 94 diagnostics; Player typecheck passed; 17 files/81 tests passed; Vite built 1,910 modules; aggregate `npm run verify` exited 1 only because of the root baseline failure.

Decision record: `docs/agent/TYPE-001_BOUNDARY_DECISION.md`.

## 2026-08-05 — TYPE-001 approved narrow implementation

- Started from a clean worktree on `chore/prepare-codex-workflow`; confirmed `TYPE-001` was `review_required`.
- Re-recorded the untouched baseline: 94 diagnostics in 6 files, including exactly 6 `TS2550` diagnostics owned by `TYPE-001`.
- Changed only root `tsconfig.json` library declarations from ES2020 to ES2022 while preserving DOM libraries and `target: ES2020`.
- First post-change typecheck: 88 diagnostics in the same 6 files, zero `TS2550`, and no new diagnostic code or path.
- Confirmed the remaining 88 diagnostics sum exactly across `TYPE-002` through `TYPE-014`.
- Marked `TYPE-001` complete and only `TYPE-005`, `TYPE-006`, and `TYPE-012` ready; their sole dependency is now complete.
- Added separate planned tasks `TYPE-015` through `TYPE-022` for the eight approved future compiler-boundary areas; implemented none of them.
- Retained no project references, no new `checkJs`, no source exclusions, and no ambient-type change.
- Final verification: root typecheck retained the expected 88 diagnostics and zero `TS2550`; Player typecheck passed; 17 files/81 tests passed in 3.50 seconds; Vite transformed 1,910 modules and built in 17.57 seconds.
- Aggregate `npm run verify` ran all four gates and exited 1 only for the expected root baseline; its nested Player typecheck, 17/81 tests, and 1,910-module build passed.

## 2026-08-06 — TYPE-005 synchronized-list tuple inference

- Started from a clean `fix/type-005-synchronized-list-tuples` branch based on the latest `chore/prepare-codex-workflow` commit, `1ffba52`; confirmed `TYPE-005` was `ready` and its dependency `TYPE-001` was complete.
- Re-recorded the untouched baseline: exactly 88 diagnostics in 6 files, including the assigned `TS2769` at `src/main.tsx:1181` and 8 downstream `TS2322` diagnostics at lines 3041, 3042, 3082, 3083, and 3128–3131.
- Extracted only `mergeSyncedList` to a pure renderer-owned helper, typed its entries as `[string, T]`, its map as `Map<string, T>`, and its result as `T[]`, without an assertion or suppression.
- Added 6 focused tests for id/name/playerName key selection, local replacement, duplicate behavior, missing/empty keys, local ordering, and remote append ordering.
- Focused tests passed, and the complete suite increased from 17 files/81 tests to 18 files/87 tests with zero failures or skips.
- Root diagnostics changed from 88 to exactly 79 in the same 6 affected files. `TS2322` changed from 29 to 21 and `TS2769` from 6 to 5; all other code and path counts were unchanged, and the 9 owned diagnostics were absent.
- Player typecheck passed; the renderer build passed with 1,911 modules transformed; the existing SQLite, ExcelJS `eval`, and chunk-size warnings remained.
- Aggregate `npm run verify` ran all four gates and exited 1 only for the expected 79-diagnostic root failure; Player TypeScript, 18/87 tests, and the renderer build passed.
- Marked only `TYPE-005` complete. `TYPE-007` remains pending on incomplete `TYPE-006`, so no downstream task became newly ready.

## 2026-08-06 — TYPE-006 map/filter result narrowing

- Started from a clean `fix/type-005-synchronized-list-tuples` branch at completed `TYPE-005` commit `beeeb14`; confirmed the branch also contains completed preparation and `TYPE-001` work.
- Confirmed `TYPE-006` was `ready`, its only dependency `TYPE-001` was complete, and the untouched root baseline was exactly 79 diagnostics in 6 files.
- Confirmed the assigned diagnostics were the `TS2322`/`TS2677` pairs at `src/main.tsx:1861`/`1927`, `2354`/`2378`, and `2745`/`2764`.
- Extracted only `getBalancePlans`, `parseGroupMeMessages`, and the today-player activity result builder to `src/lib/resultBuilders.ts`, typing each mapper as its exact object-or-`null` result and narrowing with one exact non-null guard.
- Preserved the existing balance callbacks, GroupMe ID/timestamp providers, dashboard date and membership helpers, filtering criteria, output fields, and ordering.
- Added 9 focused tests covering empty, rejected, accepted, ordered, fallback, deduplicated, and optional-field results across all three pipelines.
- Root diagnostics changed from 79 to exactly 73 in the same 6 affected files. `TS2322` changed from 21 to 18 and `TS2677` from 3 to 0; all other diagnostic-code and affected-path counts were unchanged, and the 6 owned diagnostics were absent.
- Player typecheck passed; all 19 files/96 tests passed; the renderer build passed with 1,912 modules transformed; the existing SQLite, ExcelJS `eval`, and large-chunk warnings remained.
- Aggregate `npm run verify` ran all four gates and exited 1 only for the expected 73-diagnostic root failure; Player TypeScript, 19/96 tests, and the renderer build passed.
- Marked `TYPE-006` complete. With both dependencies complete, `TYPE-007` is newly ready; it was not started.

## 2026-08-06 — TYPE-012 root test-only contracts

- Started from a clean `fix/type-005-synchronized-list-tuples` branch at completed `TYPE-006` commit `16785e2`; confirmed the branch contains the preparation work and completed `TYPE-001`, `TYPE-005`, and `TYPE-006`.
- Confirmed `TYPE-012` was `ready`, its only dependency `TYPE-001` was complete, and the untouched root baseline was exactly 73 diagnostics in 6 files.
- Confirmed the assigned diagnostics were `TS7017` at `src/components/PokerTable.test.tsx:9:12` and `TS2345` at `src/lib/appCore.test.ts:138:51`.
- Declared the React act-environment flag as an exact boolean test global and typed the frequency fixture from the public helper's parameter contract.
- Changed only the two affected tests; no production source, runtime shim, public export, compiler setting, dependency, test behavior, assertion, suppression, or exclusion changed.
- Root diagnostics changed from 73 to exactly 71. `TS7017` changed from 1 to 0 and `TS2345` from 36 to 35; every other diagnostic-code count and unaffected path count remained unchanged, and neither affected test path retained a diagnostic.
- Focused tests passed: 2 files and 16 tests. Player typecheck passed; all 19 files/96 tests passed; the renderer build passed with 1,912 modules transformed. The existing SQLite, ExcelJS `eval`, and large-chunk warnings remained.
- Aggregate `npm run verify` ran all four gates and exited 1 only for the expected 71-diagnostic root failure; Player TypeScript, 19/96 tests, and the renderer build passed.
- Marked `TYPE-012` complete. `TYPE-015` remains planned because `TYPE-021` is incomplete, so no downstream task became newly ready.

## 2026-08-06 — TYPE-007 renderer callback decomposition

- Started from a clean `fix/type-005-synchronized-list-tuples` worktree; confirmed the branch was not `main`.
- Confirmed completed `TYPE-005` and `TYPE-006` satisfy both former `TYPE-007` dependencies and that the pre-decomposition queue marked `TYPE-007` ready with human review required.
- Re-ran `npm run typecheck`: it retained exactly 71 diagnostics in 4 files. After excluding the 20 diagnostics explicitly owned by the other current remediation tasks, the live `TYPE-007` inventory is exactly 51 diagnostics, all in `src/main.tsx`.
- Traced every diagnostic through its containing function/callback, canonical `AppState`/domain type, downstream helper, existing tests, and renderer architecture notes.
- Split the 51 diagnostics into ten behavior contracts: profile grouping (2), waitlist patching (5), correction propagation (6), player move/leave transitions (6), forming/balanced table construction (4), planned participants (5), table lifecycle/events (8), profile relationships (10), table-event reporting (2), and floor rendering (3).
- Classified nine children `SAFE_AFTER_TESTS`. None is `SAFE_AUTONOMOUS` because the affected callbacks live in the explicitly risky `src/main.tsx` boundary and lack focused characterization.
- Classified `TYPE-007F` `HUMAN_DECISION_REQUIRED`: current candidate construction is interest-only, while the canonical type permits missing interests/profiles and `addPlannedSession` contains a dormant profile-only interest-creation path. Recommended preserving the broad guarded contract without activating new behavior until a separate product decision (medium confidence, 0.75).
- Converted `TYPE-007` into a zero-direct-ownership umbrella that depends on `TYPE-007A` through `TYPE-007J`; the ten children own 51 unique diagnostics. `TYPE-008` now depends on profile batches `TYPE-007A` and `TYPE-007H`; `TYPE-010` conservatively retains the parent dependency. Neither downstream task became ready.
- Added `docs/agent/TYPE-007_DECOMPOSITION.md` and one complete task specification for every child. No production source, test, compiler setting, dependency, persisted shape, API, Firebase contract, or runtime behavior changed.
- Mechanical validation found 51 inventory entries, 51 unique child-spec entries, zero ownership difference from the live compiler set, 10/10 child specs with all required sections, a parsed YAML queue totaling 71 current diagnostics, and zero dependency cycles.
- Final `npm run typecheck` retained exactly 71 diagnostics in the same 4 files and identical code counts; documentation changed no compiler output.
- Final `npm run verify` exited 1 only for that expected root TypeScript baseline. Player TypeScript passed, all 19 files/96 tests passed, and the renderer build passed with 1,912 modules transformed; the existing SQLite experimental, ExcelJS `eval`, and large-chunk warnings remained.

## 2026-08-06 — TYPE-007A duplicate-profile grouping

- Started from a clean `fix/type-005-synchronized-list-tuples` worktree at decomposition commit `83bd6d6`; confirmed the branch was not `main` and contained completed `TYPE-001`, `TYPE-005`, `TYPE-006`, and `TYPE-012` work.
- Re-recorded the untouched baseline with `npm run typecheck`: exactly 71 diagnostics in 4 files, including only the assigned `TS2322` and `TS2740` diagnostics at `src/main.tsx:2631:24` and `2631:52`.
- Traced the input as canonical `PlayerProfile[]`, the key as `name.trim().toLowerCase()`, source order within groups, first-seen `Map` group order, complete profile object references, singleton exclusion, and downstream profile-directory rendering plus merge consumption.
- Added only `src/lib/profileGrouping.test.ts` for Gate 1. `npx --no-install vitest run src/lib/profileGrouping.test.ts` passed 1 file and 1 test against unchanged production source, covering whitespace/case normalization, a unique profile, a three-profile duplicate set, three distinct duplicate groups, ordering, and deep preservation of every required and optional profile field.
- A test-development `npm run typecheck` exposed one new `TS2339` in the mock harness for an unnecessary `actual.default` access (72 total). Removed that test-only access, reran the focused test successfully, and confirmed the root baseline returned to exactly 71 with no diagnostic in the characterization file before committing.
- Committed the test-only checkpoint as `e4fbb7a` with message `test: characterize duplicate profile grouping`; no production file was part of that commit.
- Changed one production annotation in `duplicateProfiles` from the partial structural fragment to canonical `PlayerProfile`. The grouping key, arrays, filter, object references, rendering, and merge behavior remain unchanged.
- The post-change focused command passed 1 file and 1 test. `npm run typecheck` then retained exactly 69 diagnostics in 4 files: `TS2322` changed from 18 to 17, `TS2740` from 1 to 0, and `src/main.tsx` from 62 to 60; every other code/path count stayed unchanged and both owned diagnostics were absent.
- `npm run player:typecheck` passed; `npm test` passed 20 files/97 tests; `npm run build` passed with 1,912 modules transformed. The existing SQLite experimental, ExcelJS `eval`, and large-chunk warnings remained.
- `npm run verify` ran all four gates and exited 1 only for the expected 69-diagnostic root baseline; Player TypeScript, 20/97 tests, and the 1,912-module build passed.
- Marked only `TYPE-007A` complete. The `TYPE-007` umbrella remains pending on nine children, and `TYPE-008` remains pending on `TYPE-007H`; no downstream task became newly ready and no other remediation batch was started.

## 2026-08-07 — TYPE-007I table-event report projection

- Started from a clean `fix/type-005-synchronized-list-tuples` worktree at completed `TYPE-007A` commit `2317cd3`; confirmed the branch was not `main` and includes the separate `TYPE-007A` test and implementation commits.
- Confirmed `TYPE-007I` was `ready`, its `TYPE-005`/`TYPE-006` dependencies were complete, and its queue ownership was exactly the two `TS2345` diagnostics at `src/main.tsx:5594:14` and `8468:151`.
- Re-recorded the untouched root baseline with `npm run typecheck`: exactly 69 diagnostics in 4 files (`TS2345` 35; `src/main.tsx` 60), including both and only the assigned report-projection locations.
- Traced canonical `TableEvent` fields (`id`, `type`, `gameId`, `timestamp`, `playerCount`, required `note`, optional `tableId`/`reason`), report-window filtering, the `Failed to Start`/`Broke` filter, source-ordered CSV output, last-six Summary order, `Unspecified` fallback, truthy-note suffix, and CSV escaping.
- Added only `src/lib/tableEventReporting.test.ts` for Gate 1. It uses local fixture state, disables renderer Firebase sync, stubs network access, and observes the existing Summary and CSV download without hosted services or production data.
- The first harness attempt failed before running either test because a plain-object `URL` stub broke application URL construction. Replaced only that test stub with a constructible local subclass; the definitive pre-change command `npx --no-install vitest run src/lib/tableEventReporting.test.ts` then passed 1 file and 2 tests against unchanged production code.
- Characterization covers present, missing, and empty reasons; truthy and empty notes; excluded event types; more than six matching events; exact Summary labels and CSV rows/escaping; source and last-six ordering; required canonical fields; and preservation of input event values and object references.
- Confirmed the Gate 1 test introduced no root diagnostic and the baseline remained exactly 69 with both owned errors present, then committed the test-only checkpoint as `a030b1a` with message `test: characterize table event report projection`.
- Changed only the two mapper parameter annotations from partial structural fragments to canonical `TableEvent`. No expression, filter, fallback, label, order, CSV schema/encoding, persistence, or event object changed; `reason` remains optional and `note` remains required.
- The post-change focused command passed 1 file and 2 tests. `npm run typecheck` then retained exactly 67 diagnostics in 4 files: `TS2345` changed from 35 to 33 and `src/main.tsx` from 60 to 58; every other code/path count stayed unchanged, both owned diagnostics were absent, and no new diagnostic appeared.
- `npm run player:typecheck` passed; `npm test` passed 21 files/99 tests; `npm run build` passed with 1,912 modules transformed. The existing SQLite experimental, ExcelJS `eval`, and large-chunk warnings remained.
- `npm run verify` ran all four gates and exited 1 only for the expected 67-diagnostic root baseline; Player TypeScript, 21/99 tests, and the 1,912-module build passed.
- Marked only `TYPE-007I` complete. The `TYPE-007` umbrella remains pending on eight incomplete children, including `TYPE-007F` in `review_required`; no task became newly ready and no other remediation batch was started.

## 2026-08-07 — TYPE-007J floor render projections

- Started from a clean `fix/type-005-synchronized-list-tuples` worktree at completed `TYPE-007I` commit `7769a41`; confirmed the branch was not `main` and includes the separate `TYPE-007A` and `TYPE-007I` test/implementation commits.
- Confirmed `TYPE-007J` was `ready`, its `TYPE-005`/`TYPE-006` dependencies were complete, and its queue ownership was exactly the three `TS2345` diagnostics at `src/main.tsx:9697:40`, `9698:58`, and `9802:22`.
- Re-recorded the untouched root baseline with `npm run typecheck`: exactly 67 diagnostics in 4 files (`TS2345` 33; `src/main.tsx` 58), including all three and only the assigned floor-render locations.
- Traced complete canonical `GameConfig` caps/thresholds through demand and viability calculations and canonical `Interest` values through active filtering, source ordering, the eight-item cap, game-label fallback, timestamps, optional arrival/edit fields, markers, actions, and empty state.
- Added only `src/components/FloorCollectionCallbacks.test.tsx` for Gate 1. It uses local jsdom fixture state, disables Firebase, stubs network access, and checks forming/non-forming games, ready/likely output, optional fields, unknown games, active/inactive filtering, cap/order, empty state, and state value/reference non-mutation.
- Test-harness development corrected a TSX generic-arrow parse ambiguity and two invalid fixture assumptions: persisted unknown game IDs normalize to the fallback game, and a seven-seat cap normalizes to eight. The final test explicitly drives the defensive unknown-game render path through a local state update and passed 1 file/1 test against unchanged production.
- Committed the finalized test-only checkpoint as `961ccc8` with message `test: characterize floor render projections`; no production file was part of that commit.
- Changed only the selected-game mapper annotation to canonical `GameConfig` and the active-waitlist mapper annotation to canonical `Interest`. No expression, demand/viability rule, filter, ordering, cap, fallback, text, action, persisted shape, or object changed.
- The post-change focused command passed 1 file and 1 test. `npm run typecheck` then retained exactly 64 diagnostics in 4 files: `TS2345` changed from 33 to 30 and `src/main.tsx` from 58 to 55; every other code/path count stayed unchanged, all three owned diagnostics were absent, and no new diagnostic appeared.
- `npm run player:typecheck` passed; `npm test` passed 22 files/100 tests; `npm run build` passed with 1,912 modules transformed. The existing SQLite experimental, ExcelJS `eval`, and large-chunk warnings remained.
- `npm run verify` ran all four gates and exited 1 only for the expected 64-diagnostic root baseline; Player TypeScript, 22/100 tests, and the 1,912-module build passed.
- Marked only `TYPE-007J` complete. The `TYPE-007` umbrella remains pending on seven incomplete children, including `TYPE-007F` in `review_required`; `TYPE-008` still waits on `TYPE-007H`, `TYPE-010` still waits on the umbrella, no task became newly ready, and no other remediation batch was started.

## 2026-08-07 — TYPE-007B waitlist interest patching

- Started from a clean `fix/type-005-synchronized-list-tuples` worktree at completed `TYPE-007J` commit `fbc5ba9`; confirmed the branch was not `main` and contains the separate completed `TYPE-007A`, `TYPE-007I`, and `TYPE-007J` test/implementation checkpoints.
- Confirmed `TYPE-007B` was `ready`, its `TYPE-005`/`TYPE-006` dependencies were complete, and its queue ownership was exactly the five diagnostics at `src/main.tsx:3244:38`, `3261:7`, `3261:74`, `3262:30`, and `3262:57`.
- Re-recorded the untouched root baseline with `npm run typecheck`: exit 2 with exactly 64 diagnostics in 4 files (`TS2345` 30, `TS2339` 5, `src/main.tsx` 55), including all five and only the assigned waitlist-patch locations.
- Traced canonical `Interest[]` and `AppState` inputs through target selection, patch spreading, status timestamps, timestamp refresh, manual-edit accumulation, `changedInterest`, active-status demand routing, prompt-produced state selection, usage tracking, persistence, missing-target behavior, collection order, and prior-state mutation boundaries.
- Added only `src/lib/waitlistUpdates.test.ts` for Gate 1. It uses local jsdom fixtures, disables Firebase, stubs network access, and observes the existing rendered `updateInterest` closure without adding or moving a production seam.
- The exact pre-change command `npx --no-install vitest run src/lib/waitlistUpdates.test.ts` passed 1 file and 6 tests against unchanged production. A follow-up root typecheck retained exactly 64 diagnostics, all five owned diagnostics, and no test-file diagnostic.
- Characterization covers interests with and without `manualEdits`; multi-key non-status patches; every status-specific timestamp family; `Interested`; `gameId` and unrelated-field preservation; stable ordering; changed and unchanged object references; prior-state non-mutation; active/inactive prompt routing; prompt-produced persistence selection; and missing-target persistence without a prompt.
- Committed the test-only checkpoint as `d60ef42` with message `test: characterize waitlist interest patching`; no production or documentation file was part of that commit.
- Changed only the `updateInterest` mapper parameter annotation from a partial structural fragment to canonical `Interest`. No expression, patch key, timestamp rule, manual-edit rule, branch, persistence argument, prompt, usage metadata, object spread, or order changed.
- The post-change focused command passed 1 file and 6 tests. `npm run typecheck` then retained exactly 59 diagnostics in 4 files: `TS2345` changed from 30 to 27, `TS2339` from 5 to 3, and `src/main.tsx` from 55 to 50; every other code/path count stayed unchanged, all five owned diagnostics were absent, and no new diagnostic appeared.
- `npm run player:typecheck` passed; `npm test` passed 23 files/106 tests; `npm run build` passed with 1,912 modules transformed. The existing SQLite experimental, ExcelJS `eval`, and large-chunk warnings remained.
- `npm run verify` ran all four gates and exited 1 only for the expected 59-diagnostic root baseline; Player TypeScript, 23/106 tests, and the 1,912-module build passed.
- Marked only `TYPE-007B` complete. The `TYPE-007` umbrella remains pending on six incomplete children, including `TYPE-007F` in `review_required`; `TYPE-008` still waits on `TYPE-007H`, `TYPE-010` still waits on the umbrella, no task became newly ready, and no other remediation batch was started.

## 2026-08-07 - TYPE-007C cross-record timestamp corrections

- Started from a clean `fix/type-005-synchronized-list-tuples` worktree at completed `TYPE-007B` commit `ec7f8bd`; confirmed the branch was not `main` and includes the separate completed `TYPE-007B` test and implementation commits.
- Confirmed `TYPE-007C` was `ready`, its `TYPE-005`/`TYPE-006` dependencies were complete, and its queue ownership was exactly the six diagnostics at `src/main.tsx:3274:7`, `3274:38`, `3277:7`, `3277:48`, `3289:7`, and `3289:48`.
- Re-recorded the untouched root baseline with `npm run typecheck`: exit 2 with exactly 59 diagnostics in 4 files, including all six and only the assigned timestamp-correction locations.
- Traced `updateInterestTimestamp`, `updatePlayerSession`, `withCorrectionLog`, `markManualEdit`, local persistence, canonical `Interest`/`PlayerSession` fields, exact player-name/game matching, source ordering, empty and populated datetime conversion, audit insertion, and missing-target behavior.
- Added only `src/lib/stateCorrections.test.ts` for Gate 1. It uses local jsdom fixtures, disables Firebase, stubs network access, and captures the existing App-local correction functions through the Node inspector without adding or moving a production seam.
- The definitive pre-change command `npm test -- src/lib/stateCorrections.test.ts` passed 1 file and 6 tests against unchanged production code. A follow-up `npm run typecheck` exited 2 with exactly 59 diagnostics, retained all six owned diagnostics, and reported zero diagnostics in the characterization file.
- Characterization covers all five interest timestamp keys; empty and populated inputs; exact related-session propagation and unrelated sessions; manual edits with and without existing entries; audit entity, field, note, timestamp, and ordering; complete field/reference preservation; stable collection ordering; missing-interest and missing-session audited no-ops; prior-state non-mutation; and exact local JSON persistence.
- Committed the test-only checkpoint as `187be9a` with message `test: characterize timestamp correction propagation`; no production or documentation file was part of that commit.
- Changed only three mapper callback annotations: one partial interest fragment became canonical `Interest`, and two partial session fragments became canonical `PlayerSession`. No expression, datetime conversion, matching rule, propagation branch, field spread, manual-edit/audit semantic, persistence call, or order changed.
- The post-change focused command passed 1 file and 6 tests. `npm run typecheck` then retained exactly 53 diagnostics in 4 files: `TS2322` changed from 17 to 14, `TS2345` from 27 to 24, and `src/main.tsx` from 50 to 44; every other code/path count stayed unchanged, all six owned diagnostics were absent, and no new diagnostic appeared.
- `npm run player:typecheck` passed; `npm test` passed 24 files/112 tests; `npm run build` passed with 1,912 modules transformed. The existing SQLite experimental, ExcelJS `eval`, and large-chunk warnings remained.
- `npm run verify` ran all four gates and exited 1 only for the expected 53-diagnostic root baseline; Player TypeScript, 24/112 tests, and the 1,912-module build passed.
- Marked only `TYPE-007C` complete. The `TYPE-007` umbrella remains pending on five incomplete children, including `TYPE-007F` in `review_required`; `TYPE-008` still waits on `TYPE-007H`, `TYPE-010` still waits on the umbrella, no task became newly ready, and no other remediation batch was started.

## 2026-08-07 - TYPE-007D human decision and task split

- Started from a clean `fix/type-005-synchronized-list-tuples` worktree and confirmed the branch was not `main`.
- Re-ran the untouched root typecheck: it retained exactly 53 diagnostics in 4 files, including all six diagnostics previously assigned to `TYPE-007D`.
- Recorded the human decision that a profile-less departure may update profile statistics only for exactly one valid case-insensitive name match; zero or multiple matches update no profile, while the player-session departure still completes. An explicit `profileId` remains authoritative with no name fallback.
- Traced `playerSession.profileId` from `seatPlayerInState`, optional/legacy absence conditions, fallback player-name origin, current lowercase-only departure comparison, the two mutated played-hour fields, downstream persisted/statistical effects, other name fallbacks, duplicate detection/manual merge behavior, and available identity helpers and diagnostics.
- Split the original task into a zero-diagnostic `TYPE-007D` umbrella, five-diagnostic behavior-preserving `TYPE-007D1`, and one-diagnostic behavioral correction `TYPE-007D2`. `TYPE-007D1` depends on `TYPE-007D2`; both retain completed `TYPE-005`/`TYPE-006` prerequisites, and the graph remains acyclic.
- No production source or test changed during the split. `TYPE-007D2` is ready for the required characterization gate; `TYPE-007D1` remains pending until the approved behavior is established and protected.
