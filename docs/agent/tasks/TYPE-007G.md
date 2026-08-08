# TYPE-007G: Preserve table lifecycle and event transitions

Status: `complete`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 8 diagnostics in table/session updates, timestamp corrections, and recorded table events without changing lifecycle semantics.

## Root cause

Three session mappers and one player-session mapper declare record fragments and require optional `endedAt`, `manualEdits`, or `leftAt`. Collection return types then contain incomplete records instead of `GameSession[]`/`PlayerSession[]`.

## Resolved diagnostics

- `src/main.tsx:4522:7` — `TS2322`
- `src/main.tsx:4522:36` — `TS2345`
- `src/main.tsx:4554:7` — `TS2322`
- `src/main.tsx:4554:36` — `TS2345`
- `src/main.tsx:4564:7` — `TS2322`
- `src/main.tsx:4564:36` — `TS2345`
- `src/main.tsx:4576:7` — `TS2322`
- `src/main.tsx:4578:38` — `TS2345`

These are the same eight originally assigned diagnostics after the completed `TYPE-007D` edits shifted their line numbers by three.

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

## Resolution

The focused `src/lib/tableLifecycle.test.ts` suite passed against unchanged production before implementation. Its 10 cases characterize complete session patching, absent/present `endedAt`, absent/present `manualEdits`, timestamp correction and clearing, Started/Failed-to-Start/Merged/Closed/Broke events, player/dealer closure boundaries, collection order, prior-state immutability, correction and usage logs, and local persistence.

The three session mapper annotations now consume canonical `GameSession` values, and the closing player-session mapper consumes canonical `PlayerSession` values. No expression, patch, status transition, timestamp rule, event field, player/dealer propagation rule, audit/usage entry, persistence argument, or ordering changed.

## Verification result

- PASS before and after implementation: `npx --no-install vitest run src/lib/tableLifecycle.test.ts` — 1 file and 10 tests.
- EXPECTED FAILURE: `npm run typecheck` — exactly 39 diagnostics in 4 files, down from 47; all eight assigned diagnostics are absent and no new diagnostic appeared.
- PASS: `npm run player:typecheck`.
- PASS: `npm test` — 26 files and 130 tests.
- PASS: `npm run build` — 1,912 modules transformed.
- EXPECTED PARTIAL FAILURE: `npm run verify` — root TypeScript alone failed at the 39-diagnostic baseline; Player TypeScript, all tests, and the renderer build passed.

`TYPE-007G` is complete. The `TYPE-007` umbrella remains pending on `TYPE-007E`, `TYPE-007F`, and `TYPE-007H`; no downstream task became newly ready.
