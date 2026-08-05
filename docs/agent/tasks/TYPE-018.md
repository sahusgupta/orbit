# TYPE-018: Add API compiler coverage

Status: `planned`

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

Not safe for autonomous implementation because it introduces a new gate over payment, identity, licensing, and Firebase code.
