# Browser read revision commit — 2026-10-31

This follows [the first browser ownership fix](2026-10-31-browser-revision-ownership.md)
at `4e421ffe41a74c34f8345421707def2fa02dcdc3`. That fix passes CI and its
separately named safe-rejection browser characterization, preserving the
unrelated note while reporting a visible conflict for one intention. Its
original full-convergence oracle remains failed. A further composition test
found an interval between the adapter's acceptance check and the hook's resumed
continuation.

An independently queued native Promise reaction can run after the adapter has
adopted revision 2 but before the hook resumes. If that reaction queues a local
edit, the hook discards the incoming snapshot without applying it to UI or
cache. The next full-state POST nevertheless borrows revision 2 from the
discarded read. The controlled actual-adapter/hook test passed two controls and
failed this case: the required next POST revision was 1, but it was 2.

This is a deterministic composition reproduction, not a full browser/API
reproduction of this additional ordering. The real profile-import path awaits
file reads and subsequently calls `persist`, which synchronously changes
`stateRef` and increments pending-save counts. This supports the ordering's
plausibility. Ordinary synchronous browser events cannot interrupt a microtask;
the reproduction specifically uses an independent queued Promise reaction.

## Change

The browser background hook opts into `{ deferRevisionAcceptance: true }` as the
loader's optional third argument. Reading and decoding a snapshot does not
change its save revision in that mode. The available result supplies
`acceptReadRevision`, outside the state payload. This synchronous function
rechecks current ownership and the current revision map using captured account
and revision values, including on repeated invocation. It cannot replace a
newer accepted revision with an older deferred one.

The hook checks ownership after `await`, normalizes and compares the incoming
state, then calls the acceptance function. There is no further `await` before
the existing merge, state-ref and cache operations. Declined reads and failures
before acceptance do not mark the bridge initialized. Accepted unchanged operations still advance
the revision as before.

Existing default and predicate-only loader calls retain their immediate
behavior. Purposeful full-state conflict reloads, Electron persistence, polling,
optimistic updates, state merging, request payloads, authentication, datastore
shapes and financial/table replay policy are outside this change. The broader
partial-merge/base-state policy and queued-intent convergence limits remain.

## Validation

The two-file production change passes all 26 unchanged expanded regressions:
17 existing characterizations and nine new cases. Before the edit, those same
17 passed and the nine new cases failed. The new cases cover six deferred
loader contracts and three independently queued body-Promise reactions changing
state, pending status, or both. Their assertions retain UI/cache rejection and
the required next POST revision 1.

The final two-file suite passes 31 cases. Additional negatives cover declined
and throwing callbacks without UI/cache/undo/status changes, later missing-state
initialization retaining revision 1, normalization/comparison failures without
acknowledgement, and unchanged-operations acceptance advancing revision 2 without
reinitialization. Strict test TypeScript passes. A broader seven-file focused
run passes 85 tests, including desktop polling, persistence and authoritative
transition boundaries; existing React test-environment warnings remain visible.
The four source-only ancillary gates pass with all 32 bound inputs unchanged.

`node out/resource-reliability-20261031/sdk-integration/run-isolated.mjs verify`
ran the actual `npm run verify` and exited 0. All 13 checks passed: the main suite
passed 3,060 tests with 16 existing skips, Web passed 322 and the sales map passed
85 (3,467 total passes). Strict checks and all three production builds passed.
Existing React test warnings, ExcelJS eval and chunk-size warnings remain
visible. The raw log and independently checked count record are under
`soak/read-commit/full-verify.log` and `FULL_VERIFY_RESULT.json` in the ignored
resource evidence directory. All eight fresh ancillary gates passed with all
32 bound inputs unchanged. The four production dependency audits report zero
advisories and zero allowances; the seven supplemental Node-only ExcelJS
dispositions remain visible. Renderer initial assets total 608,590 bytes
(188,084 gzip), within the existing budget. Public-site and brand checks pass.
The rebuilt real-browser baseline and separately named `race-safe-rejection`
check also pass against actual Express routes and a synthetic, tenant-bound
memory datastore. The baseline observes both optimistic removals before the
held first POST reply; successful writes use revisions 1 and 2 and finish at
revision 3 in authority and cache. The contention run keeps both stale writes
at revision 1 (409), then an authoritative revision-2 replay commits the second
removal without erasing the unrelated note. The first removal is restored with
a visible sync conflict. This retains the earlier full-convergence limitation
and does not constitute a browser reproduction of the additional microtask
ordering.

Both runs preserve the other tenant and report zero expired barriers, page
errors, observed foreign origins and wrong headers. Their API fixtures close
with zero sockets and controls. Context/browser close promises and supervised
root exits complete; no captured owned process identities remain. Mutable task
prose is excluded from the runtime fingerprint, while the four executable/test
files, helper bytes and unchanged worker oracles are bound before and after.
The independent result is `soak/client-deferred-independent-review.json`.

Preparation review corrected an inherited unobserved `taskkill` timeout in the
new parent runner, then a build-deadline edge that could skip the browser worker
while retaining exit 0. Nine disposable supervision cases and a separate
full-runner VM regression pass. The original workers' assertions remain byte
identical after their binding-import substitution. Historical preparation
records remain separate; supervision certifies observed captured identities
and treats ambiguous cleanup as failure.

The ignored pre-change artifacts are
`out/resource-reliability-20261031/soak/client-microtask-before.json`,
`client-microtask-before.log` and `client-microtask-vitest-result.json`; they bind
the source/test hashes, command, safe environment and finite exit-1 result.
The two existing tracked adapter/hook suites also passed 17 characterizations
before the new regression additions. No API server, emulator, browser, native
desktop control, provider action, deployment or EAS build was used for these
composition checks.
