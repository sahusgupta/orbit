# TYPE-007D2: Resolve ambiguous profile-less departure identity

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

## Objective

Correct `markPlayerSessionLeft` so a profile-less departure mutates profile statistics only when the player's normalized name identifies exactly one profile. Ambiguous identity must not cause mutations to multiple player profiles, and the session departure must still complete.

## Human decision

- When `playerSession.profileId` exists, it is authoritative: update only that ID and do not fall back to a name.
- With no ID and exactly one valid normalized-name match, update that one profile.
- With no ID and zero matches, update no profile.
- With no ID and multiple matches, update no profile.
- Never choose by array position, age, recency, or another heuristic; never auto-merge or fan out.

## Exact owned diagnostic

- `src/main.tsx:4358:81` - `TS2345`

## Departure-flow investigation

### `playerSession.profileId` origin and absence

`seatPlayerInState` creates the persisted `PlayerSession`. It resolves a profile from an explicit `SeatPlayerPayload.profileId`, otherwise from the payload player name, then sets the session ID from `profile?.id ?? payload.profileId ?? interest?.profileId`. Profile-picker, quick-add, and typed-name seating paths normally create or select a profile and pass its ID. Waitlist and table-start paths pass the interest's optional ID. The field remains optional in `PlayerSession` and persistence normalization.

It can be absent when a legacy/imported session has no ID, or when seating begins from a profile-less interest/name and no profile is found. Manual interest creation can persist `profileId: undefined` when no case-insensitive trimmed profile match exists. Existing data can also retain profile-less records across load because normalization supplies defaults but does not synthesize an identity.

### Fallback name and normalization

Departure fallback uses `playerSession.playerName`, originally derived by `seatPlayerInState` from the payload name, resolved profile name, or interest name and trimmed before a new session is stored. Persisted legacy values are not re-trimmed on load.

Current departure comparison is `profile.name.toLowerCase() === playerSession.playerName.toLowerCase()`: case-insensitive, but without trimming, locale-aware folding, or Unicode normalization. The approved implementation must preserve this existing valid-match definition so the task does not expand into identity normalization redesign.

### Profile fields and downstream effects

Departure changes only two profile fields:

- `totalTimePlayedHours`, incremented by the departing session duration.
- `lastSessionTimePlayedHours`, replaced with that duration.

These are persisted player statistics. They are rendered in the profile and seating views, combined by the manual duplicate-profile merge, used to derive loyalty, and can be included in published player statistics. Departure does not directly change a profile timestamp, membership, history, revenue transaction, ledger, billing, or analytics event field. Independently of the profile mutation, departure closes the player session, closes matching seated interests, prepends a cash-out ledger entry, updates the table seat count, produces seat-opened notifications, persists the state, and records the existing usage event.

### Other name fallbacks

Name fallback also exists in seating/profile game-count updates, active-player and financial displays, interest/profile lookup, mobile-sync request matching, and today-activity projection. Several use first-match `find`; `withProfileGameLogged` maps all case-insensitive name matches when no ID is present. Those paths are evidence of the broader identity risk but are out of scope for this departure-only correction.

### Duplicate detection and merge

The profile directory groups duplicates by `profile.name.trim().toLowerCase()` while preserving collection order. Profile creation and editing block a duplicate under the same trimmed/case-insensitive rule. Existing/imported duplicates can still appear. Manual merge keeps the first displayed profile as primary, combines profile statistics and selected fields, removes the remaining profiles, and rewrites matching interest and player-session profile IDs. Departure must not invoke this merge automatically.

### Existing helpers and diagnostics

No shared management identity resolver provides unique/zero/ambiguous results. Local helpers in `resultBuilders.ts`, `playerSync.ts`, and the player application normalize or fall back by name, generally with first-match semantics; none is an ambiguity-safe departure helper reusable without broadening scope. The renderer's usage event bridge can forward events outside the local state, while `correctionLog` is a user-visible audit surface. Neither is an appropriate PII-free local-only diagnostic channel for this narrow correction, so no new log or external telemetry is required.

## Gate 1 - characterization before production change

Against unchanged production code, cover:

1. Departure with an authoritative `profileId`.
2. Profile-less departure with one case-insensitive name match.
3. Profile-less departure with no name match.
4. Profile-less departure with two duplicate-name matches, explicitly proving the current unsafe fan-out.

Commit the characterization tests separately before any production edit.

## Gate 2 - approved correction

Change the minimum departure profile-selection logic so the four approved cases are exact. Update the duplicate-name expectation from two mutations to zero while retaining session departure in every case. Keep unrelated profiles structurally unchanged where practical, preserve collection order, and preserve notification, persistence, seating, ledger, and audit behavior outside the ambiguous profile mutation.

## Acceptance criteria

- Exact ID updates exactly one authoritative profile and never falls back.
- One valid name match updates exactly one profile.
- Zero valid matches update zero profiles.
- Multiple valid matches update zero profiles.
- The player session departure, interest closure, cash-out ledger entry, table count, notification path, persistence, and existing usage event complete in all four cases.
- The owned diagnostic disappears without a new diagnostic.

## Verification commands

`npx --no-install vitest run src/lib/playerTableTransitions.test.ts`, `npm run typecheck`, `npm test`, and `npm run build`.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

The human identity decision is resolved. Implementation is safe only after the Gate 1 characterization passes against unchanged production code.

## Stop conditions

Stop if the correction requires changing persisted shapes, session/interest matching, cash-out or billing semantics, sync protocol behavior, automatic merging, production access, or an identity-system redesign.
