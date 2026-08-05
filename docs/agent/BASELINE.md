# Codex Engineering Baseline

Baseline captured on 2026-08-05 before preparation changes were committed.

## Source State

- Branch: `chore/prepare-codex-workflow`
- Inspected commit: `5feb0b64d8bee85b0071e9bea11ff4cb51564748`
- Initial worktree: clean
- Operating system: Microsoft Windows 11 Home 10.0.26200, AMD64
- Shell: Windows PowerShell 5.1.26100.8875
- Node: v22.16.0
- npm: 10.9.2
- Package manager: npm with three independent lockfiles (`package-lock.json`, `apps/api/package-lock.json`, and `player-app/package-lock.json`)
- Repository workspace system: none; this is not an npm workspace or another configured monorepo
- Declared Node requirement: none in package metadata or a version file; both GitHub workflows use Node 22

## Applications and Packages

| Area | Evidence and entrypoint | Development/build path |
| --- | --- | --- |
| Management renderer | React/TypeScript in `src/`; `src/main.tsx` calls `createRoot` | `npm run dev`; `npm run build` |
| Desktop shell | Electron `main` is `electron/main.cjs`; renderer bridge is `electron/preload.cjs` | `npm run desktop` builds the renderer, then launches Electron |
| API and hosted dashboard | CommonJS Express app at `apps/api/src/server.js`; static dashboard/legal assets at `apps/api/public/`; SQLite database layer at `apps/api/src/database.js` | `npm run api:dev`; there is no compile/build step |
| Orbit Player | Expo/React Native at `player-app/App.tsx` and `player-app/src/PlayerApp.tsx` | `npm run player:dev`; local typecheck is available; native build scripts use EAS |
| Download site | Static/Vite site under `download-site/` | `npm run download:dev`; `npm run download:build` |
| Shared behavior | Helpers exist in `src/lib/`, `apps/api/src/orbitCore.js`, and Electron; there is no shared-package workspace | Covered by the root Vitest run |

Firebase rules and indexes live in `player-app/firestore.rules` and `player-app/firestore.indexes.json`, selected from the root `firebase.json`. No Firebase emulator configuration is present.

## Dependency Installation

All installs used lockfile-preserving commands.

| Command | Result |
| --- | --- |
| `npm ci` | Passed in 53.1 seconds; added 619 packages and audited 620. npm reported six deprecated transitive packages and three high-severity vulnerabilities in the install summary. |
| `npm ci --prefix apps/api` | Passed in 14.7 seconds; added 231 packages and audited 232; zero vulnerabilities reported. |
| `npm ci --prefix player-app` | Passed in 70.4 seconds; added 788 packages and audited 789; three high-severity vulnerabilities reported. |
| `npm install --save-dev @types/react@19.2.18 @types/react-dom@19.2.4` | Passed during the TypeScript rebaseline; added only the two root type packages and their `csstype` dependency. npm continued to report four high-severity findings. No audit fix was run. |

No automatic audit fix or dependency upgrade was run.

## Verification Results

Commands were run individually before the unified verification entrypoint was added.

| Command | Result |
| --- | --- |
| `npm run lint --if-present` | Exited 0 but executed no lint script. This is a missing capability, not a lint pass. |
| `npm run format --if-present` | Exited 0 but executed no formatting script. This is a missing capability, not a formatting pass. |
| `npm test` | Passed: 17 test files and 81 tests; zero failed and zero skipped. Vitest emitted Node's warning that SQLite is experimental. The run includes tests under root `src/`, `apps/api/src/`, and `player-app/src/`. |
| `npx --no-install tsc --noEmit` | Failed with TypeScript exit code 2 and 3,632 diagnostics. The largest groups were TS7026 (3,041), TS7006 (503), TS7031 (22), TS2322 (17), and TS7016 (16). Missing React/ReactDOM/Vite declaration support causes most JSX and implicit-`any` cascades; independent domain errors also exist in `firebaseClubSync`, `playerSync`, and `main.tsx`. |
| `npm run player:typecheck` | Passed with no diagnostics. |
| `npm run build` | Passed in 20.9 seconds; Vite transformed 1,910 modules and built `dist/`. It warned about `eval` in the bundled `exceljs.min.js` dependency and chunks larger than 500 kB. |
| `npm audit` | Failed with four high-severity findings involving transitive `brace-expansion`, `fast-uri`, and `undici` versions. |
| `npm audit --prefix player-app` | Failed with three high-severity findings involving transitive `brace-expansion` and `fast-uri` versions. |
| `npm audit --prefix apps/api` | Passed: zero known vulnerabilities reported. |

