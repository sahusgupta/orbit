# TYPE-007D: Preserve player records across table moves and departures

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 6 diagnostics across `movePlayerToTable`, `markPlayerLeft`, and `markPlayerSessionLeft` without changing seat, waitlist, notification, ledger, or profile-hour behavior.

## Root cause

Move/leave callbacks require optional fields (`manualEdits` or `leftAt`) and declare only record fragments. Two derived state literals consequently lose `AppState` compatibility, and a removal status literal widens to `string` before notification helpers consume it.

## Exact owned diagnostics

- `src/main.tsx:4261:48` — `TS2345`
- `src/main.tsx:4280:55` — `TS2345`
- `src/main.tsx:4299:7` — `TS2769`
- `src/main.tsx:4312:66` — `TS2345`
- `src/main.tsx:4314:13` — `TS2345`
- `src/main.tsx:4358:81` — `TS2345`

## Files and symbols

- `src/main.tsx`: `movePlayerToTable`, `markPlayerLeft`, `markPlayerSessionLeft`, `syncSessionSeatCount`, `withGameFrequencyInAppNotifications`
- Existing partial evidence: `src/lib/seatNormalization.test.ts`, `src/lib/nightClose.test.ts`, `tests/e2e/management-core-smoke.mjs`
- Focused characterization: `src/lib/playerTableTransitions.test.ts`

## Runtime behavior that must be preserved

Reject same-table/no-seat moves; choose the requested seat when available then the first open seat; mark table/seat manual edits; recalculate both table counts; append the same move event; close the matching interest/session on departure; preserve cash-out ledger order and values; add played hours to the matched profile; and emit the same seat-opened notifications.

## In scope

Characterize and type the three complete state transitions.

## Out of scope

Seat-allocation redesign, cash-out rules, identity migration, notification targeting changes, or table schema changes.

## Prohibited changes

Do not change matching precedence, seat selection, status strings, timestamps, ledger ordering, profile-hour arithmetic, or notification recipients.

## Characterization tests required before implementation

Cover successful/no-op/full-target moves, optional `manualEdits`, table counts and event text; open-session lookup with/without `leftAt`; name/game matching; profile-ID and name fallback on session departure; cash-out zero/nonzero; hours; and notification inputs.

## Acceptance criteria

All 6 owned diagnostics disappear, each transition returns a complete `AppState`, and characterized persisted values and ordering remain unchanged.

## Verification commands

`npx --no-install vitest run src/lib/playerTableTransitions.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

High. These transitions affect live seating, financial ledger entries, profile totals, and player notifications.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Safe only after pure local fixtures cover all state mutations and failure paths.

## Human review

Not required for a behavior-preserving correction; required if identity or financial behavior must change.

## Stop conditions

Stop if existing code can close the wrong historical session, update multiple profiles, or requires a new identity/financial decision.
