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

## Resolution record — 2026-08-07

- Desktop records are explicitly nullable and versioned through `PersistedStateRecord`; local legacy storage remains an unversioned state object.
- `PersistedAppState` models optional top-level state plus independently partial settings, and `normalizeState` continues to supply all required current defaults.
- Local parsing now rejects malformed JSON and non-object/settings envelopes as a no-record result without persisting or changing routes.
- Five focused cases cover unavailable bridge/no local record, a null desktop result, a current schema-version-4 record, a partial legacy settings record after bridge failure, malformed JSON, and supplied pilot-access replacement.
- The two owned diagnostics disappeared. The more accurate settings input also removed TYPE-013's cast diagnostic, but TYPE-013 remains a separate legacy-retention audit until its historical fixtures and support intent are established.
