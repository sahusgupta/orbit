# Match authoritative header metadata to the committed state

This independent consistency change starts from `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-state-header-consistency`; it does not depend on the state-chunk batching PR. Scope is the [state writer](../../../apps/api/src/db/state.js), its [commit-boundary coverage](../../../apps/api/src/db/state.headerMetadata.test.js), and this record. No dependencies, authentication, public API, persisted field/collection shapes, indexes, discovery filtering, migration, or production service changes are included.

## Defect and narrow fix

`saveState` captured `venueName` from the incoming state before running its transaction precondition. The supported callback can return a validated same-account `nextState`, and the writer encodes that final state while retaining the old incoming name in the header. A same-account rename therefore commits disagreeing header/state names atomically. An existing in-place callback mutation has the same mismatch.

Transaction-time replacement states are used by [Player operations](../../../apps/api/src/routes/player.js) and [membership QR commits](../../../apps/api/src/membershipQrService.js). Existing architecture tests cover callback inputs, rejection, replacement payload and matching global receipt, but their replacement fixtures retain the same club name and do not compare header metadata to the committed payload.

The fix derives the existing `clubName || ''` value from `stateToCommit` after the optional transform validation/account-key guard and before any queued write. Header, compressed chunks, mutation receipt and outbox remain in the same transaction with the same field shapes and revision/idempotency behavior. Normal saves, result-only callbacks, rejected/invalid/cross-account transforms and duplicate retries retain their prior behavior. No additional reads or writes are introduced. This change does not repair pre-existing mismatched headers or make legacy header names safe for discovery filtering.

## Characterization and regression proof

Passing characterization ran against unchanged production source first: three files / 19 tests, comprising nine new commit-boundary cases plus existing state-architecture and transaction-order coverage. It checks the complete public result/state shape, header field keys, callback inputs/results, same-account replacement/global receipt/publication, invalid/cross-account rollback, rejected later transactions and duplicate replay without rerunning the callback.

The five new regression cases then failed against baseline, with the nine characterization cases still passing. Final replacement names of a new string, empty string, null and missing property produced the old incoming header name; an in-place callback name change did likewise. After moving the name derivation, all three focused files / 24 tests pass. The existing empty-name fallback is retained.

The first characterization attempt used different Vitest-import and CommonJS-require module caches for reset versus writer, so its store isolation failed. The harness now loads both real CommonJS modules through the same loader/cache; the original failed attempt is retained separately and is not product-defect evidence.

## Validation record

- Before source edits: `header-characterization-before.log` passed three files / 19 tests. `header-characterization-loader-mismatch.log` retains the initial harness failure. `header-regression-before.log` records the expected five failures / nine passes.
- After the two-line production change: `header-focused-after.log` passed three files / 24 tests. All store operations are in the real isolated memory adapter with synthetic fixtures; no native Firestore/provider connection is opened.
- API type checking initially rejected `import.meta` in this CommonJS-output test boundary (`header-api-typecheck.log`). Using the existing neighboring-test convention `createRequire(__filename)` fixed that harness-only diagnostic. API type checking then passed (`header-api-typecheck-final.log`), and the final focused run again passed three files / 24 tests (`header-focused-final.log`).
- CommonJS syntax and whitespace checks passed; all four local documentation links resolve.
- Full verification ran through the reviewed allowlist environment runner with unreachable loopback API URLs and synchronization disabled, finishing at 10:48:40 UTC on 2026-10-29. It passed 12 of 13 aggregate checks and retained exit code 1: 2,497 unit tests passed, 16 skipped, and only the three previously reproduced `.codex`-ancestor static-route failures failed. Root/Player/Web TypeScript, Player release contract/artwork, Web lint/focused tests/build, sales-map TypeScript/tests/build and desktop build passed (`header-full-verify.log`).
- All three source/test/document SHA-256 hashes matched their frozen inputs after the full run and before these results were appended (`header-frozen-inputs.json`, `header-freeze-result.json`). Root and independent peer reviews found no introduced issue in the production change, tests or scope.

All evidence/logs stay ignored under `out/reliability-20261029/`. No production records are read or changed, and no deployment is performed.
