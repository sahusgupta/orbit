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

## Resolution — 2026-08-07

The original `TYPE-007` umbrella dependency was procedural: it protected nearby callbacks in the large renderer while the profile-relationship work was still being decomposed. Reinspection after `TYPE-007H` became decision-blocked showed no semantic or edit overlap. This task changes only the GroupMe candidate state/editor callbacks and deliberately preserves the existing same-name acceptance behavior owned by `TYPE-007H`, so the stale umbrella dependency was removed.

Before production changed, `src/lib/groupMeCandidates.test.tsx` was committed separately as `3b9fc18`. Its eight cases characterize scanning, ignored unmatched text, the required timestamp invariant, name/game/status edits with complete-field and sibling preservation, acceptance persistence, and rejection removal.

The repair removes broad local array/item annotations and lets the canonical `GroupMeCandidate[]` state contract type each setter callback. The render callback now uses the required `GroupMeCandidate` contract, including its required timestamp. No parser, staff-review, edit, accept, reject, waitlist timestamp, persistence, or identity behavior changed.

Verification removed all four owned diagnostics with no replacement diagnostic: root TypeScript moved from 20 to 16 diagnostics in the same two production files. The focused 2-file/11-test run, Player TypeScript, all 32 files/166 tests, and the 1,912-module renderer build passed. Aggregate verification exited 1 only for the expected 16-diagnostic root baseline.
