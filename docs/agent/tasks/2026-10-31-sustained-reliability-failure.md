# Sustained reliability validation — failed full attempt

This separate failure record does not replace or promote the earlier validation draft.

The v3 full run **FAILED** after **173 min 10.371 s**, including startup and cleanup.
It ran from **2026-10-31T18:27:51.729Z** to **21:21:02.100Z**, completing epochs **0–7**.
Epoch **8**, the third large cohort, did not complete its final authority/native/history barrier.
There is no nine-epoch or 180-minute acceptance result; `timedWindowElapsedMs` is absent/null.
The original root execution **84499** exited **1**, observed through that same handle at **21:21:41 UTC**.

## Source and application verification

The final audit matches all **140** recorded/current inputs at source **4421e3b7c6c891039018e8fdd4a04daff0561516**.
The corrected source manifest is `84ca6aab…c4a16`; no application or frozen helper change accompanied the run.
Existing [FULL_VERIFY_RESULT](../../../out/resource-reliability-20261031/soak/read-commit/FULL_VERIFY_RESULT.json) records **13/13 checks**, **3,467 passed tests**, **16 existing skips**, exit 0.
That isolated `npm run verify` result establishes its application checks; it does not convert this sustained run into a pass.
This documentation-only change adds no unit tests; application behavior and test inputs are unchanged.

A [fresh isolated verification](../../../out/resource-reliability-20261031/reports/failed-soak-report-verification.json) also exited **0** with **13/13 checks**, **3,467 tests passed** and **16 existing skips**; all three production builds passed.
The original root handle **66553** was observed terminal at **21:34:09 UTC**. Application/test inputs remain unchanged at the source above; the sole tracked change is this report.
Existing React test, reduced-motion, ExcelJS eval and chunk-size warnings remain visible in the raw log.

The fixture used four synthetic tenants, 100 profiles/tenant for six epochs and 1,000 for three planned epochs.
API operations were paced sequentially at configured 1 request/s, with about one new state write per 10 s globally.
API/store and publisher VM reset after drained epochs; Node continued. This was not a concurrent-capacity test.
The stock Firestore emulator 1.22.0 used Java 21, `-Xmx512m` and explicit `-XX:MaxDirectMemorySize=2g`.

## Failures before the controlled stop

Two unplanned, uninjected attempts were retained before shutdown in epoch 8; neither had a parent marker:

| Synthetic tenant/revision | Requests | Wrapper wall span | Retained category |
| --- | ---: | ---: | --- |
| `load-tenant-0:14` | 5 | 20,611 ms | `batch-write` |
| `load-tenant-3:14` | 1 | 2,498 ms | `batch-write` |

These are **not established thirty-second request timeouts**. Per-request HTTP status/body/cause and exact header/body stage were not retained.
Subsequent same-revision attempts succeeded in 11.812 s and 5.358 s, but the incomplete cohort's final convergence/queue state remains unproved.
Native stderr contains **`OutOfMemoryError: Java heap space`** and adjacent **`INVALID_ARGUMENT`** parsing diagnostics.
The heap exception has no independent UTC timestamp. This is contemporaneous resource/parser context, not a one-to-one HTTP cause or application serialization-defect proof.
It also does not identify retained-object owners, prove a leak, or establish sufficient future capacity.

Root preserved the pre-stop snapshot, then sent one exact `shutdown` newline through the original handle; no Ctrl-C or force-kill was used for v3.
The final **“The owned soak was interrupted”** assertion records that controlled stop and is distinct from the two earlier spontaneous failures.
The terminal epoch-8 transport count is three failures: one further unsuccessful record settled during shutdown, with its exact cancellation/request mapping unretained.
That third record is not counted as another independently observed pre-stop failure. Recorded cleanup does not prove all logical outbox jobs published.

## Performance and completed-prefix evidence

Retained successful 30-request publication spans later reached **37.929 s** and **31.518 s**.
Those wrapper `Date.now()` spans exclude pre-wrapper API/outbox queueing; the 30 s deadline applies per REST request/body, not to the entire publication.
The timing review has complete healthy distributions only for completed large epochs 6 and 7. No healthy epoch-8 distribution or performance-stability claim is justified.
Cumulative event-loop maxima and the resource diagnostics do not causally assign individual slow spans.

All eight completed epoch objects remain unchanged and retain their producer assertions: authoritative state/revision against the model, parent revision/player count,
exact unique native sourceProfileId sets/ownership/revisions, expected foreign-player count, receipt/outbox counts and published status, and aggregate chunk counts.
These are recorded producer checks, not reconstructed historical payloads, full native game-field equality or full foreign-player metadata preservation. Epoch 8 has no final barrier result.
The three planned real stalls in completed epochs recovered, with response **and socket** closure after fault start as follows:

| Planned stall | Closure interval | Before its own API closed |
| --- | ---: | --- |
| Headers, epoch 3 | 30.059 s | Yes |
| JSON body, epoch 4 | 30.046 s | Yes |
| Error body, epoch 5 | 30.038 s | Yes |

These closure intervals are not whole-publication durations and do not characterize the two later unplanned failures.

## Recorded final cleanup

