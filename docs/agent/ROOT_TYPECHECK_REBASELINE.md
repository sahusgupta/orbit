# Root TypeScript Rebaseline

Rebaseline date: 2026-08-05

Branch: `chore/prepare-codex-workflow`

Dependency-restoration starting commit: `02cdd71`

## Verification state: partial failure

The root TypeScript project still fails, but its result is now truthful: React and ReactDOM are typed by root-owned packages, the missing-declaration cascade is gone, `TYPE-001` has aligned the renderer library contract, `TYPE-005` has restored synchronized-list tuple inference, `TYPE-006` has repaired exact map/filter result narrowing, `TYPE-012` has corrected the two test-only contracts, `TYPE-007A` has preserved complete canonical profiles during duplicate grouping, `TYPE-007I` has restored canonical table-event report callbacks, `TYPE-007J` has restored canonical floor render callbacks, and the remaining 64 diagnostics are application, test, stale-contract, or platform errors. Player TypeScript, unit tests, and the renderer build remain separate gates.

No production source was changed during this rebaseline. No compiler setting was weakened, no file was excluded, and no diagnostic suppression or unsafe cast was added.

## Dependency ownership and selected versions

This repository is not an npm workspace. The root, `apps/api/`, and `player-app/` are independently locked npm packages.

| Package | Root declaration/resolution | Player declaration/resolution |
| --- | --- | --- |
| `react` | Declared `^19.1.1`; locked and installed at 19.2.6 | Declared, locked, and installed at 19.1.0 |
| `react-dom` | Declared `^19.1.1`; locked and installed at 19.2.6 | Declared, locked, and installed at 19.1.0 |
| `react-native` | Not owned by root | Declared, locked, and installed at 0.81.5 |
| `@types/react` | Added as root dev dependency `^19.2.18`; locked at 19.2.18 | Independently declared `~19.1.10`; locked at 19.1.17 |
| `@types/react-dom` | Added as root dev dependency `^19.2.4`; locked at 19.2.4 | Not declared |

The selected type packages are from the React 19.2 type line, matching the root's locked React 19.2 runtime line. Registry metadata for `@types/react-dom` 19.2.4 requires `@types/react ^19.2.0`, which 19.2.18 satisfies. The install added only these two root dev dependencies and their `csstype` dependency. It did not change React, ReactDOM, React Native, Player dependencies, or any other declared package version.

Post-install dependency-tree inspection found one physical root React 19.2.6 installation, one ReactDOM 19.2.6 installation, one root 19.2 type pair, and no invalid peer dependency. Player remains isolated on its compatible React/React Native 19.1 line; its nested type package is not used to satisfy the root project.

## Diagnostic delta

| Measurement | Count |
| --- | ---: |
| Before dependency installation | 3,630 diagnostics in 12 files |
| After dependency installation | 94 diagnostics in 6 files |
| After `TYPE-001` library correction | 88 diagnostics in 6 files |
| After `TYPE-005` tuple-inference correction | 79 diagnostics in 6 files |
| After `TYPE-006` map/filter correction | 73 diagnostics in 6 files |
| After `TYPE-012` test-contract correction | 71 diagnostics in 4 files |
| After `TYPE-007A` profile-grouping correction | 69 diagnostics in 4 files |
| After `TYPE-007I` report-projection correction | 67 diagnostics in 4 files |
| After `TYPE-007J` floor-render correction | 64 diagnostics in 4 files |
| Dependency-restoration displayed-diagnostic reduction | 3,536 |
| Current net displayed-diagnostic reduction | 3,566 |
| Missing React/ReactDOM cascade diagnostics removed | 3,598 |
| Previously visible non-cascade diagnostics retained | 32 |
| Previously masked diagnostics exposed | 62 |

The gross cascade reduction is 3,598, not 3,536: installing the declarations removed all 3,598 diagnostics assigned to the missing-type dependency group while simultaneously exposing 62 semantic diagnostics. The dependency-restoration arithmetic is `3,630 - 3,598 + 62 = 94`; the 6 diagnostics removed by `TYPE-001`, 9 removed by `TYPE-005`, 6 removed by `TYPE-006`, 2 removed by `TYPE-012`, 2 removed by `TYPE-007A`, 2 removed by `TYPE-007I`, and 3 removed by `TYPE-007J` establish the current total of 64.

