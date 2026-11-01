# Discovery publication-status read reduction

This is task two in the user-authorized sequential resource/reliability queue,
following the [isolated baseline](2026-10-31-resource-baseline.md). It starts at
`9d65c38` on `codex/resource-reliability-20261031`.

## Behavior and boundary

Public and authenticated discovery hydrate authoritative state but never use
the management publication-status field. The state page reader now accepts an
internal `includePublication: false` option that omits that field and its
Firestore request. Only `listPublicStatePage`, shared by both discovery handlers,
opts out. This option is not a new HTTP parameter.

Default state pages, `loadState`, `loadLatestState`, management account operations
and account-deletion inventory retain publication hydration, result shapes and
publication-before-chunk failure ordering. No persisted state, API response,
licensing/authentication rule, sync protocol or polling interval changes.
Discovery still rejects unavailable/missing authoritative chunks and unavailable
license inspection. Its intended availability change is that an unused
publication-status outage can no longer break discovery because that request is
not attempted; identical behavior for that removed failure dependency is not
claimed. Omitted metadata is not replaced with a misleading `not-queued` value.

## Characterization and measured effect

Before application edits, 75 characterization/related tests passed. The new
optimization cases then reproduced eight failures against unchanged runtime
(14 cases already passed). After the focused two-file runtime change, 168 tests
across eight relevant suites passed, including management, deletion, source
pagination, both discovery serializers, inactive licensing, fail-closed 503s,
chunk failures and default error precedence.

The same eight discovery fixtures were measured for five samples after the
change. A strict comparison against the recorded baseline requires identical
response bytes/digests, pagination, licensing calls, header/chunk requests,
missing-document counts and zero writes. Only publication gets are removed.

| Fixture | Document operations before | After | Publication requests removed |
| --- | ---: | ---: | ---: |
| 1 venue, response limit 25 | 3 | 2 | 1 |
| 25 venues, response limit 25 | 75 | 50 | 25 |
| 50 venues, response limit 25 | 150 | 100 | 50 |
| 200 venues, response limit 25 | 151 | 101 | 50 |
| 200 venues, response limit 50 | 302 | 202 | 100 |
| 200 name-filtered venues | 603 | 403 | 200 |
| 50 venues with 250 profiles each | 150 | 100 | 50 |
| 1 venue with 1,000 profiles | 3 | 2 | 1 |

These are synthetic requested/returned document counts, not invoices. Source
page sentinels are included; licensing-store work, index work, provider retries
and minimum empty-query charges are excluded. Timing/memory samples are local
diagnostics rather than a controlled before/after production performance claim.

Evidence remains ignored under `out/resource-reliability-20261031/`:

- `task2-discovery/characterization-before.log`
- `task2-discovery/regression-before.log`
- `task2-discovery/focused-after-fixed.log`
- `task2-discovery/api-typecheck-after-fixed.log`
- `discovery-after.json`
- `discovery-comparison.json`

The initial API typecheck caught `import.meta` in the new CommonJS-scoped test.
It was changed to the existing `createRequire(__filename)` pattern; API typecheck
and all 168 related tests were rerun and passed. No diagnostic was suppressed.
The resource harness's 22 tests also passed with the new expected read counts.
Independent source review found no actionable issue and confirmed the skipped
metadata read enforces no authorization/publication gate.

Full `npm run verify` passed all 13 checks at `2026-10-31T09:00:42.118Z`
(exit 0): 2,679 Root/API/Native tests, 322 Web tests and 85 internal-tool tests
passed, totaling 3,086 passes with 16 existing skips. Type checks, Web lint,
release/artwork checks and all three production builds passed. The application
and test input hashes matched the frozen inputs after execution. Full log:
`out/resource-reliability-20261031/task2-verify.log`. Staged whitespace checks
passed. No hosted service, deployment, EAS build or store submission ran for
implementation or local verification.
