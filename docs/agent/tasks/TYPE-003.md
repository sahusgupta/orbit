# TYPE-003: Preserve domain types through Firebase synchronization

## Objective

Resolve 4 `REAL_TYPE_ERROR` diagnostics while preserving complete `ManagementClubState` and tournament shapes through Firebase transforms.

## Evidence

`syncPlayerUpdatesToClubState` assigns broad `Record<string, any>` results to `ManagementClubState`; two tournament callbacks in `publishClubSnapshot` are implicitly untyped.

## In scope

- Characterize registration/revenue transformations and publication payloads.
- Define precise untrusted-input and validated domain types.
- Make transformations preserve required management fields.

## Out of scope

Production Firebase access, deployment, collection/schema redesign, auth/rules changes, or cleanup scripts.

## Allowed areas

`src/lib/firebaseClubSync.ts`, canonical types established by `TYPE-002`, isolated fixtures, and focused tests.

## Prohibited changes

Do not add `any`, assertions that bypass validation, field-dropping fallbacks, weaker errors, or live-service calls.

## Acceptance criteria

- All 4 assigned diagnostics are resolved.
- Missing/malformed remote fields have explicit tested behavior.
- Transform ordering/idempotency and protocol-v2 publication semantics are preserved.

## Required tests

Registration, tournament, revenue, malformed-input, idempotency, revision, and publication-shape characterization tests.

## Verification commands

`npm run typecheck`, `npm test`, `npm run build`, `npm run player:typecheck`, `npm run verify`.

## Risks

High: this boundary can publish or merge player-facing state.

## Dependencies

`TYPE-002` canonical snapshot/domain decision.

## Stop conditions

Stop if current behavior cannot be characterized without production data or if a persisted/public schema change is required.
