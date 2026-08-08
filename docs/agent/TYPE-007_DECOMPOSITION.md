# TYPE-007 Renderer Callback Decomposition

Analysis date: 2026-08-06

Branch: `fix/type-005-synchronized-list-tuples`

Scope: documentation and queue planning only; no remediation code was changed.

## Repository and baseline evidence

- The worktree was clean before analysis and the branch was not `main`.
- `TYPE-005` and `TYPE-006` are complete.
- Their completion satisfies both former dependencies of `TYPE-007`; the pre-decomposition queue marked it `ready` with human review required.
- `npm run typecheck` exited nonzero with exactly 71 diagnostics in 4 files.
- The 20 diagnostics owned by `TYPE-002`, `TYPE-003`, `TYPE-004`, `TYPE-008`, `TYPE-009`, `TYPE-010`, `TYPE-011`, `TYPE-013`, and `TYPE-014` remain distinct. The remaining 51 diagnostics below are exactly the live `TYPE-007` set, all in `src/main.tsx`.

## Diagnostic inventory

The “origin” column uses the requested mismatch categories. “Legacy callback signature” means a hand-written structural parameter has replaced the contextual canonical item type; it does not mean the runtime record itself is legacy data.

| Owner | File:line:column | Code | Callback/function | Expected callback/domain contract | Actual callback/domain contract | Origin |
| --- | --- | --- | --- | --- | --- | --- |
| `TYPE-007A` | `src/main.tsx:2631:24` | `TS2322` | `duplicateProfiles` / `groups.set` | Each grouped value is a complete `PlayerProfile` accepted by `PlayerProfile[]`. | The `forEach` parameter is a partial profile fragment with optional `id` and missing required profile fields. | Domain model typing; legacy callback signatures |
| `TYPE-007A` | `src/main.tsx:2631:52` | `TS2740` | `duplicateProfiles` / group append | Appending `profile` preserves a complete `PlayerProfile`. | The structurally annotated `profile` lacks phone, membership, play-history, and other required fields. | Domain model typing; collection transformation |
| `TYPE-007B` | `src/main.tsx:3244:38` | `TS2345` | `updateInterest` / `Interest[].map` | Callback accepts every `Interest`, including entries without `manualEdits`, and returns `Interest`. | Parameter requires `manualEdits` and declares only `id`, `timestamp`, and `manualEdits`. | Optional/null state; legacy callback signatures |
| `TYPE-007B` | `src/main.tsx:3261:7` | `TS2345` | `updateInterest` / `persist` selection | Conditional branches are complete `AppState` values. | `nextState.interests` is inferred as fragment objects from the preceding mapper. | Collection transformation; domain model typing |
| `TYPE-007B` | `src/main.tsx:3261:74` | `TS2339` | `updateInterest` / active-status check | `changedInterest` is `Interest | undefined` and exposes `status`. | The inferred fragment type has no `status`. | Collection transformation |
| `TYPE-007B` | `src/main.tsx:3262:30` | `TS2345` | `updateInterest` / `promptDemandAction` | Helper receives a complete `AppState`. | The derived state contains a fragment array instead of `Interest[]`. | Collection transformation; domain model typing |
| `TYPE-007B` | `src/main.tsx:3262:57` | `TS2339` | `updateInterest` / demand game lookup | Changed item is an `Interest` with required `gameId`. | The inferred fragment type has no `gameId`. | Collection transformation |
| `TYPE-007C` | `src/main.tsx:3274:7` | `TS2322` | `updateInterestTimestamp` / state construction | `interests` remains `Interest[]`. | Mapper result is inferred as `{ id; manualEdits }[]`. | Collection transformation; domain model typing |
| `TYPE-007C` | `src/main.tsx:3274:38` | `TS2345` | `updateInterestTimestamp` / `Interest[].map` | Callback accepts complete `Interest`, with optional `manualEdits`. | Parameter requires `manualEdits` and declares only `id` plus that field. | Optional/null state; legacy callback signatures |
| `TYPE-007C` | `src/main.tsx:3277:7` | `TS2322` | `updateInterestTimestamp` / session propagation | `playerSessions` remains `PlayerSession[]`. | Mapper branches are inferred from a fragment containing player/game/manual edits. | Collection transformation; domain model typing |
| `TYPE-007C` | `src/main.tsx:3277:48` | `TS2345` | `updateInterestTimestamp` / `PlayerSession[].map` | Callback accepts every `PlayerSession`, including no `manualEdits`. | Parameter requires `manualEdits` and omits ID/table/seating fields. | Optional/null state; legacy callback signatures |
| `TYPE-007C` | `src/main.tsx:3289:7` | `TS2322` | `updatePlayerSession` / state construction | `playerSessions` remains `PlayerSession[]`. | Mapper result is inferred as `{ id; manualEdits }[]`. | Collection transformation; domain model typing |
| `TYPE-007C` | `src/main.tsx:3289:48` | `TS2345` | `updatePlayerSession` / `PlayerSession[].map` | Callback accepts complete `PlayerSession`, with optional `manualEdits`. | Parameter requires `manualEdits` and declares only `id` plus that field. | Optional/null state; legacy callback signatures |
| `TYPE-007D` | `src/main.tsx:4261:48` | `TS2345` | `movePlayerToTable` / session mapper | Callback accepts and returns complete `PlayerSession`. | Parameter requires optional `manualEdits` and otherwise exposes only `id`. | Optional/null state; legacy callback signatures |
| `TYPE-007D` | `src/main.tsx:4280:55` | `TS2345` | `movePlayerToTable` / `syncSessionSeatCount` | Moved state is a complete `AppState`. | Its `playerSessions` collection contains fragment-shaped results. | Collection transformation; domain model typing |
| `TYPE-007D` | `src/main.tsx:4299:7` | `TS2769` | `markPlayerLeft` / open-session `find` | Predicate accepts `PlayerSession`; `leftAt` remains optional. | Predicate parameter requires `leftAt`, so neither `find` overload applies. | Optional/null state; incorrect overload use; legacy callback signatures |
| `TYPE-007D` | `src/main.tsx:4312:66` | `TS2345` | `markPlayerLeft` / notification helper | `nextState` is `AppState` before seat-count and notification transforms. | Interest/session mappers produce fragment unions and widened status. | Collection transformation; domain model typing |
| `TYPE-007D` | `src/main.tsx:4314:13` | `TS2345` | `markPlayerLeft` / `persist` | Final branch value is a complete `AppState`. | The no-open-session branch retains the incomplete inferred state. | Collection transformation; domain model typing |
| `TYPE-007D` | `src/main.tsx:4358:81` | `TS2345` | `markPlayerSessionLeft` / notification helper | Updated interests remain `Interest[]` and status is `InterestStatus`. | The constructed `Removed` status widens to `string` in the uncontextualized state literal. | Domain model typing; other (literal widening) |
| `TYPE-007E` | `src/main.tsx:4402:63` | `TS2345` | `addSession` / notification helper | Newly appended item is a complete `GameSession` with `status: GameStatus`. | `status: 'Forming'` widens to `string` before the state reaches an `AppState` boundary. | Domain model typing; other (literal widening) |
| `TYPE-007E` | `src/main.tsx:4467:9` | `TS2322` | `createBalancedTable` / sessions array | Every spread item remains a complete `GameSession`. | The mapper's unchanged branch is typed as `{ id; plannedPlayerIds }`. | Collection transformation; domain model typing |
| `TYPE-007E` | `src/main.tsx:4467:31` | `TS2345` | `createBalancedTable` / `GameSession[].map` | Callback accepts every `GameSession`, including no `plannedPlayerIds`. | Parameter requires optional `plannedPlayerIds` and declares only `id` plus that field. | Optional/null state; legacy callback signatures |
| `TYPE-007E` | `src/main.tsx:4478:9` | `TS2322` | `createBalancedTable` / appended table | The combined array is contextually `GameSession[]`. | The prior fragment-returning mapper creates a union that prevents the appended object from satisfying the array contract. | Collection transformation; domain model typing |
| `TYPE-007F` | `src/main.tsx:4415:15` | `TS2769` | `addPlannedSession` / missing-interest filter | Predicate accepts `ParticipantCandidate`; `interest` is optional. | Parameter requires an `interest`, contradicting the predicate's `!candidate.interest` purpose. | Optional/null state; incorrect overload use; legacy callback signatures |
| `TYPE-007F` | `src/main.tsx:4416:12` | `TS2345` | `addPlannedSession` / new-interest mapper | Callback accepts a candidate whose `profile` may also be absent and produces a complete new `Interest`. | Parameter requires a profile object even though the canonical field is optional. | Optional/null state; domain model typing |
| `TYPE-007F` | `src/main.tsx:4441:39` | `TS2769` | `addPlannedSession` / existing-interest filter | Predicate accepts `ParticipantCandidate` and narrows candidates with an interest. | Parameter requires `interest` before the narrowing operation. | Optional/null state; incorrect overload use |
| `TYPE-007F` | `src/main.tsx:4441:98` | `TS2345` | `addPlannedSession` / planned-ID mapper | After a truthful guard, callback reads the present `Interest.id`. | Parameter independently requires `interest` instead of consuming the narrowed array type. | Optional/null state; legacy callback signatures |
| `TYPE-007F` | `src/main.tsx:7298:34` | `TS2345` | Table-builder participant render | Render callback accepts `ParticipantCandidate` and handles absent `profile`. | Structural parameter requires `profile` and broadens canonical `source`. | Optional/null state; domain model typing; legacy callback signatures |
| `TYPE-007G` | `src/main.tsx:4519:7` | `TS2322` | `updateSession` / state construction | `sessions` remains `GameSession[]`. | Mapper result is inferred from `{ id; endedAt; manualEdits }`. | Collection transformation; domain model typing |
| `TYPE-007G` | `src/main.tsx:4519:36` | `TS2345` | `updateSession` / `GameSession[].map` | Callback accepts complete sessions with optional `endedAt`/`manualEdits`. | Parameter requires both optional fields and omits the rest of `GameSession`. | Optional/null state; legacy callback signatures |
| `TYPE-007G` | `src/main.tsx:4551:7` | `TS2322` | `updateSessionTimestamp` / state construction | Corrected collection remains `GameSession[]`. | Mapper result is inferred as `{ id; manualEdits }[]`. | Collection transformation; domain model typing |
| `TYPE-007G` | `src/main.tsx:4551:36` | `TS2345` | `updateSessionTimestamp` / mapper | Callback accepts complete `GameSession`, with optional `manualEdits`. | Parameter requires `manualEdits` and declares only `id` plus that field. | Optional/null state; legacy callback signatures |
| `TYPE-007G` | `src/main.tsx:4561:7` | `TS2322` | `recordTableEvent` / sessions result | Result is `GameSession[]`. | Mapper result is inferred as `{ id; status; endedAt }[]`. | Collection transformation; domain model typing |
| `TYPE-007G` | `src/main.tsx:4561:36` | `TS2345` | `recordTableEvent` / session mapper | Callback accepts complete `GameSession`, with optional `endedAt`. | Parameter requires `endedAt` and omits game/label/seat/tag fields. | Optional/null state; legacy callback signatures |
| `TYPE-007G` | `src/main.tsx:4573:7` | `TS2322` | `recordTableEvent` / player-session result | Both conditional branches are `PlayerSession[]`. | Close/break branch is inferred as `{ tableId; leftAt }[]`. | Collection transformation; domain model typing |
| `TYPE-007G` | `src/main.tsx:4575:38` | `TS2345` | `recordTableEvent` / player mapper | Callback accepts complete `PlayerSession`, with optional `leftAt`. | Parameter requires `leftAt` and declares only table/left fields. | Optional/null state; legacy callback signatures |
| `TYPE-007H` | `src/main.tsx:4856:7` | `TS2322` | `deleteProfile` / interests result | Clearing a link preserves complete `Interest` records. | Mapper returns `{ profileId }` fragments. | Collection transformation; domain model typing |
| `TYPE-007H` | `src/main.tsx:4856:38` | `TS2345` | `deleteProfile` / interest mapper | Callback accepts interests with or without `profileId`. | Parameter requires `profileId`. | Optional/null state; legacy callback signatures |
| `TYPE-007H` | `src/main.tsx:5007:7` | `TS2322` | `mergeDuplicateProfiles` / profiles result | Map/filter operate on complete `PlayerProfile` values. | Mapper parameter exposes only `id`, so unchanged branches become `{ id }`. | Domain model typing; collection transformation |
| `TYPE-007H` | `src/main.tsx:5008:7` | `TS2322` | `mergeDuplicateProfiles` / interests result | Retargeting preserves complete `Interest` records. | Mapper output is inferred as `{ profileId }[]`. | Collection transformation; domain model typing |
| `TYPE-007H` | `src/main.tsx:5008:38` | `TS2345` | `mergeDuplicateProfiles` / interest mapper | Callback accepts optional `profileId`. | Parameter requires `profileId`. | Optional/null state; legacy callback signatures |
| `TYPE-007H` | `src/main.tsx:5011:7` | `TS2322` | `mergeDuplicateProfiles` / player sessions result | Retargeting preserves complete `PlayerSession` records. | Mapper output is inferred as `{ profileId }[]`. | Collection transformation; domain model typing |
| `TYPE-007H` | `src/main.tsx:5011:48` | `TS2345` | `mergeDuplicateProfiles` / session mapper | Callback accepts optional `profileId`. | Parameter requires `profileId`. | Optional/null state; legacy callback signatures |
| `TYPE-007H` | `src/main.tsx:5019:7` | `TS2769` | `addProfileToClub` / active-interest `find` | Predicate accepts `Interest`; `profileId` may be absent. | Parameter requires `profileId`, so neither `find` overload applies. | Optional/null state; incorrect overload use |
| `TYPE-007H` | `src/main.tsx:5115:9` | `TS2769` | `removeProfileFromClub` / `filter` | Predicate accepts every `Interest`; `profileId` may be absent. | Parameter requires `profileId`, so neither `filter` overload applies. | Optional/null state; incorrect overload use |
| `TYPE-007H` | `src/main.tsx:7520:19` | `TS2345` | Profile directory / in-club `some` | Predicate accepts every `Interest`; ID-or-name matching handles missing `profileId`. | Parameter requires `profileId`. | Optional/null state; legacy callback signatures |
| `TYPE-007I` | `src/main.tsx:5594:14` | `TS2345` | `exportCsv` / table-event mapper | Callback accepts `TableEvent`; `reason` is optional and `note` is required by the canonical type. | Structural parameter requires `reason`, rejecting events without it. | Optional/null state; legacy callback signatures |
| `TYPE-007I` | `src/main.tsx:8468:151` | `TS2345` | Summary event-reasons mapper | Callback accepts every filtered `TableEvent`, including no `reason`. | Structural parameter requires `reason`. | Optional/null state; legacy callback signatures |
| `TYPE-007J` | `src/main.tsx:9697:40` | `TS2345` | Forming-game render / `getDemand` | Domain helper receives complete `GameConfig` with required thresholds/cap. | Render callback redefines cap/threshold fields as optional. | Domain model typing; legacy callback signatures |
| `TYPE-007J` | `src/main.tsx:9698:58` | `TS2345` | Forming-game render / `getViabilityState` | Domain helper receives complete `GameConfig`. | The same optionalized fragment is passed to the helper. | Domain model typing; legacy callback signatures |
| `TYPE-007J` | `src/main.tsx:9802:22` | `TS2345` | Floor waitlist-card mapper | Callback accepts `Interest`; `manualEdits` and `arrivedAt` remain optional. | Structural parameter requires both optional fields and exposes only display fragments. | Optional/null state; legacy callback signatures |

