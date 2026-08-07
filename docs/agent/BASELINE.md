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

1. Root strict TypeScript initially failed with 3,632 diagnostics and then 3,630 after the Vite declaration correction. Root-owned React types reduced that to 94, `TYPE-001` reduced it to 88, `TYPE-005` reduced it to 79, `TYPE-006` reduced it to 73, `TYPE-012` reduced it to 71, `TYPE-007A` reduced it to 69, `TYPE-007I` reduced it to 67, `TYPE-007J` reduced it to 64, `TYPE-007B` reduced it to 59, `TYPE-007C` reduced it to 53, completed `TYPE-007D` reduced it to 47, `TYPE-007G` reduced it to 39, and completed `TYPE-007E` now establishes the truthful current baseline at 35 diagnostics in 4 affected files; the gate remains red. See `docs/agent/ROOT_TYPECHECK_REBASELINE.md` and `docs/agent/TASKS.yaml`.
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

## TYPE-005 Synchronized-List Tuple Inference — 2026-08-06

The pure `mergeSyncedList` helper now preserves its generic item type through explicit `[string, T]` entries, `Map<string, T>`, and a `T[]` return. It moved from `src/main.tsx` to `src/lib/syncedList.ts` solely to permit focused pure characterization tests. The three renderer sync flows still call the same helper with unchanged arguments, key precedence, replacement behavior, ordering, duplicate handling, and empty-key behavior.

The first post-change root typecheck produced exactly 79 diagnostics in the same 6 affected files:

- all 9 `TYPE-005` diagnostics disappeared: the `TS2769` formerly at `src/main.tsx:1181` and the 8 downstream `TS2322` diagnostics formerly at lines 3041, 3042, 3082, 3083, and 3128–3131;
- `TS2322` decreased from 29 to 21 and `TS2769` decreased from 6 to 5;
- `src/main.tsx` decreased from 77 to 68 diagnostics;
- every other diagnostic-code and affected-path count stayed unchanged; and
- neither the helper nor its focused test has a diagnostic.

Final implementation verification:

- PASS: focused Vitest run — 1 file and 6 tests passed.
- EXPECTED FAILURE: `npm run typecheck` — exactly 79 diagnostics in 6 files, no assigned `TYPE-005` diagnostic, and no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 18 files and 87 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,911 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` — exit 1 after all four gates; root TypeScript alone failed with 79 diagnostics, while Player TypeScript, 18/87 tests, and the 1,911-module renderer build passed.

`TYPE-005` is complete. `TYPE-007` remains pending because `TYPE-006` is not complete, so no downstream task became newly ready.

## TYPE-006 Map/Filter Result Narrowing — 2026-08-06

The three pure result builders now type their mapper outputs at construction as the exact result object or `null`, then remove only `null` with an exact reusable guard. `getBalancePlans`, `parseGroupMeMessages`, and the today-player activity builder moved from `src/main.tsx` to `src/lib/resultBuilders.ts` solely so focused tests can exercise their existing successful, rejected, empty, ordered, fallback, and optional-field behavior.

The first post-change root typecheck produced exactly 73 diagnostics in the same 6 affected files:

- all 6 `TYPE-006` diagnostics disappeared: the `TS2322`/`TS2677` pairs formerly at `src/main.tsx:1861`/`1927`, `2354`/`2378`, and `2745`/`2764`;
- `TS2322` decreased from 21 to 18 and `TS2677` decreased from 3 to 0;
- `src/main.tsx` decreased from 68 to 62 diagnostics;
- every other diagnostic-code and affected-path count stayed unchanged; and
- neither the helper nor its focused test has a diagnostic.

Final implementation verification:

- PASS: focused Vitest run — 1 file and 9 tests passed.
- EXPECTED FAILURE: `npm run typecheck` — exactly 73 diagnostics in 6 files, no assigned `TYPE-006` diagnostic, and no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 19 files and 96 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` — exit 1 after all four gates; root TypeScript alone failed with 73 diagnostics, while Player TypeScript, 19/96 tests, and the 1,912-module renderer build passed.

