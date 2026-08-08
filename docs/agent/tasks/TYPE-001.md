# TYPE-001: Decide and align the root ECMAScript library boundary

Status: `complete`

Investigation decision: `docs/agent/TYPE-001_BOUNDARY_DECISION.md`

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

## Investigation outcome — 2026-08-05

Repository evidence establishes that the supported renderer floor accepts the two APIs behind all six assigned diagnostics:

- the locked Electron 42.1.0 maps to Chromium 148.0.7778.97;
- installed Vite 7.3.5 builds for Chrome 107, Edge 107, Firefox 104, and Safari 16 by default;
- a read-only root probe with `lib: ["DOM", "DOM.Iterable", "ES2022"]` and `types: ["vite/client"]` reduced the count from 94 to 88 with no new diagnostic;
- `target: ES2020` does not need to change because root TypeScript is `noEmit` and Vite owns production transforms.

The investigation also proved that root TypeScript is not a whole-desktop check. It omits Vite configuration, Electron main/preload, scripts, API, download-site code, and e2e harnesses, while its unspecified `types` admits Node globals into the sandboxed browser project and two tests pull Player source plus Player-local React declarations into the root program.

No compiler change was implemented during the investigation. The request at that time required every production runtime to be covered by an appropriate TypeScript project and the verification command to become more complete. Satisfying that broader requirement needs separate renderer, Electron/check-JS, test, and Node-tooling projects plus package-specific ownership. That exceeds this specification's allowed areas and exposes existing JavaScript diagnostics needing separate ownership.

The subsequent human decision approved the narrow renderer-library correction and explicitly deferred the multi-project boundary to separate follow-up tasks.

## Completion — 2026-08-05

- Changed only root `tsconfig.json` library declarations from `DOM`, `DOM.Iterable`, `ES2020` to `DOM`, `DOM.Iterable`, `ES2022`.
- Retained `target: ES2020`, `moduleResolution: Node`, strictness, `noEmit`, `include: ["src"]`, the empty project-reference list, and existing ambient-type behavior.
- Changed no production source, test behavior, runtime configuration, package manifest, dependency, or emitted-JavaScript target.
- Root diagnostics changed from 94 to exactly 88. All six `TS2550` diagnostics assigned to this task disappeared and no new diagnostic appeared.
- The remaining 88 diagnostics map exactly to `TYPE-002` through `TYPE-014`.
- `TYPE-005`, `TYPE-006`, and `TYPE-012` are now `ready` because `TYPE-001` was their only dependency. No other downstream task became ready.
- Broader boundary work is represented separately by `TYPE-015` through `TYPE-022`; none was implemented here.

No behavior test was added because the only implementation is a `noEmit` standard-library declaration change. Root typecheck is the direct behavioral boundary; the full unit suite and Vite build verify that runtime behavior remains unchanged.
