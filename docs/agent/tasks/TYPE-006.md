# TYPE-006: Repair map/filter result narrowing

Status: `complete`

## Objective

Resolve 6 paired collection-construction diagnostics without changing produced rows, plans, or candidates.

## Evidence

`getBalancePlans`, `parseGroupMeMessages`, and `todayPlayerActivity` each map to an object-or-null result and then use a type predicate whose target is not assignable to the mapper's exact object type.

## In scope

- Characterize successful, rejected, and empty inputs for all three pipelines.
- Type mapper results at construction or introduce an exact reusable non-null guard.

## Out of scope

Balancing rules, GroupMe parsing redesign, dashboard UX changes, or candidate/profile contract changes.

## Allowed areas

The three named pure/result-building pipelines and focused tests.

## Prohibited changes

Do not use truthiness assertions, broad casts, change filtering criteria, or alter displayed/persisted values.

## Acceptance criteria

- All 6 assigned diagnostics disappear.
- Output ordering and optional-field behavior match characterization fixtures.

## Required tests

Null/empty, accepted, rejected, and optional-field cases for each pipeline.

## Verification commands

`npm run typecheck`, `npm test`, `npm run build`, `npm run verify`.

## Risks

Low/medium; type predicates can accidentally broaden or narrow runtime result sets if rewritten carelessly.

## Dependencies

`TYPE-001` for the root compiler/library decision.

## Stop conditions

Stop if the declared result type and current runtime object shape encode different product behavior.

## Implementation

- Moved the three renderer-owned pure result builders to `src/lib/resultBuilders.ts` so their existing transformations can be characterized without loading the application entrypoint.
- Typed each mapper at construction as its exact result object or `null`, then narrowed only `null` through one exact reusable guard.
- Kept balance demand, running-session, and profile resolution callbacks plus GroupMe ID/timestamp and dashboard date/membership helpers supplied by `src/main.tsx`, preserving their existing runtime behavior.
- Changed only the three call sites needed to use the extracted builders; no public contract, persistence, Firebase, authentication, notification, or dependency changed.

## Characterized behavior

Focused tests confirm that:

- balance plans reject empty, under-demand, table-less, and candidate-less inputs while preserving game order, candidate confidence order, projections, next-step text, and an absent profile;
- GroupMe parsing rejects blank and unmatched lines without consuming output positions, while preserving accepted-line order, game alias matching, status classification, name fallback, confidence, generated IDs, and timestamps; and
- today-player activity rejects prior-day, invalid, and ended-session inputs while preserving timestamp fallbacks, status/time ordering, active-session deduplication, unknown game/table fallbacks, active-member evaluation, and optional row fields.

## Completion verification

- Focused test: `npx --no-install vitest run src/lib/resultBuilders.test.ts` passed 1 file and 9 tests.
- Root TypeScript: expected failure with exactly 73 diagnostics in the same 6 affected files, down from 79. `TS2322` decreased from 21 to 18 and `TS2677` decreased from 3 to 0; every other diagnostic code and affected-path count remained unchanged.
- All 6 assigned diagnostics disappeared: the `TS2322`/`TS2677` pairs formerly at `src/main.tsx:1861` and `1927`, `2354` and `2378`, and `2745` and `2764`.
- Player TypeScript passed with no diagnostics.
- Unit tests passed: 19 files and 96 tests, zero failed or skipped. The existing experimental SQLite warning remained.
- Renderer build passed with 1,912 modules transformed. The existing ExcelJS `eval` and large-chunk warnings remained.
- `npm run verify` exited 1 after running all four gates; root TypeScript alone failed with the expected 73 diagnostics, while Player TypeScript, 19/96 tests, and the 1,912-module build passed.

No filtering criterion, output ordering, optional-field behavior, public API, persisted shape, Firebase schema, authentication/authorization behavior, notification behavior, TypeScript setting, or dependency changed. No cast, assertion, suppression, or broad exclusion was added. With both `TYPE-005` and `TYPE-006` complete, `TYPE-007` is newly ready; it was not started.
