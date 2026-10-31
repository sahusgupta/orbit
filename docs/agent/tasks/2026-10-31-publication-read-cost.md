# Publication cleanup common-path read reduction

Task three in the authorized sequential resource queue starts from `12396f8`
on `codex/resource-publication-20261031`, after the discovery work in PR 53.
It targets the second player-collection enumeration in Firebase publication.

## Selected behavior and concurrency qualification

The existing projection cleanup scan now notes whether any surviving player
record is a legacy identity candidate. It retains one boolean, not a cache of
player documents or legacy deletion paths. API-owned stale rows already selected
for deletion cannot trigger redundant legacy work or be counted twice.

When the scan is clean, publication skips the duplicate player enumeration.
When a legacy candidate was observed, the original fresh legacy scanner still
runs after owned cleanup. Stale deletions, legacy deletions and the parent club
commit marker retain their existing order. The exported four-argument
`deleteStaleOwnedProjectionDocuments` still returns a numeric count and performs
only owned-stale cleanup. Writes, ownership checks, collection paths, public
results, chunk sizes and sync-v2 metadata remain unchanged.

Blindly reusing cached legacy deletion paths was rejected: another publisher
could retag a candidate while later collections are scanned. Passing
characterization shows the fresh legacy scan preserves that now-unrelated row.
The optimization therefore retains that check rather than expanding a
destructive decision's stale-snapshot window.

The qualified timing change is explicit: a legacy row introduced or newly linked
after an otherwise clean first player scan is left for the next publication. A regression
demonstrates its preservation on the first call and removal on the next. The
change does not claim an atomic publication snapshot or repair existing
late-writer/outbox races. A second-list provider failure is no longer possible
on the clean fast path because that request is not issued; fallback list errors
retain their previous categories and stop the parent marker.

## Characterization and measurements

- Before application edits, 52 tests passed, covering canonical documents,
  ownership, overlapping stale/legacy rows, paginated cleanup, bounded deletion
  batches, phase failures, retagged candidates and malformed provider responses.
- Four additional regressions failed against unchanged source (52 other cases
  passed), exposing duplicate clean scans and the selected late-created-row
  behavior.
- After implementation, the expanded six-suite run passed 122 tests, including
  deletion fences, account deletion, state architecture and the updated resource
  harness. API TypeScript, runtime syntax and whitespace checks passed.

Fresh before/after measurements use the same six stateful synthetic fixtures,
five samples each. Comparison requires identical final-document hashes and
counts, unchanged write/batch/request-body counts, parent marker last, and the expected
per-collection listing reduction. The fallback fixtures deliberately preserve
their original scan counts.

| Players | Legacy candidates | Listed documents before | After | List requests removed |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 |
| 10 | 0 | 30 | 20 | 1 |
| 250 | 0 | 750 | 500 | 1 |
| 1,000 | 0 | 3,000 | 2,000 | 2 |
| 10, plus stale/foreign records | 2 | 45 | 45 | 0 |
| 1,000, plus stale/foreign records | 10 | 3,060 | 3,060 | 0 |

The clean 1,000-player fixture also removes 1,472,949 bytes of modeled JSON
listing responses. These are local operation/serialization measurements, not
provider invoices, compressed network traffic, production latency or peak-memory
claims. No artificial network delay is included.

Evidence is under ignored `out/resource-reliability-20261031/`:
`publication-before-cleanup.json`, `publication-after-cleanup.json`,
`publication-comparison.json`, and `task3-publication/` characterization,
regression, expanded-test and API-typecheck logs. Earlier compiler-path and
CommonJS/JSDoc fixture diagnostics are retained separately; precise fixture types
and `createRequire(__filename)` corrected them without suppressing checks.

Full `npm run verify` passed all 13 checks at `2026-10-31T09:11:00.897Z`
(exit 0): 2,698 Root/API/Native tests, 322 Web tests and 85 internal-tool tests
passed, totaling 3,105 passes with 16 existing skips. Type checks, Web lint,
release/artwork checks and the three production builds passed. Task input hashes
matched after execution, and independent source review found no actionable
regression. Full log: `out/resource-reliability-20261031/task3-verify.log`.
PR 53's separate CI stopped at newly reported
dependency advisories; the local verification entrypoint does not include that
registry advisory gate. Those findings are under investigation without widening
the existing advisory policy. No hosted application service or EAS build ran
for this implementation.
