# Isolated API resource baseline

The user authorized the resource/reliability work queue in sequence. This first
task establishes repeatable measurements before changing discovery or Firebase
publication. The clean starting branch is `codex/resource-reliability-20261031`
at `1c2739ba25a863ddb76b1458f87421a06cf84c7f`.

## Scope and reproduction

Run from the repository root with the locked Node/npm installation:

```powershell
npm run measure:api-resources -- --samples 5 --output out/resource-reliability-20261031/baseline.json
```

The output file must be new and beneath `out/`; existing files are not
overwritten, and directory symlinks/junctions are rejected. `--scenario discovery`
or `--scenario publication` selects one area. `--samples` accepts 1 through 25.
Reports are ignored generated evidence, not committed production data.

The launcher supplies an allowlisted operating-system environment to a separate
worker. Dotenv, inherited service configuration, Node options, hosted endpoints,
and sync are absent. Discovery uses the actual state reader and public discovery
handler with the memory database and a synthetic license inspection. A network
guard rejects native HTTP/socket/fetch access. Publication runs the actual
publisher/core in restricted VMs with a fixed clock, inert signing and a
stateful REST fixture. That VM cannot read credential files or dispatch a real
request. All identities and documents are synthetic.

Fixture setup and one warm-up are excluded from discovery measurements.
Publication measurements include REST reset/reseed, serialization, invariant
checks and sampled memory accounting, but exclude module/input setup. GC is
requested between measured samples. Selected application/helper input hashes
and Git HEAD are captured before measurement and checked afterward. Repeated
samples must preserve operation counts and canonical output digests. Discovery
normalizes only its volatile `club.generatedAt` field for hashing; response
bytes are measured before normalization.

## Baseline observations

The reviewed five-sample report is
`out/resource-reliability-20261031/api-resource-baseline-reviewed.json`.
Application source is unchanged. All fixtures below have one compressed state
chunk per venue and a positive revision.

| Discovery fixture | Header documents returned | Publication documents requested | Chunk documents requested | Clubs returned |
| --- | ---: | ---: | ---: | ---: |
| 1 eligible venue, limit 25 | 1 | 1 | 1 | 1 |
| 25 eligible venues, limit 25 | 25 | 25 | 25 | 25 |
| 50 eligible venues, limit 25 | 50 | 50 | 50 | 25 |
| 200 eligible venues, limit 25 | 51 | 50 | 50 | 25 |
| 200 eligible venues, limit 50 | 102 | 100 | 100 | 50 |
| 200 name-filtered venues, limit 25 | 203 | 200 | 200 | 0 |

Discovery source pages contain 50 records plus a pagination sentinel. Counts
include query-returned sentinel documents, not the hardcoded `queryCount`
summary in the state reader. Batch reads count each requested document once;
internal memory-store delegation does not create additional counted reads.
Writes remain zero. Synthetic licensing calls are counted separately.

| Publication fixture | Listed documents | Player listing requests | Child document updates | Parent marker writes |
| --- | ---: | ---: | ---: | ---: |
| 0 players | 0 | 1 | 1 | 1 |
| 10 players | 30 | 2 | 21 | 1 |
| 250 players | 750 | 2 | 501 | 1 |
| 1,000 players | 3,000 | 4 | 2,001 | 1 |

The publisher fixture applies updates and deletions to its document map before
subsequent listings. Additional tests cover stale API-owned records, legacy
identities and preserved foreign records. Every run verifies canonical final
documents, sync protocol/revision metadata and the parent commit marker last.

Raw sample timings, before/after heap/RSS observations and serialized body byte
counts are in the report. These local fixtures do not establish production
latency, billed Firestore reads, real transport byte counts, peak memory,
physical-device performance or leak freedom. Real licensing-store operations,
index work, provider retries and minimum empty-query charges are excluded.
The large-profile fixture exposes a further CPU candidate in public projection;
no optimization or measured production saving is claimed in this task.

## Verification

- Focused baseline suites passed 22 tests across two files after review fixes.
- The complete reviewed five-sample baseline completed with zero network
  attempts and stable source/output checks.
- Independent review found a sample-limit inconsistency, a directory-link
  output escape and incomplete source-freeze checks. They were corrected before
  the reviewed report. The link rejection has an actual symlink/junction
  regression test.
- An initial measurement correctly failed its stable-output check because of
  the live projection timestamp. Narrow timestamp normalization corrected the
  harness; application behavior was not changed.
- Full `npm run verify` passed all 13 checks through the existing isolated
  environment runner at `2026-10-31T08:53:17.604Z` (exit 0). Root/API/Native
  tests passed 2,657 cases, Player Web passed 322 and the internal tool passed
  85: 3,064 passes total, with 16 existing skips. All four root TypeScript
  subchecks, Player/Web/internal TypeScript, Web lint, release/artwork checks
  and the three production builds passed. The former static-route path
  failures did not recur: all 12 server-route tests passed in this checkout.
  Full log: `out/resource-reliability-20261031/baseline-verify.log`.
- `node --check` passed for all five new executable/helper files. Sensitive-path
  and independent-lockfile checks passed; staged whitespace checks passed.

No production API, Firebase, signing, billing, EAS build or store submission was
accessed or changed. No source was pushed or deployed during this baseline.
