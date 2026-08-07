# TYPE-007D: Coordinate player transition typing and departure identity safety

Status: `pending`

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