No `TS7016`, `TS7026`, `TS7031`, or `TS18046` diagnostic remains. The dependency issue is resolved; the root gate remains red because the declarations revealed real contracts that the previous untyped React layer could not check.

## Exact remaining inventory

### By TypeScript code

| Code | Count |
| --- | ---: |
| `TS2322` | 17 |
| `TS2339` | 5 |
| `TS2345` | 30 |
| `TS2352` | 1 |
| `TS2353` | 1 |
| `TS2367` | 1 |
| `TS2739` | 2 |
| `TS2769` | 5 |
| `TS7006` | 2 |
| **Total** | **64** |

### By affected path

| Path | Count | Application/package |
| --- | ---: | --- |
| `src/main.tsx` | 55 | Root management renderer |
| `src/lib/firebaseClubSync.ts` | 5 | Root renderer/Firebase sync boundary |
| `src/lib/playerSync.ts` | 2 | Root renderer/player-sync domain copy |
| `src/lib/playerSync.test.ts` | 2 | Root package tests |
| **Total** | **64** | |

Production root source accounts for 62 diagnostics and root tests account for 2. Electron, API, Player, download-site, e2e, generated output, and dependency source account for zero diagnostics because they are not part of this root TypeScript project's `include: ["src"]` boundary.

## Root-cause summary

| Task | Classification | Diagnostics | Root cause | Blocks refactoring | Blocks Player web | Safe autonomous repair | Human architecture review |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `TYPE-001` | `CONFIGURATION_BOUNDARY` | 0 | Resolved: ES2022 library declarations now match the supported renderer | No | No | Completed | Completed |
| `TYPE-002` | `STALE_OR_DEAD_CODE` | 4 | Root/Player snapshot public-contract drift | Yes | Yes | No | Yes |
| `TYPE-003` | `REAL_TYPE_ERROR` | 4 | Firebase transforms erase `ManagementClubState` and tournament types | Yes | Indirectly | No | Yes |
| `TYPE-004` | `REAL_TYPE_ERROR` | 1 | Membership `Denied` narrowing is lost across a callback | Yes | Yes | No | Yes |
| `TYPE-005` | `REAL_TYPE_ERROR` | 0 | Resolved: explicit synchronized-entry tuples preserve the helper's generic value type | No | No | Completed | No |
| `TYPE-006` | `REAL_TYPE_ERROR` | 0 | Resolved: exact mapper result types and non-null narrowing preserve all three pipelines | No | No direct block | Completed | No |
| `TYPE-007` | `REAL_TYPE_ERROR` | 44 | Remaining hand-written structural callback types discard optional/required domain fields; duplicate-profile grouping, table-event reporting, and floor rendering are resolved | Yes | No direct block | No as one repair | Yes for remaining behavior batches |
| `TYPE-008` | `REAL_TYPE_ERROR` | 2 | Profile import paths do not validate/narrow unknown input to `PlayerProfile` | Yes | No direct block | No | Yes |
| `TYPE-009` | `REAL_TYPE_ERROR` | 2 | Desktop account result nullability and shallow `Partial<AppState>` mismatch | Yes | No direct block | No | Yes |
| `TYPE-010` | `REAL_TYPE_ERROR` | 4 | GroupMe setter callbacks and candidate shape lose required fields | Yes | No direct block | No | Yes |
| `TYPE-011` | `PLATFORM_TYPE_CONFLICT` | 1 | Web Crypto requires an owned `ArrayBuffer`-compatible source | Yes for licensing | No | No | Yes/security review |
| `TYPE-012` | `TEST_TYPE_ERROR` | 0 | Resolved: exact act global and production-facing fixture typing | No | No | Completed | No |
| `TYPE-013` | `STALE_OR_DEAD_CODE` | 1 | Legacy settings migration is represented by an incompatible whole-object cast | Yes | No | No | Yes |
| `TYPE-014` | `STALE_OR_DEAD_CODE` | 1 | `addInterest` compares a form status union to unreachable `Seated` | Yes | No direct block | No | Yes |
| **Total** | | **64** | | | | | |

No remaining group is classified `MISSING_GENERATED_TYPE`, `DEPENDENCY_TYPE_MISMATCH`, or `UNKNOWN_REQUIRES_INVESTIGATION`. Those dependency/configuration discovery issues are resolved or have been converted into evidence-backed tasks.

## Detailed classifications

### TYPE-001 — ES library boundary

