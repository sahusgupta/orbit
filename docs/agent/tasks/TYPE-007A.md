# TYPE-007A: Preserve complete profiles while grouping duplicates

Status: `ready`

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

Safe only after the characterization tests pass against current behavior.

## Human review

Not required unless characterization reveals a competing duplicate-identity rule.

## Stop conditions

Stop if profile identity is not name-based in all callers or if testing requires changing merge behavior.
