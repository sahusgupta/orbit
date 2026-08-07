# TYPE-010: Align GroupMe candidate state and editor callbacks

## Objective

Resolve 4 GroupMe candidate diagnostics without changing scan, staff-review, edit, accept, or reject behavior.

## Evidence

Three `setGroupMeCandidates` callbacks use broad array/item annotations that erase required fields, and the render callback makes `timestamp` optional before passing a candidate to `acceptGroupMeCandidate`.

## In scope

- Characterize candidate creation and the timestamp invariant.
- Use the contextual `GroupMeCandidate[]` setter/item types.
- Preserve field spreads and edit semantics.

## Out of scope

Message parser redesign, external GroupMe integration, automatic acceptance, or UI redesign.

## Allowed areas

GroupMe candidate state/edit/accept functions in `src/main.tsx` and focused tests.

## Prohibited changes

Do not add `any`, make required fields optional merely to pass TypeScript, or bypass staff review.

## Acceptance criteria

- All 4 assigned diagnostics disappear.
- Name/game/status edits preserve every other candidate field.
- Accepted candidates retain characterized timestamps.

## Required tests

Scan output, each edit control, accept, reject, and missing/present timestamp cases.

## Verification commands

`npm run typecheck`, focused tests, `npm test`, `npm run build`, `npm run verify`.

## Risks

Medium: a partial-state update can lose candidate data or change waitlist timestamps.

## Dependencies

Complete the `TYPE-007` umbrella first. No single child owns the GroupMe setter contract, and retaining the parent dependency avoids overlapping edits to the same large renderer callback surface before its decomposition is complete.

## Stop conditions

Stop if the parser can intentionally produce candidates without timestamps or if acceptance semantics are unclear.
