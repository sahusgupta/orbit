# Player Web discovery refresh ordering

This focused change belongs to the user-requested Orbit reliability and performance pass. It starts from `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-web-refresh`, in a separate managed worktree. It changes the [Player Web data provider](../../../player-web/src/data/player-data-context.tsx) and its [boundary tests](../../../player-web/src/data/player-data-context.test.tsx). The [shell providers](../../../player-web/src/components/shell/providers.tsx) mount it under authentication; membership, game and tournament actions consume the same context.

## Confirmed failures

An authenticated discovery read is a snapshot of state before its response arrives. The original provider returned its existing in-flight promise for every notification, without remembering that another read was needed. Three notifications arriving during a pending read produced one total request and no follow-up. When a membership or tournament-interest mutation succeeded while that read was pending, its later stale response unconditionally replaced the acknowledged result. The provider also lost a notification scheduled after its response handler but before its outer promise cleanup.

All transport and Firestore behavior in the reproductions is mocked. Runtime commands explicitly select unreachable loopback API endpoints, disabled renderer Firebase sync, `CI=1`, and `TZ=UTC`; no hosted service or customer state is used. The first isolated attempt could not import the shared Player domain because Expo's base TypeScript configuration was not yet installed: zero tests ran. After all four independent lockfile-preserving installs, the unchanged four provider tests passed. Three additional failure/recovery characterization tests passed before the provider changed. The expanded ordering suite then produced seven failures and nine passes against the original provider.

Initial audit scratch files were placed under an ignored Web `out` directory, which still matched the Web compiler/linter's broad source globs and contaminated the parent's first baseline attempt. Exactly those three known synthetic files were moved to ignored repository-root `out/reliability-20261029`; no compiler/lint exclusions were changed. The parent retained that contaminated attempt and reran its baseline after cleanup. This setup error is not reported as a product or pre-existing failure. Subsequent checks use canonical tracked tests and keep evidence outside the Web source tree.

## Narrow change

The provider owns one discovery completion and one pending-refresh bit. Notifications during a read set that bit; the same completion drains one trailing read for the whole burst. Requests do not overlap. Valid responses render even if another notification is already pending, so sustained invalidations do not continually discard visible progress. The ownership cleanup runs in the same continuation as the final pending check, closing the demonstrated microtask handoff gap.

A successful mutation increments a session-local acknowledgement counter. A discovery operation that began before that acknowledgement cannot replace the newer mutation result; it schedules a subsequent authoritative read instead. Rejected mutations leave both the current data and acknowledgement counter unchanged. Existing loading/error recovery, UID-keyed sessions, mutation transport, account isolation and abort-controller ownership remain in place. Unmount clears pending refresh work and aborts owned operations.

The public `refresh(): Promise<void>` signature is preserved. Calls made during one drain return its owned promise directly, avoiding an async adoption wrapper for each notification. Active signed-out refreshes return a resolved promise. Exact-source characterization preserves the original branch-specific retired behavior: signed-in late callbacks settle quietly, while signed-out retired callbacks reject through their returned promise rather than throwing synchronously. The completion waits for the dirty queue to become quiescent and can remain pending under an endless notification stream. Actual production callers use `void refresh()` (the Firestore listener, tournament boundary and My Orbit retry); action busy states await their separate mutation promises. Valid intermediate reads still set the data status to ready. No production spinner awaits drain quiescence.

This is a consistency repair with a bounded freshness cost: one trailing fetch is necessary when notifications arrive after an active read started. It does not add polling, dependency changes, new public API/data shapes, authentication changes, Firebase rules, or deployment behavior.

## Deterministic measurements

| Scenario | Before / after |
| --- | --- |
| 1,000 invalidations during one pending read | Original: one request and dropped follow-up; final: exactly two total requests |
| Discovery concurrency | Final maximum active discovery requests: one |
| Continuous notifications across four reads | Final UI renders revisions 1, 2, 3 and 4 in order |
| 1,000 concurrent refresh callers | Async drain refinement returned 1,000 distinct completion wrappers; final returns one owned completion |
| Membership acknowledgement followed by an older read | Original regresses from approved to stale; final retains the acknowledgement until a subsequent authoritative result |
| Interest express/withdraw acknowledgement followed by an older read | Original loses/restores the interest incorrectly; final preserves the acknowledged state |

