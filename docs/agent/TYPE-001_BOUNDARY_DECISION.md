# TYPE-001 TypeScript Boundary Decision

Investigation date: 2026-08-05

Branch: `chore/prepare-codex-workflow`

Starting commit: `2897a35`

Decision state: `review_required`

## Executive decision

The six diagnostics assigned to `TYPE-001` are caused by an incorrect ECMAScript library declaration, not unsupported runtime behavior. The packaged desktop uses Electron 42.1.0, and the installed `electron-to-chromium` mapping identifies Chromium 148.0.7778.97. The renderer build uses Vite 7.3.5's default `baseline-widely-available` target: Chrome 107, Edge 107, Firefox 104, and Safari 16. `String.prototype.replaceAll` and `Array.prototype.at` are valid for that supported renderer floor. The correct renderer library contract is therefore `DOM`, `DOM.Iterable`, and `ES2022`, while the existing `target: ES2020` can remain unchanged because TypeScript emits nothing and Vite owns production transformation.

The present compiler boundary is nevertheless broader in globals and narrower in files than the runtime boundary:

- root TypeScript checks all TypeScript below `src/`, including tests and two unreferenced UI modules;
- two root tests import two Player domain files, so root TypeScript also follows those files into `player-app/`;
- no explicit `types` list means the browser project admits Node globals and both the root and Player React declaration trees;
- Vite checks/bundles only the renderer import graph and does not semantically check `vite.config.ts`;
- Electron main, preload, API, download-site JavaScript, scripts, and e2e harnesses have no semantic TypeScript/check-JS project;
- Vitest discovers tests across the root, API, and Player packages, which is a different scope from both root and Player TypeScript.

A narrow `tsconfig.json` correction (`lib: ES2022` plus explicit Vite globals) was proven read-only to reduce the root count from 94 to 88 with no new diagnostic. It was not applied because the request permits implementation only when every production runtime is covered by a TypeScript project and the resulting command is more complete. Meeting that condition requires a multi-project/check-JS expansion outside `TYPE-001`'s allowed areas and exposes existing, unqueued JavaScript diagnostics. A human must decide whether to authorize the narrow exception or expand the task.

## 1. Current runtime map

### Actual entry and import paths

- Desktop renderer: `index.html` loads `/src/main.tsx`. That file calls `createRoot` and statically imports `AppShell`, `PokerTable`, `TournamentTvView`, the dropdown-menu UI module, and the `appCore`, `membership`, `membershipQr`, `firebaseClubSync`, `firebaseConfig`, `nightClose`, and `seatNormalization` helpers. Those imports pull in `playerSync` and `utils`. Its only dynamic imports are external packages (`@zxing/browser` and `exceljs`).
- Electron main: root `package.json` declares `electron/main.cjs`. It requires `electron`, `electron-updater`, Node built-ins, `branding.config.json`, and `electron/firebaseSync.cjs`.
- Preload: every `BrowserWindow` sets `preload: electron/preload.cjs`, `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Preload exposes the finite `tableManagerDesktop` IPC bridge through `contextBridge`.
- Renderer loading: Electron main loads `http://127.0.0.1:5173` during Electron development and `dist/index.html` in packaged runs.
- Player: Expo loads `player-app/App.tsx`, which exports `player-app/src/PlayerApp.tsx`. Player's module graph is independent from the desktop renderer, although two root tests directly import Player domain source.
- API: `apps/api/src/server.js` runs as CommonJS under Node and imports its database, domain, Firebase, license, identity, and payment modules.
- Unit tests: root `vitest run` discovers 17 files under root `src/`, `apps/api/src/`, and `player-app/src/`. The default environment is Node; only `PokerTable.test.tsx` declares `@vitest-environment jsdom`.
- E2E: `tests/e2e/management-core-smoke.mjs` is a manual Playwright browser harness. `tests/e2e/stress-electron.mjs` is a manual Playwright/Electron harness. Neither is discovered by Vitest or CI.
- Tooling: Vite executes `vite.config.ts` in Node. Root `scripts/*.cjs`, Player configuration JavaScript, and `download-site/vite.config.mjs` are also Node-only.

## 2. Current compiler map

Only two repository TypeScript configurations exist.

