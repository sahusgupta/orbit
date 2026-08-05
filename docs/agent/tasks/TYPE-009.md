# TYPE-009: Define the persisted account-restore input contract

## Objective

Resolve 2 account-restore diagnostics with an explicit nullable, versioned persisted-input shape.

## Evidence

`loadStateForAccount` can return `null`, but `loadExistingAccountState` excludes it locally. `Partial<AppState>` is shallow and cannot truthfully describe incomplete nested settings merged with a new pilot access record.

## In scope

- Characterize preload/API and local-storage no-record/current/legacy results.
- Define an explicit persisted input and normalization boundary.
- Align renderer preload declaration nullability with actual bridge behavior.

## Out of scope

Account/auth redesign, storage schema migration, pilot licensing changes, Electron release work, or production account access.

## Allowed areas

Renderer preload declarations, `loadExistingAccountState`, normalization input types, non-production fixtures/tests, and related docs.

## Prohibited changes

Do not change persisted output shape, treat missing required settings as valid without defaults, weaken pilot checks, or use broad deep-partial assertions.

## Acceptance criteria

- Both assigned diagnostics disappear.
- Null/no-record, current, and legacy records have explicit tested behavior.
- Renderer and preload contracts agree.

## Required tests

No record, null, malformed JSON, current record, partial legacy settings, and pilot-access merge fixtures.

## Verification commands

`npm run typecheck`, `npm test`, `npm run build`, `npm run player:typecheck`, `npm run verify`.

## Risks

High: account restore touches persisted state and licensing/authentication boundaries.

## Dependencies

Coordinate with `TYPE-013` if legacy settings retention affects normalization fixtures.

## Stop conditions

Stop if existing persisted schema versions cannot be established or if a migration/public API change is required.
