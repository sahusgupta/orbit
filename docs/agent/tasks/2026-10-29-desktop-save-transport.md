# Desktop save transport resource use

The reliability pass measured repeated work inside the [Electron API client](../../../electron/orbitApiClient.cjs): every full-state save traversed its snapshot four times for JSON serialization, and explicit-auth requests still called the local credential fallback. The [local store](../../../electron/localStore.cjs) caches its file envelope, but each account read still decodes `stateJson` and parses it. Avoiding that call removes repeated decode/parse work; this is not a claim of one avoided physical disk read per request.

This independent change starts from `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-save-transport`. It does not include the separate queued-read ownership change or an adoption/IPC redesign. Scope is the API client, its [transport boundary tests](../../../src/lib/electronOrbitApiClient.transport.test.ts), and this record. No dependency, state schema, HTTP/IPC shape, authorization policy, server revision behavior, or production service changes are included.

## Change and preserved behavior

One canonical snapshot serialization supplies the mutation SHA-256, UTF-8 byte diagnostic, and existing state-request byte diagnostic. The complete HTTP wrapper still uses native `JSON.stringify` once at the original transport boundary; no JSON is assembled by hand and no pre-serialized body option is introduced. The public `requestOrbitApi(pathname, options)` method delegates to a private helper that can reuse trusted numeric diagnostic bytes. Legacy falsy direct-client inputs retain the existing `state || {}` request diagnostic behavior.

URL selection is separate from credential fallback. Ordinary requests evaluate explicit key, configured key, then cached key lazily, preserving existing truthiness and fallback precedence. Explicitly authenticated state requests and SSE connections avoid unused fallback decoding. SSE reconnects without an explicit key still resolve the current configured/cached key each time; credentials are not cached by this change. The public `getApiConfig` result remains unchanged.

Request logging and wrapper serialization remain in their existing try/order. Cyclic snapshots still reject before transport; cyclic wrappers and diagnostic failures retain their existing event order, null/rejection result, and timer cleanup. Mutation IDs, retries, request key order/bytes, telemetry fields, default-key behavior, and queue/account behavior remain characterized.

## Measurements

The matched benchmark compares the real baseline client loaded from its Git blob with the candidate in the same process. Its 867,944-byte snapshot contains 5,000 synthetic profiles. Three paired 80-save samples alternate order, with warmups and collection between runs. The actual `createLocalStore` implementation uses a prewarmed memory file cache, fake filesystem, and identity decode codec. JSON parsing is real; OS decryption time and physical disk I/O are not measured.

| Per explicit-auth save | Baseline | Candidate |
| --- | --- | --- |
| Full-state JSON traversals | 4 | 2 |
| Fallback state decode/parse calls | 1 | 0 |
| Fake file reads during measured calls | 0 | 0 |
| Wire, header, diagnostic, and result digests | Matched | Matched |

All three pairs preserve ordered request-body/header/diagnostic/result digests, request bytes, and explicit authentication. The observed median is 28.913 versus 14.491 milliseconds per save (49.9% lower) for this synthetic transport/cache boundary. This is not an end-to-end application or production-latency guarantee. Separate baseline/candidate failure comparisons also match cyclic-wrapper and request/all-logger failure events, outcomes, and timer cleanup. No network request or production data is used.

## Validation

Before production edits, the existing client suite plus 14 new characterization cases passed two suites / 53 tests. Three resource regressions then failed on the original implementation (53 passed / 3 failed): four rather than two snapshot traversals, and an unnecessary fallback read for both explicit state and SSE authentication.

The final focused transport/client/stream/composition run passed four suites / 98 tests, including 20 new transport cases. Electron check-JS passed. Coverage includes exact Unicode wire bytes/hash/log metrics, legacy falsy diagnostics, explicit/configured/cached key precedence and truthiness, missing credentials, idempotent retries, serialization rejection and queue recovery, SSE fallback renewal, wrapper/logging failures and timer cleanup.

Full verification ran from 10:28:11.916 to 10:34:16.435 UTC on 2026-10-29 through the reviewed allowlist environment runner, executing `scripts/verify.cjs`, the same entrypoint as `npm run verify`. It exited 1 with 12 of 13 aggregate checks passing. Root, Player, Web and internal-tool type checks, Web lint/tests, internal tests, release/artwork checks and all three production builds passed. Main unit tests reported 259 files passed / one failed / one skipped, with 2,503 tests passed / three failed / 16 existing skips (2,522 total). The failures match the exact-base `.codex` path baseline in `apps/api/src/server.routes.test.js`: health/legal assets before client authentication, self-check-in external assets/security headers, and the HttpOnly dashboard session. They remain failures and were not changed in this scope.

Production source and tests were frozen throughout that run. Their before/after Git blob hashes matched: API client `08bf6445c787f4b8736afcfcb695f64c2b286946`, new transport tests `68cf0ea2e36c148bf25cd601f5a13cb45dcc8ecf`.

Ignored evidence is under `out/reliability-20261029/`: `transport-characterization-before.log`, `transport-regression-before.log`, `transport-focused-after.log`, `transport-focused-failures-after.log`, `transport-benchmark.json`, `transport-benchmark.log`, and `verify-transport-final.log`. The paired benchmark helper is `measure-transport-matched.cjs`. All checks use synthetic fixtures, Node 22.16.0 / npm 10.9.2, loopback configuration, and disabled Firebase/hosted runtime services.
