# Orbit Refactor Plan

Original phase date: 2026-08-07

Continuation date: 2026-08-08

Status: active

## Objective

Make runtime ownership obvious and behavior independently testable while preserving public contracts, persistence, synchronization, security, and failure semantics. REF-001 through REF-010 established the first foundation. The active continuation addresses the still-concentrated management application layer, Player application/data boundary, explicit external validation, and measured final consolidation.

## Execution rules

1. Work in the dependency order in `docs/refactor/TASKS.yaml`.
2. Treat `src/main.tsx`, persistence, licensing, Electron, API data, and sync as risky boundaries. Run committed characterization before and after moves; add focused characterization before changing uncovered behavior.
3. Prefer relocation plus imports over redesign. A task may expose a new design decision; it must not silently answer one.
4. Keep commits task-local. Separate characterization from behavior-changing implementation.
5. Run focused checks while diagnosing and `npm run verify` before completing every implementation task.
6. Never use production services, live data, deployment scripts, or the production-connected stress harness.

## Completed first phase

REF-001 through REF-010 completed canonical management types/projections, route and CSS ownership, Electron modules, the shared API/Electron server core, API compiler coverage, SQLite repositories, and route composition.

## Active phases

1. Record the fresh architecture/metric baseline and target dependency direction.
2. Extract pure management import and state-transition owners using existing characterization before changing persistence or UI composition.
3. Move management persistence/sync coordination behind explicit application/service boundaries.
4. Establish Player domain selectors/decoders, then split application state/use cases and feature presentation.
5. Split Player HTTP/Firebase/storage adapters and validate untrusted records while preserving legacy behavior.
6. Consolidate only proven duplicate privileged service/bootstrap logic.
7. Measure and improve the renderer bundle or repeated reads only where the baseline identifies a real bottleneck.
8. Audit dead-code candidates and error policy, then complete the final architecture report.

## Completion criteria

- `src/main.tsx` primarily composes state, effects, application commands, and route/feature owners; domain mutations and persistence implementations have focused owners.
- `player-app/src/PlayerApp.tsx` no longer owns domain selectors, external-data normalization, all application workflows, all screens, and all styles in one file.
- `player-app/src/data/orbitSyncApi.ts` is replaced by or delegates to focused authenticated HTTP, Firebase, subscription, and normalization owners.
- `src/styles.css` contains only intentional global tokens/base/compatibility layers; feature styles have explicit ordered owners and visual verification.
- `electron/main.cjs` primarily wires reviewed modules after its compiler/security gate is active.
- Shared sync behavior has one deliberate ownership model; desktop/API/Player protocol tests remain green.
- API database and route responsibilities are separated only after check-JS coverage is active.
- Files above 500 lines are rare or have a documented cohesion/safety reason.
- Every active task is complete or records a genuine human blocker; all repository verification gates pass.
- `docs/refactor/FINAL_REFACTOR_REPORT.md` records starting/final metrics, commits, reusable Player-web modules, warnings, and deliberate debt.

## First-phase completion record

REF-001 through REF-010 are complete. The management renderer has focused domain and route owners; the stylesheet has ordered feature owners; Electron primarily wires characterized process modules; API/Electron server transforms have one deliberate core; and API persistence, HTTP composition, and process startup now have separate owners behind stable entrypoints.

The remaining tracked files over 500 lines are inventoried with their current responsibility and safety/cohesion reason in `docs/architecture/CURRENT_STATE.md`. Ten are characterization matrices. Production concentrations are explicit route/app orchestration, sync adapter/publisher, process wiring, or ordered compatibility owners; Player UI decomposition remains outside this authorized phase and lacks a safe local native build. No hidden active queue item remains.

The attached 2026-08-08 goal authorizes a broader continuation. Its evidence, task order, safety constraints, and stop conditions are in the fresh audit and active queue. The absence of a safe local native build remains a verification limitation, not permission to skip Player TypeScript and focused tests.
