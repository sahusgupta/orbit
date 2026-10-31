# Tournament route lookup resource pass

The Player Web tournament detail page and its metadata generator both call
[findTournamentByRouteKey](../../../player-web/src/domain/selectors.ts). Previously,
each canonical tournament candidate searched the clubs array from the beginning.
Late or absent matches could therefore repeat the same venue traversal for every event.

The selector now keeps a first-occurrence club index and one advancing cursor for
each invocation. It indexes only the prefix needed by the current candidate, so an
early canonical match still stops immediately. Canonical match order, the unique
raw-ID fallback, orphan-event `orbit` labels, original object references and route
encoding are preserved. Duplicate clubs keep their first snapshot; a subsequent
call observes current names and ordering. No caller, network, polling or UI delay changes.

## Measured work

Stable ID getters instrument the real selector and formatter in synthetic fixtures;
they do not replace either function. Counts exclude fixture construction.

| Fixture | Before club-ID reads | After club-ID reads |
| --- | ---: | ---: |
| 128 clubs, 512 events for the last club, missing route | 65,536 | 128 |
| Same inventory, final canonical route | 65,536 | 128 |
| First event at first club, early canonical route | 1 | 1 |
| Empty event inventory | 0 | 0 |
| 128 events targeting 128 distinct clubs in reverse order | Not measured | 128 |

The first two cases reduce measured club-ID reads by 99.80%. The visited club
prefix is traversed once; route-key formatting and raw-ID filtering still run as
before. Extra per-call memory is proportional to distinct visited clubs. These are
operation counts, not measured production latency, CPU, memory savings or capacity.
Arbitrary accessor side effects and mutation during a synchronous call are outside
the decoded plain-data contract.

## Validation

- Existing selector suite: 39 passed before and after the source change.
- Characterization: 17 passed against unchanged source, covering canonical/raw
  priority, duplicate IDs and snapshots, orphan events, first references, frozen
  inputs and fresh calls after rename/reorder.
- Initial resource regressions: 19 passed and exactly two scan-budget tests failed
  against unchanged source. All 21 then passed with the same test bytes after the fix.
- Review added a reverse-order distinct-club case to prevent a future per-ID cache
  from passing the resource budgets while retaining repeated scans. That case was
  added after the source change; no baseline measurement is claimed for it.
- Final focused suite: 22 passed, including the added distinct-club case.
- `npm run verify`: all 13 checks passed; 3,602 tests passed, 16 existing tests
  skipped, and all three production builds passed. The original process exited 0;
  its terminal result was observed at 2026-10-31 22:51:01 UTC. Existing React test,
  ExcelJS eval and chunk-size warnings remain in the raw log.
- Player Web strict TypeScript passed independently.

The final regression source is
[tournament-route-lookup.test.ts](../../../player-web/src/domain/tournament-route-lookup.test.ts).
Actual isolated commands and raw outputs are preserved locally under
`out/web-tournament-lookup-20261031/`; application endpoints were loopback-only,
storage was in memory, and sync, dotenv and telemetry were disabled.
The raw aggregate log SHA-256 is
`ad9e49a3a5ca60605c2b232033fa4baae1935746f389495000cd7052cd46adf5`.
The checked source/test bytes remained unchanged throughout the aggregate run.

This task does not change the previously failed nine-epoch/180-minute native
sustained validation or its unexecuted supplemental games gate. No production
service, deployment, signed iOS build or EAS submission was used.
