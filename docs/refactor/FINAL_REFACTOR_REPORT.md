# Final Orbit Refactor Report

Status: `complete`

Terminal audit date: 2026-08-10

Audited continuation base: `801aa8d`

Final production checkpoint: `18a3847`

## Executive outcome

The REF-011 through REF-030 continuation is complete. Orbit now has explicit management command, persistence, synchronization, Player domain, Player application, Player presentation, Player data-adapter, renderer-decoder, and API privileged-client owners. The management and Player entrypoints remain composition roots instead of being rewritten wholesale, persisted/public/sync contracts remain intact, and every completed production task ended with a green aggregate gate.

The terminal state has:

- all four root compiler projects passing;
- Player TypeScript passing;
- 81 Vitest files / 471 tests passing;
- the production renderer build passing with 1,957 transformed modules;
- 170 audited production modules / 521 local edges with zero cycles, direction violations, or unresolved relative imports;
- zero explicit `any` keywords in production TypeScript;
- no new type/test/build suppression, temporary refactor marker, incomplete migration, production access, deployment, dependency change, or push.

The continuation changed 178 files with 24,348 insertions and 11,418 deletions relative to `801aa8d`. That aggregate includes characterization, focused owners, and documentation; it is not presented as a code-size optimization.

## Starting architecture and metrics

The user-provided gate at the end of the inherited REF-001 through REF-010 foundation was 51 files / 293 tests and a 1,930-module build. The fresh REF-011 audit at clean commit `801aa8d` reran the repository and established the directly comparable continuation baseline: 55 files / 306 tests, 1,932 transformed modules, and all compiler/build gates green.

At that audited starting point:

- `src/main.tsx` was 5,685 lines; its 5,086-line `App` owned 72 direct state hooks, 21 effects, most management mutations, and persistence/sync orchestration.
- `player-app/src/PlayerApp.tsx` was 7,430 lines; its 1,681-line component owned 65 state hooks, 18 effects, domain selectors, application workflows, most presentation, and a large style object.
- `player-app/src/data/orbitSyncApi.ts` was a 1,328-line Firebase/Auth/HTTP/subscription/normalization adapter.
- `src/main.tsx` contained 25 `localStorage` references and 18 preload-bridge references; `PlayerApp.tsx` contained six AsyncStorage references.
- `orbitSyncApi.ts` contained eight HTTP fetches and 34 Firestore operation calls.
- Production TypeScript contained 18 explicit `any` keywords, 144 assertions, 16 non-null assertions, and 55 explicit `unknown` boundaries. The concentrations were `main.tsx` and the mixed Player adapter.
- The initial graph census found 86 production modules / 171 local edges and no cycle; coupling was concentrated in the two application entrypoints.
- The renderer emitted a rounded 989.62 kB / 295.71 kB gzip main chunk, 188.85 kB / 34.05 kB gzip CSS, a 412.05 kB / 107.68 kB gzip QR-scanner chunk, and the already-lazy 1,066.53 kB / 268.73 kB gzip ExcelJS chunk.

The highest-priority findings were the missing management application layer, management persistence orchestration inside `App`, the combined Player domain/application/presentation owner, trusted-too-early Player/renderer external data, duplicated privileged API bootstrap, and an unmeasured large default renderer entry.

## Final architecture

### Management renderer

The management dependency flow is now:

```text
React composition and feature workspaces
  -> application commands and synchronization hooks
    -> canonical domain state/rules
      -> browser, preload, localhost, and Firebase adapters
```

`src/main.tsx` owns the live application state, route/shell composition, cross-feature dialogs/effects, command invocation, and user feedback. It no longer implements the core import, waitlist, seating, player-session, table, profile, membership, tournament, closeout, browser-persistence, reconciliation, or feature-workspace algorithms inline.

Focused owners include:

