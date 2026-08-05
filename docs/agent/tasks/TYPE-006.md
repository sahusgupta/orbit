# TYPE-006: Repair map/filter result narrowing

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
