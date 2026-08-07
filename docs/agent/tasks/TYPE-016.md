# TYPE-016: Add Electron main and preload compiler checking

Status: `complete`

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

## Trigger and characterized findings

REF-008 is now the next refactor task, so the documented compiler trigger is satisfied under the approved instruction to implement only coverage required for the upcoming refactor.

The original probe was reproduced with `skipLibCheck` at the dependency boundary and still reports exactly three production diagnostics:

- `electron/main.cjs:72` reads `code` from an external unknown error/cause value.
- `electron/main.cjs:161` reads `message` from unknown JSON returned by Twilio.
- `electron/main.cjs:1590` registers `before-quit-for-update` on the `electron-updater` emitter even though installed runtime/type evidence exposes that event on Electron's native `autoUpdater`.

`src/lib/electronMainCompilerFindings.test.ts` characterizes the unchanged error/cause projection, Twilio message/status fallback, and current update-listener registration before production edits. The first two repairs must preserve output exactly. The third is an explicit correction to attach the already-intended installation telemetry listener to the emitter that actually produces the event; it must not change download/install control flow or renderer privileges.

## Implementation and verification

- Added standalone `tsconfig.electron.json` with `allowJs`/`checkJs`, ES2022 without DOM libraries, Node16 module semantics, JSON resolution, and all three production `.cjs` entrypoints. No project reference or runtime-format change was introduced.
- Added `npm run typecheck:electron` and made the non-short-circuiting root typecheck run renderer, root-test, and Electron projects independently.
- Replaced the two unsafe unknown-property reads with a validated record-property helper while preserving the characterized Error/cause and Twilio message/status outputs.
- Corrected only the `before-quit-for-update` telemetry listener to use Electron's native updater emitter; `electron-updater` still owns update checks, downloads, and installation.
- The focused three-test finding suite passed; Electron check-JS reports zero diagnostics; both existing root projects and Player TypeScript passed; all 41 files/211 tests passed; the 1,930-module renderer build passed; and `npm run verify` passed.
- The preload bridge, IPC channel list, `contextIsolation`, `nodeIntegration`, sandbox settings, production defaults, and update-install control flow were not widened or otherwise changed. Electron and the production-connected stress harness were not launched.