`TYPE-006` is complete. With `TYPE-005` and `TYPE-006` both complete, `TYPE-007` is newly ready; it was not started.

## TYPE-012 Root Test-Only Contracts — 2026-08-06

The two affected tests now express their existing contracts precisely. `PokerTable.test.tsx` declares React's act-environment flag as a boolean test global before assigning it, and `appCore.test.ts` derives its frequency-profile fixture type from the public helper's input parameter. No production source, runtime shim, public interface, compiler configuration, dependency, test behavior, assertion, suppression, or exclusion changed.

The first post-change root typecheck produced exactly 71 diagnostics in 4 affected files:

- both `TYPE-012` diagnostics disappeared: `TS7017` formerly at `src/components/PokerTable.test.tsx:9:12` and `TS2345` formerly at `src/lib/appCore.test.ts:138:51`;
- `TS7017` decreased from 1 to 0 and `TS2345` decreased from 36 to 35;
- every other diagnostic-code count and unaffected path count stayed unchanged; and
- neither affected test file retains a root diagnostic.

Final implementation verification:

- PASS: focused Vitest run — 2 files and 16 tests passed.
- EXPECTED FAILURE: `npm run typecheck` — exactly 71 diagnostics in 4 files; both assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 19 files and 96 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 71 diagnostics, while Player TypeScript, 19/96 tests, and the 1,912-module build passed.

`TYPE-012` is complete. `TYPE-015` remains planned because its other dependency, `TYPE-021`, is incomplete; no downstream task became newly ready.

## TYPE-007A Duplicate-Profile Grouping — 2026-08-06

Before production source changed, a focused jsdom characterization exercised the renderer's existing duplicate-profile computation with all remote integration paths mocked or disabled. It proves that grouping reads canonical `PlayerProfile[]`, normalizes names with `trim().toLowerCase()`, preserves source order inside groups and first-seen group order, excludes singleton groups, and carries every required and optional profile field through to the rendered merge affordance. New arrays contain the same complete state profile objects; no projection or copy drops fields.

After the pre-change test passed and was committed separately as `e4fbb7a`, the partial structural callback annotation was replaced with canonical `PlayerProfile`. No grouping expression, merge behavior, runtime condition, persisted shape, Firebase/API path, or UI behavior changed.

The first post-change root typecheck produced exactly 69 diagnostics in the same 4 files:

- both `TYPE-007A` diagnostics disappeared: `TS2322` formerly at `src/main.tsx:2631:24` and `TS2740` formerly at `src/main.tsx:2631:52`;
- `TS2322` decreased from 18 to 17, `TS2740` decreased from 1 to 0, and `src/main.tsx` decreased from 62 to 60 diagnostics;
- every other diagnostic-code and affected-path count stayed unchanged; and
- the focused characterization file has no diagnostic.

Final implementation verification:

- PASS before and after implementation: `npx --no-install vitest run src/lib/profileGrouping.test.ts` — 1 file and 1 test.
- EXPECTED FAILURE: `npm run typecheck` — exactly 69 diagnostics in 4 files, neither assigned diagnostic present, and no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 20 files and 97 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 69 diagnostics, while Player TypeScript, 20/97 tests, and the 1,912-module renderer build passed.

`TYPE-007A` is complete. The `TYPE-007` umbrella remains pending on its other nine children. `TYPE-008` still depends on incomplete `TYPE-007H`, so no downstream task became newly ready.

## TYPE-007I Table-Event Report Projection — 2026-08-07

Before production source changed, a focused jsdom characterization exercised the renderer's existing Summary `Event Reasons` list and CSV export using local fixtures with Firebase disabled, network access stubbed, and no hosted service or production data access. It covers present, missing, and empty reasons; truthy and empty notes; excluded event types; more than six matching events; exact labels, fallbacks, and CSV escaping; source and last-six ordering; required canonical event fields; and source event value/reference preservation. The focused test passed 1 file and 2 tests before the production change and was committed separately as `a030b1a`.