Promise cardinality is an allocation/ownership measurement, not a claim about measured process heap bytes. The queue stores a pending bit and acknowledgement counter, rather than one queued operation per notification.

## Validation evidence

Ignored logs are under `out/reliability-web-refresh/` in this worktree:

- `characterization-before.log`: dependency setup failure before shared Expo configuration was installed; zero tests ran.
- `characterization-before-installed.log`: original four tests passed before tracked edits.
- `characterization-expanded-before.log`: three additional characterization cases passed against the unchanged provider.
- `regressions-before.log`: seven ordering regressions failed, nine cases passed before the provider fix.
- `provider-after.log`: all 16 provider cases passed after the queue/acknowledgement fix.
- `promise-characterization-before.log`: five intermediate cases passed before removing the async completion wrapper; its initial retired signed-in rejection expectation was later corrected against the original source.
- `promise-coalescing-before.log`: the intermediate async drain measured 1,000 distinct returned wrappers, failing the new ownership bound.
- `provider-direct-promise-after.log`: all 18 intermediate cases passed before the retired-callback compatibility correction.
- `retired-refresh-original-baseline.log`: both branch-specific retired cases passed against the exact `9c726a55` provider. An ignored root-level Vitest pre-load plugin supplies the Git blob for the same canonical module ID, preserving relative imports and mocks without modifying product/compiler files.
- `retired-refresh-compatibility-regression.log`: the signed-in retired case failed against the intermediate early guard; the signed-out case passed. The final provider restores the original semantics.
- `provider-compatibility-final.log`: all 19 final provider cases passed with one worker and file parallelism disabled.
- `verify-final.log`: the frozen 18-case intermediate snapshot completed 12/13 verification checks. Its 231 Web tests, 85 internal-tool tests, all TypeScript/lint/release checks and three builds passed; the main suite had 2,483 passes, three known hidden-path static-route failures, and 16 existing skips. This run predates the final retired-callback restoration and is not relabeled final-source verification.
- `verify-compatible-final.log`: the final restored 19-case snapshot completed at `2026-10-29T10:02:41Z`, again with 12/13 verification checks passing. All 232 Web tests, 85 internal-tool tests, TypeScript/lint/release/artwork checks and all three production builds passed. The main suite retained exactly 2,483 passes, the same three static-route failures under the `.codex` ancestor, and 16 existing skips. API static-serving source was not changed in this PR.
- `verify-compatible-inputs.json`, `verify-compatible-inputs.patch` and `verify-compatible-inputs-after.json`: the base commit, exact source/test diff and all three input hashes were captured before the final full run, then checked unchanged after it. Only this prose result record was updated afterward.

The final cases also cover synchronous transport throws, failed trailing reads and recovery, original retired-refresh completion/rejection semantics, caller completion through the trailing read, account replacement, unmount cancellation and the final-read/cleanup handoff. Final standalone Web TypeScript and Web lint both passed. The React review checks preserve transient work in refs, functional state updates, stable lifecycle ownership and complete hook dependencies. An independent desktop/sync reviewer found no actionable introduced concurrency/lifecycle issue. Existing out-of-order successful mutation-response replacement and same-UID/profile-null transitions remain outside this discovery-read guard's scope; this PR does not claim to fix them.

The full checks use the reviewed isolated runner and the repository's `scripts/verify.cjs` entrypoint with a minimal environment, memory-mode services, loopback API URLs and disabled Firebase sync. Local-link and whitespace checks validate the final documentation-only result update. No production access, deployment or installer execution occurred. Source/test results are preserved as executed, including failures; no tests, compiler checks or error handling were skipped or weakened to obtain a green result.
