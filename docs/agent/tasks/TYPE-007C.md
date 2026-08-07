# TYPE-007C: Preserve full records through timestamp corrections

Status: `ready`

Safety: `SAFE_AFTER_TESTS`

## Objective

Resolve 6 diagnostics in interest/player-session correction callbacks without changing timestamp propagation or correction logging.

## Root cause

Three `map` callbacks replace canonical `Interest` or `PlayerSession` parameters with small structural types that require optional `manualEdits`. Their declared return paths therefore erase most domain fields.

## Exact owned diagnostics

- `src/main.tsx:3274:7` — `TS2322`
- `src/main.tsx:3274:38` — `TS2345`
- `src/main.tsx:3277:7` — `TS2322`
- `src/main.tsx:3277:48` — `TS2345`
- `src/main.tsx:3289:7` — `TS2322`
- `src/main.tsx:3289:48` — `TS2345`

## Files and symbols

- `src/main.tsx`: `Interest`, `PlayerSession`, `updateInterestTimestamp`, `updatePlayerSession`, `withCorrectionLog`, `markManualEdit`
- Focused characterization: `src/lib/stateCorrections.test.ts`

## Runtime behavior that must be preserved

Convert date-time input once; update only the requested interest field; mirror `seatedAt`/`closedAt` to matching player sessions by exact player name and game ID; use `closedAt` to set `leftAt`; accumulate manual-edit markers; preserve all other fields and ordering; and append the same correction-log metadata.

## In scope

Characterize the pure transformations and restore canonical callback/result types.

## Out of scope

Changing correction audit schema, player identity matching, date parsing, seating history, or persisted shapes.

## Prohibited changes

Do not make optional fields required, rewrite identity matching, remove correction logging, add casts/`any`, or alter timestamp clearing behavior.

## Characterization tests required before implementation

Cover all five interest keys, empty and populated values, matched/unmatched player sessions, seated/closed mirroring, manual-edit accumulation, missing interest IDs, and correction-log entity/field/reason.

## Acceptance criteria

All 6 owned diagnostics disappear and characterized `Interest[]`, `PlayerSession[]`, and correction-log output are unchanged.

## Verification commands

`npx --no-install vitest run src/lib/stateCorrections.test.ts`, `npm run typecheck`, `npm test`, `npm run build`.

## Risks

Medium/high because corrected timestamps alter operational history and session duration calculations.

## Dependencies

Completed `TYPE-005` and `TYPE-006`.

## Autonomous implementation

Safe only after the full propagation matrix is characterized.

## Human review

Not required unless characterization reveals ambiguous cross-record matching.

## Stop conditions

Stop if matching by name/game updates more than one historical record unexpectedly or if empty-value behavior is unclear.
