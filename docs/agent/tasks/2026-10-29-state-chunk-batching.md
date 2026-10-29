# Bounded authoritative state-chunk reads

This focused reliability/performance change starts from reviewed main `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-state-chunk-batching`. It changes only the internal Firestore readers, authoritative chunk loader, same-boundary coverage, and this record. Public APIs, authentication, state/publication shapes, revision/idempotency checks, transaction writes, compression and decoding remain unchanged. No dependencies, indexes, provider settings, production data or deployment are changed.

## Baseline and selected scope

The [chunk loader](../../../apps/api/src/db/state.js) previously awaited one document read for each chunk. A current valid state can contain up to 20 chunks, so loading its revision used up to 20 sequential native reads; loading the complete state added the header and publication-status reads. The same loader reads previous state inside `saveState`, historical revisions, and explicit revisions. Its publication-status failure precedence and transaction read-before-write boundary must remain intact.

The installed locked `@google-cloud/firestore` 7.11.6 supports both `Firestore.getAll` and `Transaction.getAll`. Its `build/src/document-reader.js` restores request order after unordered wire responses; `build/src/transaction.js` rejects `getAll` after queued writes. These installed SDK sources were inspected before implementation. Native Firestore and transaction methods are fully mocked in the focused tests; no provider connection is opened.

The memory, Admin Firestore, and wrapped transaction [readers](../../../apps/api/src/db/connection.js) gain an optional internal `getDocuments(paths)` method. It preserves requested order, missing-document null slots, duplicates and existing memory cloning behavior. Empty batches perform no native read. The chunk loader requests groups of at most the existing 20-chunk maximum. A larger legacy header remains readable through bounded groups, and injected readers without the new method retain their exact serial path. A rejected native batch propagates directly without an individual-read retry. Publication status still completes before any chunk read.

When a native batch returns normally, missing-payload checks use the original earliest index/message, and the Buffer/gzip/JSON decoder is unchanged. A successful batch can fetch later chunks before an earlier missing or invalid payload is examined: at most 19 additional chunk paths in that batch. No next batch is fetched after that failure. This bounded failure-path read tradeoff is accepted explicitly for this candidate; normal complete loads request the same documents, and the change adds no writes. Provider retry/billing behavior is not inferred from the mocks.

Mixed faults have a qualified precedence: a later path's native RPC or snapshot-data extraction failure can reject the whole batch before an earlier missing slot reaches ordinal validation. A serial reader would instead stop at that earlier missing slot. Targeted tests prove both cases. The accepted contract is fail-closed, no partial state, and no silent fallback/double-read; identical mixed-fault error precedence is not claimed. Publication-status failure still precedes every chunk request exactly.

Batching also temporarily holds up to 20 returned document payloads together, up to 8 MB at the current written-payload limit, rather than one serial document payload at a time. Existing Buffer copies remain intact. No reduction in peak process memory is claimed; the measured gain is fewer read roundtrips while preserving complete-load document and write counts.

## Reproduction and measurements

Passing characterization ran against unchanged runtime source first: three files / 27 tests, including existing state architecture and Firestore transaction-order coverage. The two new native-RPC regressions then failed against baseline: a valid 20-chunk load and a previous-state transaction each made 20 single reads instead of one batch; the 17 characterization cases in that file still passed. Production code changed only after these results were recorded.

An ignored comparison harness executes the exact baseline and proposed connection/state modules against the same mocked native transport. Small synthetic gzip states are split into valid chunk arrays to isolate roundtrip overhead. Each read RPC has an artificial 10 ms delay; five samples are taken per scenario. This is a roundtrip model, not a production latency or payload-throughput benchmark. Requested-document counts are method evidence, not provider invoices.

| Scenario | Read RPCs before / after | Requested documents before / after | Writes before / after | Synthetic median ms before / after |
| --- | --- | --- | --- | --- |
| One-chunk revision | 1 / 1 | 1 / 1 | 0 / 0 | 11.9 / 17.8 |
| Five-chunk revision | 5 / 1 | 5 / 5 | 0 / 0 | 75.2 / 12.6 |
| Twenty-chunk revision | 20 / 1 | 20 / 20 | 0 / 0 | 307.7 / 19.6 |
| Legacy twenty-one-chunk revision | 21 / 2 | 21 / 21 | 0 / 0 | 336.1 / 40.9 |
| Full state with twenty chunks | 22 / 3 | 22 / 22 | 0 / 0 | 336.2 / 44.2 |
| Save with twenty previous-state chunks | 23 / 4 | 23 / 23 | 4 / 4 | 358.1 / 70.9 |
| First missing chunk out of twenty | 1 / 1 | 1 / 20 | 0 / 0 | 11.8 / 12.5 |

The one-chunk timing is noisier/slower on this shared Windows host despite unchanged request counts; no blanket latency improvement is claimed. Actual performance depends on provider/network latency, transfer size, decoding and contention. Full proof and the comparison helper are ignored under `out/reliability-20261029/state-chunk-rpc-comparison.json` and `measure-state-chunks.cjs`.

## Verification record

- Before changes: `chunk-characterization-before.log` passed three files / 27 tests. `chunk-rpc-regression-before.log` retained the expected two failures / 17 passes.
- After implementation: the expanded focused run passed three files / 41 tests. The [new coverage](../../../apps/api/src/db/state.chunkReads.test.js) covers empty/missing/duplicate reads, serial fallback, 20/21 chunk bounds, decoder failures, batch rejection without silent fallback, publication-status precedence, native transaction routing/read-before-write, and memory clone isolation. Log: `chunk-expanded-after.log`.
- Follow-up mixed-fault characterization passed three files / 43 tests, including both later RPC failure and later snapshot-data extraction failure after an earlier missing slot (`chunk-mixed-faults-after.log`). Runtime code was unchanged during this follow-up.
- API type checking passed (`npm run typecheck --prefix apps/api`, `chunk-api-typecheck-after.log`). Both changed production CommonJS files passed `node --check`; whitespace checks passed.
- The serial API-area run passed 523 tests across 51 files, with only the three known static-route failures in the remaining file (526 tests / 52 files total). Log: `chunk-api-area-after.log`. No route-serving code changed.
- Sensitive-path, independent-lockfile and module-graph checks passed. The graph retained 278 files, zero cycles/violations/missing imports, and all 18 packaged runtime files. All four local documentation links resolve.
- Full `npm run verify` behavior ran through the reviewed isolated environment runner, starting with all four changed source/test/document inputs frozen by SHA-256. It finished at 10:15:26 UTC on 2026-10-29 with 12 of 13 aggregate checks passing and exit code 1. Root/Player/Web TypeScript, Player release contract/artwork, Web lint/focused tests/production build, sales-map TypeScript/tests/build, and desktop build passed. Unit tests recorded 2,516 passes, 16 skips, and only the [known three static-route failures](2026-10-28-firestore-read-polling.md) under a `.codex` ancestor; these baseline limitations are not silently converted into passes. Log: `chunk-full-verify.log`.
- All frozen input hashes matched after the full run (`chunk-verify-inputs.json`, `chunk-verify-freeze-result.json`), before this result was appended. Final diff review and whitespace checks retained only the intended two production files, focused test file, and this record. No commit, push, or deployment was performed by this task.

All runtime experiments use synthetic data, loopback/unreachable endpoints and disabled synchronization. Build outputs, dependencies, benchmarks and logs remain ignored. The earlier outbox-rotation experiment was rejected for recurring write amplification, fully reversed and preserved separately under ignored `out/reliability-20261029/rejected-outbox/`; it is not part of this change.
