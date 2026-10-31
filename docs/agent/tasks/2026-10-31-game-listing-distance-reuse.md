# Reuse venue distances across Web game listings

[flattenGames](../../../player-web/src/domain/selectors.ts) previously calculated
the same venue distance once for every game. Its shipping callers include game
discovery/filtering, game route lookup and club detail listings.

Each outer club occurrence now has a lazy distance value. The first game still
evaluates state, then distance, then stakes; later games reuse that distance while
still evaluating their own state and stakes. An explicit undefined sentinel keeps
zero and null results cached. Empty game arrays calculate no distance. Repeated
outer club occurrences and subsequent invocations start fresh, including when
origins or published coordinates change.

The listing keys remain `club`, `game`, `state`, `distanceMiles`, `stakes`, in that
order. Every game occurrence still creates its own wrapper with the original club
and game references. Input ordering, duplicate IDs/references, state/stakes values,
route ambiguity and input nonmutation are preserved. Mapping remains eager: a
later game failure still propagates before route lookup can return an earlier
canonical match. No caller, public type, API, network, polling or UI changes.

## Measurements

Stable coordinate-property getters instrument the actual validation/Haversine
path, with unchanged listing-value/reference oracles and no distance mocks.

| Synthetic fixture | Before coordinate reads | After coordinate reads |
| --- | ---: | ---: |
| 16 valid + 8 missing venues, 32 games each, plus 2 empty venues | 1,280 | 40 |
| 6 games at a zero-distance venue | 12 | 2 |
| 6 games at a missing-coordinate venue | 6 | 1 |
| 6 games at an invalid-coordinate venue | 6 | 1 |
| 6 games with a null origin and valid venue coordinate | 12 | 2 |
| Same nonempty venue occurrence twice, 6 games each | 24 | 4 |

The main fixture still returns all 768 listings with identical fields and original
references. Counts exclude fixture construction. The saving is repeated distance
validation/calculation, not game state, stakes, listing allocation, filtering or
sorting. Default-null route callers retain null distances while avoiding repeated
coordinate validation. These are synthetic operation counts, not measured CPU,
latency, battery, network, billing or capacity savings. Coordinate values must be
stable during the synchronous call; arbitrary stateful accessors are not an
ordinary decoded snapshot contract.

## Validation

- Against unchanged source: 16 new characterization and 39 existing selector cases
  passed. These cover shape/order/references, frozen inputs, empty arrays, fresh
  origins and first-state/distance/stakes failure order, including eager later
  failures during route lookup.
- Adding resource regressions produced exactly 6 failed cases with the 16
  characterization cases still passing.
- With unchanged RED test bytes after the patch: all 22 new and 39 existing cases
  passed. Web strict TypeScript also passed independently.
- `npm run verify`: all 13 checks passed; 3,651 tests passed, 16 existing tests
  skipped, and all three production builds passed. The original process exited 0;
  its terminal result was observed at 2026-10-31 23:13:05 UTC. Existing React test,
  ExcelJS eval and chunk-size warnings remain visible in the raw log.

The regression source is
[game-listing-distance.test.ts](../../../player-web/src/domain/game-listing-distance.test.ts).
Actual commands, exit codes, source/test hashes and raw outputs are retained locally
under `out/game-distance-reuse-20261031/`. Application endpoints were loopback only,
storage was in memory, and sync, dotenv and telemetry were disabled.
The raw aggregate log SHA-256 is
`1bb9a54f0833556bb54f27963ca7bb3f54485fa32f0587bae11cc41f1d46497e`.
The edited source/test and unchanged shared distance helper retained their frozen
hashes throughout that run.

The previously failed nine-epoch/180-minute native sustained validation and its
unexecuted supplemental games gate remain unmet. Local validation started no
native emulator. No production deployment, signed archive or EAS build/submission
was performed.
