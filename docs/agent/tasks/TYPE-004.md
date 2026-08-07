# TYPE-004: Prove membership status narrowing across synchronization

Status: `complete`

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

## Completion record

Completed on 2026-08-07. Nine focused cases were added and committed separately as `1ff9bb6` before production changed: Requested, Approved, Active, and Expired each cover existing-profile update and new-profile creation, while Denied proves exact state-reference no-op behavior. Dates, expiration timestamps, plans, payment methods, status values, and source-state immutability are characterized.

After the existing missing/Denied early return, production captures `membership.status` as `Exclude<PlayerClubMembershipRecord['status'], 'Denied'>` and uses that narrowed value through both later branches and the profile-map callback. `Denied` was not admitted to management profiles, and no transition or persisted value changed.

The owned `TS2322` disappeared and root TypeScript decreased from 26 to 25 diagnostics in 2 production files. Player TypeScript, all 28 files/146 tests, and the 1,912-module renderer build passed; aggregate verification failed only on the expected 25-diagnostic root baseline.