## Root-cause groups

| Group | Diagnostics | Shared behavioral contract |
| --- | ---: | --- |
| Duplicate-profile grouping | 2 | A grouped value must remain the complete `PlayerProfile` taken from state. |
| Waitlist patch update | 5 | Mapping an `Interest` patch must preserve all unpatched fields and produce a complete `AppState`. |
| Cross-record timestamp correction | 6 | Interest/session correction maps preserve complete records while marking exact edits. |
| Player table transition | 6 | Move/leave operations preserve complete state, seat counts, audit/ledger data, and notification inputs. |
| Forming/balanced session construction | 4 | New and updated tables remain complete `GameSession` records with literal status values. |
| Planned-participant modeling | 5 | Optional interest/profile fields need an authoritative domain model before filter/map/render callbacks can be repaired safely. |
| Table lifecycle/event transition | 8 | Session/player collections remain complete while lifecycle events set current timestamps and statuses. |
| Profile relationship mutation | 10 | Optional profile links are handled without erasing record fields or changing ID/name matching. |
| Table-event report projection | 2 | Optional reasons render/export through a stable fallback without mutating events. |
| Read-only floor collections | 3 | Render callbacks consume canonical `GameConfig`/`Interest` items and do not redefine required/optional fields. |

The 49 callback/derived-state diagnostics ultimately originate in structural callback erosion or optionality inversion. The 2 remaining diagnostics (`4358:81` and `4402:63`) are status-literal widening in uncontextualized state construction. They are grouped with the transitions that create those values because the runtime contract, test surface, and review boundary are the same.

