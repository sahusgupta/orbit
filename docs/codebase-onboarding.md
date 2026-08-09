# Codebase Onboarding Guide

This guide is written for new contributors and for the Orbit assistant to index.

## What TableManager Is

TableManager is a live poker room operations app. It helps staff manage waitlists, active tables, player profiles, table balancing, reporting, pilot licensing, and sync with a player-facing app.

The product has three major surfaces:

- Desktop management app: React + Vite + Electron.
- Local/cloud API: Express + SQLite for telemetry, state, reports, and player sync.
- Player/mobile integration: sync helpers and a tracked Expo application in `player-app/`. The current `orbit.config.json` excludes that directory from assistant indexing, but Git does not ignore it.

## Start Here

Read these files first:

- `package.json`: available commands and packaging setup.
- `src/main.tsx`: management composition root, application-wide state/effects, route wiring, and command invocation.
- `src/features/`: cohesive management route drafts, view models, typed presentation contracts, and feature-local effects.
- `src/app/persistence/`: browser/preload/localhost/Firebase persistence adapters and result policy.
- `src/application/management/`: pure management commands plus synchronization hooks.
- `src/lib/appCore.ts`: small shared pure helpers.
- `src/lib/playerSync.ts`: player app and management app sync behavior.
- `electron/main.cjs`: Electron shell, local persistence, telemetry, updates, and embedded backend.
- `apps/api/src/server.js` → `apps/api/src/app.js`: API process entrypoint and non-listening app composition.
- `apps/api/src/routes/` and `apps/api/src/http/`: focused route and middleware owners.
- `apps/api/src/database.js` → `apps/api/src/db/`: stable SQLite facade and focused persistence owners.
- `src/components/PokerTable.tsx`: visual table component used by the management UI.

## How To Run

Install all three lockfiles without rewriting them:

```powershell
npm ci
npm ci --prefix apps/api
npm ci --prefix player-app
```

Run the web app:

```powershell
npm run dev
```

Run the Electron desktop app:

```powershell
npm run desktop
```

Run tests:

```powershell
npm test
```

Run the complete repository verification entrypoint:

```powershell
npm run verify
```

The historical TypeScript stabilization record is in `docs/agent/BASELINE.md`. The current `npm run verify` gate requires every root compiler project, Player TypeScript, unit tests, and the renderer build to pass.

Run the API:

```powershell
npm run api:dev
```

## Architecture Map

### React App

`src/main.tsx` is the management composition root. It owns canonical application state, route selection, shell notification visibility, undo history, the shared clock, cross-feature effects, dialogs, and command/route assembly. Cohesive UI drafts and view models live under `src/features/`. Domain transitions are delegated to `src/application/management/*Commands.ts`; persistence and player-update coordination are delegated to explicit adapters and hooks.

Important workflows inside it:

- pilot access and license validation
- persistence-hook composition
- account/staff sign-in
- waitlist and interest tracking
- game/table lifecycle management
- player seating and timers
- table balancing suggestions
- profile management
- GroupMe message parsing
- usage analytics and reporting
- route rendering for floor, table, builder, profiles, signals, summary, customization, and KPIs

### Shared Frontend Helpers

`src/lib/appCore.ts` contains pure helpers that are already easy to test:

- backup envelope creation/loading
- game name normalization
- game ID resolution
- active player counting
- timer status calculation

`src/lib/playerSync.ts` contains the renderer's typed management sync transformations.

Management persistence follows this ownership map:

| Concern | Owner |
| --- | --- |
| Per-account browser keys, last-account precedence, parse/normalize fallback | `src/app/persistence/browserStateRepository.ts` |
| Browser/preload save selection, localhost HTTP mapping, desktop operations, account restore | `src/app/persistence/managementPersistence.ts` |
| Desktop/Firebase startup timestamp precedence and first snapshot publication | `src/application/management/sync/useManagementStartupSync.ts` |
| Browser bridge, desktop API, and Firebase reconciliation loops | `src/application/management/sync/useManagementPlayerUpdateSync.ts` |
| Cross-window reload and Electron update preservation | `src/application/management/sync/useManagementPersistenceEvents.ts` |
| Server-managed pilot refresh and persistence | `src/application/management/sync/useManagementPilotAccessRefresh.ts` |
| Staff membership/seat notification priority, deduplication, and storage | `src/application/management/sync/staffRequestNotifications.ts` |
| Firebase protocol-v2 publication, ingestion, and request subscriptions | `src/lib/firebaseClubSync.ts` and `src/lib/playerSync.ts` |

The browser repository is always written first. A desktop build then uses the preload bridge; a browser build publishes to the optional localhost bridge. Renderer Firebase publication remains optional and fire-and-forget for ordinary saves. Do not bypass these owners or change account partition, timestamp precedence, merge ordering, retry cadence, or save-result semantics without characterization.

