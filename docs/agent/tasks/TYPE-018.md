# TYPE-018: Add API compiler coverage

Status: `complete`

## Objective

Add package-owned semantic checking for the CommonJS API without converting it to TypeScript or changing API behavior.

## Current missing coverage

`apps/api/src/*.js` executes directly under Node and is exercised by Vitest, but no API TypeScript/check-JS project exists.

## Exact paths involved

- `apps/api/src/*.js`, including API test files
- proposed `apps/api/tsconfig.json`
- `apps/api/package.json` only if a package typecheck script is authorized
- root verification orchestration only if the API check becomes a repository gate

## Proposed compiler configuration

Use a package-local CommonJS/Node project with `allowJs: true`, `checkJs: true`, `noEmit: true`, `target/lib: ES2022`, Node types, `module/moduleResolution: Node16`, and `resolveJsonModule` where required. Do not add DOM globals or project references.

## Expected diagnostics

A read-only probe observed 7 diagnostics: 2 in `firebasePublisher.js`, 4 in `licenseService.js`, and 1 in `paymentService.js`.

## JavaScript checkJs

Required for API source and JavaScript tests.

## Required tests and builds

API check-JS, focused API Vitest files, `npm test`, and `npm run verify`. No API production server or external service should be started for compiler verification.

## Security implications

High. Firebase Admin, Stripe, identity, licensing, and database boundaries must not be weakened or contacted during implementation. Unknown external payloads should remain validated rather than cast away.

## Dependencies

Independent package-scoped follow-up after `TYPE-001`; each new semantic error needs reviewed ownership.

## Autonomous implementation

The user explicitly authorized compiler coverage required for the upcoming large refactor. The implementation remained isolated from production services and followed the required characterization-first workflow.

## Completion

- Characterization commit: `640f16f` (`test: characterize API compiler boundaries`). Five isolated tests captured Firebase OAuth token projection and player-document cleanup, license authentication and renewal writes, and Stripe's CommonJS/named/default constructor identity against unchanged production code.
- Added package-owned `apps/api/tsconfig.json` with CommonJS/Node16, ES2022, Node-only, no-emit check-JS coverage for API source and JavaScript tests. `npm run typecheck:api` is package-routed, and the non-short-circuiting root typecheck now includes the API project.
- Resolved the exact seven probe diagnostics without assertions or suppressions: Firebase REST JSON is narrowed and malformed successful token/list payloads now fail explicitly; license authentication preserves its timestamp mutation while renewal options are validated through their existing normalization and range checks; renewal reads the authoritative Firestore field; Stripe uses its runtime-identical named constructor export.
- Focused verification passed 4 files / 20 tests. Player TypeScript, all 47 files / 270 tests, the 1,930-module renderer build, and `npm run verify` passed with the established SQLite experimental, ExcelJS `eval`, and chunk-size warnings only.
- No API server, production database, Firebase/Admin endpoint, Stripe endpoint, identity/payment flow, credential, or hosted service was started or contacted.
