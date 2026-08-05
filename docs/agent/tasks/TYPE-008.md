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

Complete the relevant callback-contract batch in `TYPE-007` first if it changes nearby inference.

## Stop conditions

Stop if accepted legacy formats cannot be identified or if normalization requires a profile schema decision.