`src/domain/profileImport.ts` owns pure CSV/XLSX-row and pasted JSON/text profile normalization, canonical profile construction, duplicate filtering, and companion-link enrichment. `src/main.tsx` retains browser file decoding and user feedback, then invokes the shared persistence owner.

`src/lib/firebaseClubSync.ts` handles Firebase state sync, management-account authentication and password-reset email delivery, and player request subscriptions. Management password recovery verifies the new Firebase credential before replacing the desktop account's local password salt and hash.

`apps/api/src/shared/orbitCore.cjs` owns the behaviorally shared API/Electron server transforms. The API consumes it through `apps/api/src/orbitCore.js`; Electron selects its characterized compatibility profile in `electron/main.cjs`.

### Player App

`player-app/src/PlayerApp.tsx` is the Expo application composition shell. It owns Player state, storage migration, effect/subscription lifecycle, purchase/authentication/network use cases, navigation, feature assembly, shared filter sheets/seat-request modal composition, and only the referenced header/content/tab styles. Add or change feature presentation in its focused owner:

| Concern | Owner |
| --- | --- |
| Onboarding | `player-app/src/features/onboarding/` |
| Discovery deck, filters, details, hosting, lists, and map | `player-app/src/features/discovery/` |
| Tournaments | `player-app/src/features/tournaments/` |
| Clubs, membership store, wallet/QR, seat requests, and club hub | `player-app/src/features/clubs/` |
| Profile/account/preferences and identity verification | `player-app/src/features/settings/` |
| Shared fields, map picker, animated presentation primitives, and notification popup | `player-app/src/components/` |
| Shared, theme, and notification styles | `player-app/src/styles/` |
| Platform-neutral Player types, discovery rules, preferences, membership QR, and notification selection | `player-app/src/domain/` |
| Firebase/API/authentication transport and hydration | `player-app/src/data/orbitSyncApi.ts` |

`src/lib/playerOnboardingPresentation.test.ts` protects feature ownership plus exact component/style presentation fingerprints. Run Player TypeScript and that focused test while moving presentation, then run the full root verification gate. Keep storage, subscription, purchase, authentication, and network orchestration in the application shell until REF-023 gives those concerns characterized owners.

### Electron

`electron/main.cjs` owns the desktop runtime:

- app windows and routes
- IPC exposed through `electron/preload.cjs`
- local database paths
- local state persistence
- embedded backend routes
- telemetry heartbeat and event delivery
- update checks
- analytical report submission

### API

`apps/api/src/server.js` starts and stops the process and preserves the exported Express app. `apps/api/src/app.js` composes middleware and route groups without listening.

Key route areas:

- health checks
- dashboard data
- client heartbeats/events/errors
- venue and telemetry inspection
- state save/load
- player snapshots
- membership and waitlist requests
- analytical reports

`apps/api/src/database.js` preserves the persistence import contract. `apps/api/src/db/connection.js` and `schema.js` own SQLite lifecycle/schema; `clients.js`, `telemetry.js`, `state.js`, and `reports.js` own focused repositories.

`apps/api/src/orbitCore.js` preserves the public API entrypoint for the API-owned shared server sync core. Renderer-specific differences remain in `src/lib/playerSync.ts` by design.

## Common Questions For Orbit

Ask these after indexing this repo:

- What files should I read first to understand the app?
- Where is waitlist state stored and updated?
- How does a player get seated at a table?
- Where does Electron save local state?
- What API routes handle player waitlist requests?
- Where is telemetry recorded?
- Which files define player sync behavior?
- Where are pilot license keys validated?
- What should be refactored before adding a new table workflow?
- Which tests cover app core behavior?
- Where should I add a new API endpoint?

## New Contributor Tasks

Good first tasks:

- Add tests for pure helpers in `src/lib/appCore.ts`.
- Add a focused case to an existing pure management command or persistence adapter.
- Add a small API route test around state save/load.
- Improve documentation around one workflow, such as player seating or failed table starts.

Avoid as first tasks:

- Large edits to `src/main.tsx` without tests.
- Changing Electron persistence and API persistence at the same time.
- Touching generated folders like `dist`, `release`, `out`, or `download-dist`.

## Important Ignore Rules

When indexing or searching the codebase, ignore:

- `node_modules`
- `apps/api/node_modules`
- `dist`
- `build`
- `release`
- `out`
- `download-dist`
- `download-site/public/downloads`
- `TableTalk-Releases`
- `.git`
- `.vercel`

These are dependencies, generated output, or deployment artifacts rather than source knowledge.
