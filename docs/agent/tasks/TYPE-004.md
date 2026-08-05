# TYPE-004: Prove membership status narrowing across synchronization

## Objective

Resolve the membership `TS2322` without widening the management status union or changing transition behavior.

## Evidence

`applyPlayerProfileDocumentToClubState` returns early for `Denied`, but the source status remains typed as possibly `Denied` inside a later profile-map callback.

## In scope

- Characterize all incoming membership statuses.
- Capture a precisely narrowed allowed status before the callback.
- Preserve membership dates, plans, payment methods, and existing fallback behavior.

## Out of scope

Membership product redesign, payment/identity changes, stored-shape changes, or Firebase deployment.

## Allowed areas

`src/lib/playerSync.ts`, membership fixtures/tests, and canonical types from `TYPE-002`.

## Prohibited changes

Do not admit `Denied` into `ManagementProfile.membershipStatus`, skip status validation, or alter persisted/public state without review.

## Acceptance criteria

- The assigned diagnostic is resolved with an explicit narrowing proof.
- Requested, Approved, Active, Expired, and Denied inputs retain characterized behavior.

## Required tests

One focused case per status plus expiration/date and no-existing-profile cases.

## Verification commands

`npm run typecheck`, `npm run player:typecheck`, `npm test`, `npm run build`, `npm run verify`.

## Risks

Medium/high because membership eligibility is a product and persisted-state invariant.

## Dependencies

`TYPE-002` if membership types move into a canonical contract.

## Stop conditions

Stop if Denied records should mutate existing management profiles or if current transition intent is ambiguous.
