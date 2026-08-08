# Orbit Current-State Architecture

Initial phase date: 2026-08-07

Fresh audit date: 2026-08-08

## Runtime boundaries

| Surface | Entrypoint | Current ownership | Verification |
| --- | --- | --- | --- |
| Management renderer | `src/main.tsx` plus `src/components/` | React/Vite UI, management state/domain orchestration, typed route composition, browser persistence, Firebase client coordination | `tsconfig.renderer.json`, root Vitest, Vite build |
| Renderer tests | `src/**/*.test.ts(x)` | jsdom/Node-assisted characterization and pure unit tests | `tsconfig.test.json`, root Vitest |
| Electron | `electron/main.cjs`, extracted process modules, and API-owned `apps/api/src/shared/orbitCore.cjs` | desktop windowing, IPC, local SQLite, hosted/local API fallback, telemetry, reports, updates, explicit server-sync compatibility profile | dedicated non-DOM `tsconfig.electron.json`, tests, renderer build |
| API | `apps/api/src/server.js` → `apps/api/src/app.js`, `apps/api/src/routes/`, `apps/api/src/http/`, `apps/api/src/database.js`, and `apps/api/src/db/` | process startup, non-listening Express composition, focused route/middleware owners, stable SQLite facade/repositories, privileged integrations, shared server-side player transforms | dedicated non-DOM `apps/api/tsconfig.json` check-JS plus API localhost characterization and root Vitest |
| Player | `player-app/App.tsx` → `player-app/src/PlayerApp.tsx` | Expo mobile client and Player-owned domain/data code | Player TypeScript plus root Vitest |

## Current concentration

| File | Lines | Evidence-backed concern |
| --- | ---: | --- |
| `src/main.tsx` | 5,599 | Domain contracts, pure projections, and nine route views have focused owners; top-level state, effects, persistence, and mutation orchestration remain concentrated here. |
| `src/styles.css` and `src/styles/*.css` | 35-line entrypoint; 8,840 owned lines | The unchanged ordered cascade now has 35 feature/layer owners. Only the documented dark-theme compatibility pass exceeds 500 lines (649) because equal-specificity historical ordering is cohesive behavior. |
| `electron/main.cjs` | 505 | Wires the shared server-sync compatibility profile, windows, IPC, Firebase request polling, outreach transport/logging, and application lifecycle. Extracted modules own updates, embedded backend, local SQLite/reports, API transport/telemetry, and pure runtime helpers. |
| `src/lib/playerSync.ts` | 847 | Canonical renderer publication/merge logic; protected by focused tests and protocol-v2 invariants. |
| `apps/api/src/shared/orbitCore.cjs` | 471 | Pure API/Electron server-side snapshot and request transformations with explicit validation/compatibility profiles. |
| `apps/api/src/server.js` and `apps/api/src/app.js` | 25 and 35 | Process listen/shutdown/export and non-listening HTTP composition are separate; focused HTTP/route modules are at most 162 lines. |
| `apps/api/src/database.js` and `apps/api/src/db/` | 33-line facade; focused modules at most 212 | The stable 17-export facade delegates to one connection/schema owner and focused client, telemetry, state, and report repositories. |

The previous compactness audit's approximate 6,300/4,700/1,300-line figures for the renderer, stylesheet, and Electron main process are obsolete.

REF-001 subsequently moved 45 type-only contracts into `src/domain/types.ts`. `src/main.tsx` is now 9,751 lines; its generated JavaScript asset names and sizes remained identical, so the concentration changed without a runtime change.

REF-002 then moved characterized defaults and persisted-state normalization into `src/domain/state.ts`. `src/main.tsx` is now 9,364 lines; browser storage/publication orchestration deliberately remains in the entrypoint for a separately bounded task.

REF-003 moved characterized report windows, report-state projection, collection lookup, and financial/dealer summaries into `src/domain/reporting.ts`. `src/main.tsx` is now 9,072 lines, and the reporting suite exercises the pure module without mounting React or mocking Firebase.

REF-004 moved characterized license/account identity and staff-secret behavior into `src/domain/licensing.ts` and `src/domain/staffAuth.ts`. `src/main.tsx` is now 8,918 lines; signature, license-file, storage-partition, persisted-sign-in, and current/legacy secret behavior is tested directly without mounting React or using the Node inspector.

REF-005 moved characterized demand/table/session rules, operational/usage analytics, analytical payload projection, participant selection, and outreach/opportunity rules into `src/domain/operations.ts`, `src/domain/analytics.ts`, and `src/domain/participants.ts`. `src/main.tsx` is now 8,342 lines; the focused operational suite runs directly in Node while the existing renderer suites retain mutation-side coverage.

REF-006 moved all nine remaining renderer route branches into typed feature components, including the Floor and selected-table routes. `src/main.tsx` is now 5,599 lines and retains shell, navigation, top-level state/effects, persistence, and mutation ownership while the route components own their characterized markup and callback wiring.

REF-007 replaced the 8,840-line stylesheet entrypoint with 35 ordered imports under `src/styles/`. The recursively flattened source is byte-identical to the prior cascade, the generated CSS asset is unchanged, and eight isolated route/theme/viewport comparisons preserve rendered output. `src/styles/README.md` records the feature/layer owners and the compatibility-order constraint.

