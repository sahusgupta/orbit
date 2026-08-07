# TYPE-014: Decide whether direct seating belongs in add-interest

## Objective

Resolve the unreachable `Seated` comparison in `addInterest` according to reviewed product intent.

## Evidence

`form.status` excludes `Seated`, yet new-interest construction conditionally sets `seatedAt` when the form status equals `Seated`. TypeScript reports the comparison has no overlap.

## In scope

- Characterize add-interest/check-in/direct-seat workflows.
- Remove the stale branch or explicitly add a reviewed direct-seating path with required session/table behavior.

## Out of scope

Waitlist redesign, general seating refactor, table-state redesign, or unrelated status cleanup.

## Allowed areas

`addInterest`, its form/status type only if product intent requires it, and focused workflow tests.

## Prohibited changes

Do not widen the form status merely to silence TypeScript, create a seated interest without required session/table invariants, or change other transitions.

## Acceptance criteria

- The assigned diagnostic disappears for a documented product reason.
- Add-interest and seating invariants have explicit tests.

## Required tests

Interested, Confirmed Coming, Arrived, closed statuses, and direct-seat behavior if retained.

## Verification commands

`npm run typecheck`, focused workflow tests, `npm test`, `npm run build`, `npm run verify`.

## Risks

Medium: seating state crosses waitlist and table/session records.

## Dependencies

None.

## Stop conditions

Stop if product owners must decide whether direct seating belongs in this form or if retaining it requires a broader state transition change.

## Resolution record — 2026-08-07

- The Quick Add selector intentionally includes `Seated`, and `addInterest` handles it first through `seatPlayerInState`, returning before ordinary interest construction.
- Eight unchanged-production cases cover Interested, Confirmed Coming, Arrived, all four closed statuses, and direct seating into a forming table.
- Direct seating creates/uses the profile, appends a player session, advances the table, and does not construct a seated interest; every reachable ordinary-interest branch owns `seatedAt: undefined`.
- Production retains that property/value and replaces only the unreachable comparison with `undefined`. No status, seating, session, persistence, timestamp, or output behavior changed.
