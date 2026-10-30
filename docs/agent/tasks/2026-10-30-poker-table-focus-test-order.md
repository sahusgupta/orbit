# PokerTable deferred focus test ordering

## Scope

Commit Escape's React update before waiting for the existing zero-delay focus-restoration timer in `src/components/PokerTable.test.tsx`. All assertions, the timer delay, cleanup, and production files remain unchanged. There are no assertion retries, polling, dependency changes, or runtime behavior changes.

## Evidence

- Main source `b6a5aaa45dafb52fb158fc16da960c5d442b426e`, CI run [40996240629](https://github.com/sahusgupta/orbit/actions/runs/40996240629), attempt 1: build job `123869918190`, step 16 (`Run npm run verify`), failed the case `leaves underlying player details open when Escape dismisses a separate topmost dialog`. The final focus assertion observed `document.body` instead of the original draft input. Other focus-ownership assertions were retained.
- `PokerTable.tsx`, its test, `OperationalDialog.tsx`, its test, and the root lockfile have identical Git blobs between desktop release source `96dfe42e5dad08e01f390eaf7482533ddaf1d156` and main `b6a5aaa45dafb52fb158fc16da960c5d442b426e`. That interval contains only the separate Web build-configuration fixes and their records.
- Before editing, five independent normal runs of `node node_modules/vitest/vitest.mjs run src/components/PokerTable.test.tsx --maxWorkers=1` passed all 12 tests each. The CI failure was not reproduced locally in those runs.
- The installed Radix focus scope schedules its unmount focus restoration and stack removal with `setTimeout(..., 0)`. The old test registers its timer inside an asynchronous `act` before that update's unmount cleanup is guaranteed to have committed. The focused `OperationalDialog` tests already dispatch Escape synchronously and drain deferred focus in a separate `act`.
- An ignored diagnostic fixture using the actual React, Radix, PokerTable, and OperationalDialog modules passed two ordering assertions: with the original sequence, the test's zero timer fired before the draft-focus call; with synchronous Escape followed by the same timer, the draft-focus call occurred first. The original sequence still had input focus by the end of `act` in that observation. This establishes the unsafe barrier ordering, not a deterministic local reproduction of the CI failure.
- Two initial diagnostic launches stopped during config loading (no tests executed); a fixture-generation attempt also stopped before writing inputs because of newline matching. The corrected isolated diagnostic passed. Normal verification configuration was not changed, and diagnostic artifacts remain ignored.
- Root reran the single failed CI job once against unchanged `b6a5aaa45dafb52fb158fc16da960c5d442b426e`. Attempt 2 succeeded: build job `123873957860` passed verification, release checks, native export/codegen, isolated rules, and all three browser smoke suites; the previously successful desktop-mutations job remained successful. The original failed attempt is preserved.

## Validation

Commands use a minimal runtime environment, UTC, the memory datastore, unreachable loopback API URLs, and disabled Firebase synchronization and embedded backend. No production endpoints, private keys, or desktop UI are used.

- After-change focused run: `node node_modules/vitest/vitest.mjs run src/components/PokerTable.test.tsx src/components/OperationalDialog.test.tsx --maxWorkers=1` passed both files and all 18 tests.
- Literal `npm run verify` through the previously reviewed isolated environment wrapper passed all 13 checks on 2026-10-30, 04:36:11-04:42:07 UTC: 322 Web, 85 internal-tool, and 2,635 shared tests passed (3,042 total; 16 existing skips). Source inputs and all four lockfiles remained unchanged during verification.
- Final diff and `git diff --check` passed. The only intended tracked changes are this record and the test's `act` boundary; production source, configuration, dependencies, assertions, timer values, and cleanup remain unchanged.

Local diagnostic evidence is retained under the session-owned ignored `out/reliability-live-20261029/poker-focus-diagnostic` folder in the evidence worktree. It is not part of the shipped change.