- Classification: `CONFIGURATION_BOUNDARY`.
- Representative diagnostic: `TS2550` for `String.replaceAll` at `src/main.tsx:2311` and `Array.at` at `src/main.tsx:5178` and four `playerSync.test.ts` locations.
- Affected symbols: `renderScriptTemplate`, `mergeDuplicateProfiles`, and player-sync tests.
- Root cause: root `lib` was ES2020 while source assumed ES2021/ES2022 APIs; repository runtime evidence proved ES2022 support.
- Correction: `lib` is now `DOM`, `DOM.Iterable`, and `ES2022`; `target: ES2020` and all runtime source remain unchanged.
- Result: all six assigned `TS2550` diagnostics are gone, with no new diagnostic.
- Status: complete after human approval and full verification.

### TYPE-002 — Player snapshot contract drift

- Classification: `STALE_OR_DEAD_CODE`.
- Representative diagnostic: `social` is emitted and consumed but absent from root `PlayerClubSnapshot`.
- Affected symbols: `buildPlayerClubSnapshot`, `publishClubSnapshot`, and player-sync assertions.
- Root cause: duplicated root and Player public snapshot contracts have drifted.
- Confidence: high for `social`; pre-existing: yes. Runtime already emits the field, but broader protocol differences may be incorrect.
- Recommended correction: characterize protocol-v2 serialization and establish a canonical versioned contract before aligning declarations.
- Risk/tests: high; serialized shape, Firebase publication, revision/commit-marker, root and Player compatibility tests.
- Autonomous correction: no; shared/public schema review is required.

### TYPE-003 — Firebase transformation types

- Classification: `REAL_TYPE_ERROR`.
- Representative diagnostics: two `TS2739` state assignments and two implicit tournament callback parameters in `firebaseClubSync.ts`.
- Affected symbols: `syncPlayerUpdatesToClubState` and `publishClubSnapshot`.
- Root cause: broad record transformations erase required management state and tournament shapes at a privileged sync boundary.
- Confidence: high; pre-existing: yes. Runtime may drop or misinterpret fields even though current tests pass.
- Recommended correction: define validated input records and type-preserving transforms after characterization.
- Risk/tests: high; isolated Firebase-shape fixtures, idempotency/revision ordering, root tests/typecheck/build, no production service access.
- Autonomous correction: no.

### TYPE-004 — Membership status narrowing

- Classification: `REAL_TYPE_ERROR`.
- Representative diagnostic: `Denied` remains possible when assigning `ManagementProfile.membershipStatus` in `applyPlayerProfileDocumentToClubState`.
- Affected symbol: `applyPlayerProfileDocumentToClubState`.
- Root cause: an early return narrows the source record, but the proof is not retained in the later profile-map callback.
- Confidence: high; pre-existing: yes. Runtime intent appears safe, but membership state is sensitive.
- Recommended correction: capture a precisely narrowed allowed status and characterize every incoming status.
- Risk/tests: medium/high; membership transition and persisted-shape tests plus both typechecks.
- Autonomous correction: no in isolation from membership review.

### TYPE-005 — Synchronized-list tuple inference

- Classification: `REAL_TYPE_ERROR`.
- Resolved diagnostics: `new Map` rejected `(string | T)[][]` at `mergeSyncedList`; its unknown value type produced eight `{}`-array assignment diagnostics at the three sync call sites.
- Affected symbols: `mergeSyncedList`, `syncLocalPlayerUpdates`, `syncDesktopApiUpdates`, and `syncPlayerUpdates`.
- Root cause: the map callback is inferred as an array rather than a `[string, T]` tuple. Eight assignment errors are duplicates of that lost value type.
- Correction: moved the pure helper to `src/lib/syncedList.ts`, typed its entries as `[string, T]`, its map as `Map<string, T>`, and its return as `T[]`, without an assertion or suppression.
- Characterization: 6 focused tests preserve id/name/playerName key precedence, local replacement and ordering, duplicate behavior, empty keys, and remote append ordering.
- Result: all 9 assigned diagnostics are gone with no new diagnostic; runtime merge behavior and all call sites remain unchanged.
- Status: complete after focused and full verification.

### TYPE-006 — Invalid map/filter narrowing

