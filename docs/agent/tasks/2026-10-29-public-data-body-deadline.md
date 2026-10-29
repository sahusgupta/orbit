# Public Player Web response-body deadline

This focused change is part of the user-requested approximately five-hour Orbit reliability/performance pass, which started at `2026-10-29T08:56:20Z`. It starts from main `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-public-body-deadline`. Scope is the [server public-data transport](../../../player-web/src/server/public-data.ts), its [boundary tests](../../../player-web/src/server/public-data.test.ts), and this record. Public API/data shapes, authentication, URLs, cache policy, catalogue decoding and UI remain unchanged.

## Confirmed failure and small fix

The existing eight-second timer covered only the `fetch()` promise. Receiving response headers cleared it before `response.json()` read the body. A public discovery or club response could therefore keep route loading pending when headers arrived but the JSON body stalled. Pagination's total discovery deadline also stopped constraining the last pending body.

The existing `try/finally` now covers both fetch and body reading. A body abort reaches the existing timeout error instead of being swallowed as malformed JSON. Non-abort JSON failures still produce the same null-payload fallback, other transport errors preserve their previous messages, and the timer is released on success/failure. The request still uses `accept: application/json` and `next.revalidate: 30`. Discovery retains one total eight-second budget across pages; club reads retain their own eight-second budget.

## Characterization and regression evidence

All transport tests use mocked fetch and explicit loopback configuration, with no provider connection. Tests use actual `Response`/`ReadableStream` bodies controlled by the request signal, and finish/cancel their synthetic streams in cleanup.

- The two existing tests passed before tracked edits (`public-data-existing-characterization-correct-config.log`). An earlier command selected the root Vitest configuration, failed fixture alias resolution and ran zero tests; that setup failure is retained separately rather than counted as a product failure.
- Four additional characterization cases passed on unchanged production source: encoded club paths/cache options, unsuccessful-response boundary errors, malformed JSON fallback, non-timeout transport errors and timer cleanup. All six cases passed (`public-data-characterization-before.log`).
- The expanded ten-case suite failed three regressions on the original runtime, with seven passes (`public-data-regression-before.log`): stalled discovery body, stalled club body and a second page body exceeding the remaining total budget. At 8,001 ms each stalled signal was still un-aborted.
- After the fix all ten tests passed (`public-data-regression-after.log`). A successful body completing at 7,999 ms remains accepted and releases its timer. No test deadline, assertion, compiler setting or validation was weakened.
- Standalone Web TypeScript and ESLint passed after a precise test-helper function return type was supplied. The first production-build attempt caught that helper's inferred `never` return type; its failed log/proof is preserved. No type assertion, diagnostic suppression or broad type was used.

## Complete production-browser flow

Story: browser navigation to `/clubs` passes the real Next proxy against a synthetic token verifier, requests public discovery from a loopback API, receives headers and a partial JSON body, renders the existing timeout panel, then recovers on a subsequent healthy navigation.

The final check ran the actual production Next build with JavaScript-enabled headless Chromium. Both API and web listeners used ephemeral loopback ports, synthetic fixture data/cookie, a minimal allowlisted process environment, disabled Firebase synchronization/telemetry, and a browser route guard against external HTTP origins. The owned browser, server process and API connections were closed in cleanup.

| Boundary | Evidence |
| --- | --- |
| Browser to protected route | Real Next proxy accepted the synthetic verifier's HTTP 200 |
| Route to public API | Actual `/player/public/discovery` request reached the loopback handler |
| Stalled response lifetime | Incomplete response closed after 7,812 ms, with `writableEnded: false` |
| Error UI | Existing timeout text rendered in the error panel; total navigation 8,270 ms including proxy/SSR/browser overhead |
| Recovery | Next healthy navigation returned HTTP 200, removed the error panel and rendered the fixture clubs |
| External activity | Browser observed zero external requests; all API traffic was synthetic loopback |

The fetch budget is eight seconds; the browser figure is an observation, not an eight-second end-to-end SLA or production measurement. Earlier browser-harness attempts exposed the product's intentional JavaScript-required page and the separate Next route-announcer alert. Those failed attempts were retained; the final check enabled normal JavaScript and selected the actual error panel without changing product UI or expectations. It reused the unchanged successful production build.

Full proof: ignored `out/reliability-20261029/public-timeout-story-candidate-panel.json` and its log. Error/recovery screenshots were visually inspected and remain ignored. No hosted API, customer data, credentials or production service was accessed for these experiments.

## Verification baseline and delivery

The parent clean baseline ran the complete `scripts/verify.cjs` entrypoint behind `npm run verify`, with minimal runtime environment, memory Firestore, unreachable loopback API endpoints and disabled synchronization. It completed with 12/13 summary passes: only three known `apps/api/src/server.routes.test.js` static-asset cases fail under the checkout's `.codex` ancestor. Root/Player/Web/internal TypeScript, Web lint/217 tests, internal tests and all three builds passed. The earlier contaminated baseline retained temporary Web audit-source input and a worker-startup failure; its clean rerun supersedes those harness issues. No compiler/lint exclusions or test deadlines were changed.

Final aggregate verification ran against unchanged candidate source/tests through the isolated runner from 10:18:18 to 10:27:09 UTC. It returned exit code 1 with 12/13 checks passing: the same three baseline static-route failures, 2,483 main-unit passes and 16 existing skips. Web tests increased from 217 to 225 passes; internal tests recorded 85 passes. Every TypeScript check, Web lint, release/artwork check and all three builds passed. The exact log is ignored as `out/reliability-20261029/body-deadline-full-verify.log`. No failed check is reported as passing.

An independent API reviewer found no actionable introduced deadline, fallback, cache or cleanup issue. Complete diff and whitespace review retained exactly the two transport source/test files and this record; local documentation links resolve. The broader session's rejected publication-queue experiment added recurring writes and is not included in this PR. Generated helpers, benchmarks, screenshots, builds, logs and operational evidence remain ignored; no dependency, schema, deployment or unrelated source change is staged.
