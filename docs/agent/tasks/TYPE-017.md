# TYPE-017: Add Node and Vite tooling compiler checking

Status: `planned`

## Objective

Semantically check root Vite configuration and Node developer/build scripts under a Node-specific compiler environment.

## Current missing coverage

`vite.config.ts` is transformed by Vite but not semantically typechecked. Root `scripts/*.cjs` run under Node and have no check-JS coverage.

## Exact paths involved

- `vite.config.ts`
- `scripts/*.cjs`
- proposed `tsconfig.tooling.json`
- root typecheck aggregation only as needed

Download-site configuration belongs to `TYPE-019`, not this task.

## Proposed compiler configuration

Use `noEmit: true`, `target/lib: ES2022`, Node types, and `module/moduleResolution: NodeNext`; enable `allowJs` and `checkJs` for `.cjs` scripts. Keep tooling globals out of renderer projects and do not add project references.

## Expected diagnostics

The Vite config alone produced 0 diagnostics in a read-only probe. Checking root scripts exposed 2 diagnostics: one in `scripts/launch-electron.cjs` and one in `scripts/publish-firestore-layout.cjs`.

## JavaScript checkJs

Required for root `.cjs` scripts; not relevant to `vite.config.ts` itself.

## Required tests and builds

The tooling typecheck, `npm run build`, `npm test`, and `npm run verify`. Administrative/publication scripts must not be executed merely to typecheck them.

## Security implications

Some scripts read credentials or can publish state. Verification must remain static and must not execute deployment, messaging, licensing, or production-data paths.

## Dependencies

Depends on completed `TYPE-001`; newly exposed diagnostics require separately reviewed fixes.

## Autonomous implementation

Not safe for autonomous implementation because static checking covers administrative tooling and exposes unowned diagnostics.
