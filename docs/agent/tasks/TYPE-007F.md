# TYPE-007F: Decide the planned-participant domain contract

Status: `review_required`

Safety: `HUMAN_DECISION_REQUIRED`

## Objective

Resolve 5 planned-participant diagnostics only after deciding whether a planned-table candidate must already own an `Interest` or may be a profile-only suggestion that becomes an interest when the table is created.

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

## Verification commands

`npx --no-install vitest run src/lib/plannedParticipants.test.ts`, any focused render test added by the approved option, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

High. Choosing the wrong contract can place players on planned tables or create waitlist records without an explicit request.

## Dependencies

Completed `TYPE-005` and `TYPE-006`; explicit human decision above.

## Autonomous implementation

Not safe before the decision. After approval, autonomy must be reassessed against the selected option and required tests.

## Human review

Required.

## Stop conditions

Stop until the option is approved; also stop if the approved model requires new notification, consent, or player-data behavior not covered by the decision.
