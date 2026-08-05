# TYPE-001: Decide and align the root ECMAScript library boundary

## Objective

Resolve the 6 `CONFIGURATION_BOUNDARY` diagnostics by making the root TypeScript library contract match the supported Electron/browser runtime.

## Evidence

- Root `tsconfig.json` declares `lib: ["DOM", "DOM.Iterable", "ES2020"]`.
- `src/main.tsx:2311` uses `String.replaceAll`; `src/main.tsx:5178` and four `playerSync.test.ts` locations use `Array.at`.
- Player uses an independent ESNext configuration and is not evidence for the desktop support floor.

## In scope

- Document the supported renderer runtime.
- Choose between a justified library-level update and ES2020-compatible source/test equivalents.
- Keep emit target and library declarations independently reasoned.

## Out of scope

- Broad compiler modernization, module-resolution changes, Electron upgrades, or Player configuration changes.

## Allowed areas

`tsconfig.json`, the six cited call sites if compatibility replacements are selected, focused tests, and runtime-support documentation.

## Prohibited changes

Do not weaken strictness, add broad exclusions, change Player's tsconfig, or raise `lib` solely to silence diagnostics without runtime evidence.

## Acceptance criteria

- A documented runtime decision supports the selected APIs.
- All 6 assigned diagnostics are gone with no new configuration diagnostic.
- Player's independent project remains unchanged and passing.

## Required tests

Focused helper/player-sync tests and any supported-runtime smoke needed by the decision.

## Verification commands

`npm run typecheck`, `npm run player:typecheck`, `npm test`, `npm run build`, `npm run verify`.

## Risks

An unjustified library increase can declare APIs that an intended runtime lacks.

## Dependencies

None. This decision should precede implementation remediation.

## Stop conditions

Stop if the supported Electron/browser floor cannot be established from product/release evidence or requires a runtime upgrade.
