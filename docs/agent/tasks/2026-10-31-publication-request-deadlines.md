# Bound Firebase publication REST requests

The [publisher](../../../apps/api/src/firebasePublisher.js) previously awaited
provider headers and consumed bodies without a request deadline. A stalled
response could retain an outbox attempt and its transport resources indefinitely.
This change gives each OAuth, batch-write, projection-list, legacy-player-list
and parent-PATCH request one 30,000 ms budget for headers plus any body consumed.
It is a per-request deadline, not a whole-publication or pagination page-count
limit. Valid publications may contain multiple requests and take longer.

## Preserved behavior

A successful parent PATCH remains acknowledged at headers; its unused body is
discarded without reading it or waiting for a stalled cancellation promise.
Batch writes still require their existing per-write acknowledgements. A timeout
does not authorize the next batch, cleanup phase or parent commit marker. Late
transport/body fulfillment and rejection are observed without resuming a retired
local publication. Caller cancellation, request timers and listeners remain
independent across concurrent requests and are released on settlement.

The shared request helper aborts its controller and explicitly cancels an owned
native body reader. JSON/text decoding and consumed-body errors retain the
characterized Node 22.16 behavior. Existing error categories, HTTP status,
protected path references, response references and unreadable-error-body fallback
are preserved. Diagnostics contain no credential, raw provider body or player
path. Public exports, request/write payloads, ownership predicates, sync protocol
v2 and parent-marker ordering are unchanged.

The real memory-outbox integration preserves stable `account:revision` publication
identity and saved time, retry backoff, predecessor serialization, fenced
cancellation and the separate requirement to publish the sanitized revision.
Neither the outbox nor deletion-fence implementation changed. Local completion
after a transport failure does not prove that a remotely accepted write stopped.
Abort cannot roll back that write; no stronger remote atomicity or deletion
guarantee is claimed.

## Characterization and regressions

The initial isolated prototype passed 18 existing-behavior cases. Its first 22
deadline/resource cases failed finitely against unchanged source. The expanded
and promoted suite retained 23 passing characterizations and 24 expected failures
before the transport change, with all held promises released during teardown.
After implementation those 47 cases passed. Four caller-signal cases expanded
the suite to 51 passing tests without weakening the original assertions.
`FROZEN_PROTOTYPE.json`, `PROMOTED_BASELINE.json` and
`CALLER_SIGNAL_REVIEW.json` retain the source hashes, commands and results under
ignored `out/resource-reliability-20261031/deadlines/`.

The first real Node transport probes found a resource gap despite passing logical
deadline tests: JSON and error-text operations rejected around 30 seconds, but
their unfinished responses remained active beyond 32 seconds until fixture
cleanup. VM/host-realm and router controls did not resolve it. A separately
labeled source-copy experiment retaining the native fetch promise also failed
and was not applied. These results do not establish the underlying Node cause.

Before the owned-reader change, 30 decoding/consumption characterizations passed
and two stream-resource regressions failed because underlying cancellation was
never called. The implementation then took ownership of the reader, cancelled it
on abort and released its lock. All 32 body-reader tests passed. Initial incorrect
BOM assumptions were corrected to observed Node 22.16 behavior; a wrong TypeScript
executable path and VM constructor-realm mismatch were also corrected. Original
failure logs remain preserved, and the `instanceof` assertions remain intact.

The outbox prototype first passed ordinary network-failure/retry characterization;
three deadline cases then failed finitely against the old transport. The tracked
four-case integration subsequently passed, as did its 14-test group with state
architecture and deletion-fence coverage. A CI portability review reproduced four
failures when only the external memory flag was removed. The test now selects and
asserts memory mode itself, blanks alert delivery and restores environment,
globals, timers and mocks in `finally`. All four cases pass both without that
external flag and with deliberately synthetic production/Vercel/webhook settings;
external fetch remains forbidden.

## Native isolated transport proof

`native-transport/FROZEN_OWNED_READER_RESULT.json` binds the passing proof to
publisher SHA-256
`f71c9d9bbdcdc29f06d08b2588fba11486a08b200d68a69fcc81d8fb711d3508`.
The complete source ran unchanged with real Node 22.16 fetch, AbortController
and unscaled 30-second timers against one owned loopback HTTP server. The strict
router admitted only synthetic demo endpoints; no Firebase/provider request or
real credential access occurred.

The stalled-header, HTTP 200 JSON and HTTP 429 text cases rejected in
30.017-30.019 seconds with the expected redacted category/status/reference
contracts. Each dispatched one first write chunk and no follow-on chunk. Their
unfinished responses and owning sockets closed before 30.067 seconds, before
driver cleanup. JSON/text each acquired, cancelled and released one native reader
and performed no further reads after logical settlement. The successful PATCH
acknowledged in approximately 79 ms without consuming its unfinished body; its
response and socket closed around 132 ms.

The pre-cleanup snapshot had zero active unfinished responses. Three ordinary
idle pooled sockets were recorded separately and closed by fixture teardown;
they are not active-response leaks. No unhandled rejection was observed. These
timings describe this owned fixture, not Firebase latency or proof of remote
write rollback. Earlier failed probes are retained beside the passing result.

## Verification and remaining gates

The final focused local run passed 199 tests across 11 files
(`deadlines/focused-final.log`). API checkJs passed. VM fixtures use synthetic
signing/fetch, forbid credential-file reads and settle held resources on failure;
the native transport proof uses only the owned loopback server.

The isolated resource harness also completed three measured samples for each
of 14 scenarios with zero network attempts. All 12 scenarios shared with the
initial baseline retain identical response digests and contracts; the other two
are newer legacy-cleanup fixtures. An initial comparison incorrectly paired
rows by index despite the different scenario counts and failed; the corrected
comparison matches kind and source-independent setup before asserting equality.
This adds no billing or provider-latency claim.

`node out/resource-reliability-20261031/run-isolated.mjs verify` ran the actual
`npm run verify` and exited 0: all 13 checks passed. The main suite passed 3,005
tests with 16 existing skips; Player Web passed 322 and the sales map passed 85
(3,412 total passes). Strict renderer, test, Electron, API, Player and Web checks
passed, as did the three production builds. Existing React test warnings,
ExcelJS eval and chunk-size warnings remain visible in the log.

All eight ancillary gates passed: sensitive paths, production dependencies,
independent lockfiles, release controls, module graph, renderer bundle, public
site and brand. Fresh root/API/Web production audits reported zero findings;
Player reported four entries within the unchanged eight-entry policy. The
supplemental browser-artifact audit retained seven visible unshipped Node-only
dispositions. The first ancillary runner was stopped after an incorrect
`NODE_ENV=test` override was noticed; its partial logs are explicitly aborted
and excluded from the eight completed results. The corrected runner used blank
npm configuration, public registry and no inherited service settings. Source
and dependency fingerprints remained unchanged. Independent full-diff review
found no blocker and confirmed all 15 public exports and parameters unchanged.

At local handoff, CI for the prerequisite PRs is blocked by newly published Expo
58 patch expectations (`expo` 58.0.22 and `expo-build-properties` 58.0.12), rather
than a publisher test failure. Their compatible patch review is separate from
this transport change. Exact-head CI and release review remain pending.
No production service, real Firebase
credentials, EAS build, App Store submission or application deployment was used
for this change. No production billing or universal resource-usage reduction is
claimed.
