# Codebase Onboarding Guide

This guide is written for new contributors and for the Orbit assistant to index.

## What TableManager Is

TableManager is a live poker room operations app. It helps staff manage waitlists, active tables, player profiles, table balancing, reporting, pilot licensing, and sync with a player-facing app.

The product has three major surfaces:

- Desktop management app: React + Vite + Electron.
- Local/cloud API: Express + SQLite for telemetry, state, reports, and player sync.
- Player/mobile integration: sync helpers and a separate `player-app` folder that is intentionally ignored in this repo setup.

## Start Here

Read these files first:

- `package.json`: available commands and packaging setup.
- `src/main.tsx`: current main React app and most business workflows.
- `src/lib/appCore.ts`: small shared pure helpers.
- `src/lib/playerSync.ts`: player app and management app sync behavior.
- `electron/main.cjs`: Electron shell, local persistence, telemetry, updates, and embedded backend.
- `apps/api/src/server.js`: API route entry point.
- `apps/api/src/database.js`: SQLite persistence for API data.
- `src/components/PokerTable.tsx`: visual table component used by the management UI.

## How To Run

Install dependencies:

```powershell
npm install
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

Run the API:

```powershell
npm run api:dev
```

## Architecture Map

### React App

The React app currently lives mostly in `src/main.tsx`.

Important workflows inside it:

- pilot access and license validation
- local state loading/saving
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

`src/lib/playerSync.ts` contains sync transformations between player accounts and club state.

`src/lib/firebaseClubSync.ts` handles Firebase state sync and player request subscriptions.

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

`apps/api/src/server.js` defines HTTP routes.

Key route areas:

- health checks
- dashboard data
- client heartbeats/events/errors
- venue and telemetry inspection
- state save/load
- player snapshots
- membership and waitlist requests
- analytical reports

`apps/api/src/database.js` owns SQLite tables and persistence functions.

`apps/api/src/orbitCore.js` duplicates some player-sync/domain behavior from the frontend and should eventually be consolidated.

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
- Extract one pure helper from `src/main.tsx` into `src/lib/appCore.ts`.
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
