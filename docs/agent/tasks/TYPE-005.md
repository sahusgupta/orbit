# TYPE-005: Restore synchronized-list tuple inference

Status: `complete`

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

## Implementation

- Moved the renderer-owned pure helper to `src/lib/syncedList.ts` so it can be characterized without loading the application entrypoint.
- Typed each synchronized entry as `[string, T]`, constructed `Map<string, T>`, and declared the helper result as `T[]`.
- Removed the prior non-null assertion by checking the typed map result directly.
- Kept the three sync call sites unchanged apart from importing the helper.

## Characterized behavior

Focused tests confirm that the helper:

- selects `id`, then normalized `name`, then normalized `playerName` as its key;
- replaces matching local items in their existing positions;
- uses the last synchronized duplicate when replacing a matching local key;
- preserves local ordering and appends unmatched synchronized items in synchronized order;
- preserves local items without a usable key and ignores synchronized items without one; and
- preserves unmatched synchronized duplicates rather than adding a new deduplication rule.

## Completion verification

- Focused test: `npx --no-install vitest run src/lib/syncedList.test.ts` passed 1 file and 6 tests.
- Root TypeScript: expected failure with exactly 79 diagnostics in the same 6 affected files, down from 88. `TS2322` decreased from 29 to 21 and `TS2769` decreased from 6 to 5; every other diagnostic code and affected-path count remained unchanged.
- All 9 assigned diagnostics disappeared: `src/main.tsx:1181` (`TS2769`) and the 8 `TS2322` diagnostics formerly at `src/main.tsx:3041`, `3042`, `3082`, `3083`, `3128`, `3129`, `3130`, and `3131`.
- Player TypeScript passed with no diagnostics.
- Unit tests passed: 18 files and 87 tests, zero failed or skipped. The existing experimental SQLite warning remained.
- Renderer build passed with 1,911 modules transformed. The existing ExcelJS `eval` and large-chunk warnings remained.
- `npm run verify` exited 1 after running all four gates; root TypeScript alone failed with the expected 79 diagnostics, while Player TypeScript, 18/87 tests, and the 1,911-module build passed.

No public API, persisted shape, Firebase schema, sync key/order behavior, network behavior, TypeScript setting, or dependency changed. No call-site assertion or diagnostic suppression was added. `TYPE-007` remains pending because its other dependency, `TYPE-006`, is still incomplete; no downstream task became newly ready.