The final audit records awaited API closure with **0 sockets / 0 controls**, zero in-flight HTTP/bodies, and zero pending store/transaction work.
All **24** metrics PowerShell probes have complete retained records: status 0/null signal, exit/close and all four pipe flags observed, ownership retired,
no timeout/abort/kill/output limit/ambiguity, null kill/reason fields, matching byte totals, empty unretired list and no cleanup failure.
Native accounting is **14,261 starts = 14,260 headers + 1 pre-header failure**; all **14,260** handed-off body reads completed, with **0 body-read failures**.
Final header/body/cancellation work is zero. The five reader-ownership counters were zero in each of the eight completed epoch snapshots.
Java PID **41328**, parent **43576**, retained the same creation identity before stop; normal SIGTERM was followed by recorded process null and zero owned connections.
These are reviewed run-owned ledgers, not a fresh OS probe, continuous containment, or a zero-request-failure result. Cleanup errors are `[]`.

## Preserved predecessors and blocked gates

| Attempt | Preserved result and cleanup scope |
| --- | --- |
| Original full run | Failed at 119 min 49.885 s, five epochs. Final-authority GET retained only `TypeError: fetch failed`; exact header/body stage and cause unknown. Java/native cleanup was recorded; an explicit final API zero-owner snapshot was not retained. |
| V2 full run | Seven checkpoints; direct-buffer OOM at the 512 MiB limit. Root's forced Ctrl-C ended the tree with exit 1; internal report remained `running`, and final internal API/reader/utility cleanup is unproved. |

No durations are stitched together into a successful 180-minute run. V3's controlled-stop cleanup does not repair the v2 bookkeeping gap.
The prepared games check `b81863ef…f2ccc` remains **blocked and unexecuted**: its 148-source provenance is not a passing games result.
This prepared candidate stays bound to the failed run and cannot execute. A replacement must be separately prepared for a fresh successful nine-epoch/180-minute run, independently reviewed cleanup and that run's original root exit 0. The existing provenance and failed evidence must remain unchanged.
The earlier validation draft (`afe224cc…f9aa`) is preserved unchanged; it must not be promoted as successful validation.

## Existing implementation records and next safe work

Implementation and test details remain in the existing seven records:
[discovery reads](../../../docs/agent/tasks/2026-10-31-discovery-read-cost.md), [publication reads](../../../docs/agent/tasks/2026-10-31-publication-read-cost.md),
[CI/security/tooling](../../../docs/agent/tasks/2026-10-31-resource-ci-remediation.md), [pagination recovery](../../../docs/agent/tasks/2026-10-31-publication-pagination-recovery.md),
[request deadlines](../../../docs/agent/tasks/2026-10-31-publication-request-deadlines.md), [browser revision ownership](../../../docs/agent/tasks/2026-10-31-browser-revision-ownership.md),
and [browser read commit](../../../docs/agent/tasks/2026-10-31-browser-read-commit.md).

Next investigation should first preserve per-request monotonic stage/status/error-cause metadata and finite batch size/count observations, without payloads or secrets.
A separately reviewed finite synthetic fixture experiment can then observe heap/direct-buffer usage and owner retirement over time to distinguish provisioning pressure from retention.
No further memory-cap increase, restart, application/helper change, deployment, release, EAS/App Store build or submission is performed or authorized by this record.
There is no product-fix, leak-freedom, production-performance, capacity, quota or billed-Firestore-read conclusion.

## Compact evidence index

Paths resolve to local ignored evidence; hashes bind the specific records, not a portable/public production harness.

| Evidence | SHA256 |
| --- | --- |
| [Final failed audit](../../../out/resource-reliability-20261031/reports/v3-terminal-failed-run-audit/2026-10-31T21-23-54-122Z/review.json) | `b3998c578c527e8302c65c271ae5fbf3b7c8ca86482fb9975b7529483a12c785` |
| [Original root terminal observation](../../../out/resource-reliability-20261031/soak/reviews/v3-root-original-terminal-observation.json) | `24ac82caa8a7086055a7f4e87a668392c0a26e8868be5c83517a3d9392724aac` |
| [Pre-stop partial failure review](../../../out/resource-reliability-20261031/soak/reviews/v3-epoch8-unplanned-publication-failures/partial-failure-review.json) | `ea63ce89467fb992315ffbbb8055acf090410d372919b87522f976eddd24bea6` |
| [Publication timing review](../../../out/resource-reliability-20261031/soak/reviews/v3-epoch8-publication-timing-burst/independent-review.json) | `0adfb6516623a31ddab443259c046ed416b2fd10f5598fde95a5143b655ef770` |
| [Terminal result snapshot](../../../out/resource-reliability-20261031/reports/v3-terminal-failed-run-audit/2026-10-31T21-23-54-122Z/terminal-result.snapshot.json) | `5d4b6a9dd0a35a79d6076c79920b6a54bff151c796ca896df8857e2cae4fb68b` |
| [Application verification](../../../out/resource-reliability-20261031/soak/read-commit/FULL_VERIFY_RESULT.json) | `7dc01f0979d0008f5ae1ab9d4a9d7e13f37d20d640beaf40cfb976d0b345c6ad` |
| [Fresh application verification](../../../out/resource-reliability-20261031/reports/failed-soak-report-verification.json) | `f3542271a4ae529449f064ce2db53b61d3e06a72324240e808865aa6a1a19d8c` |
| [Blocked games preparation](../../../out/resource-reliability-20261031/soak/projection-readback-v3/prepared-v3-run-pinned.json) | `b81863ef2e6c89c7101a808a4fcc9eeb8e8a66f5ce2e0309b45fa612bdff2ccc` |
