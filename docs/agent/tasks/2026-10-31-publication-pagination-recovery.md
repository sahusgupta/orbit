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

Full repository verification and CI remain pending integration of the separate
tooling-advisory repair. This record does not claim a complete rollout, a bound
on an arbitrarily long sequence of unique valid pages, or production Firestore
billing measurements. No hosted service, credentials, EAS build or deployment
was used for this change.
