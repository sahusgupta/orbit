# TYPE-007C: Preserve full records through timestamp corrections

Status: `complete`

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

Completed only after the full propagation matrix passed against unchanged production.

## Human review

Not required unless characterization reveals ambiguous cross-record matching.

## Stop conditions

Stop if matching by name/game updates more than one historical record unexpectedly or if empty-value behavior is unclear.

## Implementation

- Added `src/lib/stateCorrections.test.ts`, which loads only local fixture state, disables renderer Firebase sync, stubs network access, and captures the existing App-local correction functions without adding or moving a production seam.
- Replaced only the interest mapper's partial annotation with canonical `Interest` and the two player-session mapper annotations with canonical `PlayerSession`.
- Preserved datetime conversion, computed-field assignment, exact player-name/game matching, seated/closed propagation, manual-edit accumulation, audit insertion, persistence, and collection ordering.

## Characterized behavior

All five interest timestamp keys continue to accept populated local datetime input and store its ISO conversion on only the matching interest. Existing manual edits accumulate the corrected key, while absent manual edits produce a new marker record. Only `seatedAt` and `closedAt` propagate: populated `seatedAt` replaces the exact matching session's `seatedAt`, while `closedAt` writes the corresponding value to `leftAt`. Sessions that differ by player name or game ID remain untouched.

Clearing `seatedAt` leaves the matching player session unchanged, but clearing `closedAt` writes `undefined` to its `leftAt` and records that manual edit. JSON persistence omits those cleared properties while retaining their manual-edit and audit markers. Each correction prepends the same entity, field, note, and timestamp metadata while preserving prior audit entries.

Player-session corrections continue to copy only the target, spread the supplied patch, accumulate or create the requested manual-edit marker, preserve canonical identity/profile/game/table/time fields, and retain collection order. Missing interest and player-session IDs remain audited no-ops: record values/references stay unchanged and the resulting state is still persisted. Prior input state is not mutated.

## Completion verification

- Pre-change focused gate: `npm test -- src/lib/stateCorrections.test.ts` passed 1 file and 6 tests against unchanged production source.
- Test-only checkpoint: `187be9a` (`test: characterize timestamp correction propagation`).
- Post-change focused gate: the same command passed 1 file and 6 tests.
- Root TypeScript: expected failure with exactly 53 diagnostics in 4 files, down from 59. `TS2322` decreased from 17 to 14, `TS2345` decreased from 27 to 24, and `src/main.tsx` decreased from 50 to 44; every other diagnostic-code and affected-path count remained unchanged.
- All six owned diagnostics disappeared: `src/main.tsx:3274:7` (`TS2322`), `3274:38` (`TS2345`), `3277:7` (`TS2322`), `3277:48` (`TS2345`), `3289:7` (`TS2322`), and `3289:48` (`TS2345`).
- Player TypeScript passed with no diagnostics.
- Unit tests passed: 24 files and 112 tests, zero failed or skipped. The existing experimental SQLite warning remained.
- Renderer build passed with 1,912 modules transformed. The existing ExcelJS `eval` and large-chunk warnings remained.
- `npm run verify` exited 1 after all four gates; root TypeScript alone retained the expected 53-diagnostic baseline, while Player TypeScript, 24/112 tests, and the 1,912-module build passed.

No runtime expression, optional field, public or persisted shape, matching rule, correction audit/manual-edit semantic, persistence transport, compiler setting, dependency, cast, assertion, `any`, or diagnostic suppression changed. `TYPE-007` remains pending on five unfinished children, including `TYPE-007F` in `review_required`; no task became newly ready.
