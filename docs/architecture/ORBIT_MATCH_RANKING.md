# Orbit Match ranking

`player-app/src/domain/orbitMatchCandidates.ts` derives a complete catalog from the player-safe published club snapshots and tournament records. Saved-game resolution uses this full catalog, including inactive games and current requests; the recommendation deck removes inactive/paused games, current requests, saved/passed game references, venue exclusions, and incompatible strict filters. A pass applies to one game and never becomes a venue exclusion or attendance inference.

The five normalized factors remain cost/stakes 30, proximity 25, variant 20, availability 15, and venue 10. Each factor lies from zero to one; the weighted sum is normalized to 100. Missing evidence earns no compatibility points. Reasons state published facts or explicit preference relationships. Stable reference tie-breaking and limited venue diversity only reorder eligible records; they never relax filters. The hook uses the default limit of 100 recommendations.

The cost/stakes factor uses different factual units for the two formats: cash uses an explicitly recognizable big blind in dollars and the player's big-blind range; tournaments use the numeric published buy-in in dollars and the player's buy-in range. A tournament name's numeric blind label is not a substitute for its buy-in. A missing appropriate range or cost earns zero cost points, and cash buy-in is never fabricated. Values inside the selected range score one; smaller/larger values fall smoothly by their ratio to the nearest range boundary. A published zero buy-in can match a range containing zero. Strict stakes and buy-in behavior remains separately enforced before scoring.

Cash availability comes only from current published running-table seats and queue counts. Cash playing-day/time schedules are unavailable and are not inferred from the clock, table creation time, venue address, or a player's historical actions. Forming and scheduled games are never described as live or as having known available seats.

Scheduled tournament availability can instead match the actual published `startsAt`. The timestamp must specify an absolute offset or `Z`; invalid or ambiguous timestamps earn no schedule points. Selected day and time preferences contribute equally within the existing 15-point availability factor. Daytime is 06:00 through 17:59; evening is 18:00 through 23:59, in the explicitly supplied device time zone. An unselected dimension contributes neither reward nor penalty. The pure ranker defaults to UTC; invalid zones fall back to UTC. `usePlayerMatch` supplies the runtime's current device zone and exposes it for preference explanations. These remain soft schedule preferences, not exclusions or operational registration promises.

Exploration uses only explicit favorite venues and currently saved game venue references as the known-venue set. When that set exists, enabling exploration grants a venue outside it at most five normalized score points inside the existing venue factor; custom weights retain the same five-point ceiling. Favorites keep their explicit preference score. No known-venue set means no exploration bonus. Passed games do not establish attendance, familiarity, or a venue dislike. The explanation is “Outside your favorite and currently saved venues.”

Active radius filters require a finite, nonnegative distance within the chosen finite radius. Unknown, `NaN`, infinite, and negative distances are excluded. Mileage explanations also require finite nonnegative distance. The shared distance helper clamps the intermediate Haversine value to its mathematical interval: a regression first reproduced `NaN` for valid antipodal points, then passed after the clamp. Invalid coordinates still return `null`.

The Match hook memoizes ranking against semantic preferences and decision reference/status values. Telemetry-only controller snapshots clone records but reuse the ranked result. Preference changes, saves/passes/removals, device-zone changes, and updated live catalog data still rerank. Saved-game details continue to use complete current decision records, so acknowledgement metadata is not frozen by this optimization.

## Local performance evidence

On October 12, 2026, the actual pure ranker was bundled locally with the repository's installed esbuild and measured on Windows x64, Node 22.16.0. The synthetic catalogs used 70 venues, 10% scheduled tournaments, varied valid cash stakes/variants, seat/queue facts, distances, radius/exclusions, and 150 decisions. Each size used five warmups followed by 30 measured calls, returning at most 100 records. No hosted service was accessed, and no wall-clock threshold is asserted by tests.

| Candidate input | Median | p95 | Returned |
| --- | ---: | ---: | ---: |
| 4,000 | 4.70 ms | 5.58 ms | 100 |
| 6,000 | 8.26 ms | 8.89 ms | 100 |

Temporary harness and JSON evidence remain under ignored `out/player-match-ranking/`; they are local output, not shipped source. These are desktop Node measurements of pure ranking, not native frame-time or device-memory evidence. No ranking algorithm overhaul was justified by this measurement. The meaningful optimization is avoiding repeated sorts for telemetry snapshots. Focused tests also exercise a 6,000-record catalog and confirm deterministic ordering with the default 100-record bound.
