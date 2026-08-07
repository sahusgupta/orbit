# TYPE-007B: Preserve waitlist entries through patch updates

Status: `ready`

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

Safe only after tests capture current patch and prompt behavior.

## Human review

Not required if characterization confirms the existing status/timestamp matrix.

## Stop conditions

Stop if status changes currently produce inconsistent timestamps, if a missing target has side effects, or if the fix requires changing the `Interest` shape.