## Proposed task batches and safety classification

| Batch | Diagnostics | Focused test surface | Classification | Queue status | Why |
| --- | ---: | --- | --- | --- | --- |
| `TYPE-007A` | 2 | Profile grouping | `SAFE_AFTER_TESTS` | `ready` | Name normalization/order are clear, but destructive merge UI consumes the output. |
| `TYPE-007B` | 5 | Waitlist patch state transform | `SAFE_AFTER_TESTS` | `ready` | Status/timestamp behavior is readable but uncharacterized in focused tests. |
| `TYPE-007C` | 6 | Correction propagation | `SAFE_AFTER_TESTS` | `ready` | Runtime propagation is explicit but affects persisted timestamps/audit history. |
| `TYPE-007D` | 6 | Move/leave state transforms | `SAFE_AFTER_TESTS` | `ready` | Existing intent is clear; financial, seating, and notification consequences need fixtures. |
| `TYPE-007E` | 4 | Table construction/balance | `SAFE_AFTER_TESTS` | `ready` | Existing balance tests cover plan generation, not state construction. |
| `TYPE-007F` | 5 | Planned participant model and render | `HUMAN_DECISION_REQUIRED` | `review_required` | Canonical optionality, current constructors, and dormant new-interest behavior encode competing interpretations. |
| `TYPE-007G` | 8 | Table lifecycle matrix | `SAFE_AFTER_TESTS` | `ready` | Event/status mapping is explicit but high-impact and uncharacterized as one transform. |
| `TYPE-007H` | 10 | Profile link/merge transforms | `SAFE_AFTER_TESTS` | `ready` | Current identity/merge behavior is readable but persisted link rewrites need fixtures. |
| `TYPE-007I` | 2 | Report projection text/order | `SAFE_AFTER_TESTS` | `ready` | Read-only behavior is unambiguous but report text lacks focused coverage. |
| `TYPE-007J` | 3 | Floor render/projection | `SAFE_AFTER_TESTS` | `ready` | Read-only behavior is clear but importing the large app without a focused seam is risky. |

