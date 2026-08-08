# Historical Umbrella Task: Restore the Root TypeScript Gate

## Problem

`npm run typecheck` originally failed with 3,632 diagnostics. Vite declarations and compatible root-owned React/ReactDOM type packages are now restored. The current truthful baseline is 94 diagnostics in 6 files.

## Narrow Scope

A separate dependency-restoration/rebaseline task completed the first two items below. Remaining work is split into `TYPE-001` through `TYPE-014` in `docs/agent/TASKS.yaml`:

1. Completed: add only the compatible development type packages and Vite client declarations needed by the existing React/Vite versions.
2. Completed: re-run TypeScript and classify the remaining diagnostics by module and behavior boundary.
3. Fix remaining errors in small groups with characterization tests before any risky domain change.
4. Preserve compiler strictness and do not use blanket `any`, `@ts-ignore`, broad exclusions, or skipped tests.
5. Run `npm run verify` and document the diagnostic-count reduction after each coherent group.

The rebaseline intentionally does not perform the remaining production remediation. Use the bounded task specifications and their characterization/stop conditions rather than this historical umbrella.
