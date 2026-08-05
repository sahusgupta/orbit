# Future Task: Restore the Root TypeScript Gate

## Problem

`npm run typecheck` fails on the inspected baseline with 3,632 diagnostics. Missing React, ReactDOM, and Vite declaration support creates a large cascade, but independent application/domain mismatches are also present.

## Narrow Scope

A separate task should:

1. Add only the compatible development type packages and Vite client declarations needed by the existing React/Vite versions.
2. Re-run TypeScript and classify the remaining diagnostics by module and behavior boundary.
3. Fix remaining errors in small groups with characterization tests before any risky domain change.
4. Preserve compiler strictness and do not use blanket `any`, `@ts-ignore`, broad exclusions, or skipped tests.
5. Run `npm run verify` and document the diagnostic-count reduction after each coherent group.

This preparation task intentionally does not perform that remediation because it would touch production source and dependency resolution beyond workflow setup.