| Boundary | Owners |
| --- | --- |
| External profile import | `src/domain/profileImport.ts` |
| Waitlist, seating, and player sessions | `src/application/management/waitlistCommands.ts`, `seatingCommands.ts`, `playerSessionCommands.ts` |
| Tables and lifecycle | `tableCommands.ts`, `tableLifecycleCommands.ts` |
| Profiles and membership | `profileCommands.ts`, `membershipCommands.ts` |
| Tournaments and night close | `tournamentCommands.ts`, `closeoutCommands.ts` |
| Browser/desktop/bridge persistence | `src/app/persistence/browserStateRepository.ts`, `managementPersistence.ts` |
| Startup, reconciliation, preservation, pilot, and staff-request policy | `src/application/management/sync/` |
| Cohesive route drafts/view models | `src/features/` |
| Renderer Firebase input validation | `src/lib/firebaseClubDecoders.ts` |

The entrypoint still directly owns Firebase authentication/password UX, route-window identifiers, reports, and telemetry calls because those are composition/platform interactions rather than duplicated domain or persistence algorithms.

### Player application

The Player dependency flow is now:

```text
Expo composition and React Native features
  -> React application hooks
    -> platform-neutral Player domain/decoders
      -> focused HTTP, Firebase, subscription, storage, purchase, and native adapters
```

`PlayerApp.tsx` owns navigation/filter state, feature assembly, shared sheets/modals, and two route-local effects. Feature presentation and styles live under `features/`, `components/`, and `styles/`. Account, identity, premium, live-data, club/waitlist, private-game, tournament, storage, and polling workflows live under `application/` and `data/`.

The former 1,328-line data module is a 66-line compatibility facade. Focused HTTP, Firebase Auth, document repository, request repository, subscription, decoder, and snapshot-transform modules own the implementation. Raw HTTP and Firestore values pass through structural decoders and explicit legacy-normalization functions before canonical use. Player domain source has no Firebase, React, React Native, or Expo dependency.

### API and Electron

The inherited API route/repository and Electron process decomposition remains intact. REF-027 added one lazy Firebase Admin bootstrap owner and one Stripe client owner for API identity, licensing, and payment consumers. Credential precedence, explicit license-file behavior, default credential discovery, missing-key failures, authorization, routes, webhooks, and per-club isolation are unchanged.

Electron remains a reviewed process composition root over focused local store, API client, embedded backend, updater, runtime utilities, preload, and the shared server-sync compatibility profile. No evidence justified another Electron split.

### Data and error boundaries

Persisted, HTTP, Firebase, Auth-error, and provider inputs now have named decoding/bootstrap owners. The final error audit distinguishes explicit user/action/provider failure, defensive parse/default behavior, local-authoritative fan-out, best-effort hydration/subscription, compatibility acknowledgements, and optional OS handoff. Ambiguous silent catches now state their existing policy without changing visible messages or fallback behavior.

## Final metrics

| Measure | Audited start | Final | Result |
| --- | ---: | ---: | --- |
| `src/main.tsx` | 5,685 lines | 3,514 lines | 2,171 fewer; composition retained |
| Direct management state/effect hooks | 72 / 21 | 5 / 8 | feature/application ownership extracted |
| `PlayerApp.tsx` | 7,430 lines | 953 lines | 6,477 fewer; presentation/workflows extracted |
| Direct Player state/effect hooks | 65 / 18 | 25 / 2 | shell/navigation state retained |
| `orbitSyncApi.ts` | 1,328 lines | 66 lines | stable facade over focused owners |
| `main.tsx` localStorage / preload references | 25 / 18 | 6 / 8 | persistence coordination moved |
| PlayerApp AsyncStorage references | 6 | 0 | one storage adapter owner |
| Facade fetch / Firestore calls | 8 / 34 | 0 / 0 | focused adapters own transport |
| Production explicit `any` | 18 | 0 | removed, not suppressed |
| Type assertions | 144 | 124 | remaining assertions localized/audited |
| Non-null assertions | 16 | 15 | no broad assertion strategy added |
| Explicit `unknown` boundaries | 55 | 116 | validation became explicit |
| Test files / tests | 55 / 306 | 81 / 471 | +26 files / +165 tests |
| Renderer modules transformed | 1,932 | 1,957 | focused modules retained by build |

The terminal graph audit covers the expanded decomposition: 170 production modules / 521 relative edges, zero cycles, zero direction violations, and zero unresolved relative imports. Its only unconfigured zero-incoming candidates are the deliberately retained Badge and Button design-system primitives.