No batch is `SAFE_AUTONOMOUS`: `src/main.tsx` is an explicitly risky refactor boundary, and no current focused test isolates any of these callbacks. The nine `SAFE_AFTER_TESTS` batches are ready to start only on the condition that their specified characterization is added and passes before the type correction.

## Human decision required for TYPE-007F

Decision: whether planned-table candidates are interest-backed only, can include profile-only suggestions that create persisted interests, or should keep the broad optional contract without activating profile-only behavior.

- Option A — make `interest` required. Evidence: every current `getParticipantPool` result is built from an interest and declares `source: 'interest'`. Consequence: current runtime/data remain unchanged; the new-interest branch is stale and must be removed or isolated after approval.
- Option B — define a discriminated interest/profile candidate union and add profile candidates. Evidence: `addPlannedSession` explicitly constructs `Connected participant` interests for candidates lacking one. Consequence: builder output expands and planned-table creation can persist interests for players who did not already have them.
- Option C — keep optional fields, explicitly guard both branches, and leave current construction interest-only. Evidence: smallest behavior-preserving correction that retains the apparent future seam. Consequence: no current runtime/data change, but the public local type continues to permit states no current constructor emits.

Recommendation: Option C for this remediation, then a separate product decision before profile-only suggestions are enabled or removed. Confidence: medium (0.75).

