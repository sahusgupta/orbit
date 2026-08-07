# TYPE-007D: Coordinate player transition typing and departure identity safety

Status: `complete`

Safety: `SAFE_AFTER_TESTS`

Role: umbrella

## Objective

Coordinate the two intentionally separate corrections that were previously grouped as one six-diagnostic task. `TYPE-007D2` first establishes the approved ambiguous-identity departure behavior; `TYPE-007D1` then performs the remaining behavior-preserving canonical callback/domain typing repair.

## Diagnostic delegation

This umbrella owns no diagnostics directly.

- `TYPE-007D1` owns five diagnostics in `movePlayerToTable` and `markPlayerLeft`.
- `TYPE-007D2` owns the one diagnostic at the `markPlayerSessionLeft` state boundary.

Together the children own the original six diagnostics exactly once.

## Required order

1. Characterize current `markPlayerSessionLeft` behavior, including the existing duplicate-name fan-out.
2. Implement and regress the approved ambiguous-identity correction in `TYPE-007D2`.
3. Characterize any remaining move/leave paths needed by `TYPE-007D1`.
4. Repair the remaining canonical callback/domain annotations without further behavior change.

## Children

- `TYPE-007D2` - Resolve ambiguous profile-less departure identity.
- `TYPE-007D1` - Repair behavior-preserving player transition types after `TYPE-007D2`.

## Dependencies

Completed `TYPE-005` and `TYPE-006`, then both child tasks. The child edge is one-way: `TYPE-007D1` depends on `TYPE-007D2`.

## Acceptance criteria

Both children are complete; all six delegated diagnostics are absent; departure identity behavior matches the approved four cases; unrelated move, leave, seating, notification, persistence, ledger, and audit behavior remains characterized; and the dependency graph remains acyclic.

## Stop conditions

Stop if implementation requires a broader identity-system redesign, a schema or sync-protocol change, production access, or a decision about financial behavior not covered by the approved departure rule.

## Completion result

- The split, characterization, behavioral correction, remaining characterization, and canonical typing repair were committed independently.
- `TYPE-007D2` implements the approved exact-ID/unique-name/zero-match/ambiguous-match behavior, with session departure preserved in all four cases.
- `TYPE-007D1` replaces only handwritten transition callback fragments with canonical domain contracts; the characterized move and early-departure behavior is unchanged.
- All six delegated diagnostics are absent. Root typecheck moved from 53 to 47 diagnostics in the same 4 files with no new diagnostic.
- Final focused tests passed 1 file/8 tests; Player TypeScript passed; all 25 files/120 tests passed; and the renderer build passed with 1,912 modules transformed. Aggregate verification exited 1 only for the known 47-diagnostic root baseline.
