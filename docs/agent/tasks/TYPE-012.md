# TYPE-012: Correct root test-only type contracts

Status: `complete`

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

## Implementation

- Declared `IS_REACT_ACT_ENVIRONMENT` as an exact boolean test-environment global inside `PokerTable.test.tsx`, leaving the existing runtime assignment unchanged.
- Derived the game-frequency fixture element type from the public helper parameter with `Parameters<typeof getProfilesWithGameInTopTwoByFrequency>[0][number]` and annotated the fixture array.
- Changed no production source, export, runtime behavior, compiler setting, dependency, test assertion, or test configuration.

## Completion verification

- Focused test: `npx --no-install vitest run src/components/PokerTable.test.tsx src/lib/appCore.test.ts` passed 2 files and 16 tests.
- Root TypeScript: expected failure with exactly 71 diagnostics in 4 affected files, down from 73 diagnostics in 6 files. `TS2345` decreased from 36 to 35 and `TS7017` decreased from 1 to 0; every other diagnostic-code count and unaffected path count remained unchanged.
- Both assigned diagnostics disappeared: `src/components/PokerTable.test.tsx:9:12` (`TS7017`) and `src/lib/appCore.test.ts:138:51` (`TS2345`). Neither affected test file has a remaining root diagnostic.
- Player TypeScript passed with no diagnostics.
- Unit tests passed: 19 files and 96 tests, zero failed or skipped. The existing experimental SQLite warning remained.
- Renderer build passed with 1,912 modules transformed. The existing ExcelJS `eval` and large-chunk warnings remained.
- `npm run verify` exited 1 after running all four gates; root TypeScript alone failed with the expected 71 diagnostics, while Player TypeScript, 19/96 tests, and the 1,912-module build passed.

No runtime global shim, production type or interface change, assertion, diagnostic suppression, compiler exclusion, or test weakening was introduced. `TYPE-015` remains planned because its other dependency, `TYPE-021`, is incomplete; no downstream task became newly ready.
