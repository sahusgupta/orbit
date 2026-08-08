# TYPE-008: Validate and normalize profile imports

## Objective

Resolve 2 profile-import diagnostics through a truthful untrusted-input boundary while preserving accepted import formats.

## Evidence

`importProfiles` permits JSON-derived `unknown[]` in `preferredGameIds` and declares a text-line callback parameter as an incompatible object rather than `string`.

## In scope

- Characterize current JSON and delimited-text formats.
- Parse from `unknown` into a complete normalized `PlayerProfile`.
- Validate arrays, aliases, numeric values, defaults, and malformed rows.

## Out of scope

Import UI redesign, new file formats, profile schema changes, or bulk data migration.

## Allowed areas

`importProfiles`, existing import helpers, and isolated import fixtures/tests.

## Prohibited changes

Do not trust/cast raw JSON to domain types, silently drop previously accepted valid data, or alter stored profile shape.

## Acceptance criteria

- Both assigned diagnostics disappear.
- Valid existing JSON/text examples normalize identically.
- Malformed values have explicit tested fallback/rejection behavior.

## Required tests

JSON arrays, delimited rows, aliases, invalid/non-string game IDs, missing values, numeric coercion, and malformed input.

## Verification commands

`npm run typecheck`, focused import tests, `npm test`, `npm run build`, `npm run verify`.

## Risks

Medium/high: compatibility and imported persisted data can change subtly.

## Dependencies

Complete `TYPE-007A` and `TYPE-007H` first. Those batches establish complete `PlayerProfile` values and profile-link callbacks adjacent to the import commit path; unrelated table/report children of the `TYPE-007` umbrella do not gate this work.

## Stop conditions

Stop if accepted legacy formats cannot be identified or if normalization requires a profile schema decision.

## Resolution — 2026-08-07

`TYPE-007A` was already complete. Reinspection showed that the remaining `TYPE-007H` dependency was procedural rather than semantic: pasted input is normalized into complete profiles before the unchanged commit/linking function, while `TYPE-007H` governs same-name identity choices elsewhere. The parser repair preserves that existing first-name-match linking behavior and does not choose an identity policy, so the stale dependency was removed.

Before production changed, three passing UI-level characterization cases were committed as `2c4df0f`. They preserve complete valid JSON arrays, aliases, string-to-number coercion, game aliases and de-duplication, delimited rows, missing-value defaults, invalid-game fallback, and malformed-JSON fallback to the accepted text format. A fourth boundary case was then added for invalid JSON members and fields.

The JSON parse result is now explicitly `unknown`. Only non-empty named object records proceed, nested arrays and count objects are checked before use, non-string IDs and companions are rejected, tags are narrowed to the existing `TableTag` vocabulary, and non-finite numeric inputs fall back to zero. Each admitted record is returned as a complete `PlayerProfile`; the delimited callback now receives its actual `string` input. No file format, UI, stored profile shape, duplicate handling, companion-linking behavior, or valid input result changed.

Verification removed both assigned diagnostics with no replacement diagnostic: root TypeScript moved from 16 to 14 diagnostics in the same two production files. The focused 1-file/4-test run, Player TypeScript, all 33 files/170 tests, and the 1,912-module renderer build passed. Aggregate verification exited 1 only for the expected 14-diagnostic root baseline.