No standalone API build or shared-package build was run because neither exists. No native Player build was run because the available EAS commands are remote preview/production workflows, not safe local validation. The Player web build was not run because building the Orbit Player website is explicitly out of scope.

## Integration and End-to-End Coverage

- `tests/e2e/management-core-smoke.mjs` is a manual Playwright script. It requires a separately running Vite server and an installed Chromium browser. It has no package script and is not run by CI or `npm test`; it was not executed in this baseline.
- `npm run stress:e2e` was not run. The harness reads a local pilot private key and launches Electron; Electron defaults to a hosted Orbit API unless explicitly overridden. That does not meet this preparation task's secret-access and production-isolation rules.
- The CI workflow installs all three dependency trees, invokes the absent optional lint script, runs the root tests, runs Player typechecking, and builds the root renderer. It does not run root TypeScript, formatting, audit, API runtime smoke tests, or either e2e harness.
- No flaky test is documented and none was observed in the executed Vitest run. The unexecuted e2e harnesses have no established reliability baseline.

## Environment and Local Services

Variable-name-only templates now document safe local configuration in `.env.example`, `apps/api/.env.example`, and `player-app/.env.example`. Real `.env` files and credentials must remain untracked.

Safe local linked development expects:

- Vite management renderer on `127.0.0.1:5173`.
- Local API/sync bridge on `127.0.0.1:4629` using an isolated SQLite path.
- Expo Player server on an available port from 8081 through 8090 when using `npm run linked:dev`.
- Firebase renderer sync disabled unless an explicit emulator/test project task authorizes it.

Optional product integrations include Firebase/Google authentication and maps, Stripe payments and Identity, RevenueCat, Twilio, and SMTP/report endpoints. No local Firebase emulator suite or Stripe webhook forwarder is configured. These integrations are not required for install, unit tests, Player typechecking, or the renderer build.

Important safety defaults in source:

- Electron's `ORBIT_API_URL` falls back to a hosted service.
- Renderer Firebase sync is enabled unless `VITE_ENABLE_FIREBASE_SYNC=false`.
- Electron Firebase sync is opt-in through `ORBIT_ENABLE_FIREBASE_SYNC=true`.

Use explicit localhost overrides and disabled sync for isolated development.

## Known Pre-existing Failures and Warnings

1. Root strict TypeScript initially failed with 3,632 diagnostics and then 3,630 after the Vite declaration correction. Root-owned React types reduced that to 94, and the completed `TYPE-001` library correction now establishes the truthful current baseline at 88 diagnostics in 6 files; the gate remains red. See `docs/agent/ROOT_TYPECHECK_REBASELINE.md` and `docs/agent/TASKS.yaml`.
2. Root npm audit reports four high-severity transitive findings; Player audit reports three. Human dependency review is required before choosing compatible updates.
3. The successful Vite build warns about dependency `eval` usage and two chunks exceeding 500 kB.
4. Vitest passes but Node warns that its SQLite support is experimental.
5. `data/orbit-api.sqlite3` is tracked. Its contents were not inspected; a human should determine whether a database artifact belongs in version control and whether it contains sensitive data.

## Missing Verification Capabilities

- No ESLint configuration or effective lint script.
- No Prettier/formatter configuration or validation script.
- No passing root TypeScript gate.
- No API-specific test script, although root Vitest currently discovers API tests.
- No API build step (the API runs source JavaScript directly).
- No safe local native Player build command.
- No secret-free, automatically orchestrated e2e entrypoint and no e2e CI job.
- No Firebase emulator configuration or rules test suite.
- No separated shared package/build despite duplicated sync behavior across runtime boundaries.

## Unified Verification Result

`npm run verify` was executed after the preparation files were created. It ran all four checks in 34.7 seconds and exited 1 because the pre-existing root TypeScript check failed:

- FAIL: Root TypeScript (`npm run typecheck`) — the same pre-existing diagnostic baseline described above.
- PASS: Player TypeScript (`npm run player:typecheck`).
- PASS: Unit tests (`npm test`) — 17 files and 81 tests passed, with zero skipped.
- PASS: Desktop renderer build (`npm run build`) — 1,910 modules transformed; the existing `eval` and chunk-size warnings remained.

