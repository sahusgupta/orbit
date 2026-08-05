# TYPE-015: Separate renderer and root unit-test compiler projects

Status: `planned`

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