The two report mappers now consume canonical `TableEvent` values instead of structural fragments that required `reason`. The optional `reason`, required `note`, filter expressions, `Unspecified` fallback, note suffix, event order, CSV schema/escaping, summary labels, and source event objects remain unchanged.

The first post-change root typecheck produced exactly 67 diagnostics in the same 4 files:

- both `TYPE-007I` `TS2345` diagnostics disappeared: formerly `src/main.tsx:5594:14` and `src/main.tsx:8468:151`;
- `TS2345` decreased from 35 to 33 and `src/main.tsx` decreased from 60 to 58;
- every other diagnostic-code and affected-path count stayed unchanged; and
- the focused characterization file has no diagnostic.

Final implementation verification:

- PASS before and after implementation: `npx --no-install vitest run src/lib/tableEventReporting.test.ts` — 1 file and 2 tests.
- EXPECTED FAILURE: `npm run typecheck` — exactly 67 diagnostics in 4 files, neither assigned diagnostic present, and no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 21 files and 99 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 67 diagnostics, while Player TypeScript, 21/99 tests, and the 1,912-module renderer build passed.

`TYPE-007I` is complete. The `TYPE-007` umbrella remains pending on its other eight incomplete children and must not be marked complete. `TYPE-008` still depends on incomplete `TYPE-007H`, `TYPE-010` still depends on the umbrella, and no task became newly ready.

## TYPE-007J Floor Render Projections — 2026-08-07

Before production source changed, a focused jsdom characterization exercised the existing floor forming-game and waitlist projections using local fixtures with Firebase disabled, network access stubbed, and no hosted service or production data access. It covers complete canonical game caps/thresholds; ready/likely demand and viability text; forming/non-forming actions; interests with and without optional `manualEdits`/`arrivedAt`; edited markers; unknown-game fallback; active/inactive filtering; source order; the eight-item cap; empty state; and state value/reference non-mutation. The focused test passed 1 file and 1 test before production changed and was committed separately as `961ccc8`.

The forming-game and waitlist mappers now consume canonical `GameConfig` and `Interest` values. No demand/viability rule, field value, expression, selected-game filter, active-status filter, source order, cap, fallback, timestamp text, label, action, or persisted shape changed.

The first post-change root typecheck produced exactly 64 diagnostics in the same 4 files:

- all three `TYPE-007J` `TS2345` diagnostics disappeared: formerly `src/main.tsx:9697:40`, `src/main.tsx:9698:58`, and `src/main.tsx:9802:22`;
- `TS2345` decreased from 33 to 30 and `src/main.tsx` decreased from 58 to 55;
- every other diagnostic-code and affected-path count stayed unchanged; and
- the focused characterization file has no diagnostic.

Final implementation verification:

- PASS before and after implementation: `npm test -- --run src/components/FloorCollectionCallbacks.test.tsx` — 1 file and 1 test.
- EXPECTED FAILURE: `npm run typecheck` — exactly 64 diagnostics in 4 files, none of the three assigned diagnostics present, and no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 22 files and 100 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 64 diagnostics, while Player TypeScript, 22/100 tests, and the 1,912-module renderer build passed.

`TYPE-007J` is complete. The `TYPE-007` umbrella remains pending on its other seven incomplete children and must not be marked complete. `TYPE-008` still depends on incomplete `TYPE-007H`, `TYPE-010` still depends on the umbrella, and no task became newly ready.

## TYPE-007B Waitlist Interest Patching — 2026-08-07

The `updateInterest` mapper now consumes canonical `Interest` values instead of a structural fragment that required optional `manualEdits` and omitted every business field except `id` and `timestamp`. Patch spreading, unpatched-field preservation, optional manual edits, status-specific timestamps, conditional timestamp refresh, `changedInterest`, `gameId`, demand prompting, persistence selection, usage tracking, ordering, missing-target behavior, and prior-state immutability remain unchanged.

