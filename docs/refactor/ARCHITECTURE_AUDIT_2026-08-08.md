# Orbit Architecture Audit

Date: 2026-08-08

Audited commit: `801aa8d`

Audit branch: `refactor/orbit-architecture`

## Gate and scope

The audit started from a clean worktree on a dedicated branch. The first `npm run verify` attempt had one five-second timeout while loading the Stripe CommonJS boundary in the fully parallel suite. The same test then passed in 128 ms in isolation, all 55 test files passed together, and a complete `npm run verify` rerun passed. No source change was needed to restore the gate.

Current verified baseline:

- all four root compiler projects pass;
- Player TypeScript passes;
- 55 Vitest files / 306 tests pass;
- the renderer build passes with 1,932 transformed modules;
- the known SQLite experimental, ExcelJS `eval`, and large-chunk warnings remain.

This audit excludes generated output, dependencies, ignored artifacts, and the tracked `data/orbit-api.sqlite3`. It does not start Electron, the API, Expo, Firebase, or any production-connected process.

## Application and entrypoint map

| Runtime | Entrypoint | Current composition owner | External boundaries |
| --- | --- | --- | --- |
| Management renderer | `src/main.tsx` | React route shell, one canonical `AppState`, commands, effects, browser persistence, Electron bridge calls, and Firebase coordination | `localStorage`, preload `window.tableManagerDesktop`, local API bridge, Firebase client |
| Electron | `electron/main.cjs` and `electron/preload.cjs` | Browser windows, IPC registration, lifecycle, remaining outreach and Firebase coordination | SQLite module, hosted/local API client, Firebase client, SMTP, updater |
| API | `apps/api/src/server.js` -> `apps/api/src/app.js` | Process start/stop and non-listening Express composition | SQLite repositories, Firebase Admin/REST, Stripe, RevenueCat |
| Player | `player-app/App.tsx` -> `player-app/src/PlayerApp.tsx` | Expo navigation, state/effects, data orchestration, and nearly all presentation | AsyncStorage, Firebase Auth/Firestore, local and hosted API, RevenueCat |
| Download site | Vite configuration and `download-site/` | Separate static download surface | staged release assets |

## State and domain ownership

### Management

`src/domain/types.ts` is the canonical management contract owner. `src/main.tsx` holds the one live `AppState` and still owns most state-changing use cases: waitlist changes, seating, table/session lifecycle, membership/profile mutations, imports, tournaments, closeout, authentication orchestration, and persistence coordination. Focused modules already own state normalization, reporting, licensing, staff secrets, operational projections, analytics, and participant scoring. Route components are presentation-only and do not directly access persistence, Firebase, SQLite, or Electron.

### Player

`player-app/src/domain/playerSync.ts` owns the Player-facing snapshot and request types. `PlayerApp.tsx` owns 65 local state hooks, 18 effects, navigation decisions, async orchestration, discovery projections, form rules, and presentation. `player-app/src/data/orbitSyncApi.ts` owns Firebase initialization, authentication, HTTP calls, Firestore reads/writes/subscriptions, legacy-state mutation, snapshot normalization, and protocol adaptation in one module.

### API and Electron

The completed REF-008 through REF-010 work established clear API route/repository owners, a non-listening API app boundary, focused Electron modules, and one API-contained server sync core used by Electron through an explicit compatibility profile. Those boundaries are materially healthier than the renderer and Player boundaries and should not be reworked without new evidence.

## Starting measurements

The measurements below use tracked production source only and exclude tests, generated output, declaration files, and dependency trees.

### Source concentration

| Owner | Production files | Lines |
| --- | ---: | ---: |
| `src/` | 74 | 23,721 |
| `player-app/src/` | 13 | 9,906 |
| `apps/api/src/` | 25 | 3,475 |
| `electron/` | 9 | 2,170 |
| `scripts/` | 10 | 960 |
| `download-site/` | 3 | 338 |

Largest production modules:

| File | Lines | Largest function/component | Measured responsibility concern |
| --- | ---: | ---: | --- |
| `player-app/src/PlayerApp.tsx` | 7,430 | `PlayerApp`, 1,681 lines | State/effects, navigation, use cases, dozens of screens/components, selectors, formatting, and a 2,300-line style object |
| `src/main.tsx` | 5,685 | `App`, 5,086 lines | 72 state hooks, 21 effects, commands for most management domains, persistence, sync, and composition |
| `player-app/src/data/orbitSyncApi.ts` | 1,328 | `subscribeToAllClubSnapshots`, 176 lines | Auth, HTTP, Firestore, subscriptions, normalization, legacy compatibility, and state mutation |
| `src/components/FloorView.tsx` | 1,123 | `FloorView`, 1,001 lines | One route, but a broad table/waitlist/quick-add callback and rendering surface |
| `src/lib/playerSync.ts` | 847 | snapshot/request transforms | Cohesive renderer sync owner with characterized runtime-specific semantics |
| `src/lib/firebaseClubSync.ts` | 760 | Firebase publication and reconciliation | Renderer Firebase transport and protocol-v2 boundary remain combined |
| `src/components/ProfilesView.tsx` | 727 | `ProfilesView`, 625 lines | One route with profile/import/membership sections |
| `apps/api/src/firebasePublisher.js` | 644 | `publishStateToFirebase`, 146 lines | REST credentials, conversion, cleanup, and parent-last publication in one boundary |
| `src/components/SummaryView.tsx` | 574 | `SummaryView`, 511 lines | Cohesive route, but dense reporting/closeout presentation |
| `electron/main.cjs` | 507 | `createWindow`, 95 lines | Composition plus remaining privileged outreach/Firebase wiring |

### Dependency shape

- 86 production TypeScript/JavaScript modules participate in 171 resolved relative dependency edges.
- No relative-import dependency cycle was found.
- `src/main.tsx` has 32 internal outgoing dependencies, over three times the next-highest production module.
- `src/domain/types.ts` has the highest internal fan-in at 15, which is appropriate for a canonical management contract owner.
- Presentation components do not directly import database, Firebase, API, or Electron implementations; the coupling is concentrated in the two application entrypoints.

### Boundary and type-safety indicators

Syntactic production-only TypeScript counts:

- 18 explicit `any` keywords;
- 144 type assertions;
- 16 non-null assertions;
- 55 explicit `unknown` boundaries.

The concentration is not uniform. `player-app/src/data/orbitSyncApi.ts` contains 9 `any` keywords and 44 assertions, while `src/main.tsx` contains 8 `any` keywords, 28 assertions, and 8 non-null assertions. The Player data adapter parses eight HTTP responses and maps many Firestore documents with assertions rather than one canonical runtime-validation step. The renderer Firebase adapter also casts raw Firestore records before domain application.

Direct platform operations are concentrated but still live in application/UI owners:

| Indicator | Count |
| --- | ---: |
| `localStorage` references in `src/main.tsx` | 25 |
| preload bridge references in `src/main.tsx` | 18 |
| renderer Firebase orchestration calls in `src/main.tsx` | 10 |
| `AsyncStorage` references in `PlayerApp.tsx` | 6 |
| HTTP `fetch` calls in `orbitSyncApi.ts` | 8 |
| Firestore read/write/subscription operations in `orbitSyncApi.ts` | 34 |

`src/main.tsx` contains 13 silent optional-boundary catch patterns and `PlayerApp.tsx` contains 9. Some are deliberate offline/fallback behavior, but the distinction between expected optional failure and actionable failure is implicit rather than represented by a shared result/error policy.

### Duplication inventory

Name and call-site review identifies these real or candidate duplicated concepts:

- management and Player each implement `createMembershipQrValue` with the same public concept;
- renderer and Player request modules each own membership/waitlist request constructors and ID/slug helpers;
- API service modules repeat Firebase Admin credential loading and initialization;
- API identity and payment modules independently construct Stripe clients;
- renderer/Electron Firebase publishers repeat timeout and undefined-stripping mechanics, although their deployment/runtime ownership differs;
- API publisher and renderer operations repeat collection/session time calculations;
- server and renderer sync functions have similar names but characterized semantic differences and must not be merged blindly.

The prior REF-009 decision remains valid: renderer sync, server sync, and Player hydration are distinct observable contracts. Consolidation requires concept-by-concept characterization, not a shared-name assumption.

### Tests and difficult seams

