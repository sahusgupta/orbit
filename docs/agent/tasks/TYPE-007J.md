# TYPE-007J: Preserve canonical domain items in floor render callbacks

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 3 read-only floor rendering diagnostics while preserving forming-game calculations and waitlist-card output.

## Root cause

The forming-game callback redefines required `GameConfig` thresholds as optional before passing the item to domain functions. The waitlist callback requires optional `Interest.manualEdits` and `arrivedAt` while declaring only a subset of the record.

## Exact owned diagnostics

- `src/main.tsx:9697:40` — `TS2345`
- `src/main.tsx:9698:58` — `TS2345`
- `src/main.tsx:9802:22` — `TS2345`

## Files and symbols

- `src/main.tsx`: floor `Forming Games` callback, `getDemand`, `getViabilityState`, floor `Waitlist` callback, `GameConfig`, `Interest`
- Existing partial browser evidence: `tests/e2e/management-core-smoke.mjs`
- Focused characterization: `src/components/FloorCollectionCallbacks.test.tsx` or an equivalent pure view-model test plus a narrow render assertion

## Runtime behavior that must be preserved

Pass complete games to demand/viability calculations; keep selected-game filtering, session lookup, candidate/start options, labels, and buttons unchanged; render active interests in current order, cap at eight, preserve unknown-game fallback, timestamp/minute text, conditional arrival row, edited markers, and empty state.

## In scope

Characterize these read-only projections and use canonical/contextual item contracts.

## Out of scope

Changing viability/demand rules, waitlist status sets, floor layout, sorting/capping, time formatting, or removal behavior.

## Prohibited changes

Do not make canonical required game thresholds optional, make optional interest fields required, alter filters/order, or use casts/`any`.

## Characterization tests required before implementation

Cover a complete game threshold fixture through demand/viability rendering; forming/no-forming sessions; interests with and without `arrivedAt`/`manualEdits`; unknown games; active versus inactive statuses; eight-item cap; and empty state.

## Acceptance criteria

All 3 owned diagnostics disappear and characterized floor text, ordering, visibility, and actions remain unchanged.

## Verification commands

Run the focused test path chosen above, then `npm run typecheck`, `npm test`, and `npm run build`.

## Risks

Low/medium because callbacks are read-only, but the floor is the primary operational view.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Safe only after focused local render/projection coverage exists; do not run the production-connected e2e harness as a substitute.

## Human review

Not required if render output and action wiring remain unchanged.

## Stop conditions

Stop if the render path needs a domain-rule change, a new game default, or runtime validation of malformed persisted records.