- Classification: `REAL_TYPE_ERROR`.
- Resolved diagnostics: paired `TS2322`/`TS2677` failures in `getBalancePlans`, `parseGroupMeMessages`, and `todayPlayerActivity`.
- Affected symbols: those three result-building pipelines.
- Root cause: each map returned a concrete object or `null`, but the declared filter predicate target was wider or differently optional than the inferred object.
- Correction: moved the pure builders to `src/lib/resultBuilders.ts`, typed each mapper as its exact result object or `null`, and removed only `null` with one exact reusable guard.
- Characterization: 9 focused tests preserve empty/rejected behavior, plan and row ordering, balance candidate ranking/projections, GroupMe alias/status/name fallbacks, today timestamp/session rules, and optional output fields.
- Result: all 6 assigned diagnostics are gone with no new diagnostic; filtering criteria, constructed values, optional fields, and collection ordering are unchanged.
- Status: complete after focused and full verification.

### TYPE-007 — Renderer callback contract erosion

- Classification: `REAL_TYPE_ERROR`.
- Remaining diagnostics: 44 `TS2322`, `TS2339`, `TS2345`, and `TS2769` errors across waitlist updates, session/table transitions, profile merging, and rendering callbacks. `TYPE-007A` removed the profile-grouping `TS2322`/`TS2740` pair, `TYPE-007I` removed the table-event reporting `TS2345` pair, and `TYPE-007J` removed the three floor-rendering `TS2345` diagnostics.
- Remaining affected symbols include `updateInterest`, `updateInterestTimestamp`, `updatePlayerSession`, `movePlayerToTable`, `markPlayerLeft`, `markPlayerSessionLeft`, `addSession`, `addPlannedSession`, `createBalancedTable`, `updateSession`, `recordTableEvent`, `deleteProfile`, `mergeDuplicateProfiles`, `addProfileToClub`, `removeProfileFromClub`, and several render lists.
- Root cause: hand-written structural callback parameter annotations make optional domain fields required or discard fields later preserved with object spread. React typings restore contextual function checking and expose the mismatch; several state literals also widen status strings.
- Confidence: high; pre-existing but mostly previously masked. Runtime may be correct where spread preserves fields, but state transitions can currently construct incomplete or widened objects.
- Recommended correction: repair one behavior boundary at a time using canonical domain types and characterization tests; do not bulk-delete annotations without checking behavior.
- Risk/tests: high because waitlist, table, persistence, and reporting flows are involved.
- Autonomous correction: no as one broad repair; execute bounded subgroups under the task's stop conditions.
- Completed subgroups: `TYPE-007A` characterized duplicate grouping before restoring canonical `PlayerProfile`; `TYPE-007I` characterized Summary/CSV reason projection before restoring canonical `TableEvent` mapper inputs. Their existing text, ordering, fallback, filtering, object-preservation, rendering, and consumption behavior remains unchanged.

### TYPE-008 — Profile import normalization

- Classification: `REAL_TYPE_ERROR`.
- Representative diagnostics: JSON `preferredGameIds` remains `unknown[]`, and a text-line callback declares a non-string structural type.
- Affected symbol: `importProfiles`.
- Root cause: untrusted JSON/CSV-like text is shaped inline without a validated boundary that proves a complete `PlayerProfile`.
- Confidence: high; pre-existing, with one previously masked diagnostic. Runtime may accept malformed values.
- Recommended correction: centralize parsing/normalization from `unknown`, validate string arrays and required defaults, and preserve existing accepted formats.
- Risk/tests: medium/high; fixtures for JSON, delimited text, malformed data, aliases, and empty fields.
- Autonomous correction: no without import compatibility fixtures.

### TYPE-009 — Existing-account restore shape

- Classification: `REAL_TYPE_ERROR`.
- Representative diagnostics: the preload bridge may return `null`, and shallow `Partial<AppState>` permits incomplete nested settings that `normalizeState` cannot accept as written.
- Affected symbol: `loadExistingAccountState` and the `tableManagerDesktop.loadStateForAccount` declaration.
- Root cause: nullability and persisted deep-partial semantics disagree across renderer/preload and local-storage fallbacks.
- Confidence: high; pre-existing. Runtime may fail or silently default older account records.
- Recommended correction: characterize bridge/local records and define an explicit persisted input schema instead of shallow `Partial<AppState>`.
- Risk/tests: high; legacy/current account fixtures, null/no-record behavior, normalization, and preload contract tests.
- Autonomous correction: no; persisted-data architecture review is required.

### TYPE-010 — GroupMe candidate state

