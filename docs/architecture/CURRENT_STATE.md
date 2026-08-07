# Orbit Current-State Architecture

Date: 2026-08-07

## Runtime boundaries

| Surface | Entrypoint | Current ownership | Verification |
| --- | --- | --- | --- |
| Management renderer | `src/main.tsx` plus `src/components/` | React/Vite UI, management state/domain orchestration, typed route composition, browser persistence, Firebase client coordination | `tsconfig.renderer.json`, root Vitest, Vite build |
| Renderer tests | `src/**/*.test.ts(x)` | jsdom/Node-assisted characterization and pure unit tests | `tsconfig.test.json`, root Vitest |
| Electron | `electron/main.cjs`, `electron/runtimeUtils.cjs`, `electron/preload.cjs` | desktop windowing, IPC, local SQLite, hosted/local API fallback, telemetry, reports, updates | dedicated non-DOM `tsconfig.electron.json`, tests, renderer build |
| API | `apps/api/src/server.js` | Express routes, SQLite, Firebase Admin publication, licensing/payment integrations | root Vitest only; semantic check pending TYPE-018 |
| Player | `player-app/App.tsx` → `player-app/src/PlayerApp.tsx` | Expo mobile client and Player-owned domain/data code | Player TypeScript plus root Vitest |

## Current concentration

| File | Lines | Evidence-backed concern |
| --- | ---: | --- |
| `src/main.tsx` | 5,599 | Domain contracts, pure projections, and nine route views have focused owners; top-level state, effects, persistence, and mutation orchestration remain concentrated here. |
| `src/styles.css` and `src/styles/*.css` | 35-line entrypoint; 8,840 owned lines | The unchanged ordered cascade now has 35 feature/layer owners. Only the documented dark-theme compatibility pass exceeds 500 lines (649) because equal-specificity historical ordering is cohesive behavior. |
| `electron/main.cjs` | 1,809 | Combines transport/auth, local SQLite, reports, duplicated player sync, embedded backend, updates, windows, and IPC; pure runtime validation, error, outreach, and account-key helpers now live in `electron/runtimeUtils.cjs`, and TYPE-016 guards both owners. |
| `src/lib/playerSync.ts` | 847 | Canonical renderer publication/merge logic; protected by focused tests and protocol-v2 invariants. |
| `apps/api/src/server.js` | 668 | Route composition and service orchestration are still combined. |
| `apps/api/src/database.js` | 556 | Connection/schema, mapping, state, telemetry, and reports share one module. |

The previous compactness audit's approximate 6,300/4,700/1,300-line figures for the renderer, stylesheet, and Electron main process are obsolete.

REF-001 subsequently moved 45 type-only contracts into `src/domain/types.ts`. `src/main.tsx` is now 9,751 lines; its generated JavaScript asset names and sizes remained identical, so the concentration changed without a runtime change.

REF-002 then moved characterized defaults and persisted-state normalization into `src/domain/state.ts`. `src/main.tsx` is now 9,364 lines; browser storage/publication orchestration deliberately remains in the entrypoint for a separately bounded task.

REF-003 moved characterized report windows, report-state projection, collection lookup, and financial/dealer summaries into `src/domain/reporting.ts`. `src/main.tsx` is now 9,072 lines, and the reporting suite exercises the pure module without mounting React or mocking Firebase.

REF-004 moved characterized license/account identity and staff-secret behavior into `src/domain/licensing.ts` and `src/domain/staffAuth.ts`. `src/main.tsx` is now 8,918 lines; signature, license-file, storage-partition, persisted-sign-in, and current/legacy secret behavior is tested directly without mounting React or using the Node inspector.

REF-005 moved characterized demand/table/session rules, operational/usage analytics, analytical payload projection, participant selection, and outreach/opportunity rules into `src/domain/operations.ts`, `src/domain/analytics.ts`, and `src/domain/participants.ts`. `src/main.tsx` is now 8,342 lines; the focused operational suite runs directly in Node while the existing renderer suites retain mutation-side coverage.

REF-006 moved all nine remaining renderer route branches into typed feature components, including the Floor and selected-table routes. `src/main.tsx` is now 5,599 lines and retains shell, navigation, top-level state/effects, persistence, and mutation ownership while the route components own their characterized markup and callback wiring.

REF-007 replaced the 8,840-line stylesheet entrypoint with 35 ordered imports under `src/styles/`. The recursively flattened source is byte-identical to the prior cascade, the generated CSS asset is unchanged, and eight isolated route/theme/viewport comparisons preserve rendered output. `src/styles/README.md` records the feature/layer owners and the compatibility-order constraint.

## Renderer dependency shape

`src/domain/types.ts` owns the canonical management `AppState` and related persisted contracts; focused state, reporting, licensing/staff-auth, operations, analytics, and participant modules own renderer domain projections. Typed components own route markup while `src/main.tsx` remains their state/effect/mutation orchestrator and still imports focused behavior from `src/lib/`. Renderer-mount characterization remains for persistence and state mutations; pure projections have direct focused boundaries. Renderer styles retain one explicit import entrypoint with ordered feature and compatibility owners.

The renderer phases now follow this dependency direction:

```text
domain types
  → state defaults/normalization
  → reporting and pure calculations
  → feature orchestration/components
  → ordered CSS feature slices
```

Electron and API refactoring are separate later phases. They require their own compiler coverage and characterization before moving persistence, privileged integrations, or duplicated sync code.

## Invariants

- The renderer uses the preload bridge; it does not gain Node globals or direct Electron imports.
- Persisted management state and API/Firebase payload shapes remain unchanged unless separately approved.
- Sync protocol v2 child-first/commit-marker semantics and per-club isolation remain intact.
- Payment/profile/tournament identities remain authoritative and validated at external boundaries.
- Electron/API production defaults are never exercised by ordinary refactor verification.