| Config | Extends | Root files | Effective imported repository files | References |
| --- | --- | ---: | ---: | --- |
| `tsconfig.json` | none | 26 below `src/` | 29: the 26 root files, two Player domain files imported by tests, and `branding.config.json` | empty |
| `player-app/tsconfig.json` | `expo/tsconfig.base` | 16 Player files | 16 | none |

### Root settings

| Setting | Current value | Boundary finding |
| --- | --- | --- |
| `target` | `ES2020` | May remain; root is `noEmit` and Vite owns renderer output. |
| `lib` | `DOM`, `DOM.Iterable`, `ES2020` | Too old for the proven renderer floor; causes all six `TYPE-001` diagnostics. |
| `jsx` | `react-jsx` | Correct for React renderer and the JSX unit test. It also makes TypeScript resolve a Player-local JSX runtime while following Player `.ts` files. |
| `module` | `ESNext` | Consistent with Vite renderer source. |
| `moduleResolution` | `Node` (effective `node10`) | Works for current renderer imports but does not match Vite's package-export-aware resolution; it cannot resolve `@vitejs/plugin-react` when `vite.config.ts` is added to this project. |
| `types` | unspecified | Overbroad. All visible `@types` packages are admitted, including Node; following Player files also loads Player's React declarations. |
| `strict` | `true` | Correct and must remain. |
| `skipLibCheck` | `true` | Existing setting; it must not be used as the boundary correction and may hide duplicate declaration conflicts. |
| `allowJs` / `checkJs` | `false` / `false` | Electron, API, scripts, download site, and e2e JavaScript receive no semantic check. |
| `include` | `src` | Includes renderer source, unreferenced renderer modules, generated declarations, and root unit tests. |
| `exclude` | implicit defaults | No explicit runtime separation. |

### Player settings and inheritance

`player-app/tsconfig.json` extends Expo 54.0.36's installed `expo/tsconfig.base`. The base supplies `allowJs: true`, `lib: [DOM, ESNext]`, `module: preserve`, `moduleDetection: force`, `moduleResolution: bundler`, React-Native custom conditions, `target: ESNext`, `noEmit: true`, `resolveJsonModule: true`, and `skipLibCheck: true`. Player overrides `strict: true`, `moduleResolution: Bundler`, `noEmit: true`, and `jsx: react-jsx`, and includes `App.tsx` plus `src`.

The effective Player project includes production files, three Player unit tests, `MapView.ts`, `MapView.web.tsx`, and the JavaScript performance-overlay shim. It does not include `MapView.tsx`, `app.config.js`, or `metro.config.js`. Because Player also omits `types`, its effective declaration graph includes Player-local Node/React types and root React/ReactDOM types found by upward resolution. Player currently passes, but that ambient overlap is not an endorsement of the boundary.

## 3. Required repository mapping

