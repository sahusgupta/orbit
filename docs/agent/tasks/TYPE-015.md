# TYPE-015: Separate renderer and root unit-test compiler projects

Status: `complete`

## Objective

Give production renderer source and root unit tests distinct compiler environments without removing either from verification.

## Current missing coverage

Root `tsconfig.json` mixes all non-test renderer source, nine root unit-test files, jsdom-only setup, and two cross-package Player imports. Production and test diagnostics are not attributable to separate projects.

## Exact paths involved

- Production: `src/**/*.ts`, `src/**/*.tsx`, and `src/**/*.d.ts`, excluding `src/**/*.test.ts` and `src/**/*.test.tsx`.
- Tests: `src/**/*.test.ts` and `src/**/*.test.tsx`, plus production modules reached by those test imports.
- Proposed configuration: `tsconfig.renderer.json`, `tsconfig.test.json`, root `tsconfig.json`/typecheck orchestration, and `package.json` only as required for an aggregate check.

## Proposed compiler configuration

- Renderer: retain strictness, `target: ES2020`, `lib: [DOM, DOM.Iterable, ES2022]`, `jsx: react-jsx`, `module: ESNext`, and `noEmit`.
- Tests: use `ES2022`, Node/Vitest types, DOM/jsdom only for browser-component tests, React JSX, and `noEmit`.
- Run both projects through a non-short-circuiting root typecheck command.
- Do not add project references; defer them until a genuine shared package or measured need exists.

## Expected diagnostics

The current 88 diagnostics should initially partition into 84 production diagnostics and 4 root-test diagnostics. No new diagnostic is expected solely from separation, but an exact rebaseline is required.

## JavaScript checkJs

Not involved. This task remains TypeScript-only.

## Required tests and builds

`npm run typecheck`, focused root unit tests, `npm test`, `npm run build`, `npm run player:typecheck`, and `npm run verify`.

## Security implications

Separation enables a later renderer-only global restriction without removing legitimate Node/jsdom test capabilities. It must preserve Electron's sandboxed renderer assumptions.

## Dependencies

Complete `TYPE-012` and `TYPE-021` first so test globals and cross-package imports have deliberate ownership.

## Autonomous implementation

Not safe for autonomous implementation. It changes verification orchestration and requires review of exact file ownership, although it must not change runtime behavior.

## Completed implementation — 2026-08-07

The post-green review classified compiler ownership as required before extracting renderer code from `src/main.tsx`. `tsconfig.renderer.json` now owns production renderer roots and excludes `*.test.ts(x)` roots; `tsconfig.test.json` owns the 25 root test files plus the production modules they import, with explicit Node, Vitest, Vite, DOM, and JSX capabilities. The shared root config retains strict compiler behavior and has no source roots of its own.

`npm run typecheck` now uses `scripts/typecheck.cjs` to run both projects even when one fails, and reports their results independently. No project references, source exclusions that hide imports, runtime source changes, or diagnostic suppressions were added.

The renderer graph contains 21 workspace inputs and zero test roots. The test graph contains no Player implementation paths after TYPE-021. Both projects, Player TypeScript, 35 files/188 tests, the 1,913-module renderer build, and `npm run verify` passed.
