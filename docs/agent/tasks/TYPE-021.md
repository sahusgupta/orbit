# TYPE-021: Remove unintended Player modules from the root compiler scope

Status: `complete`

## Objective

Stop root unit tests from compiling Player implementation source under desktop compiler options while preserving cross-application protocol coverage.

## Current missing coverage

Root `tsc` follows two direct test imports into Player source, loading `player-app/src/domain/playerSync.ts`, `syncProtocol.ts`, and Player-local React declarations into the root program.

## Exact paths involved

- `src/lib/playerStatus.test.ts`
- `src/lib/orbitMobileSyncProtocol.test.ts`
- `player-app/src/domain/playerSync.ts`
- `player-app/src/domain/syncProtocol.ts`
- any approved package-neutral contract/fixture location created later

## Proposed compiler configuration

Keep Player source owned by `player-app/tsconfig.json`. Move the affected integration assertions to the Player project or consume a genuine shared package/public contract once one exists. Do not use exclusions that hide still-imported files, path aliases into build output, or project references as a shortcut.

## Expected diagnostics

No current diagnostic is caused by these two imported Player files, and no new diagnostic is expected. The success criterion is the root `--listFilesOnly` graph no longer containing Player implementation paths while equivalent tests still run.

## JavaScript checkJs

Not involved.

## Required tests and builds

The two protocol/status test groups in their approved owner, `npm run typecheck`, `npm run player:typecheck`, `npm test`, `npm run build`, and `npm run verify`.

## Security implications

Protocol-v2 revision/commit-marker behavior and membership/waitlist status must remain unchanged. Moving tests must not weaken coverage of player-safe publication contracts.

## Dependencies

Depends on `TYPE-002` so the canonical Player snapshot/public contract is decided before test ownership moves. This task should precede `TYPE-015`.

## Autonomous implementation

Not safe for autonomous implementation because it changes cross-package test ownership around a public synchronization contract.

## Completed implementation — 2026-08-07

The post-green refactor-safety review classified this boundary correction as required before renderer compiler separation. The two Player-domain suites moved unchanged into `player-app/src/domain/`, where `player-app/tsconfig.json` owns their implementation imports. Root Vitest still discovers and runs all nine cases.

The exact pre-move suites passed 2 files/9 tests. After the move, those suites, root TypeScript, and Player TypeScript passed; root `tsc --listFilesOnly` changed from two Player implementation files to zero without exclusions, aliases, generated output, or project references.
