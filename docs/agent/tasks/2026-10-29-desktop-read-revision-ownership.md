# Desktop read and queued-write revision ownership

The reliability pass reproduced a lost-update boundary in the Electron API client. A full-state read started at revision 1, then two optimistic local snapshots were queued while another actor committed revision 2. The read advanced the main-process writable cursor even though the renderer's pending-save/state-reference guards would discard its state. The first stale write correctly conflicted at revision 1; the second borrowed revision 2 and overwrote the unrelated incoming request.

Work starts from `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-desktop-cas` in a separate managed worktree. Scope is limited to the [Electron API client](../../../electron/orbitApiClient.cjs), its [same-boundary tests](../../../src/lib/electronOrbitApiClient.test.ts), and this record. Existing HTTP/IPC shapes, authentication, state schemas, server CAS, idempotency, queued-save ordering, and publication behavior are preserved. No production service or credentials are used.

## Change

A per-account context tracks only active reads, the pending queue, and a symbolic enqueue epoch. A normal read may update the writable revision and recovery cache only when no mutation was pending at its start or completion and its enqueue epoch stayed unchanged. The fetched record still returns through the existing renderer boundary, where the existing save/state-reference guards apply. A delayed lower revision still rejects as before.

The QR redemption path may adopt its own full read only while its private mutation token remains the newest queued intent. A queued stale full-state writer behind that operation prevents promotion. Existing sole-operation QR adoption and contiguous QR-issuance revision handling remain characterized. Legacy latest-state reads, whose account is unknown at request start, use a single global token and pending count conservatively. Known-account reads remain isolated from other-account writes.

Contexts are released after their last active read and queued mutation. Settled tail promises are cleared; bookkeeping does not retain state payloads or credentials. One global token/counter remains, rather than an unbounded completed-operation history.

## Evidence

The synthetic harness uses the real API client and a compare-and-swap server implemented entirely in test memory. It preserves an incoming request at revision 2 while testing separate stale local edits; no network requests are made.

| Observation | Before | After |
| --- | --- | --- |
| Queued POST expected revisions | `1`, then `2` | `1`, then `1` |
| Second stale POST | Accepted, creates revision 3 | Conflicts at current revision 2 |
| Unrelated incoming request | Overwritten | Preserved |
| Recovery after a stable full reload | Existing behavior | Revision 2 can be adopted, then saved normally |

Passing-before characterization added stable post-write full-read adoption and sole queued QR-read adoption. The complete API-client suite passed 41 tests before production edits. Five new race regressions then failed against the original implementation (42 passed / 5 failed): queued writes borrowing a read, reads begun during an existing queue, mutations completing before a read, and stale writers queued before/during QR's internal read.

The initial implementation run exposed an incorrectly bound private callback token and retained four QR `ReferenceError` failures in `focused-after-initial.log`; the callback was corrected without changing expectations. The final focused run passed three suites / 90 tests, including 51 API-client cases, transport and composition coverage. Electron check-JS passed. Additional coverage checks account isolation, overlapping-read context lifetime, idle latest-state compatibility, queue cleanup/recovery, normal cache behavior, the existing delayed-old-read rejection, and preservation of an own accepted revision when a later remote revision remains unadopted.

Commands use Node 22.16.0 / npm 10.9.2 and isolated fake transports, loopback API configuration, disabled Firebase sync, `CI=1`, and `TZ=UTC`. Root, API, Player and Web locked installs completed without manifest/lock changes.

Full verification ran from this worktree with the reviewed isolation runner from `09:42:15` through `09:50:14 UTC`. That built-in-only runner invokes `scripts/verify.cjs` (the `npm run verify` entry script) with an allowlisted runtime environment, memory Firestore, unreachable loopback API endpoints, and disabled Firebase/embedded sync. It returned exit 1: 12/13 summary checks passed. Main unit results were 2,495 passed, three failed, and 16 existing skips across 260 files. All three failures are the unchanged `apps/api/src/server.routes.test.js` static-route cases under this `.codex` checkout: health/legal assets, self-check-in external assets/security headers, and the HttpOnly dashboard session. They match the parent's clean baseline and are not reported as local passes. All root/Player/Web/internal TypeScript, Web lint/tests, internal tests, release/artwork checks, and the three production builds passed. The source/tests remained frozen throughout the aggregate run. Full log: `verify-cas-final.log` in the ignored evidence directory.

Ignored evidence is under `out/reliability-20261029/` in this worktree: `characterization-before.log`, `regression-before.log`, `focused-after-initial.log`, `focused-after-token-binding.log`, `focused-after-expanded.log`, `focused-after-own-success.log`, and `desktop-cas-scenarios.json`. The comparison script loads the unchanged baseline client directly from its Git blob and compares it with the candidate under the same synthetic CAS inputs.

## Remaining adoption contract gap

This change protects reads that overlap queued/enqueued mutations through GET completion. It does not prove that a renderer adopted a completed main-process read before a later IPC save arrives. The current bridge has no sender-bound adoption acknowledgment or explicit per-snapshot expected revision. A new save first enqueued after main's read completed, but before the renderer adopts or rejects that IPC reply, can still use the read's writable cursor with an older snapshot.

The ignored `desktop-cas-scenarios.cjs` diagnostic deliberately reproduces this separate gap against the candidate: after a completed revision-2 load is left unadopted by a simulated consumer, the old snapshot is accepted with expected revision 2 and overwrites the incoming request. This is not represented as a fixed scenario or as a skipped/passing tracked regression. A follow-up requires an explicitly reviewed main/preload/persistence/renderer adoption contract; no such contract change is included here.