The aggregate runner therefore preserves the failure while still executing and reporting every other configured verification step.

## Root TypeScript Diagnosis Update — 2026-08-05

The required exact `npm run typecheck` diagnosis run produced 3,632 diagnostics across 13 root renderer/test files. The root script is `tsc --noEmit`; its effective project is the 25 files under `src/`, not Electron, API, Player, Vite configuration, scripts, e2e, or a shared package.

### Error counts by code

| Code | Initial count | Primary category |
| --- | ---: | --- |
| `TS18046` | 5 | React contextual-type cascade |
| `TS2322` | 17 | 10 React cascade; 7 real state/domain assignments |
| `TS2339` | 8 | 3 React cascade; 3 stale snapshot uses; 2 missing Vite environment types |
| `TS2345` | 5 | Test, Web Crypto, GroupMe, and game callback errors |
| `TS2352` | 1 | Legacy persisted-settings compatibility cast |
| `TS2353` | 1 | Stale snapshot declaration |
| `TS2550` | 6 | ES2020 library boundary versus ES2021/ES2022 methods |
| `TS2677` | 2 | Invalid null-filter type predicates |
| `TS2739` | 2 | Firebase state-shape loss |
| `TS2740` | 1 | Over-narrow profile callback annotation |
| `TS2769` | 1 | Lost tuple inference for `Map` construction |
| `TS7006` | 503 | 501 React cascade; 2 Firebase implicit-any errors |
| `TS7016` | 16 | Missing root React/ReactDOM declarations |
| `TS7017` | 1 | Missing test-global declaration |
| `TS7026` | 3,041 | Missing React JSX intrinsic types |
| `TS7031` | 22 | React contextual-type cascade |
| **Total** | **3,632** | |

### Root-cause categories

| Classification | Initial diagnostics | Affected paths | Likely cause | Refactor block | Player website block |
| --- | ---: | --- | --- | --- | --- |
| `DEPENDENCY_TYPE_MISMATCH` | 3,598 | `src/main.tsx`, root React components, `PokerTable.test.tsx` | Root owns React/ReactDOM runtime packages but no compatible root declaration packages. | Yes | Conditional if root UI/types are reused |
| `MISSING_GENERATED_TYPE` | 2, now resolved | `src/main.tsx`, `src/lib/firebaseConfig.ts` | Missing standard Vite client environment declaration. | No after correction | No |
| `CONFIGURATION_BOUNDARY` | 6 | `src/main.tsx`, `src/lib/playerSync.test.ts` | Root `lib` is ES2020 while code uses `replaceAll`/`at`. | Yes | Yes if shared/browser target is unresolved |
| `STALE_OR_DEAD_CODE` | 5 | `src/lib/playerSync.ts`, `src/lib/firebaseClubSync.ts`, `src/lib/playerSync.test.ts`, `src/main.tsx` | Stale duplicated snapshot type plus an unmodeled legacy settings field. | Yes | Yes for snapshot schema; no for legacy desktop setting |
| `REAL_TYPE_ERROR` | 18 | `src/main.tsx`, `src/lib/playerSync.ts`, `src/lib/firebaseClubSync.ts` | Firebase shape loss, membership narrowing, and renderer state/collection transformations. | Yes | Yes for shared sync/membership; otherwise indirect |
| `PLATFORM_TYPE_CONFLICT` | 1 | `src/main.tsx` | Typed-array proof does not meet DOM Web Crypto `BufferSource`. | Yes for licensing work | No direct block |
| `TEST_TYPE_ERROR` | 2 | `src/components/PokerTable.test.tsx`, `src/lib/appCore.test.ts` | Missing test global and heterogeneous fixture inference. | Yes as a gate | No direct block |
| **Total** | **3,632** | | | | |

### Affected-path counts

| Path | Initial diagnostics |
| --- | ---: |
| `src/main.tsx` | 3,593 |
| `src/components/AppShell.tsx` | 4 |
| `src/components/PokerTable.test.tsx` | 4 |
| `src/components/PokerTable.tsx` | 4 |
| `src/components/TournamentTvView.tsx` | 1 |
| `src/components/ui/badge.tsx` | 2 |
| `src/components/ui/button.tsx` | 7 |
| `src/components/ui/dropdown-menu.tsx` | 2 |
| `src/lib/appCore.test.ts` | 1 |
| `src/lib/firebaseClubSync.ts` | 5 |
| `src/lib/firebaseConfig.ts` | 1 |
| `src/lib/playerSync.test.ts` | 6 |
| `src/lib/playerSync.ts` | 2 |

