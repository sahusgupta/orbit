# TYPE-007H: Preserve profile relationships during profile mutations

Status: `review_required`

Safety: `HUMAN_DECISION_REQUIRED`

## Objective

Resolve 10 diagnostics across profile deletion, duplicate merge, club check-in/removal, and in-club display lookup while preserving profile/interest/session identity behavior.

## Root cause

Callbacks over `PlayerProfile`, `Interest`, and `PlayerSession` are annotated with record fragments. Several require optional `profileId`, so `map`, `find`, `filter`, and `some` overloads reject them; mapped collections lose every field except the fragment.

## Exact owned diagnostics

- `src/main.tsx:4856:7` — `TS2322`
- `src/main.tsx:4856:38` — `TS2345`
- `src/main.tsx:5007:7` — `TS2322`
- `src/main.tsx:5008:7` — `TS2322`
- `src/main.tsx:5008:38` — `TS2345`
- `src/main.tsx:5011:7` — `TS2322`
- `src/main.tsx:5011:48` — `TS2345`
- `src/main.tsx:5019:7` — `TS2769`
- `src/main.tsx:5115:9` — `TS2769`
- `src/main.tsx:7520:19` — `TS2345`

## Files and symbols

- `src/main.tsx`: `deleteProfile`, `mergeDuplicateProfiles`, `addProfileToClub`, `removeProfileFromClub`, membership-directory `inClub` lookup
- Related evidence: `src/lib/playerSync.test.ts`, `src/lib/membershipQr.test.ts`
- Focused characterization: `src/lib/profileRelationships.test.ts`

## Runtime behavior that must be preserved

Deletion removes only the profile and clears matching interest links; duplicate merge keeps the first profile, combines the same fields, retargets duplicate interest/session IDs, and preserves order; club check-in matches active interests by ID then case-insensitive name and uses current preferred-game fallback; club removal deletes only `Arrived` matching interests; the profile card uses the same in-club identity rule.

## In scope

Characterize complete profile/link transformations and restore canonical callback contracts.

## Out of scope

Changing duplicate field-merge rules, identity schema, membership authorization, QR validation, import normalization (`TYPE-008`), or persisted data migration.

## Prohibited changes

Do not require `profileId`, drop name fallback, delete historical sessions/interests, change primary-profile selection, add casts/`any`, or broaden removal statuses.

## Characterization tests required before implementation

Cover missing/present profile IDs; delete link clearing and historical preservation; two/three-profile merge field rules, reference retargeting, and order; active/inactive interest check-in matching by ID/name; preferred-game fallback; Arrived-only removal; and in-club display matching.

## Acceptance criteria

All 10 owned diagnostics disappear; all transformed arrays retain complete records; characterized identity, merge, order, and persistence behavior remain unchanged.

## Verification commands

`npx --no-install vitest run src/lib/profileRelationships.test.ts src/lib/membershipQr.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

High because these changes rewrite persisted identity references and affect membership/front-desk workflows.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Safe only after link/identity and merge behavior is characterized with complete records.

## Human review

Not required if the current ID/name precedence and first-profile merge policy are consistent; otherwise required.

## Stop conditions

Stop if duplicate identities collide, multiple active interests match by name, membership checks would be bypassed, or a stored-shape change is required.

## Blocking identity evidence — 2026-08-07

Repository inspection reached the task's explicit stop condition before production or test modification:

- `removeProfileFromClub` filters every `Arrived` interest whose `profileId` matches **or** whose normalized name matches. Two logically distinct profiles with the same name can therefore cause multiple differently linked interests to be deleted from persisted state.
- `addProfileToClub` and `ensureInterestEntry` each use source-order `find` over the same ID-or-name fallback. When multiple active interests share a name, the first record can be selected and retargeted to the checked-in profile ID.
- Profile-directory, floor-search, and membership-QR “already in club” checks use the same fallback, so one interest can mark or block multiple distinct same-name profiles.
- `deleteProfile` and `mergeDuplicateProfiles` are ID-directed and did not create this blocker; their owned typing changes remain unimplemented so this identity-sensitive task stays atomic.

No stored data, production source, test expectation, Firebase path, or runtime behavior was changed during this investigation.

## Exact human decision required

Choose one identity rule for profile/interest club-presence operations:

1. **Authoritative ID plus unique unlinked-name fallback (recommended):** a matching `profileId` wins; name fallback is allowed only when exactly one matching interest has no `profileId`; zero or multiple matches perform no mutation and do not infer club presence.
2. **Explicit operator disambiguation:** ambiguous same-name matches perform no mutation until staff chooses a specific interest/profile link in the UI.
3. **Name equivalence:** all same-name interests are intentionally treated as one identity, preserving current fan-out removal and shared club-presence behavior even when profile IDs differ.

The recommended rule matches the already approved `TYPE-007D2` departure policy and preserves explicit profile IDs, but applying it here changes persisted link/removal and visible club-status semantics and therefore requires a new human decision under the controller rules.

Verification after documentation retained exactly 35 root diagnostics in 4 files. `npm run verify` executed every gate and failed only on that expected root baseline; Player TypeScript, 27 files/134 tests, and the 1,912-module renderer build passed.
