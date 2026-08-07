# TYPE-007D1: Repair behavior-preserving player transition types

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

## Objective

After `TYPE-007D2` establishes and protects the approved departure identity behavior, resolve the remaining five diagnostics in `movePlayerToTable` and `markPlayerLeft` by using canonical `PlayerSession`, `Interest`, and `AppState` contracts without changing runtime behavior.

## Exact owned diagnostics

- `src/main.tsx:4261:48` - `TS2345`
- `src/main.tsx:4280:55` - `TS2345`
- `src/main.tsx:4299:7` - `TS2769`
- `src/main.tsx:4312:66` - `TS2345`
- `src/main.tsx:4314:13` - `TS2345`

## Files and symbols

- `src/main.tsx`: `movePlayerToTable`, `markPlayerLeft`, `syncSessionSeatCount`, `withGameFrequencyInAppNotifications`
- Focused characterization: `src/lib/playerTableTransitions.test.ts`

## Runtime behavior that must be preserved

- Reject same-table moves and missing/full targets.
- Prefer the requested available seat, then the first available seat.
- Mark table/seat manual edits, recalculate both table counts, append the same move event, and retain event and collection ordering.
- For `markPlayerLeft`, find the same first open exact-name/exact-game session, mark the requested interest removed, close that session when present, recalculate the table count, and emit the same seat-opened notifications.
- Preserve all unrelated records, references where practical, persistence arguments, and failure behavior.

## In scope

Canonical callback parameter annotations and complete `AppState` inference for the five owned diagnostics.

## Out of scope

Any further identity matching change, seat-allocation redesign, notification targeting change, cash-out rule, financial mutation, persisted shape, API contract, or sync behavior.

## Characterization required before implementation

Cover successful/no-op/full-target moves, optional `manualEdits`, table counts and event text, open-session lookup with and without `leftAt`, exact name/game matching, interest closure, notification inputs, stable ordering, and unrelated-record preservation.

## Acceptance criteria

All five owned diagnostics disappear; the focused tests prove the same observable move and early-departure behavior before and after; no new diagnostic appears; and no `TYPE-007D2` behavior is weakened.

## Verification commands

`npx --no-install vitest run src/lib/playerTableTransitions.test.ts`, `npm run typecheck`, `npm test`, and `npm run build`.

## Dependencies

Completed `TYPE-005`, `TYPE-006`, and `TYPE-007D2`.

## Autonomous implementation

Safe only after focused fixtures cover the affected state mutations and failure paths.

## Stop conditions

Stop if a typing repair would alter matching precedence, timestamps, seat selection, status values, ledger order, notification recipients, or the approved `TYPE-007D2` identity rule.
