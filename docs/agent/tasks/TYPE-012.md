# TYPE-012: Correct root test-only type contracts

## Objective

Resolve the 2 test-only diagnostics without excluding tests from the root project.

## Evidence

`PokerTable.test.tsx` writes `globalThis.IS_REACT_ACT_ENVIRONMENT` without a declaration. `appCore.test.ts` infers a heterogeneous fixture union incompatible with `GameFrequencyProfile[]`.

## In scope

- Add an exact test-environment global declaration.
- Give the fixture the truthful production-facing profile type.

## Out of scope

Production behavior changes, test removal/skipping, global runtime shims, or broad Vitest configuration changes.

## Allowed areas

The two cited tests and a narrowly scoped test declaration file if needed.

## Prohibited changes

Do not use `any`, suppress diagnostics, exclude test files, or weaken the production contract to fit a fixture.

## Acceptance criteria

- Both diagnostics disappear.
- The focused tests and full test suite pass unchanged semantically.

## Required tests

The affected PokerTable and appCore test files, then the full unit suite.

## Verification commands

`npm run typecheck`, focused Vitest files, `npm test`, `npm run build`, `npm run verify`.

## Risks

Low.

## Dependencies

`TYPE-001` should settle whether test uses of `Array.at` remain valid, though these two diagnostics are otherwise independent.

## Stop conditions

Stop if a declaration would leak into production globals or the fixture reveals a production contract defect.