No implementation should begin until a human records the choice in `docs/agent/tasks/TYPE-007F.md` and the journal.

## Recommended execution order

1. `TYPE-007A`, `TYPE-007I`, and `TYPE-007J`: lowest-state-mutation read-only/grouping contracts; establish the batch/testing pattern.
2. `TYPE-007B` then `TYPE-007C`: waitlist patching before cross-record timestamp correction.
3. `TYPE-007D` then `TYPE-007G`: player transitions before the broader table lifecycle matrix.
4. `TYPE-007E`: table construction after transition/lifecycle fixtures exist.
5. `TYPE-007H`: persisted profile-link mutations with the earlier state-transform patterns available.
6. `TYPE-007F`: only after the human decision; it need not block implementing other children but does block umbrella completion.

Each batch should be one reviewable commit and must remove only its owned diagnostics.

## Expected downstream effects

- `TYPE-007` is now an umbrella with zero directly owned diagnostics and depends on completion of all ten children. It cannot become complete while `TYPE-007F` is `review_required`.
- `TYPE-008` depends specifically on `TYPE-007A` and `TYPE-007H`, the two batches that establish complete profile values and profile relationship callbacks next to the import/commit path. It no longer waits on unrelated table/report/render children.
- `TYPE-010` remains dependent on parent `TYPE-007` completion. It shares the same large renderer callback/state-setter surface but no single child owns its GroupMe contract; retaining the parent dependency avoids premature parallel churn.
- Neither downstream task is newly ready at decomposition time.

