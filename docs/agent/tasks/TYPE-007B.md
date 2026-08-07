# TYPE-007B: Preserve waitlist entries through patch updates

Status: `complete`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 5 diagnostics in `updateInterest` while preserving waitlist patch, timestamp, demand-prompt, and manual-edit behavior.

## Root cause

The `map` callback requires optional `manualEdits` and retains only `id`, `timestamp`, and `manualEdits` in its declared input. The resulting collection is no longer `Interest[]`, so the changed item loses `status` and `gameId` and the next state is not an `AppState`.

## Exact owned diagnostics

- `src/main.tsx:3244:38` — `TS2345`
- `src/main.tsx:3261:7` — `TS2345`
- `src/main.tsx:3261:74` — `TS2339`
- `src/main.tsx:3262:30` — `TS2345`
- `src/main.tsx:3262:57` — `TS2339`

## Files and symbols

- `src/main.tsx`: `Interest`, `AppState`, `updateInterest`, `promptDemandAction`, `persist`
- Focused characterization: `src/lib/waitlistUpdates.test.ts`

## Runtime behavior that must be preserved

Patch only the target ID; preserve every unpatched field; set status-specific timestamps; refresh `timestamp` only for a status patch; merge manual-edit markers for every patch key; prompt demand only for an active changed interest; and retain ordering.

## In scope

Characterize the state transformation and make the mapper/result contract exactly `Interest`/`AppState` without changing the patch algorithm.

## Out of scope

Waitlist status redesign, direct seating (`TYPE-014`), sync ingestion, persistence transport, or UI changes.

## Prohibited changes

Do not make `manualEdits` required, drop fields, alter active/inactive status sets, add casts or suppressions, or change prompt timing.

## Characterization tests required before implementation

Cover non-status edits, every timestamp-producing status family, inactive status behavior, missing target ID, manual-edit accumulation, output order, and full-field preservation.

## Acceptance criteria

All 5 owned diagnostics disappear; the transformed state remains a complete `AppState`; characterized state and prompt decisions are unchanged.

## Verification commands

`npx --no-install vitest run src/lib/waitlistUpdates.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

Medium/high because waitlist status and timestamp changes are persisted and may be published to players.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Completed only after tests captured current patch, persistence, and prompt behavior against unchanged production.

## Human review

Not required if characterization confirms the existing status/timestamp matrix.

## Stop conditions

Stop if status changes currently produce inconsistent timestamps, if a missing target has side effects, or if the fix requires changing the `Interest` shape.

## Implementation

- Added `src/lib/waitlistUpdates.test.ts`, which loads only local fixture state, disables renderer Firebase sync, stubs network access, and invokes the existing rendered `updateInterest` closure without adding or moving a production seam.
- Replaced only the mapper callback's partial structural annotation with canonical `Interest`.
- Preserved the patch spreads, status timestamp matrix, timestamp refresh condition, manual-edit reduction, `changedInterest` lookup, active-status check, demand prompt, persistence selection, usage metadata, and collection ordering.

## Characterized behavior

The focused fixture proves that only the matching interest is copied and patched; unpatched canonical fields, including `gameId`, remain intact; unrelated interest objects and source ordering remain unchanged; and the prior state is not mutated. Existing `manualEdits` accumulate every patch key, while an interest without `manualEdits` receives a new marker record.

Status patches continue to refresh `timestamp`. `Confirmed Coming`, `Arrived`, and `Seated` respectively set `confirmedAt`, `arrivedAt`, and `seatedAt`; `Declined`, `No-Show`, `Left Before Seated`, and `Removed` set `closedAt`; and `Interested` adds no status-specific timestamp. A non-status patch retains the prior `timestamp`.

An active changed interest still enters `promptDemandAction`; accepting `start` persists the prompt-produced table and event. An inactive changed interest skips the prompt and persists the direct patch state. A missing target produces no `changedInterest`, does not prompt, preserves every interest value/reference in order, and still follows the existing persistence/usage path.

## Completion verification

- Pre-change focused gate: `npx --no-install vitest run src/lib/waitlistUpdates.test.ts` passed 1 file and 6 tests against unchanged production source.
- Test-only checkpoint: `d60ef42` (`test: characterize waitlist interest patching`).
- Post-change focused gate: the same command passed 1 file and 6 tests.
- Root TypeScript: expected failure with exactly 59 diagnostics in 4 files, down from 64. `TS2345` decreased from 30 to 27, `TS2339` decreased from 5 to 3, and `src/main.tsx` decreased from 55 to 50; every other diagnostic-code and affected-path count remained unchanged.
- All five owned diagnostics disappeared: `src/main.tsx:3244:38` (`TS2345`), `3261:7` (`TS2345`), `3261:74` (`TS2339`), `3262:30` (`TS2345`), and `3262:57` (`TS2339`).
- Player TypeScript passed with no diagnostics.
- Unit tests passed: 23 files and 106 tests, zero failed or skipped. The existing experimental SQLite warning remained.
- Renderer build passed with 1,912 modules transformed. The existing ExcelJS `eval` and large-chunk warnings remained.
- `npm run verify` exited 1 after all four gates; root TypeScript alone retained the expected 59-diagnostic baseline, while Player TypeScript, 23/106 tests, and the 1,912-module build passed.

No runtime logic, `Interest` optionality, public or persisted shape, persistence transport, demand-action behavior, compiler setting, dependency, cast, assertion, `any`, or diagnostic suppression changed. `TYPE-007` remains pending on six unfinished children, including `TYPE-007F` in `review_required`; no task became newly ready.
