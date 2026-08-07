# Orbit Current-State Architecture

Date: 2026-08-07

## Runtime boundaries

| Surface | Entrypoint | Current ownership | Verification |
| --- | --- | --- | --- |
| Management renderer | `src/main.tsx` | React/Vite UI, most management state/domain orchestration, browser persistence, Firebase client coordination | `tsconfig.renderer.json`, root Vitest, Vite build |
| Renderer tests | `src/**/*.test.ts(x)` | jsdom/Node-assisted characterization and pure unit tests | `tsconfig.test.json`, root Vitest |
| Electron | `electron/main.cjs`, `electron/preload.cjs` | desktop windowing, IPC, local SQLite, hosted/local API fallback, telemetry, reports, updates | tests/build only; semantic check pending TYPE-016 |
| API | `apps/api/src/server.js` | Express routes, SQLite, Firebase Admin publication, licensing/payment integrations | root Vitest only; semantic check pending TYPE-018 |
| Player | `player-app/App.tsx` → `player-app/src/PlayerApp.tsx` | Expo mobile client and Player-owned domain/data code | Player TypeScript plus root Vitest |

## Current concentration

| File | Lines | Evidence-backed concern |
| --- | ---: | --- |
| `src/main.tsx` | 10,171 | 597 lines of top-level types/contracts, roughly 1,600 lines of state/report/domain helpers, and a 7,720-line `App` component containing nine route branches. |
| `src/styles.css` | 8,840 | Global cascade contains multiple historical theme/detail passes and feature-specific sections; ordering is behavior and requires rendered comparison before splitting. |
| `electron/main.cjs` | 1,856 | Combines transport/auth, local SQLite, reports, duplicated player sync, embedded backend, updates, windows, and IPC. |
| `src/lib/playerSync.ts` | 847 | Canonical renderer publication/merge logic; protected by focused tests and protocol-v2 invariants. |
| `apps/api/src/server.js` | 668 | Route composition and service orchestration are still combined. |
| `apps/api/src/database.js` | 556 | Connection/schema, mapping, state, telemetry, and reports share one module. |

The previous compactness audit's approximate 6,300/4,700/1,300-line figures for the renderer, stylesheet, and Electron main process are obsolete.

REF-001 subsequently moved 45 type-only contracts into `src/domain/types.ts`. `src/main.tsx` is now 9,751 lines; its generated JavaScript asset names and sizes remained identical, so the concentration changed without a runtime change.

REF-002 then moved characterized defaults and persisted-state normalization into `src/domain/state.ts`. `src/main.tsx` is now 9,364 lines; browser storage/publication orchestration deliberately remains in the entrypoint for a separately bounded task.

## Renderer dependency shape

`src/domain/types.ts` now owns the canonical management `AppState` and related persisted contracts, and `src/domain/state.ts` owns characterized defaults and normalization. `src/main.tsx` remains their orchestration consumer and still imports focused behavior from `src/lib/`. Existing characterization suites import `main.tsx` through a mocked renderer mount to exercise persistence, licensing, identity, waitlist, seating, table, and reporting behavior.

The next runtime extractions should follow dependency direction:

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
