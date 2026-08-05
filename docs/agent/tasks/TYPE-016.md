# TYPE-016: Add Electron main and preload compiler checking

Status: `planned`

## Objective

Add semantic checking for Electron main, Firebase sync, and preload JavaScript without changing the Electron security boundary or runtime format.

## Current missing coverage

The packaged `electron/**/*.cjs` files are active production source but are outside every TypeScript project.

## Exact paths involved

- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/firebaseSync.cjs`
- `branding.config.json` through module resolution
- proposed `tsconfig.electron.json`

## Proposed compiler configuration

Use a dedicated project with `allowJs: true`, `checkJs: true`, `noEmit: true`, `target/lib: ES2022`, Node/Electron types, `module: Node16`, `moduleResolution: Node16`, and `resolveJsonModule: true`. Do not add DOM globals or project references.

## Expected diagnostics

A read-only probe observed 3 diagnostics in `electron/main.cjs`: two unknown-error property accesses and one `electron-updater` event-name mismatch.

## JavaScript checkJs

Required for all three `.cjs` files.

## Required tests and builds

Electron-focused unit/characterization tests where needed, `npm test`, `npm run build`, the Electron typecheck project, and `npm run verify`. Do not run the production-connected stress harness.

## Security implications

High. Preload must continue exposing only the reviewed `contextBridge` API with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`; fixes must not widen IPC or renderer privileges.

## Dependencies

Depends on completed `TYPE-001`. Any semantic findings must receive separate behavioral task ownership before correction.

## Autonomous implementation

Not safe for autonomous implementation because it exposes production Electron diagnostics and touches a security-sensitive boundary.
