# TYPE-002: Canonicalize the Player snapshot contract

Status: `complete`

## Objective

Resolve the 4 snapshot-schema diagnostics without changing the published sync protocol accidentally.

## Evidence

`buildPlayerClubSnapshot` emits `social`, `publishClubSnapshot` publishes it, and root tests consume it, but root `PlayerClubSnapshot` omits it. Player owns a related declaration with additional protocol fields.

## In scope

- Characterize the serialized root and Player snapshot shapes.
- Review `social`, `syncProtocolVersion`, `syncRevision`, and commit-marker expectations.
- Establish one versioned canonical contract or an explicit compatibility mapping.

## Out of scope

Firebase deployment, collection renames, payload redesign, Player website implementation, or unrelated shared-package creation.

## Allowed areas

`src/lib/playerSync.ts`, `src/lib/firebaseClubSync.ts`, Player snapshot types/readers, protocol tests, and architecture documentation.

## Prohibited changes

Do not remove emitted fields, weaken Firestore rules, change collection/document names, or update stored/published data without reviewed compatibility evidence.

## Acceptance criteria

- The 4 assigned diagnostics are resolved by a truthful versioned contract.
- Root and Player agree on serialized field meaning and revision semantics.
- Existing payloads remain compatible or an approved migration is documented and tested.

## Required tests

Root/Player snapshot fixtures, Firebase publication-shape tests, protocol-v2 revision and commit-marker tests.

## Verification commands

`npm run typecheck`, `npm run player:typecheck`, `npm test`, `npm run build`, `npm run verify`.

## Risks

This is a public cross-application data contract; a type-only-looking change can break Player synchronization.

## Dependencies

None, but `TYPE-003` and `TYPE-004` should consume the reviewed contract.

## Stop conditions

Stop if root and Player field semantics conflict, production payload samples are required, or a schema/protocol migration decision is needed.

## Completion record

Completed on 2026-08-07 after repository fixtures established an explicit compatibility mapping without a schema migration. The desktop `buildPlayerClubSnapshot` result is the player-safe pre-publication payload and now truthfully requires the `social` summary it already emitted. Firebase publication continues to add protocol-v2 `syncProtocolVersion`, `syncRevision`, `publishedAt`, entity counts, and the parent-club commit marker. The Player hydrated snapshot continues to make revision fields optional solely for legacy publisher compatibility.

The focused pre-change suite passed 3 files/21 tests across root snapshot construction, Player published-game normalization, and protocol-v2 commit/revision selection. A snapshot-key assertion added and committed separately as `20af844` proves the builder does not claim publisher-owned revision metadata. No runtime expression, serialized value, Firebase path, revision rule, or persisted/public shape changed.

All four owned diagnostics disappeared and root TypeScript decreased from 30 to 26 diagnostics in 3 affected production files. Player TypeScript, all 28 files/137 tests, and the 1,912-module renderer build passed; aggregate verification failed only on the expected 26-diagnostic root baseline.