REF-008 extracted Electron transport, persistence, embedded-backend, updater, and utility modules behind characterized process-local interfaces. REF-009 then moved the duplicated API/Electron player snapshot and request transformations into the API-contained `apps/api/src/shared/orbitCore.cjs`; the API keeps its public wrapper and validation defaults while Electron selects an explicit compatibility profile. Renderer management transforms remain intentionally separate because their account-key, membership-note, and full-table behaviors are observably different. Player remains the protocol consumer and revision-selection owner.

REF-010 preserved the API's CommonJS start/export and database facade while separating schema/connection, four persistence repositories, non-listening app composition, authentication/error/publication/SSE middleware, and system/Player/dashboard/client route groups. Its isolated localhost characterization uses a unique temporary SQLite file and disabled external credentials; all 38 method/path registrations remain present.

## Remaining large-file ownership

The tracked production files above 500 lines are deliberate current boundaries, not undiscovered API/database/route ownership:

| Owner | Lines | Current cohesion or safety reason |
| --- | ---: | --- |
| `player-app/src/PlayerApp.tsx` | 7,430 | Expo state/effect/navigation shell plus colocated React Native presentation components. Player UI decomposition was not part of this authorized phase, and the repository has no safe local native build; this remains an explicit future concentration. |
| `src/main.tsx` | 5,599 | Management state/effect/command orchestration and typed route composition after domain and nine route views moved to focused owners. |
| `player-app/src/data/orbitSyncApi.ts` | 1,328 | Player's single Firebase/API authentication, transport, hydration, and protocol-compatibility adapter. |
| `src/components/FloorView.tsx` | 1,123 | One management route and its characterized floor/table callback surface. |
| `src/lib/playerSync.ts` | 847 | Renderer-specific management sync transformation boundary whose semantics intentionally differ from the server core. |
| `src/lib/firebaseClubSync.ts` | 756 | Renderer Firebase publication/subscription and protocol-v2 boundary. |
| `src/components/ProfilesView.tsx` | 727 | One management route and its characterized profile/import/relationship callback surface. |
| `src/styles/91-dark-theme-compatibility.css` | 649 | Ordered equal-specificity compatibility pass; moving rules changes the preserved cascade. |
| `apps/api/src/firebasePublisher.js` | 644 | API's sequential Firestore REST publisher, including child-first/parent-last protocol-v2 commit semantics. |
| `src/components/SummaryView.tsx` | 574 | One management summary/closeout/report route boundary. |
| `electron/main.cjs` | 505 | Reviewed Electron process composition, window/IPC lifecycle, and remaining privileged outreach/Firebase wiring. |

Ten additional tracked files over 500 lines are focused characterization suites. Their size comes from complete lifecycle, transition, planning, synchronization, persistence, identity, and ordering matrices; splitting those fixtures would obscure the behavioral boundary they protect.

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

Electron and API now have dedicated compiler coverage. API route/database decomposition remains separate from the shared pure server-sync core and requires its own persistence/route characterization.

## Invariants

- The renderer uses the preload bridge; it does not gain Node globals or direct Electron imports.
- Persisted management state and API/Firebase payload shapes remain unchanged unless separately approved.
- Sync protocol v2 atomic-batch or REST parent-last commit semantics and per-club isolation remain intact.
- Payment/profile/tournament identities remain authoritative and validated at external boundaries.
- Electron/API production defaults are never exercised by ordinary refactor verification.

## 2026-08-08 continuation audit

The 2026-08-07 ownership map remains the record of REF-001 through REF-010. A fresh audit from merged commit `801aa8d` opened a continuation queue rather than treating that first phase as the terminal architecture.

Current tracked line counts are `src/main.tsx` 5,685, `player-app/src/PlayerApp.tsx` 7,430, `player-app/src/data/orbitSyncApi.ts` 1,328, and `electron/main.cjs` 507. The management `App` still owns most state-changing use cases plus browser/preload/Firebase persistence orchestration. Player still combines application state/effects, navigation, domain selectors, presentation, and styles in one file, while its data adapter combines HTTP, Firebase Auth/Firestore, subscriptions, normalization, and legacy behavior.

The fresh audit, reproducible metrics, target dependency direction, and active REF-011 through REF-030 queue are in:

- `docs/refactor/ARCHITECTURE_AUDIT_2026-08-08.md`
- `docs/refactor/TARGET_ARCHITECTURE.md`
- `docs/refactor/TASKS.yaml`

API route/repository ownership, Electron module ownership, the server sync core, sync protocol-v2 invariants, and ordered CSS ownership remain deliberate current boundaries. The continuation begins with pure management commands and Player domain characterization before moving persistence or external-data adapters.

REF-012 subsequently moved CSV/XLSX/pasted-profile validation, parsing, canonical construction, duplicate filtering, and companion-link enrichment into `src/domain/profileImport.ts`. `src/main.tsx` is now 5,464 lines and `App` is 4,858 lines; file selection, lazy ExcelJS decoding, UI feedback, usage reporting, and persistence remain with the application owner. The import boundary has seven renderer characterization cases and four direct pure cases.
