# TYPE-007G: Preserve table lifecycle and event transitions

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 8 diagnostics in table/session updates, timestamp corrections, and recorded table events without changing lifecycle semantics.

## Root cause

Three session mappers and one player-session mapper declare record fragments and require optional `endedAt`, `manualEdits`, or `leftAt`. Collection return types then contain incomplete records instead of `GameSession[]`/`PlayerSession[]`.

## Exact owned diagnostics

- `src/main.tsx:4519:7` — `TS2322`
- `src/main.tsx:4519:36` — `TS2345`
- `src/main.tsx:4551:7` — `TS2322`
- `src/main.tsx:4551:36` — `TS2345`
- `src/main.tsx:4561:7` — `TS2322`
- `src/main.tsx:4561:36` — `TS2345`
- `src/main.tsx:4573:7` — `TS2322`
- `src/main.tsx:4575:38` — `TS2345`

## Files and symbols

- `src/main.tsx`: `updateSession`, `updateSessionTimestamp`, `recordTableEvent`, `GameSession`, `PlayerSession`, `TableEvent`
- Focused characterization: `src/lib/tableLifecycle.test.ts`

## Runtime behavior that must be preserved

Patch only the selected session; set/clear `endedAt` exactly as today; accumulate manual-edit markers; emit Started/Failed-to-Start/Closed events only under current conditions; correct timestamps with the same audit entry; map event types to the same statuses; close active players and dealers for the same event types; and append the same table event in the same order.

## In scope

Characterize these lifecycle transforms and restore complete canonical collection contracts.

## Out of scope

New lifecycle states, reopening behavior, reason taxonomy, dealer workflow changes, historical migration, or UI redesign.

## Prohibited changes

Do not make optional timestamps required, alter event-to-status mapping, close additional records, change audit/event ordering, or use casts/`any`.

## Characterization tests required before implementation

Cover running/closed/other patches from Forming and Running, already-ended sessions, manual edits, timestamp correction/clearing, every `TableEventType`, active versus ended players/dealers, and complete-field preservation.

## Acceptance criteria

All 8 owned diagnostics disappear and all resulting session/player/event arrays retain complete domain records and characterized values.

## Verification commands

`npx --no-install vitest run src/lib/tableLifecycle.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

High because table closure affects active-player state, dealer assignments, reports, and persisted history.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Safe only after the complete event/state matrix is characterized.

## Human review

Not required for a behavior-preserving correction; required if current event mappings conflict.

## Stop conditions

Stop if event types have competing status meanings, if closing a table must perform financial reconciliation, or if existing records lack fields required by `GameSession`/`PlayerSession`.
