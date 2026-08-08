# TYPE-007F: Decide the planned-participant domain contract

Status: `complete`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 5 planned-participant diagnostics under the approved behavior-preserving optional contract without activating profile-only candidate production.

## Root cause

The canonical `ParticipantCandidate` makes both `interest` and `profile` optional, but `getParticipantPool` currently builds candidates only from active interests and always supplies `interest`. `addPlannedSession` nevertheless contains a branch that creates new interests for candidates without one. Hand-written filter/map annotations independently require `interest` or `profile`, producing incompatible callback contracts; the participant card also requires a profile even though rendering handles its absence.

## Exact owned diagnostics

- `src/main.tsx:4415:15` — `TS2769`
- `src/main.tsx:4416:12` — `TS2345`
- `src/main.tsx:4441:39` — `TS2769`
- `src/main.tsx:4441:98` — `TS2345`
- `src/main.tsx:7298:34` — `TS2345`

## Files and symbols

- `src/main.tsx`: `ParticipantCandidate`, `getParticipantPool`, `participantPool`, `addPlannedSession`, participant-card render callback
- Related evidence: `src/lib/resultBuilders.test.ts`
- Required focused test surface after decision: `src/lib/plannedParticipants.test.ts` and, if rendering changes structurally, a focused React render test

## Runtime behavior that must be preserved

Until a decision explicitly authorizes otherwise: candidate ranking/order, displayed name/reasons/stakes/buy-in fallback, generated-interest contents/order, planned-player ID order, table/event construction, and persisted shapes.

## Exact human decision required

Decision completed on 2026-08-07: **Option C is approved for this remediation.** Keep `interest` and `profile` optional, explicitly narrow both branches, preserve current interest-backed candidate construction, do not generate profile-only candidates, and do not create persisted interests for profile-only candidates. Activating or removing profile-only behavior remains a separate future product decision.

Choose the authoritative `ParticipantCandidate` model for planned-table creation.

### Option A — Interest-backed candidates only

Narrow the contract so every participant candidate owns an `Interest`; keep `profile` optional; treat the new-interest branch as stale.

- Evidence: `getParticipantPool` starts from `state.interests`, assigns `interest` on every returned candidate, and declares `source: 'interest'`; no current constructor emits a profile-only candidate.
- Runtime consequences: current emitted candidate list and current table creation remain unchanged; the dormant profile-only path is removed or isolated as unreachable.
- Data consequences: no new `Interest` records are created from profile-only suggestions.

### Option B — Support interest-backed and profile-only candidates

Define a discriminated union (for example, `source: 'interest' | 'profile'`) and extend candidate construction so a profile-only branch is real and tested.

- Evidence: `addPlannedSession` labels generated records `Connected participant` and explicitly creates interests for `!candidate.interest`; the canonical type already permits missing interests.
- Runtime consequences: the builder may show and persist players who did not already express interest; ranking and UI behavior expand.
- Data consequences: creating a planned table can add new persisted `Interest` records for profile-only suggestions.

### Option C — Preserve the broad future-facing type without expanding behavior

Keep optional `interest`/`profile`, type both branches with explicit guards, but leave `getParticipantPool` interest-only for now.

- Evidence: this is the smallest behavior-preserving remediation and retains the existing extension seam.
- Runtime consequences: current output is unchanged, but the type continues to represent states no current constructor emits.
- Data consequences: unchanged today; future callers could still activate the profile-only persistence branch.

## Recommended option

Option C for this remediation, followed by a separate product decision before adding profile-only candidates. It fixes the truthful optional-field contract without deleting or activating product behavior. Confidence: medium (0.75), because the dormant branch strongly suggests unfinished intent but repository tests/documentation do not define it.

## In scope

After approval, characterize the selected model and repair only candidate filtering/mapping/rendering at this boundary.

## Out of scope

Unapproved participant ranking changes, outreach, automatic messaging, balance-plan redesign, or persisted profile/interest schema changes.

## Prohibited changes

Do not make fields required merely to silence overloads, use non-null assertions as the contract, silently add profile-only candidates, or delete the branch without the decision.

## Characterization tests required before implementation

For all options, cover candidate order, optional profile rendering, planned ID order, and event/session payloads. Option A must prove every constructor supplies `interest`; Option B must cover both union branches and new-interest persistence; Option C must test explicit guards while proving current construction remains interest-backed.

## Acceptance criteria

All 5 owned diagnostics disappear under the approved model, the decision is recorded in this spec/journal, and only approved runtime/data consequences occur.

## Completion record

Completed on 2026-08-07 under approved Option C. A focused local jsdom characterization passed against unchanged production and was committed separately as `8e3bcc4`. Its three cases prove that current candidates remain active-interest-backed, profiles remain optional in rendering, profile-only records do not enter the candidate pool, planned-player IDs preserve ranked interest order, no new interests are created, empty profile-only input remains an empty planned table, persisted session/event/usage shapes remain complete, and input state remains unchanged.

Production now uses explicit presence and absence type guards for optional `interest`, a canonical `Interest` result boundary for the dormant branch, and the canonical `ParticipantCandidate` render callback. Candidate construction, ranking, rendering fallbacks, persisted values/order, and the dormant profile-only behavior are unchanged. All five owned diagnostics disappeared; root TypeScript decreased from 35 to 30 diagnostics with no new diagnostic.

Verification passed the focused 1-file/3-test suite, Player TypeScript, all 28 files/137 unit tests, and the 1,912-module renderer build. Aggregate verification ran all gates and failed only on the expected 30-diagnostic root baseline.

## Verification commands

`npx --no-install vitest run src/lib/plannedParticipants.test.ts`, any focused render test added by the approved option, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

High. Choosing the wrong contract can place players on planned tables or create waitlist records without an explicit request.

## Dependencies

Completed `TYPE-005` and `TYPE-006`; the explicit Option C human decision above is complete.

## Autonomous implementation

Safe after the required characterization passes against unchanged production and proves current construction remains interest-backed.

## Human review

Completed for Option C. New review is required only if implementation would activate, delete, or otherwise change the dormant profile-only branch.

## Stop conditions

Stop if the approved model would require new notification, consent, player-data, persistence, or profile-only candidate behavior not covered by the decision.
