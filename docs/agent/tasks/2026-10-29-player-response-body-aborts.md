# Preserve Player response-body timeouts and cancellation

This focused change starts from main `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-player-body-aborts`. It changes the [bounded transport](../../../player-app/src/data/api/boundedFetch.ts), its [same-boundary tests](../../../player-app/src/data/api/boundedFetch.test.ts), and this record. It does not change authentication, wire/data schemas, caller signatures, dedupe keys, retry limits, deadlines, metric fields, dependencies or polling lifecycle.

## Observed failure and narrow change

The existing per-attempt deadline already covers `response.json()`. However, the unconditional JSON-rejection fallback converted a body error caused by that deadline or caller cancellation into `{}`. With HTTP 200 headers, the transport resolved and recorded `ok`, bypassing its existing bounded GET retry. With HTTP 500 headers, a final body timeout was reported as an ordinary HTTP error. Existing domain decoders reject incomplete payloads, so this is a transport failure/recovery/telemetry bug; false successful domain mutations are not claimed.

The JSON fallback now rethrows its original error when the request controller or upstream signal is aborted. The existing outer catch then records `timeout` or `cancelled`, applies only the already-configured GET retry, and retains the existing no-retry rule for mutations. Non-aborted malformed JSON still falls back to `{}`; ordinary HTTP status/payload handling remains unchanged. Existing timer/listener and shared-read-key cleanup run through their unchanged `finally` paths.

Actual callers are `playerHttpApi.ts`, `localPlayerApi.ts` and `playerPhoneAuthApi.ts`. The tests compose the real [public discovery reader](../../../player-app/src/data/api/playerHttpApi.ts) with the real bounded transport and decoder, mocking only fetch and the Firebase client boundary. A stalled first HTTP 200 body previously produced a generic discovery-decoding failure after one attempt. It now reaches the existing second GET attempt and decodes the valid authoritative response. No private service, credential or real network request is involved.

## Characterization and deterministic resource evidence

The original four transport tests passed before any edits. Additional passing characterization ran against unchanged production source: ten total cases preserving ordinary/malformed JSON for HTTP 200/400/500, mutation HTTP-error payloads without retry, GET server-error retry, and successful-response timer/upstream-listener cleanup.

The expanded 22-case file then failed 11 cases against unchanged production source, while 11 passed. Its deferred fixtures use real `Response` and `ReadableStream` objects, immediate 200/500 headers, and a JSON body that rejects on the request signal. The cases cover GET and POST deadlines, final-attempt outcomes, bounded recovery, caller cancellation, coalesced failure/key reuse, path redaction, timer/listener cleanup and the actual public discovery reader. One HTTP 500 recovery case already passed through ordinary status-based retry; it is retained to protect that behavior.

The fetch fixture rejects immediately if passed an already-aborted signal. An initial helper returned an errored Response in that situation; it was corrected before final validation. The ignored `original-transport.config.mjs` pre-load plugin supplies exact `git show 9c726a55fc353c0edda31c6d1e8843c76a8a652c:player-app/src/data/api/boundedFetch.ts` text for the same actual module ID, retaining real relative imports/mocks. With the corrected fixture, the original source again has 11 failures / 11 passes (`regressions-before-corrected-fetch.log`). The earlier helper run is retained separately and is not used to claim request savings.

For a cancelled HTTP 500 body with two allowed read retries, the original implementation enters backoff and invokes fetch a second time with an already-aborted signal before rejecting. The fixed transport rejects after the first invocation. The second original invocation is rejected before headers, so no extra server/Firestore read or billing reduction is inferred. For an HTTP 200 body timeout, successful recovery can now consume the existing GET retry instead of failing after one attempt; this is intentional bounded recovery, not a blanket reduction in request count. POST requests remain single-attempt even when retry options are supplied.

These are deterministic synthetic transport behaviors, not device/network/production latency measurements. The original malformed-JSON fallback and non-aborted body-error handling remain outside this narrow correction. This task does not address the separately confirmed foreground-refresh invalidation backlog.

## Verification record

- `original-tests.log`: four original tests passed on the fresh exact-base branch.
- `characterization-before.log`: ten tests passed before production changes.
- `regressions-before.log`: expected 11 failures / 11 passes before the runtime edit; `regressions-before-corrected-fetch.log` repeats those counts with exact baseline source and the corrected pre-aborted fetch behavior.
- `focused-after.log`: 22 tests passed with the runtime fix. After correcting the fetch fixture, `player-boundaries-final.log` passed all 123 tests across the transport, API boundary and tournament repository suites, using one worker with file parallelism disabled.
- Player strict TypeScript passed both before and after the fetch-fixture correction (`player-typecheck-final.log`). Whitespace checks and all three local documentation links pass.
- Root and independent sync-agent review found no actionable introduced issue after checking the signal-only rethrow, unchanged retry/dedupe/metric cleanup, actual caller UID checks, corrected fetch fixture and composed public-reader tests.
- Literal `npm run verify` ran through the reviewed isolated environment wrapper from this worktree, 11:00:03–11:05:57 UTC on 2026-10-29. It returned exit code 1 with 12 of 13 aggregate checks passing. All root/Player/Web/internal TypeScript checks, Web lint, release/artwork checks and all three production builds passed. Web tests: 217 passes; internal tests: 85 passes; main suite: 2,501 passes, 16 existing skips and only the same three `apps/api/src/server.routes.test.js` static-route failures observed in the clean exact-base baseline under a `.codex` ancestor. Those failures cover legal assets, self-check-in assets and the dashboard; no API route-serving code changed or failure was converted into a pass. Log: `full-verify.log`.
- All three source/test/document input hashes and the exact baseline HEAD remained unchanged throughout that run (`verify-inputs.json`, `verify-inputs.patch`, `verify-inputs-after.json`). Only this result prose was appended afterward; documentation links, whitespace checks and the complete final diff were reviewed again.

All runtime tests use mocked fetch, synthetic data, loopback/unreachable configured endpoints and disabled Firebase synchronization. Diagnostics, helpers and logs remain ignored under `out/reliability-player-body-aborts/`. No production service, cloud build, deployment or customer data was accessed.