| Area | Paths | Runtime | Entry point | Current tsconfig owner | Recommended owner | Required globals/types |
| --- | --- | --- | --- | --- | --- | --- |
| Renderer | `index.html`, `src/main.tsx`, imported `src/components/**`, imported `src/lib/**`, `src/styles.css`, `branding.config.json` | Chromium browser, either Vite dev or Electron renderer | `index.html` -> `src/main.tsx` | root `tsconfig.json` for TypeScript; CSS/HTML outside TS | dedicated renderer project | `DOM`, `DOM.Iterable`, `ES2022`, `vite/client`, React module types; no Node globals |
| Electron main | `electron/main.cjs`, `electron/firebaseSync.cjs` | Electron main/Node | root `package.json#main` | none | Electron check-JS project, or a future Electron TypeScript project | `ES2022`, Node and Electron module types; no DOM globals |
| Preload | `electron/preload.cjs` | sandboxed Electron preload isolated from renderer | `BrowserWindow.webPreferences.preload` | none | Electron preload/check-JS project, separate from renderer | `ES2022`, Electron preload and limited Node module types; no renderer-wide Node globals |
| Shared/runtime-neutral desktop code | `src/lib/appCore.ts`, `membership.ts`, `membershipQr.ts`, `nightClose.ts`, `playerSync.ts`, `seatNormalization.ts`; `utils.ts` is UI-neutral but renderer-owned | Renderer in production; Node or jsdom under tests | imported from renderer or tests | root `tsconfig.json` | renderer project as current production owner; test project consumes it; a shared project only after a real package boundary exists | `ES2022` only for the neutral contract; consumer projects supply platform globals |
| Shared Player domain consumed by root tests | `player-app/src/domain/playerSync.ts`, `syncProtocol.ts` | Expo in production; Node under root tests | direct imports from `src/lib/playerStatus.test.ts` and `orbitMobileSyncProtocol.test.ts` | Player project and transitively root project | Player project as primary owner; root test project as an intentional cross-package consumer | Player's React-Native/ESNext contract in Player; Node/ES2022 in tests; avoid ambient React duplication |
| Unit tests | root `src/**/*.test.ts(x)`, Player `player-app/src/**/*.test.ts`, API `apps/api/src/*.test.js` | Vitest Node; one root file uses jsdom | Vitest default discovery | root config owns root TS tests; Player config owns Player TS tests; API tests untyped | package-specific test projects; root test project for root tests | `ES2022`, Node, Vitest module declarations; DOM/jsdom and React only where needed |
| Test setup and mocks | inline setup in `PokerTable.test.tsx`; `vi` usage there; no shared setup file | jsdom test worker | per-file environment comment | root `tsconfig.json` | root test project | DOM, React, Vitest; a narrow declaration for `IS_REACT_ACT_ENVIRONMENT` belongs to `TYPE-012` |
| E2E tests | `tests/e2e/*.mjs` | Node Playwright controller plus browser/Electron callback contexts | manual scripts | none | dedicated e2e check-JS project | Node, Playwright, and DOM for page-evaluation callbacks; typed preload bridge for Electron pages |
| Build/configuration | `vite.config.ts`, `download-site/vite.config.mjs`, Player `app.config.js`, `metro.config.js` | Node tooling | Vite/Expo CLIs | none; Player config files are excluded by Expo base | package-specific Node/tooling projects | `ES2022`, Node, Vite or Expo module types; no DOM except a download-site browser project |
| Scripts/developer tooling | root `scripts/*.cjs` | Node 22 in CI/development; some launch Electron or administer services | package scripts | none | Node tooling check-JS project, split from production Electron | `ES2022`, Node and imported tool types |
| API | `apps/api/src/*.js` | Node/CommonJS | `apps/api/src/server.js` | none | independent API check-JS project if authorized | `ES2022`, Node and API dependency declarations; no DOM |
| Player application | `player-app/App.tsx`, `player-app/src/**` | Expo/React Native, plus supported web paths | `player-app/App.tsx` | `player-app/tsconfig.json` | keep independent Player project | Expo/React Native, `DOM` and `ESNext` inherited today; review explicit types in a Player-scoped task |
| Download site | `download-site/main.js`, HTML/CSS/assets | Browser; config runs in Node | download-site HTML and Vite config | none | separate download browser check-JS project plus Node config ownership | browser `DOM`/`ES2022` for `main.js`; Node/Vite for config |
| Generated/support declarations | tracked `src/vite-env.d.ts`; dependency `.d.ts` files; ignored `.expo/` output | compile-time only | reference directive to `vite/client` | root `tsconfig.json` | renderer project for `src/vite-env.d.ts`; dependency/generated output remains external/ignored | `vite/client`; no generated declaration should be committed unless intentionally source-controlled |

`src/components/ui/badge.tsx` and `button.tsx` are checked by root TypeScript but are not reachable from the current `index.html` renderer graph. They should stay in renderer ownership as active source rather than being excluded merely because the current bundle does not import them.

## 4. Mismatches

### Files checked under the wrong or mixed environment

1. Root tests and renderer production code share one project. This is not currently producing the six `TYPE-001` errors by itself, but it mixes Node/jsdom test needs with browser production globals.
2. Root tests directly import two Player domain files. Root TypeScript follows them under root compiler options while their normal owner checks them under Expo's independent options. TypeScript resolves `react/jsx-runtime` relative to those Player files, so both React declaration versions enter the root compilation.
3. Root `types` is unspecified. The renderer project therefore sees `@types/node` and numerous transitive global declaration packages even though Electron disables renderer Node integration. This is a compiler/security-boundary mismatch even though current renderer code does not use `process` or `Buffer`.
4. `Window.tableManagerDesktop` is declared inline in `src/main.tsx`, while the runtime bridge is implemented separately in JavaScript preload. The two sides can drift; `TYPE-009` already owns one observed nullability disagreement.
5. `lib: ES2020` contradicts both the packaged Electron Chromium floor and Vite's build target. These are the six diagnostics assigned to `TYPE-001`.