## Ownership and dependency validation

- Child diagnostic sum: `2 + 5 + 6 + 6 + 4 + 5 + 8 + 10 + 2 + 3 = 51`.
- Every inventory location is unique and appears in exactly one child specification.
- The umbrella directly owns zero diagnostics, avoiding double counting.
- Child tasks depend only on completed `TYPE-005`/`TYPE-006`; the parent depends on all children; `TYPE-008` depends on `TYPE-007A`/`TYPE-007H`; and `TYPE-010` depends on the parent. This graph is acyclic.
- Each child has a specification under `docs/agent/tasks/`.

## Production boundaries

This decomposition does not authorize runtime validation against hosted APIs, Firebase, Electron production defaults, payment/identity services, or tracked database data. All characterization must use pure/local fixtures. The manual e2e harness remains unsuitable for ordinary execution because repository instructions require explicit local endpoint and disabled-sync isolation.

## Final verification record

- Ownership check: 51 inventory entries, 51 unique entries, 51 child-spec entries, and zero set difference from the live compiler-owned `TYPE-007` locations.
- Queue check: YAML parsed successfully; all task dependencies resolved; zero cycles; all ten child specs existed; child diagnostics totaled 51; and all queue diagnostics totaled the unchanged root baseline of 71.
- Expected failure: `npm run typecheck` exited 2 with exactly 71 diagnostics in the same 4 files and the same code counts (`TS2322` 18, `TS2339` 5, `TS2345` 35, `TS2352` 1, `TS2353` 1, `TS2367` 1, `TS2739` 2, `TS2740` 1, `TS2769` 5, `TS7006` 2).
- Expected partial failure: `npm run verify` exited 1 only because root TypeScript retained those 71 diagnostics. Player TypeScript passed, all 19 test files/96 tests passed, and the renderer build passed with 1,912 modules transformed. The existing SQLite experimental, ExcelJS `eval`, and large-chunk warnings remained.
- No production or test source changed, so no focused runtime test was added or run for an implementation that this task explicitly prohibited.
