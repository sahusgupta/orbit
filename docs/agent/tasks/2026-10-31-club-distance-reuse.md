# Reuse venue distances during native and Web sorting

[Native filterMapClubs](../../../player-app/src/domain/discovery.ts) and
[Web filterClubs](../../../player-web/src/domain/selectors.ts) calculated each
venue's distance during filtering, then calculated it again for both sides of
every sort comparison. Their shipping callers are the Player map and Web clubs
explorer respectively.

Each selector now records the existing filter calculation in an invocation-local
Map keyed by the snapshot object. Sorting uses that recorded distance with the
same comparator. Every surviving snapshot already passed the calculation, so
there is no eager coordinate work for query/activity rejects. Native distance
checks still precede venue checks. Distinct snapshots sharing a venue ID retain
independent distances; repeated occurrences of one snapshot remain repeated and
still reach the existing filter calculation once per occurrence.

Zero distances, unknown/invalid coordinates, null origins, positive cutoffs,
stable ties, original references and input nonmutation retain their behavior.
The Map is recreated each call, so later origin or published-coordinate changes
are observed. No location permission, geocoding, network, polling or UI changes.

## Measurements

Stable coordinate-property getters return fixed values while the actual
production validation and Haversine functions run. Output/reference assertions
are unchanged between baseline and candidate; counts exclude fixture setup.

| Synthetic fixture | Before coordinate reads | After coordinate reads |
| --- | ---: | ---: |
| Native mixed catalog, 246 occurrences: 193 valid, 53 unknown/invalid | 6,253 | 439 |
| Web shuffled catalog: 128 valid, 2 missing | 3,135 | 258 |
| Web repeated snapshot twice plus one missing snapshot | 18 | 5 |
| Web catalog with unknown origin | 771 | 258 |

The real helper reads valid published coordinates twice and missing/invalid ones
once. The candidate performs that work once per reached input occurrence, without
repeating it in the comparator. Sorting itself remains comparison-based. These
are synthetic property-access counts, not measured CPU, latency, battery, network,
billing or capacity savings. The Map adds temporary memory proportional to the
reached snapshots. The Web cards still calculate their own displayed distance.
Arbitrary stateful getters or coordinate mutation during a synchronous call are
outside the ordinary decoded snapshot contract.

## Validation

- Before editing native source: 8 new characterization and 23 existing discovery
  cases passed. Adding the resource budget produced exactly one failed case with
  both valid/unknown read bounds exceeded; the other 8 cases passed.
- Before editing Web source: 15 new characterization and 39 existing selector
  cases passed. Adding resource budgets produced exactly 3 failures, with the
  other 15 cases passing.
- With unchanged RED test bytes after the patch: all 32 native and 57 Web focused
  cases passed. Duplicate-ID tests place the farther snapshot first, so an ID-keyed
  cache would fail their reference-order oracle. Query/activity rejection still
  reads zero coordinates.
- Native and Web strict TypeScript checks passed independently.
- `npm run verify`: all 13 checks passed; 3,629 tests passed, 16 existing tests
  skipped, and all three production builds passed. The original process exited 0;
  its terminal result was observed at 2026-10-31 23:00:50 UTC. Existing React test,
  ExcelJS eval and chunk-size warnings remain in the raw log.

Regression sources:
[native distance reuse](../../../player-app/src/domain/discovery.distanceReuse.test.ts),
[Web distance reuse](../../../player-web/src/domain/club-distance-reuse.test.ts).
Raw commands, actual exit codes, frozen source/test hashes and outputs are retained
locally in `out/club-distance-cache-20261031/`. Application endpoints were loopback
only, storage was in memory, and sync, dotenv and telemetry were disabled.
The raw aggregate log SHA-256 is
`f9ef239e00cc36e99288bd775777979d6216fce05093d7efe8fc3375327ca955`.
All four checked source/test files remained unchanged throughout that run.

The previously failed nine-epoch/180-minute native sustained validation and its
unexecuted supplemental games gate remain unmet. Local validation started no
native emulator. No production deployment, signed archive or EAS build/submission
was performed.
