# TYPE-022: Remove unnecessary Node globals from the sandboxed renderer

Status: `planned`

## Objective

Restrict the renderer compiler to browser/Vite globals so accidental Node-global use fails at compile time.

## Current missing coverage

Root `tsconfig.json` has no explicit `types`, so visible `@types/node` and other transitive global packages enter the renderer program even though Electron uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.

## Exact paths involved

- renderer compiler configuration created by `TYPE-015`
- `src/vite-env.d.ts`
- renderer `src/**/*.ts` and `src/**/*.tsx`
- test compiler configuration only to preserve legitimate test globals

## Proposed compiler configuration

Set the renderer project's explicit ambient types to `vite/client` while relying on imported React declarations for React modules. Keep Node types only in test/tooling/Electron projects. Retain DOM/DOM.Iterable/ES2022 and do not add project references.

## Expected diagnostics

The prior read-only renderer probe with ES2022 and `types: ["vite/client"]` produced the same 88 diagnostics as the library correction and exposed no new error. Re-probe after renderer/test separation because file ownership will differ.

## JavaScript checkJs

Not involved.

## Required tests and builds

Renderer and test typechecks, `npm test`, `npm run build`, `npm run player:typecheck`, and `npm run verify`. Add a compile-only fixture only if needed to prove Node globals are rejected.

## Security implications

Positive and security-relevant: compiler globals will match the sandboxed renderer. Do not expose Node or Electron modules directly to renderer source; the preload bridge remains the only desktop capability boundary.

## Dependencies

Depends on `TYPE-015` so test-only Node globals can move to a dedicated test project without being removed from legitimate tests.

## Autonomous implementation

Safe only after `TYPE-015` is complete and the exact renderer file list is verified; until then human review is required.
