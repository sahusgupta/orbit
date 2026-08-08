# Orbit Refactor Plan

Date: 2026-08-07

Status: complete

## Objective

Make runtime ownership obvious and behavior independently testable while preserving public contracts, persistence, synchronization, security, and failure semantics. The first active phase is the management renderer; Electron, API, shared-core, and CSS phases remain gated by their boundary-specific prerequisites.

## Execution rules

1. Work in the dependency order in `docs/refactor/TASKS.yaml`.
2. Treat `src/main.tsx`, persistence, licensing, Electron, API data, and sync as risky boundaries. Run committed characterization before and after moves; add focused characterization before changing uncovered behavior.
3. Prefer relocation plus imports over redesign. A task may expose a new design decision; it must not silently answer one.
4. Keep commits task-local. Separate characterization from behavior-changing implementation.
5. Run focused checks while diagnosing and `npm run verify` before completing every implementation task.
6. Never use production services, live data, deployment scripts, or the production-connected stress harness.

## Phases

1. Renderer foundations: canonical management types, persisted state/defaults/normalization, reporting, and remaining pure calculations.
2. Renderer features: split route sections behind typed props while `App` retains top-level state and mutation orchestration until behavior is characterized.
3. Styles: move ordered, feature-owned slices with rendered comparison; retain a documented global layer.
4. Electron: complete TYPE-016, characterize IPC/persistence/update boundaries, then extract wiring modules.
5. API and shared core: complete TYPE-018, decide a real shared-package boundary, then deduplicate sync before route/database decomposition.

## Completion criteria

- `src/main.tsx` primarily composes state, effects, commands, and route components; domain contracts and pure rules have focused owners.
- `src/styles.css` contains only intentional global tokens/base/compatibility layers; feature styles have explicit ordered owners and visual verification.
- `electron/main.cjs` primarily wires reviewed modules after its compiler/security gate is active.
- Shared sync behavior has one deliberate ownership model; desktop/API/Player protocol tests remain green.
- API database and route responsibilities are separated only after check-JS coverage is active.
- Files above 500 lines are rare or have a documented cohesion reason.
- Every active task is complete or records a genuine human blocker; all repository verification gates pass.

## Completion record

REF-001 through REF-010 are complete. The management renderer has focused domain and route owners; the stylesheet has ordered feature owners; Electron primarily wires characterized process modules; API/Electron server transforms have one deliberate core; and API persistence, HTTP composition, and process startup now have separate owners behind stable entrypoints.

The remaining tracked files over 500 lines are inventoried with their current responsibility and safety/cohesion reason in `docs/architecture/CURRENT_STATE.md`. Ten are characterization matrices. Production concentrations are explicit route/app orchestration, sync adapter/publisher, process wiring, or ordered compatibility owners; Player UI decomposition remains outside this authorized phase and lacks a safe local native build. No hidden active queue item remains.