- Classification: `REAL_TYPE_ERROR`.
- Representative diagnostics: setter callbacks annotated as broad arrays return partial candidates, and the render callback treats required `timestamp` as optional.
- Affected GroupMe edit and accept controls around `setGroupMeCandidates` and `acceptGroupMeCandidate`.
- Root cause: local structural annotations override the `GroupMeCandidate[]` state contract.
- Confidence: high; previously masked. Runtime spread likely preserves fields, but the optional timestamp assumption conflicts with the accepted object contract.
- Recommended correction: use contextual setter/item types and decide whether parsed candidates always own a timestamp.
- Risk/tests: medium; scan, edit, accept, reject, and timestamp fixtures.
- Autonomous correction: no until the timestamp invariant is confirmed.

### TYPE-011 — Web Crypto buffer source

- Classification: `PLATFORM_TYPE_CONFLICT`.
- Representative diagnostic: `ArrayBufferLike` from signature conversion is not assignable to DOM `BufferSource` because it may be a `SharedArrayBuffer`.
- Affected symbol: `verifyPilotSignature`/`derToRawP256Signature`.
- Root cause: the helper does not prove that cryptographic input owns an `ArrayBuffer` compatible with Web Crypto.
- Confidence: high; pre-existing. Runtime is probably using an owned buffer, but the security boundary is unproven.
- Recommended correction: construct/return an owned compatible buffer without type assertions.
- Risk/tests: high; valid, invalid, malformed, wrong-key, and DER/raw signature tests in a browser-compatible environment.
- Autonomous correction: no without security characterization.

### TYPE-012 — Root test types

- Classification: `TEST_TYPE_ERROR`.
- Resolved diagnostics: undeclared `IS_REACT_ACT_ENVIRONMENT` and a heterogeneous frequency-profile fixture incompatible with `Record<string, number>`.
- Affected files: `PokerTable.test.tsx` and `appCore.test.ts`.
- Root cause: one missing test-environment global declaration and one over-narrow inferred fixture union.
- Correction: declared the act-environment flag as an exact boolean test global and derived the fixture type from the public helper parameter contract.
- Result: both assigned diagnostics are gone with no new diagnostic; runtime behavior and production contracts remain unchanged.
- Status: complete after focused and full verification.

### TYPE-013 — Legacy settings migration cast

- Classification: `STALE_OR_DEAD_CODE`.
- Representative diagnostic: `normalizeState` converts the entire settings object to `Record<string, "Time" | "Drop">` to read a legacy property.
- Affected symbol: `normalizeState`.
- Root cause: the historical persisted shape has no explicit input type.
- Confidence: high on the type cause, medium on retention intent; pre-existing. Runtime migration may still be required by deployed installations.
- Recommended correction: establish legacy fixtures and a narrow compatibility input, or remove the branch only after retention review.
- Risk/tests: medium/high; old/current saved-state normalization fixtures.
- Autonomous correction: no; human retention decision required.

### TYPE-014 — Unreachable seated form branch

- Classification: `STALE_OR_DEAD_CODE`.
- Representative diagnostic: `addInterest` compares `form.status` to `Seated` even though that form's status union excludes `Seated`.
- Affected symbol: `addInterest`.
- Root cause: either the branch is stale or the form contract no longer represents an intended direct-seating workflow.
- Confidence: high that it is unreachable, medium on product intent; previously masked. Runtime currently never sets `seatedAt` through this branch.
- Recommended correction: remove the branch only if direct seating is not intended, otherwise update the workflow and tests explicitly.
- Risk/tests: medium; add-interest/check-in/direct-seating behavior tests.
- Autonomous correction: no; human product-flow review required.

## Recommended repair order

1. Completed: `TYPE-001` aligned the renderer runtime/library contract.
2. `TYPE-002`: canonicalize the shared Player snapshot contract.
3. `TYPE-003` and `TYPE-004`: characterize sync and membership boundaries.
4. Completed: `TYPE-005` restored synchronized-list tuple inference and `TYPE-006` repaired exact map/filter result narrowing.
5. In progress by bounded child: `TYPE-007A` and `TYPE-007I` are complete; the umbrella retains 47 diagnostics across its other eight characterized or review-required batches and is not complete.
6. `TYPE-008`, `TYPE-009`, and `TYPE-010`: repair import, persistence, and GroupMe boundaries independently when their dependencies are complete.
7. `TYPE-011`: repair Web Crypto only with security fixtures.
8. Completed: `TYPE-012` corrected the two root test-only contracts.
9. `TYPE-013` and `TYPE-014`: obtain human decisions on legacy/dead behavior.
10. Future compiler-boundary work is split across `TYPE-015` through `TYPE-022` and must not be implemented as one task.

