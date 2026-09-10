# Table action lag and time balance corrections

Scope: management desktop/browser table operations, based on main `8d086bfd689b7f0af1037468c0764d16b32d77bc`.

## Findings and fixes

- A poll could finish after a newer local action and replace the optimistic balance with an older server snapshot. Polling now pauses during saves for the active account, rejects responses if local state changed during the read, prevents overlapping browser polls, and rejects desktop offline-cache records.
- An older Electron read could roll back the expected server revision and encrypted recovery cache after a newer save. Outdated responses now fail without replacing either. Existing conflict behavior remains; monetary changes are not automatically replayed.
- Browser persistence wrappers recreated their revision map on each call. They now share an adapter. A conflict does not advance the writable revision until an authoritative reload.
- Time handlers used captured React state, and additions used an outdated selected session. They now use current state and resolve the current open session by ID.
- Whole-minute rounding restored consumed seconds during time mutations. Mutations now retain millisecond precision, paused balances survive additions, and only the displayed countdown rounds to whole seconds. A render clock preceding the action no longer creates a phantom second.
- Polls imported player balances without their associated receipts and operational logs. These slices now reconcile together.
- Rejected additions no longer close the time form or display a success message.

No dependencies, persisted schema, API contracts, authentication, production data, or release controls changed.

## Regression coverage

Coverage includes repeated additions through a stale captured UI handler, stale selected sessions, partial-minute additions/deductions, paused balances, missing/closed players, non-finite input, outdated Electron reads, browser revision retention/conflicts, browser and desktop poll races, offline cache rejection, consistent receipt imports, and rejected UI additions.

The earlier unpushed local commit was removed by workspace maintenance. This patch was reconstructed on the same GitHub base and verified again before publication.

## Verification

`npm run verify` executed all 13 gates. Its initial test TypeScript gate found a missing required `note` field in a new fixture; the fixture was corrected and `npm run typecheck` passed all four TypeScript projects on rerun. All other verification gates passed, including 1,383 root/API/player unit tests (8 existing skips), 209 Player Web tests, 85 sales-map tests, and the three production builds. Focused regression tests: 64 passed. Release-control contract check: passed.

Runtime checks use localhost API endpoints, disabled Firebase sync, Node 22.16.0, npm 10.9.2, and TZ=UTC. Native Windows packaging and promotion belong to the existing `Verify and Promote Desktop Release` workflow and are not claimed as locally verified.