### Files included by root TypeScript but not the production renderer build

- all nine root `*.test.ts`/`*.test.tsx` files;
- `src/components/ui/badge.tsx` and `src/components/ui/button.tsx`;
- the two Player domain files pulled in only by tests;
- `src/vite-env.d.ts`, which is compile-time support rather than emitted runtime code.

### Production or operational files not semantically typechecked

- `vite.config.ts`;
- Electron main, preload, and Firebase sync JavaScript;
- root Node scripts;
- API JavaScript;
- download-site browser/config JavaScript;
- e2e harnesses;
- Player's excluded configuration JavaScript and effectively unchecked JavaScript shim.

### Vite, Electron, tests, TypeScript, and CI disagreement

- Vite starts at `index.html`, follows only production imports, uses package-export-aware bundler resolution, and targets its installed baseline browsers. Root TypeScript includes every file below `src`, uses effective `node10` module resolution, and declares ES2020 libraries.
- Electron packages `dist/**/*` and `electron/**/*`, but root TypeScript checks neither Electron file nor Vite configuration.
- Vitest discovers 17 test files across all three package trees. Root TypeScript checks nine root tests and two imported Player modules; Player TypeScript checks three Player tests; API tests are JavaScript and untyped.
- CI runs tests, Player typecheck, and Vite build but omits root typecheck and `npm run verify`. The release workflow runs tests and a renderer/package build but no TypeScript check.

## 5. Options considered

### Option A: narrow, specification-local renderer correction

Exact files:

- modify `tsconfig.json` only;
- retain `include: ["src"]` and the empty `references` list;
- retain `target: ES2020`, `module: ESNext`, `moduleResolution: Node`, strictness, JSX, and `noEmit`;
- change `lib` to `DOM`, `DOM.Iterable`, `ES2022`;
- add `types: ["vite/client"]` to prevent automatic admission of Node globals;
- retain `src/vite-env.d.ts` for standard Vite asset/environment declarations.

Root verification command: unchanged, `tsc --noEmit` through `npm run typecheck`.

Advantages:

- exactly matches the proven renderer runtime;
- removes only the six assigned diagnostics;
- strengthens the browser boundary by removing automatic Node globals;
- keeps all current production source and tests checked;
- is one small compiler-only change with no output/runtime change.

Disadvantages:

- tests remain mixed into the renderer project;
- Player source is still reached transitively under root options;
- `vite.config.ts`, Electron, scripts, API, download site, and e2e remain unchecked;
- the root command is more accurate but does not gain file coverage.

Migration risk: low.

Expected diagnostic impact: 94 -> 88. The six `TS2550` diagnostics disappear; no new diagnostic appeared in the read-only probe.

Runtime behavior: none.

Downstream validity: `TYPE-005`, `TYPE-006`, and `TYPE-012` remain valid and become eligible only after `TYPE-001` is accepted as complete. Their diagnostic groups are unchanged.

### Option B: explicit runtime/test/tooling projects with check-JS coverage

Exact intended files and ownership:

- create `tsconfig.base.json` for strict, runtime-neutral defaults only;
- create `tsconfig.renderer.json` for non-test `src/**/*.ts`, `src/**/*.tsx`, and `src/**/*.d.ts`, excluding `src/**/*.test.*`, with `DOM`, `DOM.Iterable`, `ES2022`, `vite/client`, `module: ESNext`, and `moduleResolution: Bundler`;
- create `tsconfig.tests.json` for root unit tests and their imported sources, with `ES2022`, Node, Vitest imports, DOM/jsdom for the component test, and React JSX;
- create `tsconfig.electron.json` for `electron/**/*.cjs` with `allowJs: true`, `checkJs: true`, `ES2022`, Node/Electron types, `module/moduleResolution: Node16`, and `resolveJsonModule: true`;
- create `tsconfig.tooling.json` for `vite.config.ts`, `download-site/vite.config.mjs`, and `scripts/**/*.cjs`, using Node/ES2022 and `NodeNext` resolution;
- create a dedicated e2e check-JS config for `tests/e2e/*.mjs` with Node, Playwright, and DOM callback types;
- add package-scoped API and download-site check-JS configs if the root command is intended to represent the whole repository;
- keep `player-app/tsconfig.json` independent;
- change the root `typecheck` script to a small aggregate runner that executes every project and reports every failure, rather than short-circuiting after the renderer.

