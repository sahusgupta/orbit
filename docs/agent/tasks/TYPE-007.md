# TYPE-007: Renderer callback domain-contract umbrella

Status: `pending` (`decomposed` umbrella)

## Objective

Coordinate the remediation of the 51 renderer callback diagnostics without treating them as one implementation change.

## Root cause

Hand-written structural callback parameter annotations in `src/main.tsx` make optional domain fields required, discard fields preserved by object spread, or remove contextual typing from constructed state. A smaller set of unannotated state literals widens status values from their canonical unions. Restored React types exposed these previously masked contracts.

## Diagnostic ownership

This umbrella owns no diagnostic directly. Its former 51 diagnostics are delegated exactly once:

| Batch | Contract | Diagnostics | Safety |
| --- | --- | ---: | --- |
| `TYPE-007A` | Duplicate-profile grouping | 2 | `SAFE_AFTER_TESTS` |
| `TYPE-007B` | Waitlist patch updates | 5 | `SAFE_AFTER_TESTS` |
| `TYPE-007C` | Timestamp/manual-correction propagation | 6 | `SAFE_AFTER_TESTS` |
| `TYPE-007D` | Player move/leave transitions | 6 | `SAFE_AFTER_TESTS` |
| `TYPE-007E` | Forming and balanced table creation | 4 | `SAFE_AFTER_TESTS` |
| `TYPE-007F` | Planned-participant contract | 5 | Completed under approved Option C |
| `TYPE-007G` | Table lifecycle updates and events | 8 | `SAFE_AFTER_TESTS` |
| `TYPE-007H` | Profile relationship mutations | 10 | `HUMAN_DECISION_REQUIRED` |
| `TYPE-007I` | Table-event report projections | 2 | `SAFE_AFTER_TESTS` |
| `TYPE-007J` | Read-only floor collection rendering | 3 | `SAFE_AFTER_TESTS` |
| **Total** | | **51** | |

The full diagnostic inventory and ownership proof are in `docs/agent/TYPE-007_DECOMPOSITION.md`.

## Runtime behavior that must be preserved

- `AppState`, `Interest`, `PlayerSession`, `GameSession`, `PlayerProfile`, `ParticipantCandidate`, `TableEvent`, and `GameConfig` persisted shapes.
- Waitlist timestamps, statuses, correction markers, demand prompts, table seat counts, notification triggers, cash-out/profile-hour updates, planned-player ordering, profile link rewrites, and report/render output.
- API-first persistence and local fallback, Firebase publication behavior, account isolation, and sync protocol v2 behavior.

## In scope

- The ten child specifications listed above.
- Focused characterization before each implementation batch.
- Canonical domain types, contextual callback typing, exact type guards, and deliberately typed state construction.

## Out of scope

Large `App` extraction, UI redesign, public or persisted schema changes, import normalization (`TYPE-008`), GroupMe state repair (`TYPE-010`), or unrelated renderer cleanup.

## Prohibited changes

Do not bulk-delete annotations, add `any`, assertions, suppressions, or exclusions, weaken domain types, or combine child batches into one implementation commit.

## Acceptance criteria

- Every child batch is completed under its own specification.
- The parent is marked complete only after all 51 delegated diagnostics are absent and no replacement diagnostic appears.
- Tests/build remain green and the root baseline decreases only by the diagnostics owned by completed children.

## Verification commands

Each child runs its focused test, `npm run typecheck`, `npm test`, and `npm run build`. The final child also runs `npm run player:typecheck` and `npm run verify`.

## Risks

High in aggregate. The children touch persisted operational state and are deliberately separated so review can reason about one behavior at a time.

## Dependencies

The children depend on completed `TYPE-005` and `TYPE-006`. This umbrella depends on all ten children and therefore cannot complete while `TYPE-007H` awaits an identity-policy decision.

## Autonomous implementation

Not safe as an umbrella. Autonomous work is permitted only at the child classification stated in that child's specification.

## Human review

Required for umbrella completion and specifically before `TYPE-007H` implementation. Review for `TYPE-007F` Option C was completed on 2026-08-07.

## Stop conditions

Stop if diagnostic ownership drifts, a child requires a public/persisted/Firebase/API contract change, a state transition cannot be characterized locally, or any proposed correction changes runtime behavior outside an approved human decision.