A focused jsdom characterization passed against unchanged production before the correction and was committed separately as `d60ef42`. It uses local fixture state with Firebase disabled and network access stubbed. It covers existing and absent `manualEdits`; multi-key non-status patches; every status timestamp family; game/unrelated-field preservation; stable order and references; non-mutation; active and inactive demand routing; prompt-selected persistence; and a missing target.

The first post-change root typecheck produced exactly 59 diagnostics in the same 4 files:

- all five `TYPE-007B` diagnostics disappeared: `TS2345` formerly at `src/main.tsx:3244:38`, `3261:7`, and `3262:30`, plus `TS2339` formerly at `3261:74` and `3262:57`;
- `TS2345` decreased from 30 to 27, `TS2339` decreased from 5 to 3, and `src/main.tsx` decreased from 55 to 50;
- every other diagnostic-code and affected-path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS before and after implementation: `npx --no-install vitest run src/lib/waitlistUpdates.test.ts` — 1 file and 6 tests.
- EXPECTED FAILURE: `npm run typecheck` — exactly 59 diagnostics in 4 files; all five assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 23 files and 106 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 59 diagnostics, while Player TypeScript, 23/106 tests, and the 1,912-module renderer build passed.

`TYPE-007B` is complete. The `TYPE-007` umbrella remains pending on six incomplete children, including `TYPE-007F` in `review_required`, and must not be marked complete. `TYPE-008` still depends on incomplete `TYPE-007H`, `TYPE-010` still depends on the umbrella, no task became newly ready, and no additional remediation task was started.

## TYPE-007C Cross-record Timestamp Corrections — 2026-08-07

The interest timestamp mapper now consumes canonical `Interest` values, and both player-session correction mappers consume canonical `PlayerSession` values instead of structural fragments that required optional `manualEdits` and omitted canonical business fields. Datetime conversion, requested-field assignment, exact player-name/game matching, seated/closed propagation, optional manual edits, correction logging, persistence, ordering, missing-target behavior, and prior-state immutability remain unchanged.

A focused jsdom characterization passed against unchanged production before the correction and was committed separately as `187be9a`. It uses local fixture state with Firebase disabled and network access stubbed. It covers all five interest timestamp keys; empty/populated inputs; matched and unmatched sessions; seated/closed mirroring; existing and absent manual edits; complete identity/profile/game/table/seating/time field preservation; stable ordering/references; exact audit markers; missing targets; non-mutation; and JSON persistence.

The first post-change root typecheck produced exactly 53 diagnostics in the same 4 files:

- all six `TYPE-007C` diagnostics disappeared: `TS2322` formerly at `src/main.tsx:3274:7`, `3277:7`, and `3289:7`, plus `TS2345` formerly at `3274:38`, `3277:48`, and `3289:48`;
- `TS2322` decreased from 17 to 14, `TS2345` decreased from 27 to 24, and `src/main.tsx` decreased from 50 to 44;
- every other diagnostic-code and affected-path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS before and after implementation: `npm test -- src/lib/stateCorrections.test.ts` — 1 file and 6 tests.
- EXPECTED FAILURE: `npm run typecheck` — exactly 53 diagnostics in 4 files; all six assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 24 files and 112 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 53 diagnostics, while Player TypeScript, 24/112 tests, and the 1,912-module renderer build passed.

`TYPE-007C` is complete. The `TYPE-007` umbrella remains pending on five incomplete children, including `TYPE-007F` in `review_required`, and must not be marked complete. `TYPE-008` still depends on incomplete `TYPE-007H`, `TYPE-010` still depends on the umbrella, no task became newly ready, and no additional remediation task was started.

## TYPE-007G Table Lifecycle and Event Transitions — 2026-08-07

Before production source changed, a focused local jsdom characterization captured the existing App-local `updateSession`, `updateSessionTimestamp`, and `recordTableEvent` closures with Firebase disabled and network access stubbed. Its 10 cases cover complete sessions, absent/present optional lifecycle fields, patching/reopening/closing, timestamp audit corrections, normal and lifecycle events, target/other player and dealer propagation, field/reference/order preservation, prior-state immutability, correction/usage logging, and local persistence. The focused suite passed against unchanged production and was committed separately as `2ea2b04`.

