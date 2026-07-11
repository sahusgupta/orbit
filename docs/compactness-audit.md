# Compactness Audit

This audit identifies the areas most worth redoing so the TableManager codebase is easier to navigate, test, and explain to new contributors.

## Highest Priority

### `src/main.tsx`

Current size: about 6,300 lines.

This file is doing too many jobs:

- domain types
- seed data
- persistence and backup loading
- pilot license validation
- staff authentication helpers
- game demand and table-health calculations
- analytics and usage reporting
- GroupMe parsing
- all top-level React state
- all route rendering
- many large screen sections

Suggested target structure:

```text
src/
  app/
    App.tsx
    routes.ts
    state.ts
    storage.ts
  domain/
    types.ts
    seedState.ts
    games.ts
    tables.ts
    analytics.ts
    staff.ts
    licensing.ts
    imports.ts
  features/
    floor/
    profiles/
    signals/
    summary/
    customization/
    kpis/
  components/
    common/
    PokerTable.tsx
```

Good first extraction:

1. Move all shared domain types into `src/domain/types.ts`.
2. Move `seedState` and `normalizeState` into `src/domain/state.ts`.
3. Move analytics helpers into `src/domain/analytics.ts`.
4. Move license/signature helpers into `src/domain/licensing.ts`.
5. Split the large JSX route sections into `src/features/*` components.

### `src/styles.css`

Current size: about 4,700 lines.

This stylesheet likely mirrors the same problem as `src/main.tsx`: everything for every screen is in one global file.

Suggested target structure:

```text
src/styles/
  base.css
  layout.css
  components.css
  poker-table.css
  floor.css
  profiles.css
  signals.css
  summary.css
  customization.css
```

The compactness goal is not fewer CSS lines at all costs. The goal is for a new developer to know where a style belongs.

### `electron/main.cjs`

Current size: about 1,300 lines.

This file mixes:

- Electron window creation
- auto-updates
- local SQLite persistence
- telemetry
- embedded backend HTTP routes
- analytical report email delivery
- IPC handlers
- player/mobile sync logic duplicated from API code

Suggested target structure:

```text
electron/
  main.cjs
  windows.cjs
  ipc.cjs
  localDatabase.cjs
  telemetry.cjs
  reports.cjs
  embeddedBackend.cjs
  updates.cjs
```

### API/Core Duplication

The app has similar player sync/domain logic in multiple places:

- `src/lib/playerSync.ts`
- `apps/api/src/orbitCore.js`
- `electron/main.cjs`

This should be compacted into one shared source of truth. A good direction is to create a shared package or plain shared module:

```text
packages/
  table-core/
    src/
      playerSync.ts
      accountKeys.ts
      stateValidation.ts
```

Then both the frontend and API can depend on the same behavior.

## Medium Priority

### `apps/api/src/database.js`

Current size: about 500 lines.

This is not dangerously large yet, but it mixes schema creation, row mapping, writes, reads, telemetry queries, state persistence, and reports.

Suggested split:

```text
apps/api/src/db/
  connection.js
  schema.js
  clients.js
  telemetry.js
  state.js
  reports.js
```

### `apps/api/src/server.js`

Current size: about 300 lines.

This file is still manageable, but route groups should eventually move into files:

```text
apps/api/src/routes/
  dashboard.js
  clients.js
  telemetry.js
  state.js
  player.js
  reports.js
```

### `scripts/firestore-club-members.cjs`

Current size: about 250 lines.

This script contains Firestore REST conversion helpers that may become useful elsewhere. If more Firestore scripts appear, extract shared helpers into `scripts/lib/firestoreRest.cjs`.

## Repo Hygiene

Generated and dependency folders are present locally:

- `node_modules/`
- `apps/api/node_modules/`
- `dist/`
- `build/`
- `release/`
- `out/`
- `download-dist/`
- `TableTalk-Releases/`

These should stay ignored by Git and ignored by Orbit indexing. The local `apps/api/node_modules` tree appears to contain recursive package paths, so avoid broad recursive filesystem tools that do not honor ignore rules.

## Recommended Refactor Order

1. Extract domain types and seed/normalization from `src/main.tsx`.
2. Extract analytics and table/demand calculations from `src/main.tsx`.
3. Split the top-level React route screens into `src/features/*`.
4. Split `src/styles.css` by feature/component.
5. Extract Electron database/telemetry/update/report modules.
6. Deduplicate shared player sync logic across frontend, Electron, and API.
7. Split API database and routes once the shared core is stable.

## Definition Of Done

The codebase will feel compact when:

- `src/main.tsx` is mostly app composition and route wiring.
- domain rules are testable without rendering React.
- Electron `main.cjs` only wires modules together.
- source files above 500 lines are rare and intentional.
- new developers can answer "where does this behavior live?" from folder names.