Recommended include/exclude rules:

- renderer owns all non-test root TypeScript source, including currently unreferenced renderer modules; it excludes tests, Electron, API, Player, scripts, generated output, and dependencies;
- root tests own only root test entry files, while imports bring their production dependencies into that test program;
- Electron owns only `electron/**/*.cjs` and `branding.config.json` through resolution;
- tooling owns root scripts and config files, not runtime renderer or Electron source;
- API, Player, and download site retain package-specific ownership.

Advantages:

- compiler globals match each actual runtime;
- production renderer, Electron, tests, and tooling all receive semantic checks;
- Vite's configuration is checked with the resolution model it actually needs;
- future accidental use of Node globals in the sandboxed renderer is rejected;
- diagnostics identify their runtime owner.

Disadvantages:

- outside `TYPE-001`'s explicit allowed areas and prohibition on broad compiler/module-resolution modernization;
- check-JS adoption reveals pre-existing JavaScript defects that need separate task ownership;
- root tests importing Player source still need a deliberate cross-package strategy;
- a multi-project aggregate runner and documentation/CI changes are not one small change;
- production and test imports may be checked more than once unless a future shared package creates a true reference boundary.

Migration risk: medium/high because the verification surface expands significantly even though runtime output does not change.

Expected diagnostic impact from read-only probes:

- renderer with corrected library/types: 88 existing diagnostics;
- Electron check-JS: 3 new diagnostics in `electron/main.cjs`;
- root scripts/tooling check-JS: 2 new diagnostics;
- e2e check-JS: 2 new diagnostics after providing Node and DOM libraries;
- API check-JS: 7 new diagnostics;
- download-site check-JS: 2 new diagnostics;
- full expanded total: 104 diagnostics (88 existing plus 16 newly exposed), while Player remains at zero.

Runtime behavior: none if introduced as check-only projects.

Downstream validity: all existing remediation tasks remain valid, but the new diagnostics need separately approved task ownership. `TYPE-005` and `TYPE-006` should not start while `TYPE-001` remains `review_required`.

## 6. Recommended boundary

The correct architecture is the environment-separated boundary in Option B, introduced in stages. Renderer, Electron main/preload, tests, and Node tooling have materially different globals and module-resolution rules; keeping Node globals ambient in a sandboxed browser project is particularly undesirable. API and Player should remain package-owned rather than being merged into the root renderer project.

For the existing narrow `TYPE-001`, the first stage should be Option A: declare `ES2022` libraries and explicit Vite globals without changing target, source, runtime, or Player configuration. The remaining projects should be separately authorized follow-up work because check-JS adoption creates new remediation obligations and exceeds the existing task specification.

TypeScript project references should not be used yet for source sharing. No reusable compiled package exists, all current projects use `noEmit`, and root tests import source across package boundaries. References would either duplicate source checking, require declaration output, or create misleading ownership. A root solution may later use references purely for orchestration after renderer/test/tooling ownership is implemented and a shared package has a real public boundary.

## 7. Files affected

This investigation changes documentation only:

- `docs/agent/TYPE-001_BOUNDARY_DECISION.md`;
- `docs/agent/tasks/TYPE-001.md`;
- `docs/agent/TASKS.yaml`;
- `docs/agent/JOURNAL.md`;
- `docs/agent/BASELINE.md`;
- `docs/agent/ROOT_TYPECHECK_REBASELINE.md`.

`docs/architecture/testing-and-verification.md` does not exist, so it was not updated. No source, TypeScript configuration, package manifest, lockfile, test, or runtime file was changed.

## 8. Expected impact on downstream tasks

