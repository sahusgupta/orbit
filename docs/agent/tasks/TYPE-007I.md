# TYPE-007I: Preserve table-event report projections

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 2 report/export callback diagnostics without changing which table events appear or how reasons and notes are formatted.

## Root cause

The CSV and summary `map` callbacks require `TableEvent.reason`, although the canonical field is optional. Their local structural annotations override the contextual `TableEvent` contract.

## Exact owned diagnostics

- `src/main.tsx:5594:14` — `TS2345`
- `src/main.tsx:8468:151` — `TS2345`

## Files and symbols

- `src/main.tsx`: `TableEvent`, `exportCsv`, Summary `Event Reasons` render list
- Focused characterization: `src/lib/tableEventReporting.test.ts`

## Runtime behavior that must be preserved

Include only `Failed to Start` and `Broke`; preserve source order in CSV and last-six order in the summary; use `Unspecified` for a missing/empty reason; append ` - note` only for a truthy note; and preserve labels exactly.

## In scope

Characterize the shared projection/formatting and restore callbacks to the canonical `TableEvent` optionality contract.

## Out of scope

Changing report metrics, CSV schema, event reason taxonomy, date filtering, download behavior, or summary layout.

## Prohibited changes

Do not make `reason` required, fill persisted data, reorder events, broaden event types, or add casts/`any`.

## Characterization tests required before implementation

Cover missing/empty/present reason and note, excluded event types, source order, more than six matching events, exact CSV row values, and exact summary labels.

## Acceptance criteria

Both owned diagnostics disappear and the characterized report projections remain byte/text equivalent.

## Verification commands

`npx --no-install vitest run src/lib/tableEventReporting.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

Low/medium. The path is read-only, but report output is an operational/audit artifact.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Safe only after projection text/order tests pass against current behavior.

## Human review

Not required unless report wording is intentionally changing.

## Stop conditions

Stop if CSV and summary intentionally use different fallback rules or if the correction requires mutating stored events.