The standard `src/vite-env.d.ts` correction removes the two `MISSING_GENERATED_TYPE` diagnostics without adding errors. The current expected baseline is therefore 3,630 diagnostics across 12 files: `src/lib/firebaseConfig.ts` becomes clean and `src/main.tsx` decreases to 3,592.

A React-only diagnostic probe removed 3,596 displayed diagnostics but exposed 62 additional semantic diagnostics in `src/main.tsx`. These latent errors are not included in the 3,632 initial count and require a definitive rebaseline after root-owned React and ReactDOM declaration packages are installed. They are classified `UNKNOWN_REQUIRES_INVESTIGATION` until then.

Full representative errors, underlying causes, confidence, correction risk, required verification, autonomous-repair safety, project-boundary findings, and remediation order are documented in `docs/agent/ROOT_TYPECHECK_DIAGNOSIS.md`.

### Diagnosis completion verification

After the narrow Vite declaration correction, the required commands were rerun individually:

- FAIL: `npm run typecheck` reported exactly 3,630 diagnostics. The two former `ImportMeta.env` diagnostics were absent and no new diagnostic appeared.
- PASS: `npm run player:typecheck` completed with no diagnostics.
- PASS: `npm test` ran 17 files and 81 tests with zero failures or skips; the existing experimental SQLite warning remained.
- PASS: `npm run build` transformed 1,910 modules and completed in 15.55 seconds; the existing ExcelJS `eval` and chunk-size warnings remained.

The root gate remains intentionally red and quantified. No production code, public API, stored shape, TypeScript strictness setting, include boundary, or runtime behavior was changed.

## React Type Dependency Rebaseline — 2026-08-05

The root runtime resolves `react` and `react-dom` to 19.2.6. Root dev dependencies now own `@types/react` 19.2.18 and `@types/react-dom` 19.2.4. Player remains independently locked to React/ReactDOM 19.1.0, React Native 0.81.5, and `@types/react` 19.1.17.

The first complete post-install `npm run typecheck` run failed with exactly 94 diagnostics across 6 files. This is a net reduction of 3,536 from the prior 3,630-diagnostic baseline. All 3,598 missing React/ReactDOM cascade diagnostics were removed, while exactly 62 previously masked semantic diagnostics became visible.

### Post-install rebaseline diagnostics by code

| Code | Count |
| --- | ---: |
| `TS2322` | 29 |
| `TS2339` | 5 |
| `TS2345` | 36 |
| `TS2352` | 1 |
| `TS2353` | 1 |
| `TS2367` | 1 |
| `TS2550` | 6 |
| `TS2677` | 3 |
| `TS2739` | 2 |
| `TS2740` | 1 |
| `TS2769` | 6 |
| `TS7006` | 2 |
| `TS7017` | 1 |
| **Total** | **94** |

### Post-install rebaseline diagnostics by path

| Path | Count |
| --- | ---: |
| `src/main.tsx` | 79 |
| `src/lib/firebaseClubSync.ts` | 5 |
| `src/lib/playerSync.ts` | 2 |
| `src/lib/playerSync.test.ts` | 6 |
| `src/lib/appCore.test.ts` | 1 |
| `src/components/PokerTable.test.tsx` | 1 |

The 94 diagnostics are assigned to 14 bounded groups: 6 configuration-boundary, 6 stale/dead-contract, 79 real implementation type errors, 1 platform conflict, and 2 test-only errors. No missing-generated-type, dependency-type-mismatch, or unknown diagnostic remains. The complete classification, duplicate mapping, correction risks, block status, and ordered task specifications are in `docs/agent/ROOT_TYPECHECK_REBASELINE.md` and `docs/agent/tasks/TYPE-001.md` through `TYPE-014.md`.

At that rebaseline stage, repository verification remained a partial failure with 94 diagnostics assigned to those bounded tasks. No production source was changed during dependency restoration and rebaselining.

### Rebaseline completion verification

- FAIL: `npm run typecheck` — exactly 94 diagnostics in 6 files; TypeScript exit code 2.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 17 files and 81 tests passed, zero failed/skipped, in 3.44 seconds; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,910 modules transformed and built in 14.99 seconds; the existing ExcelJS `eval` and large-chunk warnings remained.
- PARTIAL FAILURE: `npm run verify` exited 1 after 31.3 seconds because root TypeScript failed; its Player typecheck, 17/81 tests, and 1,910-module build all passed.