The executable queue is `docs/agent/TASKS.yaml`; detailed specifications are under `docs/agent/tasks/TYPE-001.md` through `TYPE-022.md`. This is a temporary TypeScript-remediation and compiler-boundary queue, not the broader product refactor plan.

## Verification record

The first and final post-install `npm run typecheck` runs both exited with TypeScript code 2 and produced exactly 94 diagnostics in 6 files. The stable count confirms that documentation and task creation introduced no compiler change.

Final individual results:

- FAIL: `npm run typecheck` — 94 diagnostics in 6 files; TypeScript exit code 2.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 17 files and 81 tests passed, zero failed/skipped, in 3.44 seconds; the existing Node experimental SQLite warning remained.
- PASS: `npm run build` — 1,910 modules transformed and built in 14.99 seconds; the existing ExcelJS `eval` and large-chunk warnings remained.

`npm run verify` then ran all four gates, exited 1 after 31.3 seconds, and accurately summarized only the root TypeScript failure. Its nested Player typecheck, 17/81 tests, and 1,910-module renderer build all passed. Repository verification is therefore a documented partial failure, not a green gate.

## TYPE-001 completion update — 2026-08-05

The human approved the narrow renderer-library correction. Root `tsconfig.json` now declares `lib: ["DOM", "DOM.Iterable", "ES2022"]` while retaining `target: ES2020`, the existing include, strictness, ambient types, module resolution, `noEmit`, and no project references.

The first post-change root typecheck produced exactly 88 diagnostics in the same 6 files:

- all 6 former `TS2550` diagnostics disappeared;
- `src/main.tsx` decreased from 79 to 77 diagnostics;
- `src/lib/playerSync.test.ts` decreased from 6 to 2 diagnostics;
- every other error-code and path count stayed unchanged;
- no new diagnostic appeared.

All remaining 88 diagnostics map to `TYPE-002` through `TYPE-014`. `TYPE-005`, `TYPE-006`, and `TYPE-012` are now ready because `TYPE-001` was their only dependency. No other downstream task became ready.

Future boundary work is represented separately by `TYPE-015` through `TYPE-022`: renderer/test separation, Electron, Node/Vite tooling, API, download site, e2e, Player-root scope, and renderer Node-global restriction. Project references remain deferred.

Final implementation verification:

- EXPECTED FAILURE: `npm run typecheck` — exactly 88 diagnostics in 6 files; TypeScript exit code 2; zero `TS2550`; no new diagnostics.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 17 files and 81 tests passed, zero failed/skipped, in 3.50 seconds; the existing Node experimental SQLite warning remained.
- PASS: `npm run build` — 1,910 modules transformed and built in 17.57 seconds; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 88 diagnostics, while the nested Player typecheck, 17/81 tests, and 1,910-module build passed. The nested test and build durations were 3.50 and 18.78 seconds.

See `docs/agent/TYPE-001_BOUNDARY_DECISION.md` for the runtime/compiler map and approved resolution.

## TYPE-005 completion update — 2026-08-06

The renderer's pure synchronized-list merge now uses explicit `[string, T]` entries, `Map<string, T>`, and a `T[]` result. The helper moved to `src/lib/syncedList.ts` so focused tests can import it without loading the application entrypoint. No public API, persisted or Firebase shape, sync scheduling, transport, conflict rule, key precedence, ordering, or duplicate behavior changed.

The first post-change root typecheck produced exactly 79 diagnostics in the same 6 affected files:

- the assigned `TS2769` formerly at `src/main.tsx:1181` disappeared;
- the 8 assigned `TS2322` diagnostics formerly at `src/main.tsx:3041`, `3042`, `3082`, `3083`, `3128`, `3129`, `3130`, and `3131` disappeared;
- `TS2322` decreased from 29 to 21, `TS2769` decreased from 6 to 5, and every other diagnostic-code count stayed unchanged;
- `src/main.tsx` decreased from 77 to 68 diagnostics, while every other affected-path count stayed unchanged; and
- neither `src/lib/syncedList.ts` nor its focused test introduced a diagnostic.

Focused characterization covers id/name/playerName key selection, replacement, local and remote ordering, duplicate behavior, and missing/empty keys. No conflicting expectation was found across the behavior used by the three sync sources.