The suite is strong around management state transitions and privileged boundaries: waitlist, seating, table lifecycle, profile identity, persistence, Firebase publication, cross-runtime sync, Electron modules, and API database/routes all have focused characterization. Several renderer suites still mount the 5,086-line `App` and capture internal state or handlers through React/inspector harnesses. Extracting pure command owners will let those same behavioral matrices target stable functions directly.

Player coverage is much thinner. Player domain status/protocol/visibility and one `orbitSyncApi` behavior are covered, but the 1,681-line `PlayerApp`, discovery projections, navigation/use-case orchestration, AsyncStorage migration, and most Firestore normalization paths lack direct characterization.

### Build and performance baseline

The verified Vite build transforms 1,932 modules and emits:

- CSS: 188.85 kB, 34.05 kB gzip;
- small renderer chunk: 412.05 kB, 107.68 kB gzip;
- main renderer chunk: 989.62 kB, 295.71 kB gzip;
- lazy ExcelJS chunk: 1,066.53 kB, 268.73 kB gzip.

ExcelJS is already dynamically imported by profile-file import. The remaining main chunk is the first measured bundle target. No runtime render, memory, startup, network, or database performance claim is made yet. `subscribeToAllClubSnapshots` combines live child listeners with a 30-second fallback refresh, and tournament subscriptions refetch all tournament collections after child changes; these are measurement candidates, not proven bottlenecks.

### Dead-code candidates

The relative import graph finds only `src/components/ui/badge.tsx` and `src/components/ui/button.tsx` as non-entry production modules with zero incoming edge. Earlier compiler-boundary documentation deliberately retained them as active design-system source. They are therefore candidates requiring product/history/build proof, not authorized deletions. Platform-selected `MapView` files, preload, API scripts, and Expo shims are dynamic/configured entrypoints and are not dead-code candidates.

## Architecture findings

### Highest priority

1. The management renderer has canonical types and projections but not an application layer. `App` still owns domain mutation algorithms and platform persistence together.
2. The Player runtime has the largest file and weakest characterization. Domain selectors, application workflows, platform data access, presentation, and styles need separate owners.
3. Player external data is treated as trusted too early. Runtime validation/normalization should precede canonical Player objects while preserving approved legacy behavior.

### Medium priority

1. Renderer persistence/synchronization effects need an explicit application/service boundary after pure mutation extraction.
2. Renderer Firebase raw-record validation should become explicit at the adapter boundary.
3. API privileged-client construction is repeated across identity, licensing, and payment modules.
4. The main renderer bundle needs route/import analysis after orchestration modules are separable.

### Deliberate current boundaries

- API route and SQLite repository decomposition is complete and coherent.
- Electron process modules are cohesive; the remaining `main.cjs` size is not itself evidence for another split.
- Renderer/server/Player sync semantics remain intentionally distinct.
- The ordered CSS compatibility layers remain behavior, not cleanup material.
- A repository-root shared runtime package is not introduced until Expo Metro, API deployment packaging, Electron packaging, and independent lockfile ownership can all be verified locally.

## Future Orbit Player web readiness

Already reusable without React Native presentation:

- `player-app/src/domain/playerSync.ts`;
- `player-app/src/domain/syncProtocol.ts`;
- `player-app/src/domain/clubVisibility.ts`;
- `player-app/src/domain/membershipQr.ts`;
- `player-app/src/domain/playerTypes.ts` for platform-neutral screen, filter, opportunity, coordinate, and draft contracts;
- `player-app/src/domain/discovery.ts` for private-game/map/tournament/live-game selectors, distance/location rules, stable keys, grouping, discovery labels, validation, and immutable preference updates;
- `player-app/src/data/playerRequests.ts` after its platform dependencies remain absent.

REF-021 completed the reusable discovery-selector/type boundary. The next phases should add runtime decoders and transport-independent API contracts. `PlayerApp.tsx`, React Native components, AsyncStorage, RevenueCat, Firebase initialization, native map behavior, and club checkout/presentation remain platform-specific.

## Audit conclusion

The previous refactor materially improved API, Electron, styles, canonical management contracts, and pure projections. The repository is not at the attached goal's terminal state because management mutation/persistence ownership and the Player application remain monolithic, Player boundary validation is incomplete, and no final architecture/report covers those areas. The next queue starts with behavior-preserving pure extractions, then moves outward to persistence/data adapters and presentation.