Three lifecycle mappers now consume canonical `GameSession` values and the player-closure mapper consumes canonical `PlayerSession` values. No expression, status transition, timestamp rule, event field, player/dealer propagation rule, audit/usage behavior, persistence argument, or ordering changed.

The first post-change root typecheck produced exactly 39 diagnostics in the same 4 files:

- all eight `TYPE-007G` diagnostics disappeared: the `TS2322`/`TS2345` pairs formerly at current pre-fix `src/main.tsx:4522`, `4554`, and `4564`, plus `TS2322` at `4576` and `TS2345` at `4578`;
- `TS2322` decreased from 14 to 10, `TS2345` decreased from 19 to 15, and `src/main.tsx` decreased from 38 to 30;
- every other diagnostic-code and affected-path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS before and after implementation: `npx --no-install vitest run src/lib/tableLifecycle.test.ts` — 1 file and 10 tests.
- EXPECTED FAILURE: `npm run typecheck` — exactly 39 diagnostics in 4 files; all eight assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 26 files and 130 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 39 diagnostics, while Player TypeScript, 26/130 tests, and the 1,912-module renderer build passed.

`TYPE-007G` is complete. The `TYPE-007` umbrella remains pending on `TYPE-007E`, `TYPE-007F`, and `TYPE-007H` and must not be marked complete. `TYPE-008` still depends on incomplete `TYPE-007H`, `TYPE-010` still depends on the umbrella, no task became newly ready, and no additional remediation task was started.

## TYPE-007E Forming and Balanced Table Construction — 2026-08-07

Before production source changed, a focused local jsdom characterization captured the existing `addSession` and `createBalancedTable` closures with Firebase disabled and network access stubbed. Four cases cover first/subsequent labels, configured/default collection modes, capped start-player drafts, complete session/event/notification payloads, source-table order, planned IDs with and without the optional field, moved-ID removal, appended Table B order/shape, persistence, usage tracking, and prior-state/plan immutability. The focused 2-file command passed 13 tests before the correction; the test-only checkpoint is `3bd7fe5`.

The forming-table state now has an explicit canonical `AppState` boundary, and the balance mapper consumes canonical `GameSession` values. No expression, label, status, seat projection, collection fallback, candidate order, event/notification payload, persistence call, or balancing algorithm changed.

The first post-change root typecheck produced exactly 35 diagnostics in the same 4 files:

- all four `TYPE-007E` diagnostics disappeared: `TS2345` formerly at current pre-fix `src/main.tsx:4405`, the `TS2322`/`TS2345` pair at `4470`, and `TS2322` at `4481`;
- `TS2322` decreased from 10 to 8, `TS2345` decreased from 15 to 13, and `src/main.tsx` decreased from 30 to 26;
- every other diagnostic-code and affected-path count stayed unchanged; and
- no new diagnostic appeared.

Final implementation verification:

- PASS before and after implementation: `npx --no-install vitest run src/lib/resultBuilders.test.ts src/lib/tablePlanning.test.ts` — 2 files and 13 tests.
- EXPECTED FAILURE: `npm run typecheck` — exactly 35 diagnostics in 4 files; all four assigned diagnostics absent; no new diagnostic.
- PASS: `npm run player:typecheck` — no diagnostics.
- PASS: `npm test` — 27 files and 134 tests passed, zero failed/skipped; the existing experimental SQLite warning remained.
- PASS: `npm run build` — 1,912 modules transformed; the existing ExcelJS `eval` and large-chunk warnings remained.
- EXPECTED PARTIAL FAILURE: `npm run verify` exited 1 after all four gates; root TypeScript alone failed with 35 diagnostics, while Player TypeScript, 27/134 tests, and the 1,912-module renderer build passed.

`TYPE-007E` is complete. The `TYPE-007` umbrella remains pending on `TYPE-007F` and `TYPE-007H`; `TYPE-008` still depends on incomplete `TYPE-007H`, `TYPE-010` still depends on the umbrella, no downstream task became newly ready, and nothing was pushed.
