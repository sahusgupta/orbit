# TYPE-007A: Preserve complete profiles while grouping duplicates

Status: `complete`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve the 2 duplicate-profile grouping diagnostics without changing how possible duplicates are detected or ordered.

## Root cause

`duplicateProfiles` annotates its `forEach` parameter as a partial structural object. That callback contract discards required `PlayerProfile` fields before the value is inserted into `Map<string, PlayerProfile[]>`.

## Exact owned diagnostics

- `src/main.tsx:2631:24` — `TS2322`
- `src/main.tsx:2631:52` — `TS2740`

## Files and symbols

- `src/main.tsx`: `PlayerProfile`, `duplicateProfiles`
- Focused characterization: `src/lib/profileGrouping.test.ts` or an equivalently focused test colocated with an extracted pure helper

## Runtime behavior that must be preserved

Normalize names with `trim().toLowerCase()`, preserve source profile order within each group, preserve first-seen group order, and return only groups containing more than one complete profile.

## In scope

Characterize the grouping operation and restore the callback/value contract to `PlayerProfile` through contextual or canonical typing.

## Out of scope

Changing duplicate identity rules, fuzzy matching, merge semantics, profile schema, or profile UI.

## Prohibited changes

Do not add partial profiles, casts, `any`, new deduplication rules, sorting, or automatic merging.

## Characterization tests required before implementation

Cover whitespace/case normalization, unique names, three same-name profiles, group/order stability, and preservation of all optional and required fields by object identity or deep equality.

## Acceptance criteria

Both owned diagnostics disappear, no new diagnostic appears, and characterized grouping output is unchanged.

## Verification commands

`npx --no-install vitest run src/lib/profileGrouping.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

Low/medium. The computation is read-only, but its output drives destructive profile merge UI.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Completed only after the focused characterization passed against the unchanged implementation.

## Human review

Not required unless characterization reveals a competing duplicate-identity rule.

## Stop conditions

Stop if profile identity is not name-based in all callers or if testing requires changing merge behavior.

## Implementation

- Added a focused jsdom characterization that loads the unchanged renderer with local state, disabled Firebase behavior, and stubbed network access.
- Replaced only the duplicate-group callback's partial structural annotation with the canonical `PlayerProfile` type.
- Kept the `Map<string, PlayerProfile[]>`, normalization expression, array construction, filtering rule, render path, and merge call unchanged.

## Characterized behavior

The input is `state.profiles`, whose canonical type is `PlayerProfile[]`. The grouping key remains `profile.name.trim().toLowerCase()`. Each append creates a new group array while retaining the same complete profile object from state. JavaScript `Map` insertion order preserves the first-seen group order, array append preserves source order inside each group, and the final filter excludes singleton groups. The profile screen renders groups in that order and passes each group to `mergeDuplicateProfiles`.

The focused fixture covers a unique profile, a three-profile whitespace/case-normalized group, three duplicate groups, source/group ordering, rendered ordering, and deep preservation of every required and optional profile field.

## Completion verification

- Pre-change focused gate: `npx --no-install vitest run src/lib/profileGrouping.test.ts` passed 1 file and 1 test against unchanged production source.
- Test-only checkpoint: `e4fbb7a` (`test: characterize duplicate profile grouping`).
- Post-change focused gate: the same command passed 1 file and 1 test.
- Root TypeScript: expected failure with exactly 69 diagnostics in 4 files, down from 71. `TS2322` decreased from 18 to 17, `TS2740` decreased from 1 to 0, and `src/main.tsx` decreased from 62 to 60 diagnostics; every other code and path count remained unchanged.
- Both owned diagnostics disappeared: `src/main.tsx:2631:24` (`TS2322`) and `src/main.tsx:2631:52` (`TS2740`).
- Player TypeScript passed with no diagnostics.
- Unit tests passed: 20 files and 97 tests, zero failed or skipped. The existing experimental SQLite warning remained.
- Renderer build passed with 1,912 modules transformed. The existing ExcelJS `eval` and large-chunk warnings remained.
- `npm run verify` exited 1 after all four gates; root TypeScript alone retained the expected 69-diagnostic baseline, while Player TypeScript, 20/97 tests, and the 1,912-module build passed.

No runtime logic, profile schema, persisted shape, Firebase/API behavior, merge behavior, compiler setting, dependency, cast, assertion, `any`, or diagnostic suppression changed. `TYPE-007` remains pending on its other nine children. `TYPE-008` remains pending on `TYPE-007H`, so no downstream task became newly ready.
