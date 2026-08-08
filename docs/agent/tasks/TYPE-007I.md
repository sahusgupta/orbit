# TYPE-007I: Preserve table-event report projections

Status: `complete`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 2 report/export callback diagnostics without changing which table events appear or how reasons and notes are formatted.

## Root cause

The CSV and summary `map` callbacks require `TableEvent.reason`, although the canonical field is optional. Their local structural annotations override the contextual `TableEvent` contract.

## Exact resolved diagnostics

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

## Completion record

Before production changed, `src/lib/tableEventReporting.test.ts` passed 1 file and 2 tests against the existing renderer. Local fixtures characterize present, missing, and empty reasons; truthy and empty notes; excluded event types; source-ordered CSV rows; the summary's last six matching events in source order; exact CSV escaping and labels; required canonical event fields; and preservation of source event values and object references. The test-only checkpoint is `a030b1a`.

The two report mappers now accept canonical `TableEvent` values. `reason` remains optional, `note` remains required, and the filter expressions, fallback text, note suffix, row/summary order, CSV encoding, labels, and source events are unchanged.

Verification on 2026-08-07:

- PASS before and after implementation: `npx --no-install vitest run src/lib/tableEventReporting.test.ts` — 1 file and 2 tests.
- EXPECTED FAILURE: `npm run typecheck` — 67 diagnostics in 4 files, down from 69; `TS2345` decreased from 35 to 33 and `src/main.tsx` from 60 to 58, with both resolved locations absent and every other code/path count unchanged.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 21 files and 99 tests.
- PASS: `npm run build` — 1,912 modules transformed; existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` — root TypeScript alone failed with the remaining 67 diagnostics; Player TypeScript, 21/99 tests, and the renderer build passed.

`TYPE-007I` is complete. The `TYPE-007` umbrella remains pending on eight incomplete children, including `TYPE-007F` in `review_required`; no task became newly ready.
