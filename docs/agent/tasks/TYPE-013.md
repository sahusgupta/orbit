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

## Resolution — 2026-08-07

Repository history establishes the compatibility contract without a new product decision. Commits `4ee2853` and `412bbef` stored `settings.defaultRakeMode` as `'Time' | 'Drop'`, defaulted it to `Drop`, and used it to configure newly created tables. Because tracked installations may contain that shape and no support-window evidence authorizes removal, the branch is retained.

Before production changed, three additional account-restore cases were committed separately as `a484c26`. Together with the existing current/absent settings cases, they prove legacy `Time` restoration, current-key precedence, corrupt-value fallback to `Drop`, omission of the legacy key from normalized current output, and the existing default.

`PersistedSettings` now models only the historical `defaultRakeMode` as `unknown` alongside partial current settings. `normalizeState` narrows that value once and preserves the exact current-key-first, legacy-key-second, `Drop`-fallback behavior. The broad whole-settings casts are gone from this migration branch; current persisted output and every runtime value are unchanged.

TYPE-009 had already removed the original compiler symptom, so root TypeScript remains at 14 diagnostics rather than decreasing. The focused 1-file/8-test run, Player TypeScript, all 33 files/173 tests, and the 1,912-module renderer build passed. Aggregate verification exited 1 only for the expected 14-diagnostic root baseline.
