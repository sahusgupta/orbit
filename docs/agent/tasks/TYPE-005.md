# TYPE-005: Restore synchronized-list tuple inference

## Objective

Resolve the `mergeSyncedList` tuple error and its 8 duplicate downstream assignment diagnostics without changing merge semantics.

## Evidence

At `src/main.tsx:1181`, the map callback is inferred as `(string | T)[]`, so `Map` loses its `T` value type. Sync merges at lines 3041-3131 consequently return arrays containing `{}`.

## In scope

- Add characterization coverage for key selection, replacement, ordering, empty keys, and appended remote items.
- Give the tuple/map and helper return values precise inferred types without assertions.

## Out of scope

Sync scheduling, API/Firebase transport changes, conflict-resolution redesign, or shared schema work.

## Allowed areas

`mergeSyncedList`, focused pure tests, and only directly necessary call-site typing.

## Prohibited changes

Do not change merge ordering, deduplication keys, network behavior, or cast through `unknown`/`any`.

## Acceptance criteria

- All 9 assigned diagnostics disappear.
- The helper returns `T[]` and preserves characterized runtime output.
- No call-site assertion or public API change is introduced.

## Required tests

Pure helper cases for id/name/playerName keys, duplicates, missing keys, local replacement, and remote append ordering.

## Verification commands

`npm run typecheck`, `npm test`, `npm run build`, `npm run verify`.

## Risks

Low/medium; an inference fix is small, but merge ordering feeds sync state.

## Dependencies

`TYPE-001` should settle the compiler/runtime boundary first.

## Stop conditions

Stop if characterization reveals conflicting key or ordering expectations across the three sync sources.