## TYPE-001 Boundary Investigation — 2026-08-05

The untouched pre-investigation `npm run typecheck` result remains exactly 94 diagnostics in 6 files with TypeScript exit code 2. The worktree was clean on `chore/prepare-codex-workflow`, and `TYPE-001` was confirmed as a direct prerequisite of `TYPE-005`, `TYPE-006`, and `TYPE-012` and a transitive prerequisite of `TYPE-007`.

The compiler/runtime map is more complex than the earlier 26-file root `include` summary:

- root `tsconfig.json` declares 26 files below `src`, including nine unit-test files;
- TypeScript's actual repository file graph has 29 files after following `branding.config.json` and two test imports into `player-app/src/domain/playerSync.ts` and `syncProtocol.ts`;
- root `types` is unspecified, so Node and other transitive globals are admitted to the browser project, and following Player source loads Player-local React declarations alongside root React declarations;
- Vite's production graph contains 14 root TypeScript modules from `index.html`/`src/main.tsx` and excludes root tests plus the currently unreferenced badge/button modules;
- `vite.config.ts`, Electron main/preload, API, scripts, download-site code, and e2e harnesses are not semantically typechecked by the current root command.

Locked runtime/build evidence supports an ES2022 renderer library contract without changing the ES2020 TypeScript target: Electron 42.1.0 maps to Chromium 148.0.7778.97, while Vite 7.3.5's installed default target is Chrome 107, Edge 107, Firefox 104, and Safari 16. A read-only compiler probe using `DOM`, `DOM.Iterable`, `ES2022`, and explicit `vite/client` globals produced exactly 88 diagnostics. It removed all six `TYPE-001` `TS2550` diagnostics and exposed no new diagnostic.

No compiler change was applied during the investigation. At that point a comprehensive renderer/Electron/test/tooling boundary exceeded the task specification and read-only probes exposed 16 additional JavaScript diagnostics across Electron, tooling, e2e, API, and the download site. `TYPE-001` was therefore marked `review_required` pending a human scope decision.

Full evidence, options, recommended ownership, and the required human scope decision are in `docs/agent/TYPE-001_BOUNDARY_DECISION.md`.

Final post-documentation verification retained the same partial-failure state:

- FAIL: `npm run typecheck` — unchanged 94 diagnostics in 6 files.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 17 files and 81 tests in 3.78 seconds; the existing SQLite warning remained.
- PASS: `npm run build` — 1,910 modules in 18.61 seconds; the existing ExcelJS and chunk-size warnings remained.
- PARTIAL FAILURE: `npm run verify` — exit 1 after all four gates; only root TypeScript failed.

## TYPE-001 Narrow Implementation — 2026-08-05

The human approved only the renderer library correction. Root `tsconfig.json` now retains `target: ES2020` and the existing DOM libraries while changing the standard library declaration from ES2020 to ES2022. No source, runtime, emitted-JavaScript target, ambient types, include/exclude rule, strictness option, JavaScript checking, package dependency, or project reference changed.

The first committed-configuration typecheck result is exactly 88 diagnostics in the same 6 files:

- all 6 `TYPE-001` `TS2550` diagnostics are removed;
- no new diagnostic appeared;
- `src/main.tsx` changed from 79 to 77 diagnostics;
- `src/lib/playerSync.test.ts` changed from 6 to 2 diagnostics;
- all other path and code counts are unchanged.

The 88 remaining diagnostics map exactly to `TYPE-002` through `TYPE-014`. `TYPE-005`, `TYPE-006`, and `TYPE-012` are newly ready because `TYPE-001` was their only dependency. `TYPE-015` through `TYPE-022` separately record approved future compiler-boundary work; none was implemented, and project references remain deferred.

Final implementation verification:

- EXPECTED FAILURE: `npm run typecheck` — exactly 88 diagnostics in 6 files, zero `TS2550`, no new diagnostics, TypeScript exit code 2.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 17 files and 81 tests passed, zero failed/skipped, in 3.50 seconds; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,910 modules transformed and built in 17.57 seconds; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` — exit 1 after all four gates; root TypeScript alone failed with 88 diagnostics, while Player TypeScript, 17/81 tests, and the 1,910-module renderer build passed. The nested test and build durations were 3.50 and 18.78 seconds.