Final implementation verification:

- PASS: focused Vitest run — 1 file and 6 tests passed.
- EXPECTED FAILURE: `npm run typecheck` — exactly 79 diagnostics in 6 files; all 9 assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 18 files and 87 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,911 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 79 diagnostics, while Player TypeScript, 18/87 tests, and the 1,911-module build passed.

`TYPE-005` is complete. `TYPE-007` remains pending because `TYPE-006` is not complete, so no downstream task became newly ready.

## TYPE-006 completion update — 2026-08-06

The renderer's three pure result builders now type their map callbacks as the exact constructed result or `null` and narrow with one exact non-null guard. They moved to `src/lib/resultBuilders.ts` so focused tests can import them without loading the application entrypoint. Existing balance-domain callbacks, GroupMe ID/timestamp providers, dashboard date/membership helpers, filtering decisions, output fields, and collection ordering remain unchanged.

The first post-change root typecheck produced exactly 73 diagnostics in the same 6 affected files:

- the assigned `TS2322`/`TS2677` pairs formerly at `src/main.tsx:1861`/`1927`, `2354`/`2378`, and `2745`/`2764` disappeared;
- `TS2322` decreased from 21 to 18, `TS2677` decreased from 3 to 0, and every other diagnostic-code count stayed unchanged;
- `src/main.tsx` decreased from 68 to 62 diagnostics, while every other affected-path count stayed unchanged; and
- neither `src/lib/resultBuilders.ts` nor its focused test introduced a diagnostic.

Focused characterization covers empty and rejected inputs, accepted result ordering, balance candidate ranking and projections, GroupMe matching/status/name fallbacks, today timestamp and session behavior, and optional result fields. No declared result/runtime shape conflict was found.

Final implementation verification:

- PASS: focused Vitest run — 1 file and 9 tests passed.
- EXPECTED FAILURE: `npm run typecheck` — exactly 73 diagnostics in 6 files; all 6 assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 19 files and 96 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 73 diagnostics, while Player TypeScript, 19/96 tests, and the 1,912-module build passed.

`TYPE-006` is complete. With `TYPE-005` and `TYPE-006` both complete, `TYPE-007` is newly ready; it was not started.

## TYPE-012 completion update — 2026-08-06

The root tests now state their existing contracts precisely. `PokerTable.test.tsx` declares React's `IS_REACT_ACT_ENVIRONMENT` flag as a boolean test global, and `appCore.test.ts` derives its game-frequency fixture element type from the public helper parameter. The production helper remains generic, no runtime shim or production export was added, and test behavior is unchanged.

The first post-change root typecheck produced exactly 71 diagnostics in 4 affected files:

- the assigned `TS7017` formerly at `src/components/PokerTable.test.tsx:9:12` disappeared;
- the assigned `TS2345` formerly at `src/lib/appCore.test.ts:138:51` disappeared;
- `TS7017` decreased from 1 to 0, `TS2345` decreased from 36 to 35, and every other diagnostic-code count stayed unchanged;
- neither affected test path retains a diagnostic, while every unaffected path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS: focused Vitest run — 2 files and 16 tests passed.
- EXPECTED FAILURE: `npm run typecheck` — exactly 71 diagnostics in 4 files; both assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 19 files and 96 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 71 diagnostics, while Player TypeScript, 19/96 tests, and the 1,912-module build passed.

`TYPE-012` is complete. `TYPE-015` remains planned because `TYPE-021` is incomplete, so no downstream task became newly ready; no additional remediation task was started.

## TYPE-007A completion update — 2026-08-06

The duplicate-profile computation now consumes canonical `PlayerProfile` values instead of locally redefining a partial profile fragment. A focused jsdom test was added and passed before production changed; it loads only local fixture state, disables Firebase behavior, stubs network access, and observes the existing renderer computation and output. The test-only checkpoint is `e4fbb7a`.

Characterization confirms whitespace/case normalization through `trim().toLowerCase()`, singleton exclusion, a duplicate group with more than two profiles, more than two duplicate groups, source order within groups, first-seen group order, complete required/optional fields, and rendered order. The implementation still creates new group arrays containing the same state profile object references and passes those complete groups to the existing merge consumer.

The first post-change root typecheck produced exactly 69 diagnostics in the same 4 files:

- the assigned `TS2322` formerly at `src/main.tsx:2631:24` disappeared;
- the assigned `TS2740` formerly at `src/main.tsx:2631:52` disappeared;
- `TS2322` decreased from 18 to 17, `TS2740` decreased from 1 to 0, and `src/main.tsx` decreased from 62 to 60;
- every other diagnostic-code and affected-path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS before and after implementation: `npx --no-install vitest run src/lib/profileGrouping.test.ts` — 1 file and 1 test.
- EXPECTED FAILURE: `npm run typecheck` — exactly 69 diagnostics in 4 files; both assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 20 files and 97 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 69 diagnostics, while Player TypeScript, 20/97 tests, and the 1,912-module build passed.

`TYPE-007A` is complete. `TYPE-007` remains pending on its other nine children and must not be marked complete. `TYPE-008` still depends on incomplete `TYPE-007H`; no downstream task became newly ready and no additional remediation task was started.

## TYPE-007I completion update — 2026-08-07

The CSV and Summary event-reason mappers now consume complete canonical `TableEvent` values rather than structural fragments that incorrectly required `reason`. The optional reason, required note, event-type filters, `Unspecified` fallback, truthy-note suffix, source and last-six ordering, labels, CSV escaping/schema, and source event values/references remain unchanged.

A focused jsdom test passed against unchanged production before the correction and was committed separately as `a030b1a`. It uses only local fixture state with Firebase disabled and network access stubbed, and covers present, missing, and empty reasons; notes; excluded event types; more than six matching events; exact CSV rows and Summary labels; canonical required fields; ordering; and non-mutation.

The first post-change root typecheck produced exactly 67 diagnostics in the same 4 files:

- the assigned `TS2345` formerly at `src/main.tsx:5594:14` disappeared;
- the assigned `TS2345` formerly at `src/main.tsx:8468:151` disappeared;
- `TS2345` decreased from 35 to 33 and `src/main.tsx` decreased from 60 to 58;
- every other diagnostic-code and affected-path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS before and after implementation: `npx --no-install vitest run src/lib/tableEventReporting.test.ts` — 1 file and 2 tests.
- EXPECTED FAILURE: `npm run typecheck` — exactly 67 diagnostics in 4 files; both assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 21 files and 99 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 67 diagnostics, while Player TypeScript, 21/99 tests, and the 1,912-module build passed.

`TYPE-007I` is complete. `TYPE-007` remains pending on eight incomplete children, including `TYPE-007F` in `review_required`, and must not be marked complete. No task became newly ready and no additional remediation task was started.

## TYPE-007J completion update — 2026-08-07

The selected forming-game mapper now consumes canonical `GameConfig` values, and the active waitlist mapper consumes canonical `Interest` values. Required game caps and viability thresholds, optional interest edit/arrival fields, all expressions, selected-game filtering, source ordering, active-status filtering, the eight-item cap, unknown-game fallback, timestamp formatting, labels, and actions remain unchanged.

A focused jsdom characterization passed against unchanged production before the correction and was committed separately as `961ccc8`. It uses local fixture state with Firebase disabled and network access stubbed. It covers complete games, ready/likely demand and viability output, forming and non-forming actions, interests with and without `manualEdits`/`arrivedAt`, edited markers, unknown games, active/inactive statuses, source order, the eight-item cap, empty state, and source value/reference non-mutation.

The first post-change root typecheck produced exactly 64 diagnostics in the same 4 files:

- the assigned `TS2345` diagnostics formerly at `src/main.tsx:9697:40`, `src/main.tsx:9698:58`, and `src/main.tsx:9802:22` disappeared;
- `TS2345` decreased from 33 to 30 and `src/main.tsx` decreased from 58 to 55;
- every other diagnostic-code and affected-path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS before and after implementation: `npm test -- --run src/components/FloorCollectionCallbacks.test.tsx` — 1 file and 1 test.
- EXPECTED FAILURE: `npm run typecheck` — exactly 64 diagnostics in 4 files; all three assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 22 files and 100 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 64 diagnostics, while Player TypeScript, 22/100 tests, and the 1,912-module renderer build passed.

`TYPE-007J` is complete. `TYPE-007` remains pending on seven incomplete children, including `TYPE-007F` in `review_required`, and must not be marked complete. `TYPE-008` still depends on incomplete `TYPE-007H`, `TYPE-010` still depends on the umbrella, no task became newly ready, and no additional remediation task was started.
