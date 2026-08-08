# TYPE-020: Add E2E compiler coverage

Status: `planned`

## Objective

Add static checking for the manual Playwright browser and Electron harnesses without executing production-connected flows.

## Current missing coverage

`tests/e2e/*.mjs` is excluded from Vitest, CI, and all compiler projects.

## Exact paths involved

- `tests/e2e/management-core-smoke.mjs`
- `tests/e2e/stress-electron.mjs`
- proposed `tsconfig.e2e.json`

## Proposed compiler configuration

Use `allowJs: true`, `checkJs: true`, `noEmit: true`, `target/lib: ES2022` plus DOM for browser-evaluation callbacks, Node and Playwright types, and `NodeNext` module/resolution. Do not add project references.

## Expected diagnostics

A read-only probe with Node and DOM libraries observed 2 diagnostics in `stress-electron.mjs`: an over-narrow environment object and the undeclared `tableManagerDesktop` window bridge.

## JavaScript checkJs

Required for both `.mjs` harnesses.

## Required tests and builds

Static e2e check-JS, `npm test`, `npm run build`, and `npm run verify`. Runtime e2e execution requires a separately authorized secret-free, localhost-only harness.

## Security implications

High. The current stress harness reads a local pilot private key and Electron can default to a hosted API. Static checking must not execute it or access secrets/services.

## Dependencies

Depends on `TYPE-016` for reviewed Electron/preload bridge ownership before sharing that declaration with e2e callbacks.

## Autonomous implementation

Not safe for autonomous implementation until the e2e harness is isolated from secrets and hosted defaults.