Current largest production modules are documented rather than hidden: `main.tsx` (3,514), `FloorView.tsx` (1,118), `PlayerApp.tsx` (953), renderer player sync (847), renderer Firebase sync (765), Profiles (689), discovery styles (655), API Firebase publisher (644), Summary (572), and Electron main (507). Each has one documented composition, route, protocol, publisher, process, or ordered-style responsibility.

## Performance results

Performance work was measurement-driven. REF-028 first measured the post-validation renderer at 1,009,541 initial bytes / 301,459 gzip. It kept the default Floor route synchronous and deferred nine non-default routes behind a shell-local Suspense boundary. The terminal write-free measurement is:

| Artifact | Before route deferral | Final | Change |
| --- | ---: | ---: | ---: |
| Initial JavaScript | 1,009,541 | 914,989 | -94,552 bytes (-9.37%) |
| Initial JavaScript gzip | 301,459 | 281,186 | -20,273 bytes (-6.73%) |
| CSS | 188,848 / 34,045 gzip | unchanged | no cascade change |
| ZXing | 412,054 / 107,682 gzip | unchanged | remains on demand |
| ExcelJS | 1,066,528 / 268,728 gzip | same emitted size | remains on demand |

No speculative Player polling/freshness change was accepted; the existing lifecycle already prevents overlapping work, pauses in background, refreshes on foreground, and cleans up listeners/timers.

## Consolidation and duplication decisions

Consolidated:

- canonical management state transitions that were repeated or constructed inline in `App`;
- management persistence selection and sync lifecycle ownership;
- Player discovery and snapshot transformations behind pure owners;
- Player external decoding and source-selection logic behind focused repositories/decoders;
- API Firebase Admin and Stripe construction behind shared lazy providers.

Deliberately not consolidated:

- renderer, server, and Player sync transforms, because characterization proves different account-key, membership, notes, validation, full-table, and legacy semantics;
- renderer/Electron/API Firebase publication mechanics, because their transaction/deployment boundaries differ;
- React Native and management UI components, because no shared UI concept or verified cross-platform package boundary exists;
- a repository-root shared runtime package, because root, API, Player, Electron, Metro, and deployment packaging use independent boundaries and lockfiles.

## Dead code removed and retained

Removed only with compiler, repository search, history, configuration, build, and test evidence:

- unused imports, destructures, constants, projections, aliases, and local formatting/correction helpers;
- unreachable management quick-fill, seat lookup, table projection, and undo callback code;
- 114 orphaned Player style declarations after feature ownership moved;
- obsolete Player favorite/membership hook actions whose UI consumers had been removed;
- a no-op Player snapshot expression and the Player-domain Firebase SDK type dependency;
- residual explicit `any` annotations whose canonical types were inferable.

Retained deliberately:

- two characterized management closures invoked by the renderer harness;
- four dormant characterized onboarding steps;
- undo snapshot write cadence pending a restore/remove product decision;
- Badge/Button design-system candidates;
- platform/configuration entries including MapView variants, preload, API scripts, and the Expo performance shim;
- approved legacy sync and persisted-state compatibility paths.

No production `TODO`, `FIXME`, `HACK`, temporary migration marker, or refactor-created compatibility facade remains without explicit justification.

## Bugs and regressions

No existing product behavior bug was silently changed inside this continuation. Structural tasks preserved the characterized behavior, including non-obvious legacy and failure cases.

One test reliability defect was repaired separately: `b4ce041` freezes the API telemetry test clock so its current-window assertion is deterministic. Several task-owned harness/ownership regressions were also corrected before their task completed: migrated Player request-path inspection, lazy-route preload timing, intentional source fingerprints, and protected management closure capture. Those corrections did not weaken product assertions.

Intermittent five-second Stripe CommonJS test timeouts occurred during a few fully parallel aggregate runs. Each case passed quickly in isolation and later full reruns passed; no timeout increase or production change was justified.

## Characterization and final verification

The continuation added 26 test files and 165 tests. Coverage was added at the same boundary as the work:

- direct management import, waitlist, seating, player-session, table, profile, membership, tournament, and closeout commands;
- browser/desktop persistence, startup/reconciliation, update preservation, and staff-request notification policy;
- Player discovery, presentation ownership, storage migration, application lifecycles, subscription cleanup, HTTP/Auth/Firestore behavior, malformed records, protocol revisions, and decoders;
- renderer Firebase input decoding;
- API Firebase Admin/Stripe provider bootstrap;
- renderer route-loading ownership and final dependency graph constraints.

Terminal `npm run verify` result:

- PASS renderer TypeScript;
- PASS root-test TypeScript;
- PASS Electron check-JS;
- PASS API check-JS;
- PASS Player TypeScript;
- PASS 81 test files / 471 tests;
- PASS Vite renderer build / 1,957 modules.

No test was skipped or removed to obtain the result. No compiler setting, exclusion, or warning threshold was weakened.

## Known warnings and deliberate technical debt

Unchanged non-blocking warnings:

- Node SQLite remains experimental;
- bundled ExcelJS contains `eval`;
- the initial Firebase-heavy renderer entry and lazy ExcelJS chunk remain above Vite's 500 kB warning threshold.

Deliberate debt and verification limits:

- `main.tsx` remains a large composition root; further work needs a new cohesive responsibility, not a size-only split.
- `FloorView`, Profiles, Summary, renderer sync, renderer Firebase sync, and API Firebase publication remain large cohesive route/protocol owners.
- the repository has no safe local native Expo build in the ordinary verification gate; Player TypeScript and fake-only tests are green, but no EAS/native build was run.
- no secret-free automated Electron/browser e2e gate or Firebase rules emulator suite is part of `npm run verify`.
- clipboard failure feedback, background device/cloud persistence recovery UX, and undo-history removal/restoration require separate product decisions.
- the two unused design-system primitives and four dormant onboarding steps remain intentionally retained.

## Orbit Player web readiness

Directly reusable platform-neutral modules:

- `player-app/src/domain/playerTypes.ts`, `playerSync.ts`, `playerIdentity.ts`, and `syncProtocol.ts`;
- `discovery.ts`, `clubAccess.ts`, `clubVisibility.ts`, `membershipQr.ts`, `playerNotifications.ts`, and `playerPreferences.ts`;
- `domain/decoders/playerBoundaryDecoders.ts`, `playerGameDecoder.ts`, and `playerSnapshotDecoders.ts`;
- `domain/playerSnapshotTransforms.ts`;
- `data/playerRequests.ts` pure request construction/transforms.

These modules have no React Native, Expo, Firebase runtime, or native map dependency. REF-029 replaced the last Firestore document type used by Player domain transforms with a structural document contract.

Reusable after an explicit web adapter/composition decision:

- React application hooks under `player-app/src/application/` import no React Native module but currently consume the concrete data facade and a Player platform port;
- `data/api/` and `data/firebase/` are independently selectable, but hosted authentication/configuration and Firebase initialization need a web environment decision;
- the 66-line `orbitSyncApi.ts` facade can remain as an application contract or be replaced by injected ports in a separately scoped web task.

Platform-specific and not claimed reusable:

- React Native feature components and styles;
- Expo navigation/browser/linking behavior and `app/playerPlatform.ts`;
- native maps, AsyncStorage wiring, RevenueCat, EAS/native configuration, and mobile presentation behavior.

No Orbit Player website, web route, framework choice, deployment plan, or cross-platform UI abstraction was created.

## Complete continuation commit list

The 78 commits from audited base `801aa8d` through final production checkpoint `18a3847` are:

### REF-011 to REF-017

- `633bce6` - docs: audit remaining Orbit architecture
- `f42e297` - test: characterize profile file imports
- `c0cb9e2` - refactor: extract profile import domain
- `3a406f2` - refactor: extract waitlist commands
- `81dc007` - test: characterize player session operations
- `33ebc2c` - refactor: extract seating and player sessions
- `aca78c3` - test: characterize table start and switching
- `3646564` - refactor: extract table commands
- `8406cba` - test: characterize profile membership mutations
- `9f4e7bd` - refactor: extract profile and membership commands
- `c517ab9` - test: characterize tournament and closeout lifecycles
- `45f9aae` - refactor: extract tournament and closeout commands

### REF-018 to REF-020

