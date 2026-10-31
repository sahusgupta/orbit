# Reject cyclic Firebase publication pagination

The projection and legacy-player cleanup loops trusted every continuation token.
A provider returning a previous token could keep an outbox attempt reading and
accumulating paths indefinitely. Both loops collect their deletion paths before
writing, so the cycle can fail before the affected cleanup phase changes data.

A private helper preserves `String(value || '')` token handling and tracks
returned tokens in a scan-local set. Repetition throws the existing
`projection-list-response-invalid` or `player-list-response-invalid` error, with
only the protected collection reference. Each collection and fresh legacy
recheck gets its own set. Normal pages have no new request or arbitrary page
limit. Public exports, payloads, sync protocol v2, ownership predicates, retry
rules and marker-last ordering are unchanged.

## Behavioral evidence

The actual publisher runs inside an isolated VM with synthetic signing/fetch
responses and forbidden credential-file access. Fourteen characterization cases
passed before production changes, covering opaque Unicode/reserved URL tokens,
token reuse across all eight collections and fresh rechecks, ordered deletions,
counters, commit-marker ordering and existing falsy terminal values.

Four finite cyclic-provider regressions failed before the guard: both scans
continued until the fixture's explicit request cap and produced a request error.
Afterward, same-token cycles fail after two list requests and two-token cycles
after three. The failing phase issues no cleanup writes or parent marker. A
completed earlier stale cleanup remains intact when a legacy recheck fails.
Diagnostics contain no raw tokens, club/project identifiers or provider rows.

After the change, all 18 pagination cases and 74 tests across the three
publisher suites pass. API checkJs passes. Independent review found no concern
in token identity, scope, redaction or phase ordering. Evidence is under ignored
`out/resource-reliability-20261031/pagination/`.

The first integrated `npm run verify` completed all checks but failed one
compiler-boundary test: its extracted legacy-cleanup function did not receive
the new private token helper. The harness now extracts and supplies that real
helper without changing its request, deletion or input-preservation assertions.
All 80 tests across the compiler-boundary and publisher suites then passed.
The complete `npm run verify` rerun passed all 13 checks: 3,324 tests passed,
with 16 existing skips. Clean root/Player installs and the
fresh advisory, sensitive-path, independent-lockfile, release-control and
module-graph gates passed after integrating the separate tooling repair.

The fresh audit reports zero root/API/Web production findings and five Player
findings in this run; the original eight-entry Player policy and November 3
review deadline remain unchanged. Seven unshipped Node aggregate findings stay
visible in the supplemental browser artifact audit. Existing test-adapter and
Vite eval/large-chunk warnings remain.

CI is still pending. This record does not claim a complete rollout, a bound
on an arbitrarily long sequence of unique valid pages, or production Firestore
billing measurements. No live application service, real Firebase credentials,
EAS build or deployment was used for this change.
