# TYPE-007E: Preserve forming and balanced table construction

Status: `complete`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 4 diagnostics in ordinary forming-table and balanced-table construction without changing session/event contents or candidate movement planning.

## Root cause

`addSession` constructs a status literal without a contextual `GameSession` boundary, so it widens to `string`. `createBalancedTable` annotates its session mapper with a fragment that requires optional `plannedPlayerIds`, causing both the updated source table and the appended table to lose `GameSession` context.

## Exact owned diagnostics

- `src/main.tsx:4402:63` — `TS2345`
- `src/main.tsx:4467:9` — `TS2322`
- `src/main.tsx:4467:31` — `TS2345`
- `src/main.tsx:4478:9` — `TS2322`

## Files and symbols

- `src/main.tsx`: `addSession`, `createBalancedTable`, `GameSession`, `BalancePlan`, `withGameFrequencyInAppNotifications`
- Existing balance characterization: `src/lib/resultBuilders.test.ts`
- Focused characterization: `src/lib/tablePlanning.test.ts`

## Runtime behavior that must be preserved

Use the configured game cap/collection mode; label tables by current non-closed count; keep status `Forming`, zero/default seat counts, tags, timestamps, and event text; retain source-table order; remove moved planned IDs from Table A; append Table B; and preserve moved-candidate order and projected seats.

## In scope

Characterize the two construction transforms and restore exact `GameSession[]`/`AppState` typing.

## Out of scope

Changing balance-plan selection, participant contracts (`TYPE-007F`), table viability, notification recipients, or collection settings.

## Prohibited changes

Do not change table labels, event ordering/text, planned-player ordering, collection-mode fallback, status values, or assert candidate interests into existence.

## Characterization tests required before implementation

Cover first/subsequent table labels, collection modes, default start-player draft IDs, event payloads, notification trigger inputs, source-table planned IDs with/without the optional field, candidate removal, and appended Table B shape/order.

## Acceptance criteria

All 4 owned diagnostics disappear; constructed sessions are complete `GameSession` records; existing balance tests plus focused construction tests pass unchanged.

## Verification commands

`npx --no-install vitest run src/lib/resultBuilders.test.ts src/lib/tablePlanning.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

Medium/high because malformed table records or planned IDs affect live table start workflows.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Safe only after construction fixtures pass against current behavior.

## Human review

Not required unless balance candidates without interests are encountered; that decision belongs to `TYPE-007F`.

## Stop conditions

Stop if a balance plan can contain a candidate without an interest, or if exact event/session values differ across callers.

## Completion record

- Added `src/lib/tablePlanning.test.ts` and committed it before production changes.
- Characterized first/subsequent labels, configured/default collection modes, capped start-player drafts, complete session/event/notification payloads, balance ordering, optional planned IDs, moved-ID removal, persistence, usage tracking, and input immutability.
- Confirmed current balance plans are interest-backed, so the stop condition was not triggered.
- Typed the forming-table `nextState` as canonical `AppState` and the balance mapper item as canonical `GameSession`; no construction or balancing expression changed.
- Root TypeScript decreased from 39 to 35 diagnostics, removing exactly the four owned errors with no replacement diagnostic.
- Final verification: focused 2 files/13 tests passed; Player TypeScript passed; all 27 files/134 tests passed; the 1,912-module renderer build passed; aggregate verification failed only on the expected 35-diagnostic root baseline.
