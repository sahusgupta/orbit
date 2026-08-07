# TYPE-007H: Preserve profile relationships during profile mutations

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

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
