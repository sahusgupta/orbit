# TYPE-003: Preserve domain types through Firebase synchronization

Status: `ready`

Safety: `APPROVED_AFTER_CHARACTERIZATION`

## Objective

Resolve 4 `REAL_TYPE_ERROR` diagnostics while preserving complete `ManagementClubState` and tournament shapes through Firebase transforms.

## Evidence

`syncPlayerUpdatesToClubState` assigns broad `Record<string, any>` results to `ManagementClubState`; two tournament callbacks in `publishClubSnapshot` are implicitly untyped.

## In scope

- Characterize registration/revenue transformations and publication payloads.
- Define precise untrusted-input and validated domain types.
- Make transformations preserve required management fields.

## Out of scope

Production Firebase access, deployment, collection/schema redesign, auth/rules changes, or cleanup scripts.

## Allowed areas

`src/lib/firebaseClubSync.ts`, canonical types established by `TYPE-002`, isolated fixtures, and focused tests.

## Prohibited changes

Do not add `any`, assertions that bypass validation, field-dropping fallbacks, weaker errors, or live-service calls.

## Acceptance criteria

- All 4 assigned diagnostics are resolved.
- Missing/malformed remote fields have explicit tested behavior.
- Transform ordering/idempotency and protocol-v2 publication semantics are preserved.

## Required tests

Registration, tournament, revenue, malformed-input, idempotency, revision, and publication-shape characterization tests.

## Verification commands

`npm run typecheck`, `npm test`, `npm run build`, `npm run player:typecheck`, `npm run verify`.

## Risks

High: this boundary can publish or merge player-facing state.

## Dependencies

`TYPE-002` canonical snapshot/domain decision.

## Stop conditions

Stop if current behavior cannot be characterized without production data or if a persisted/public schema change is required.

## Decision blocker found on 2026-08-07

Read-only repository tracing reached the stop condition before any TYPE-003 production or test change:

1. `apps/api/src/paymentService.js` publishes paid five-hour access as revenue type `time-package`, while management `RevenueTransaction.type` excludes that value. `applyRevenueTransactions` currently copies the remote record into persisted management state anyway, and reporting implicitly classifies it as other revenue. A truthful transform therefore requires either adding the already-produced value to the persisted management union (recommended), explicitly mapping it to an existing type, or intentionally excluding it from management revenue.
2. Paid membership application currently selects the first profile whose ID matches, whose notes contain the email, or whose normalized name matches. Two same-name profiles can therefore receive the wrong paid entitlement. The API payment record supplies `playerId`; choose authoritative ID-only entitlement application (recommended), an explicit unique fallback policy, or intentional name equivalence.
3. Player registration status includes `finished`, but `applyTournamentRegistrations` maps every status except `checked-in` and `eliminated` to management `Registered`. Choose a complete status mapping (`finished` to `Finished` is recommended), or explicitly retain the collapse. The same validation decision must define whether malformed records lacking stable IDs/tournament IDs are skipped or defaulted.

These choices affect persisted revenue, paid membership identity, and tournament state. No production payload or live service is needed to state the conflict, but choosing among the outcomes is outside behavior-preserving TypeScript remediation.

## Smallest decision needed

Approve or revise this recommended bundle:

- recognize `time-package` as an existing persisted management revenue type and keep its reporting category as other revenue;
- apply paid membership entitlement only by authoritative `playerId`, while retaining unmatched valid revenue records and creating the existing profile only when that stable ID is present;
- map `finished` to management `Finished`, retain current checked-in/eliminated/registered mappings, treat rebuy/add-on events as registration updates, and skip malformed remote records without stable record/tournament IDs.

After that decision, add isolated pure-transform fixtures for registration, revenue, malformed input, idempotency, publication shape, and protocol-v2 revision behavior before changing the production pipeline. All 4 diagnostics remain assigned to this task.

## Approved policy — 2026-08-07

The human-approved conservative domain-preservation bundle requires canonical `time-package` preservation; authoritative persisted payment IDs; validated or explicitly normalized tournament statuses; and boundary validation that skips or isolates malformed records without fabricated IDs, payment types, statuses, or other semantic defaults. Known legacy mappings may be added only when repository evidence proves a one-to-one meaning and tests protect it. Independent valid records should continue synchronizing when existing behavior permits partial synchronization.

Implementation remains gated on characterization against unchanged production behavior for canonical and malformed revenue/registration inputs, identity, ordering, idempotency, field preservation, and input immutability.
