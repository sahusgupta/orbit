# TYPE-013: Decide the legacy settings migration contract

## Objective

Resolve the legacy settings `TS2352` through a reviewed compatibility contract or an evidence-backed removal decision.

## Evidence

`normalizeState` casts the entire current settings object to `Record<string, "Time" | "Drop">` to read an obsolete dynamically named collection-mode field.

## In scope

- Identify the historical persisted key and retention requirement.
- Add legacy saved-state fixtures.
- Model a narrow legacy normalization input or remove the branch after approval.

## Out of scope

Current settings redesign, storage schema overhaul, account migration rollout, or unrelated normalization cleanup.

## Allowed areas

`normalizeState`, persisted-input types, legacy fixtures/tests, and migration documentation.

## Prohibited changes

Do not use a double cast, silently stop loading supported installations, or change current persisted output.

## Acceptance criteria

- The assigned diagnostic disappears.
- Supported legacy and current fixtures normalize deterministically.
- The retention/removal decision is documented.

## Required tests

Historical key present/absent, current settings, corrupt/unknown values, and default fallback fixtures.

## Verification commands

`npm run typecheck`, focused normalization tests, `npm test`, `npm run build`, `npm run verify`.

## Risks

Medium/high: old installations may depend on this compatibility path.

## Dependencies

None, but the decision informs `TYPE-009` account-restore fixtures.

## Stop conditions

Stop if the historical shape or support window cannot be established or removal needs a product/release decision.
