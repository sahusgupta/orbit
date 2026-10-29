# Release unused protected-route verification responses

This independent reliability/resource change starts from main `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-proxy-body-cleanup`. Scope is the [Player Web proxy](../../../player-web/proxy.ts), its [boundary tests](../../../player-web/proxy.test.ts), and this record. It does not depend on the separate public-data body-deadline PR. Authorization, App Check forwarding, matched routes, status decisions, redirects, cookies, request/cache policy and public payloads retain their current behavior.

## Confirmed retention and narrow change

The proxy verifies a session by requesting the existing private discovery endpoint and checking only `Response.ok`. It cleared its eight-second header deadline without consuming or cancelling the unused body. A verifier returning headers followed by an incomplete body could leave its response/connection occupied after the proxy had returned. Node's [Undici documentation](https://github.com/nodejs/undici#garbage-collection) recommends consuming or cancelling response bodies instead of relying on garbage collection.

The existing `finally` now aborts the request controller after clearing its timer. The proxy still decides from the received HTTP status without parsing or waiting for a body. Aborting an already timed-out request is idempotent. Missing cookies still avoid a request, and network failures/non-success statuses retain the existing fail-closed redirect. No new request, dependency, timeout policy, session rule or server endpoint is introduced.

## Characterization and measured resources

The original seven proxy tests passed before tracked edits. Eight additional characterization cases passed on unchanged runtime source: the HTTP 200/204/299/300/401/403/500 decisions, malformed unused bodies, cookies/return paths, timer cleanup, and immediate return after successful headers while a body stays pending. Three resource regressions then failed on baseline, with 15 passes: successful, unauthorized and server-error verification signals remained un-aborted after the proxy returned. All 18 cases pass after the two-line production addition.

A separate native-HTTP probe calls the actual proxy against an ephemeral loopback server that sends headers plus incomplete JSON. Before the change its response remained open 100 ms after the proxy returned. Afterward it was closed without being completed. An ignored differential harness loads the exact baseline proxy through a Vitest loader and compares it with the actual working module against identical synthetic listeners. It records source hashes and asserts matching ordered status/redirect/cookie digests.

| 100 sequential verifications, checked after 100 ms | Baseline | Candidate |
| --- | --- | --- |
| Incomplete responses still open | 100 | 0 |
| Peak simultaneous incomplete responses | 100 | 2 |
| Incomplete responses cancelled before fixture cleanup | 0 | 100 |
| Total TCP connections for incomplete bodies | 100 | 102 |
| TCP connections for complete 10-byte bodies | 2 | 2 |
| Authorization/redirect/cookie outcome digest | Matched | Matched |

Immediate cancellation closes unfinished HTTP/1 responses and can cause replacement-connection churn; it does not make stalled responses reusable. Complete small bodies reused two connections in both variants. The candidate's observed total decision time was slower in this synthetic run (546 versus 367 ms for unfinished bodies; 180 versus 131 ms for complete bodies). No throughput, CPU, heap, production-latency or universal connection-count improvement is claimed. The proven gain is prompt release of otherwise retained unfinished responses, with the same status-only decision.

## Validation record

- `proxy-characterization-original.log`: seven passes before edits; `proxy-characterization-expanded-before.log`: 15 passes before the runtime change.
- `proxy-resource-regression-before.log`: expected three failures / 15 passes. `proxy-resource-regression-after.log`: all 18 pass.
- Real native transport: `proxy-body-probe-before.json` and `proxy-body-probe-after.json`. The first attempt had a relative-package export resolution error and ran no tests; `proxy-body-probe-before.log` retains it, and `proxy-body-probe-correct-config.log` records the corrected successful probe.
- Exact-source comparison: `proxy-resource-comparison.json` and `proxy-resource-comparison-with-complete.log`; the earlier stalled-only successful proof is preserved separately. Both synthetic listeners and their connections are closed after every variant.
- Standalone Web TypeScript and ESLint passed. Whitespace checks passed. An independent API reviewer found no actionable introduced authorization, redirect, timer, fallback or cleanup issue.
- Frozen aggregate verification ran from 10:49:53 to 10:55:50 UTC on 2026-10-29 through the isolated entrypoint runner. It returned exit code 1 with 12/13 checks passing: only the exact three known `.codex`-ancestor static-route failures, 2,483 main-unit passes and 16 existing skips. Web tests recorded 228 passes and internal tests 85 passes. Every TypeScript/release/artwork/lint check and all three builds passed. All three source/test/document SHA-256 hashes matched after the run, before this result was appended. Evidence: `proxy-full-verify.log`, `proxy-full-verify-inputs.json` and `proxy-full-verify-inputs-after.json`.
- The actual production Next build plus JavaScript-enabled Chromium passed accepted and rejected protected-route navigation against an ephemeral synthetic loopback verifier with incomplete response bodies. Accepted HTTP 200 rendered the fixture clubs without a cookie-clearing response; rejected HTTP 401 produced the existing sign-in redirect/return path and expired both session/attestation cookies. The two unused bodies closed after 14 ms and 3 ms without completion. The browser made zero external requests; screenshots were visually inspected, and all owned processes/listeners were closed. This tests the proxy/status boundary, not real Firebase credential validation or production latency.
- The first browser attempt used the partial `headers()` snapshot and failed its cookie-header assertion even though the verifier response had already closed. The harness now uses `allHeaders()` and retains the same cookie assertions; the failed proof/log are preserved. The passing attempt reused the unchanged successful production build. Proof: `proxy-browser-story-all-headers.json` and its log; failed attempt: `proxy-browser-story-candidate.json` and its log.
- The separate low-rate response-retention soak passed for 45 minutes (10:39:22–11:24:23 UTC), with 10,232 requests: 5,116 complete bodies and 5,116 intentionally incomplete bodies cancelled. HTTP 200/401/500 decisions stayed correct; after every settled request there were zero open responses. Peak open responses was one and peak owned TCP sockets two, with one idle socket at the final pre-cleanup sample. The source hash stayed unchanged. The listener/owned connections closed and Vitest exited 0 after its final cleanup. Proof: `proxy-response-soak.json` and `proxy-response-soak.log`.
- The soak's Node worker did not expose explicit GC. Its final observed RSS was 82,980,864 bytes and heap used 19,018,240 bytes; these are process observations, not a production memory-leak, capacity, throughput or latency guarantee. The test's assertions concern bounded responses/sockets, decisions and source continuity. It used one request at a time with a 250 ms pause, not production concurrency.

All fixtures use synthetic tokens/data, explicit loopback endpoints and disabled synchronization. No production service, customer data, credential file or hosted deployment is accessed. Generated helpers, benchmark output, screenshots, build output, dependencies and logs remain ignored under `out/reliability-20261029/`.