- `44c630d` - test: characterize management persistence orchestration
- `50259ec` - refactor: extract management persistence adapters
- `19a83f3` - refactor: extract staff request notifications
- `1c7b44a` - refactor: extract management synchronization hooks
- `31e8ae7` - refactor: complete management persistence boundary
- `06621b8` - docs: record management persistence extraction
- `fceb2bd` - refactor: consolidate tournament workspace
- `4a857b0` - refactor: consolidate profile workspace
- `e10879c` - refactor: consolidate settings workspace
- `86c0c50` - refactor: consolidate reporting workspace
- `e957682` - refactor: consolidate floor workspace
- `15be035` - refactor: consolidate games workspace
- `926da38` - refactor: finish settings workspace state
- `c1969cc` - refactor: move table ledger presentation
- `13a1058` - docs: record management composition consolidation

### REF-021 and REF-022

- `c673010` - test: characterize Player discovery rules
- `a513415` - refactor: extract Player discovery domain
- `fec2f75` - docs: record Player discovery extraction
- `8a0fdf0` - test: characterize Player onboarding presentation
- `40d0b2c` - test: cover shared Player onboarding primitives
- `8527e0b` - test: track Player onboarding presentation owners
- `9d50798` - test: normalize Player presentation fingerprints
- `b4ce041` - test: stabilize telemetry time window
- `2bd58ed` - refactor: extract Player onboarding presentation
- `9268566` - style: trim Player presentation files
- `10f7100` - test: characterize Player discovery presentation
- `c1d78bd` - refactor: extract Player discovery presentation
- `728f378` - test: characterize Player tournament presentation
- `29031d3` - refactor: extract Player tournament presentation
- `cab6138` - test: characterize Player club presentation
- `0b10f18` - refactor: extract Player club presentation
- `24359f5` - test: characterize Player settings presentation
- `c0f62d6` - refactor: extract Player settings presentation
- `7dd5db0` - refactor: remove orphaned Player styles
- `056231a` - docs: complete REF-022 presentation split

### REF-024, REF-023, and REF-025

- `9a158fd` - test: characterize Player data boundaries
- `284c516` - docs: complete REF-024 characterization
- `37f9c42` - test: characterize Player orchestration
- `b8a7739` - refactor: extract Player application orchestration
- `82de43a` - docs: complete REF-023 orchestration
- `0213146` - refactor: split Player Firebase auth adapter
- `faba811` - refactor: split Player HTTP adapters
- `cc8de40` - refactor: split Player Firestore repositories
- `a1184b6` - refactor: decode Player game records
- `d778068` - refactor: split Player club sync adapters
- `16ca7a5` - refactor: finalize Player data facade
- `d4fd8c6` - test: follow Player request repository ownership
- `b1ccb55` - docs: complete REF-025 data adapters

### REF-026 to REF-028

- `fcefbc1` - test: characterize Firebase input records
- `f0a27d1` - refactor: validate renderer Firebase inputs
- `93d0845` - docs: complete REF-026 Firebase validation
- `2a7dc49` - test: characterize privileged client bootstrap
- `506c2d6` - refactor: centralize API privileged clients
- `fcdd354` - docs: complete REF-027 privileged clients
- `3b80c15` - test: record renderer bundle baseline
- `2229a4d` - perf: defer non-default management routes
- `0c715ba` - test: await deferred management routes
- `1f975cb` - docs: complete REF-028 performance work

### REF-029

- `39ffc37` - refactor: remove Player domain platform types
- `ae0b359` - test: audit module dependency graph
- `c7fc561` - refactor: remove proven dead locals
- `a085c00` - docs: clarify best-effort failure policies
- `93bd230` - test: preserve audited closure boundaries
- `11510a5` - refactor: remove obsolete Player hook actions
- `deb2b15` - docs: complete REF-029 consistency audit
- `18a3847` - refactor: remove residual explicit any types

The REF-030 documentation checkpoint is the commit containing this report and the terminal queue/architecture updates.

## Completion decision

Every REF-011 through REF-030 task is complete. The final architecture matches the dependency target, verification is green, performance claims are measured, deletions have evidence, retained debt is explicit, and no unresolved product/data/security/architecture decision blocks the refactor goal. The Orbit refactor can be declared complete.
