# Tournament discovery join performance

This focused change starts from main `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-tournament-indexes`. It changes the Native and Web tournament selectors, their existing test files, and this record. It does not change transport requests, public APIs, persisted shapes, authentication, publication/revision semantics, dependencies or deployment settings.

## Observed work and preserved behavior

The [Native selector](../../../player-app/src/domain/discovery.ts) is called by the tournament `useMemo` in `player-app/src/PlayerApp.tsx`. The [Web selector](../../../player-web/src/domain/selectors.ts) is called by `player-web/src/components/discovery/tournaments-explorer.tsx`. Each previously searched the full club and interest arrays separately for every tournament when discovery or filters changed. These related-record joins grew as `T * (C + I)` for tournament, club and interest counts, in addition to the existing filtering and sorting.

Each invocation now builds a first-match club index and a nested raw-club-ID/raw-tournament-ID interest index, then joins by lookup. Join work is `C + I + T`; the existing date sort still costs up to `T log T`, and distance/search work remains unchanged. The maps hold additional references for the duration of one invocation and are not retained as a cache. Tiny inputs can incur extra map-allocation overhead; no reduction in transport reads, retained heap or every-call elapsed time is claimed.

First-match behavior is intentional. Native selects the first record with the exact requested player ID and `interested` status, including an exact match for an empty player ID. Web selects the first matching player record regardless of status, or the first record from any player when no player ID is supplied. A first withdrawn Web record must not be replaced by a later interested duplicate. Both selectors retain the first club snapshot for duplicate IDs. Nested maps avoid separator collisions and prototype-like keys without normalizing raw IDs.

Characterization preserves duplicate tournaments, stable ordering for equal start times, original tournament/club/interest references, input immutability, absent-club filtering, and the existing filter/time/distance behavior. Native still omits past events; Web still retains them with the all-interest filter. Empty tournament arrays still normalize the existing filters, then return without reading related records.

## Reproduction and measurement

The original existing suites passed first: Native 14 tests and Web 30 tests. Additional characterization then passed against unchanged production source: Native 19 and Web 35. Four linear-operation-budget cases per selector were added next; all eight failed on the original implementation while the 54 characterization cases continued to pass. These cases count raw related-record identifier reads through valid synthetic property getters, allowing a generous linear bound rather than asserting a particular map implementation or wall-clock threshold. After indexing, all Native 23 and Web 39 cases pass.

An ignored helper, `out/reliability-tournament-indexes/measure-actual-selectors.mjs`, bundles the exact baseline selector text obtained with `git show 9c726a55fc353c0edda31c6d1e8843c76a8a652c:<path>` and the actual working selector text. It records source hashes and compares both variants against the same synthetic objects, asserting equal result order, object identity and distance values. Local shared pure dependencies are unchanged. This is a comparison of the implemented code, separate from an earlier discarded indexing prototype.

Deterministic related-record identifier reads are the same for Native and Web:

| Clubs / tournaments / interests | Club ID reads before / after | Interest club ID reads before / after |
| --- | --- | --- |
| 1 / 1 / 1 | 1 / 1 | 1 / 1 |
| 10 / 50 / 50 | 275 / 10 | 1,275 / 50 |
| 50 / 250 / 250 | 6,375 / 50 | 31,375 / 250 |
| 1,000 / 5,000 / 0 | 2,502,500 / 1,000 | 0 / 0 |
| 1,000 / 5,000 / 5,000 | 2,502,500 / 1,000 | 12,502,500 / 5,000 |

The same helper separately measures uninstrumented data after three warmups, using nine samples and alternating variant order. The following median milliseconds were observed on Windows x64 / Node 22.16.0 at 10:21:31 UTC on 2026-10-29:

| Clubs / tournaments / interests | Web before / after ms | Native before / after ms |
| --- | --- | --- |
| 1 / 1 / 1 | 0.01 / 0.02 | 0.01 / 0.02 |
| 10 / 50 / 50 | 0.18 / 0.14 | 0.33 / 0.29 |
| 50 / 250 / 250 | 1.73 / 0.45 | 2.37 / 1.02 |
| 1,000 / 5,000 / 0 | 37.46 / 8.03 | 70.14 / 12.50 |
| 1,000 / 5,000 / 5,000 | 438.99 / 10.91 | 455.95 / 15.48 |

These are observational shared-host timings while another worktree ran verification typechecks. They are not browser, Hermes, device, frame-time, production-load or UI-latency measurements. Small and medium scenarios are included to expose map overhead, and the larger scenarios characterize scaling. Full samples and source hashes remain ignored in `actual-selector-comparison.json`; operation counts are the primary regression evidence.

## Verification record

- Original suites: `native-characterization-original.log` (14 passes) and `web-characterization-original.log` (30 passes).
- Expanded characterization before production edits: `native-characterization-expanded.log` (19 passes) and `web-characterization-expanded.log` (35 passes).
- Expected failing operation budgets before production edits: `native-budget-before.log` (4 failures / 19 passes) and `web-budget-before.log` (4 failures / 35 passes).
- After implementation: `native-indexed.log` (23 passes) and `web-indexed.log` (39 passes), one worker per focused run and file parallelism disabled.
- `npm run player:typecheck` and `npm run typecheck --prefix player-web` passed. Web ESLint (`npm run lint --prefix player-web`) passed. Whitespace checks passed.
- Root and independent sync-agent review found no actionable introduced issue after checking raw tuple equality, different Native/Web eligibility rules, per-invocation index lifetime, the unchanged filter/sort pipeline and the new tests.
- Full `npm run verify` behavior ran through the reviewed isolated environment runner from this worktree, 10:34:43–10:40:48 UTC on 2026-10-29. It returned exit code 1 with 12 of 13 aggregate checks passing. All root/Player/Web/internal TypeScript checks, Web lint, release/artwork checks and all three production builds passed. Web tests: 226 passes; internal tests: 85 passes; main suite: 2,492 passes, 16 existing skips and the same three `apps/api/src/server.routes.test.js` static-route failures observed in the clean exact-base baseline under a `.codex` ancestor. Those failures cover legal assets, self-check-in assets and the dashboard; no API route-serving code changed or failure was converted into a pass. Log: `full-verify.log`.
- All five source/test/document input hashes and the exact baseline HEAD remained unchanged during the full run (`verify-inputs.json`, `verify-inputs.patch`, `verify-inputs-after.json`). Only this verification-result prose was appended afterward; both local documentation links, whitespace checks and the final complete diff were reviewed again.

All experiments use synthetic data and pure selectors. Test commands select loopback/unreachable API endpoints and disable Firebase synchronization. Generated bundles, benchmark helpers, logs and dependency directories remain ignored. No production service, cloud build, deployment or data was accessed.
