# TYPE-007: Repair renderer callback domain contracts in bounded batches

## Objective

Resolve 51 diagnostics caused by hand-written structural callback types and widened state literals while preserving waitlist, table, profile, and reporting behavior.

## Evidence

Restored React contextual types show callbacks that require optional fields or discard domain fields later expected after object spread. Affected symbols are enumerated in `ROOT_TYPECHECK_REBASELINE.md` and span `duplicateProfiles`, waitlist updates, table/session transitions, profile merge/remove flows, reports, and render lists.

## In scope

- Split work into behavior batches: profile grouping; waitlist edits; session/table transitions; membership/profile merge; report/render callbacks.
- Add characterization coverage before each batch.
- Replace local structural callback annotations with canonical domain types or inference.
- Preserve literal unions deliberately where state objects are constructed.

## Out of scope

Large `App` extraction, UI redesign, persistence/schema changes, feature changes, or opportunistic cleanup.

## Allowed areas

Only the cited `src/main.tsx` callbacks, directly corresponding domain types, and focused tests. A batch should remain independently reviewable.

## Prohibited changes

Do not bulk-delete annotations without review, add `any`/suppression/casts, change state shapes, or combine unrelated functions in one repair commit.

## Acceptance criteria

- Each batch removes only its assigned diagnostics and has before/after characterization coverage.
- All 51 diagnostics eventually disappear without public/stored behavior change.
- Every intermediate commit keeps tests/build passing and documents remaining count.

## Required tests

Waitlist status/timestamp edits, seat/table moves and closes, planned/balanced sessions, profile deletion/merge, report export, and affected rendering branches.

## Verification commands

For every batch: `npm run typecheck`, focused tests, `npm test`, `npm run build`; final batch also `npm run player:typecheck` and `npm run verify`.

## Risks

High: these callbacks mutate persisted operational state and span several product workflows.

## Dependencies

`TYPE-005` and `TYPE-006` should remove helper-level inference noise first.

## Stop conditions

Stop a batch if removing an annotation changes inferred output shape, if runtime intent is ambiguous, or if characterization requires production access/data.