- `TYPE-005`, `TYPE-006`, and `TYPE-012` directly depend on `TYPE-001`; their dependencies are not satisfied while this task is `review_required`.
- `TYPE-007` depends transitively on `TYPE-001` through `TYPE-005` and `TYPE-006`.
- The six `TYPE-001` diagnostics remain in the baseline because no compiler change was authorized.
- The recommended ES2022 contract does not alter the diagnosis or intended repairs for any downstream task.
- No downstream task was marked ready.

## 9. Verification evidence

### Required pre-investigation evidence

- `git status --short --branch`: clean on `chore/prepare-codex-workflow`, not `main`.
- `npm run typecheck`: exit 2, exactly 94 diagnostics in 6 files.
- `TYPE-001` dependency inspection: direct prerequisite of `TYPE-005`, `TYPE-006`, and `TYPE-012`; transitive prerequisite of `TYPE-007`.

### Read-only compiler probes

- root `tsc --showConfig`: 26 root files below `src`, ES2020 libraries, effective `node10` resolution, no explicit types.
- root `tsc --listFilesOnly`: 29 repository files after following JSON and Player imports.
- Player `tsc --showConfig`/`--listFilesOnly`: 16 repository files, Expo inheritance described above.
- root probe with `lib: DOM,DOM.Iterable,ES2022` and `types: vite/client`: exit 2 with exactly 88 diagnostics and no new code.
- Vite tooling probe with NodeNext/Node/ES2022: zero diagnostics for `vite.config.ts` alone.
- Electron check-JS probe: three semantic diagnostics after resolving JSON.
- scripts/tooling check-JS probe: two diagnostics.
- e2e check-JS probe with Node and DOM: two diagnostics.
- API check-JS probe: seven diagnostics.
- download-site check-JS probe: two diagnostics.
- `npx vitest list`: 17 files and 81 tests across root, API, and Player.

No production service, Electron runtime, e2e harness, API server, Firebase path, or tracked database was accessed.

### Final required verification after documentation

| Command | Exact result |
| --- | --- |
| `npm run typecheck` | Failed as expected: TypeScript exit 2 with the unchanged 94 diagnostics in 6 files, including all 6 `TYPE-001` `TS2550` diagnostics. |
| `npm run player:typecheck` | Passed with no diagnostics. |
| `npm test` | Passed: 17 files and 81 tests; zero failed or skipped; 3.78 seconds. Node emitted the existing experimental SQLite warning. |
| `npm run build` | Passed: Vite 7.3.5 transformed 1,910 modules and built in 18.61 seconds. The existing ExcelJS `eval` and chunk-size warnings remained. |
| `npm run verify` | Exited 1 after running every gate. Summary: root TypeScript failed; Player TypeScript, 17/81 tests, and the 1,910-module renderer build passed. The existing SQLite, ExcelJS, and chunk-size warnings remained. |

No focused behavior test was added because the deliverable is documentation and the proposed compiler settings were not committed. The read-only compiler probes are the direct evidence for the configuration decision; the full existing unit suite and production renderer build show that documentation work caused no runtime regression.

## 10. Remaining risks

- Root browser code can currently typecheck accidental Node-global use despite Electron renderer isolation.
- Root and Player React declarations coexist in the root program because tests cross the package boundary.
- `skipLibCheck` can hide declaration conflicts; removing it is not part of this task.
- Electron/preload bridge drift is not caught automatically.
- Vite configuration and production Electron JavaScript can regress without semantic compiler feedback.
- CI and release workflows can publish while root TypeScript remains red because neither runs the root typecheck.
- Vite's baseline is an installed-tool default rather than an explicit repository policy; a Vite major upgrade can change it. The supported renderer floor should be written explicitly when the compiler correction is approved.

## 11. Required human decision

Choose one scope before implementation:

1. Authorize the narrow Option A correction as the completion of `TYPE-001`, explicitly accepting that Electron/tooling/API/download check-JS coverage will be separate tasks. This would remove the six assigned diagnostics, leave 88 known diagnostics, and unblock the declared downstream dependencies.
2. Expand `TYPE-001` to Option B, approve the new configuration/script/CI areas, and create owners for the 16 newly exposed JavaScript diagnostics before implementation.

Until that decision is made, `TYPE-001` is `review_required`, not `complete` or `blocked`.
