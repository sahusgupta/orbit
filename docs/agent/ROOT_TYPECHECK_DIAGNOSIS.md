# Root TypeScript Failure Diagnosis

Diagnosis date: 2026-08-05

Branch: `chore/prepare-codex-workflow`

Starting commit: `bd6fd1c030291c1dbeda2bf28791689ef92879bb`

## Executive conclusion

`npm run typecheck` is a renderer-and-renderer-test check, not a whole-repository TypeScript check. It runs `tsc --noEmit` against the root `tsconfig.json`, whose effective scope is 25 files under `src/`. It does not typecheck Electron, the API, Player, Vite configuration, scripts, the download site, or a shared package.

The initial diagnosis run produced 3,632 diagnostics in 13 files. The dominant failure is not 3,632 independent implementation defects: the root package has React 19 and ReactDOM 19 but owns neither `@types/react` nor `@types/react-dom`. Missing React JSX/contextual types cause 3,598 initial diagnostics, including all 3,041 `TS7026` errors and most implicit-`any` errors.

That cascade is hiding real work. A read-only diagnostic probe using the Player install's compatible React type package reduced the displayed set to 98 diagnostics, but 62 of those were newly exposed semantic errors that the untyped React layer currently masks. The correct remediation is therefore to restore the root's own React/ReactDOM type dependencies first and then rebaseline; it is not safe to assume the remaining count will simply be 34.

One narrowly safe correction was applied: `src/vite-env.d.ts` now references Vite's shipped `vite/client` declarations. This removes exactly two `ImportMeta.env` errors, emits no JavaScript, and changes no runtime behavior. The current count after that correction is 3,630 diagnostics in 12 files.

No TypeScript setting was weakened. No file was excluded. No `any`, suppression directive, or unsafe cast was added.

## Exact commands and effective projects

### Root command

Root `package.json` defines:

```json
"typecheck": "tsc --noEmit"
```

The exact `npm run typecheck` run exited nonzero. TypeScript itself reported exit code 2. The captured stream contained 3,724 output lines and 3,632 diagnostic header lines before the safe Vite declaration correction.

Root `tsconfig.json`:

- Does not extend another configuration.
- Uses TypeScript 5.9.3 resolved from the root lockfile.
- Uses `strict: true`, `noEmit: true`, `isolatedModules: true`, `jsx: react-jsx`, `target: ES2020`, `lib: DOM, DOM.Iterable, ES2020`, and `moduleResolution: Node` (effective TypeScript value `node10`).
- Has `include: ["src"]` and an empty `references` array.
- Has no `types` or `typeRoots` entry.
- Effectively includes 25 renderer, renderer-helper, and root test files.
- Correctly excludes `player-app/`, `electron/`, `apps/api/`, `vite.config.ts`, `scripts/`, and `tests/e2e/` from this project.

### Renderer configuration

There is no separate `tsconfig.app.json` or renderer-specific extended configuration. The root `tsconfig.json` is the renderer configuration. It also includes every `*.test.ts` and `*.test.tsx` below `src/`; the reported test errors are therefore inside the declared project boundary, not accidental inclusion from another application.

### Electron main process

There is no Electron TypeScript configuration. `electron/main.cjs`, `electron/preload.cjs`, and `electron/firebaseSync.cjs` are CommonJS JavaScript. Root `allowJs: false` plus `include: ["src"]` means the root check performs no Electron main/preload semantic checking.

### Player

`npm run player:typecheck` changes into `player-app` and runs its independent `tsc --noEmit`:

- `player-app/tsconfig.json` extends the installed `expo/tsconfig.base`.
- The effective project uses TypeScript 5.9.3, `@types/react` 19.1.17, `moduleResolution: bundler`, `target: ESNext`, `lib: DOM, ESNext`, and `strict: true`.
- It effectively includes 16 Player files under `App.tsx` and `src/`.
- It does not share the root dependency/type environment.

Player's pass does not validate the root renderer. It also has a separate boundary observation: `player-app/src/components/MapView.ts` and `MapView.tsx` share a basename, and the effective TypeScript file list contains `MapView.ts` but not `MapView.tsx`; `MapView.web.tsx` is included. The two native files currently re-export the same module, so this is not a root failure, but a future Player verification task should decide which native file is canonical rather than relying on extension precedence.

### API, shared packages, and project references

- `apps/api/` is source JavaScript and has no `tsconfig`.
- No `packages/` shared-package TypeScript configuration exists.
- The root has no project references.
- The only tracked TypeScript configurations are `tsconfig.json` and `player-app/tsconfig.json`.

## Why the renderer builds while typecheck fails

`npm run build` is `vite build`. The installed Vite pipeline uses esbuild/Rollup to transform and bundle the imported runtime module graph. It strips TypeScript syntax and checks syntax/module resolution, but it does not run the TypeScript semantic checker. Missing declaration packages, invalid type predicates, incomplete object types, and test-only type errors therefore do not prevent Vite from producing JavaScript.

The scopes also differ:

- Vite starts from `index.html` and bundles imported production modules. It does not import or bundle the root unit tests.
- Root `tsc` includes all 25 files under `src`, whether or not they are in the production bundle.
- Vite handles `vite.config.ts` itself; root `tsc` does not include that file.
- Vite's bundler resolution and transform target are independent of the root compiler's effective `node10` resolution and `ES2020` library declarations.

Consequently, a successful renderer build proves that Vite can emit a bundle; it does not prove that the renderer's TypeScript contracts are coherent.

## Complete initial inventory by error code

These counts describe the required initial `npm run typecheck` run before `src/vite-env.d.ts` was added.

| Error code | Count | Root cause assignment |
| --- | ---: | --- |
| `TS18046` | 5 | React contextual-type cascade; all disappeared in the React-type probe. |
| `TS2322` | 17 | 10 React cascade; 7 independent state/domain assignment errors. |
| `TS2339` | 8 | 3 React/Radix cascade; 3 stale snapshot-schema uses; 2 missing Vite environment declarations. |
| `TS2345` | 5 | Independent test, Web Crypto, GroupMe, and game-callback argument errors. |
| `TS2352` | 1 | Unsafe legacy settings conversion. |
| `TS2353` | 1 | Stale root `PlayerClubSnapshot` declaration omits runtime `social`. |
| `TS2550` | 6 | Root library is ES2020 while source/tests use `replaceAll` and `at`. |
| `TS2677` | 2 | Invalid null-filter type predicates in `src/main.tsx`. |
| `TS2739` | 2 | Firebase synchronization helpers return a type too broad for `ManagementClubState`. |
| `TS2740` | 1 | An explicitly narrowed profile callback discards required `PlayerProfile` fields. |
| `TS2769` | 1 | Generic tuple inference is lost before constructing a `Map`. |
| `TS7006` | 503 | 501 React contextual-type cascade; 2 real Firebase tournament implicit-any errors. |
| `TS7016` | 16 | Missing root React/ReactDOM declarations. |
| `TS7017` | 1 | Test-only React act-environment global has no declaration. |
| `TS7026` | 3,041 | Missing React JSX namespace/intrinsic elements. |
| `TS7031` | 22 | React contextual-type cascade; all disappeared in the probe. |
| **Total** | **3,632** | |

After the safe Vite declaration correction, only the `TS2339` count changes, from 8 to 6, for a current total of 3,630.

## Complete initial inventory by path

| Path | Initial diagnostics | Application/boundary | Notes |
| --- | ---: | --- | --- |
| `src/main.tsx` | 3,593 | Root renderer | Mostly React cascade, plus state/domain and configuration errors. |
| `src/components/AppShell.tsx` | 4 | Root renderer | React cascade. |
| `src/components/PokerTable.test.tsx` | 4 | Root renderer test | Three missing React/ReactDOM types plus one test-global declaration. |
| `src/components/PokerTable.tsx` | 4 | Root renderer | React cascade. |
| `src/components/TournamentTvView.tsx` | 1 | Root renderer | Missing JSX runtime type. |
| `src/components/ui/badge.tsx` | 2 | Root renderer | React cascade. |
| `src/components/ui/button.tsx` | 7 | Root renderer | React cascade. |
| `src/components/ui/dropdown-menu.tsx` | 2 | Root renderer | Radix prop inference damaged by missing React types. |
| `src/lib/appCore.test.ts` | 1 | Root renderer test | Heterogeneous fixture inference. |
| `src/lib/firebaseClubSync.ts` | 5 | Root renderer/Firebase boundary | Four real state-shape errors and one stale snapshot use. |
| `src/lib/firebaseConfig.ts` | 1 | Root renderer configuration | Missing Vite client declaration; resolved safely. |
| `src/lib/playerSync.test.ts` | 6 | Root renderer test | Four ES library errors and two stale snapshot-schema checks. |
| `src/lib/playerSync.ts` | 2 | Root renderer/shared-domain copy | Stale snapshot declaration and membership-status narrowing. |

After the Vite declaration correction, `src/lib/firebaseConfig.ts` has no errors and `src/main.tsx` has 3,592; the other path counts are unchanged.

## Root-cause groups and remediation classification

All groups were present before this diagnosis unless explicitly marked resolved. Counts sum to the initial 3,632.

### 1. Missing root React and ReactDOM declarations — `DEPENDENCY_TYPE_MISMATCH`

- Initial count: 3,598.
- Codes: all 16 `TS7016`; all 3,041 `TS7026`; 501 `TS7006`; all 22 `TS7031`; all 5 `TS18046`; 10 `TS2322`; 3 `TS2339`.
- Representative errors: missing declarations for `react`, `react/jsx-runtime`, and `react-dom/client`; missing `JSX.IntrinsicElements`.
- Affected files: `src/main.tsx`, `src/components/AppShell.tsx`, `PokerTable.tsx`, `PokerTable.test.tsx`, `TournamentTvView.tsx`, and UI badge/button/dropdown modules.
- Underlying cause: root React 19.1.1 and ReactDOM 19.1.1 are installed without root-owned compatible declaration packages. Player owns `@types/react`, but independently locked nested dependencies are not a valid root type source.
- Duplicate mechanism: once React is untyped, JSX, hook state, component props, event handlers, Radix props, array callbacks, and destructured callback parameters lose contextual types. Thousands of downstream diagnostics describe that one missing foundation.
- Pre-existing: yes.
- Real implementation defect: the missing development type dependencies are real; most individual downstream messages are duplicates, not distinct runtime defects.
- Project-boundary defect: dependency boundary, not an incorrect file inclusion.
- Confidence: high. A read-only probe using Player's compatible React declarations eliminated 3,596 diagnostics; the two remaining `TS7016` errors are ReactDOM.
- Recommended correction: add compatible root `@types/react` and `@types/react-dom` development dependencies through the root lockfile. Do not point root `typeRoots` at `player-app/node_modules`.
- Risk: low runtime risk, medium verification risk because correct React types expose additional semantic failures.
- Verification: lockfile review, `npm run typecheck`, `npm run player:typecheck`, `npm test`, and `npm run build`.
- Safe for autonomous repair: yes only as a separately reviewed foundational dependency change; stop after rebaselining rather than attempting all newly visible repairs in the same step.
- Blocks refactoring: yes. Renderer refactors cannot be trusted while React contracts are absent.
- Blocks website development: conditionally. A separately configured website is not directly blocked, but reusing root components or types is unsafe until this is repaired.

### 2. Missing Vite client environment type — `MISSING_GENERATED_TYPE` (resolved)

- Initial count: 2 `TS2339` diagnostics.
- Representative errors: `Property 'env' does not exist on type 'ImportMeta'` at `src/main.tsx:1172` and `src/lib/firebaseConfig.ts:13`.
- Affected files: `src/main.tsx`, `src/lib/firebaseConfig.ts`.
- Underlying cause: the Vite renderer used `import.meta.env` without the standard `vite/client` type reference.
- Pre-existing: yes.
- Real implementation defect: no runtime defect; the TypeScript environment declaration was incomplete.
- Project-boundary defect: renderer configuration support file was missing.
- Confidence: high. A CLI probe removed exactly these two errors with no new errors.
- Correction applied: added `src/vite-env.d.ts` with `/// <reference types="vite/client" />`.
- Risk: low; type-only, no emit.
- Verification: `npm run typecheck` and `npm run build`.
- Safe for autonomous repair: yes; completed.
- Blocks refactoring or website development: no after correction.

### 3. ES2020 library versus newer built-ins — `CONFIGURATION_BOUNDARY`

- Initial/current count: 6 `TS2550` diagnostics.
- Representative errors: `String.replaceAll` at `src/main.tsx:2311`; `Array.at` at `src/main.tsx:5178` and four locations in `src/lib/playerSync.test.ts`.
- Affected files: `src/main.tsx`, `src/lib/playerSync.test.ts`.
- Underlying cause: root `lib` is ES2020, while code assumes ES2021/ES2022 built-ins. Player uses ESNext and does not report these errors.
- Pre-existing: yes.
- Real implementation defect: potentially; the type error reflects an unresolved browser/runtime support decision.
- Project-boundary defect: compiler/runtime target policy mismatch, not misplaced files.
- Confidence: high.
- Recommended correction: explicitly choose the supported desktop/browser runtime. Either raise the root library level while preserving the intended emit target, with documented runtime support, or replace newer methods with ES2020-compatible equivalents.
- Risk: medium because changing `lib` can validate APIs unavailable on an intended older runtime.
- Verification: supported-runtime smoke coverage, `npm run typecheck`, tests, and renderer build.
- Safe for autonomous repair: no until runtime support is confirmed.
- Blocks refactoring: yes, because array/string helper choices affect extracted code.
- Blocks website development: yes if code is shared; a website needs its own explicit browser target.

### 4. Root/player snapshot schema drift — `STALE_OR_DEAD_CODE`

- Initial/current count: 4 diagnostics (`TS2353` once, `TS2339` three times).
- Representative errors: root `PlayerClubSnapshot` omits `social`, while `buildPlayerClubSnapshot` returns it, Firebase publishes it, and root tests assert it.
- Affected files: `src/lib/playerSync.ts`, `src/lib/firebaseClubSync.ts`, `src/lib/playerSync.test.ts`.
- Underlying cause: the root exports a duplicated, stale snapshot declaration. The Player declaration includes `social`, `syncProtocolVersion`, and `syncRevision`.
- Pre-existing: yes.
- Real implementation defect: stale compile-time contract; runtime and tests provide evidence that `social` is intentional.
- Project-boundary defect: duplicated cross-application schema with no canonical shared package.
- Confidence: high for `social`; additional root/player differences require field-by-field review.
- Recommended correction: characterize the serialized snapshot and establish one canonical versioned type before aligning root and Player declarations.
- Risk: medium/high because the exported type represents a cross-application sync API.
- Verification: root/player sync unit tests, Firebase publication shape tests, protocol-v2 compatibility tests, both typechecks, and build.
- Safe for autonomous repair: no under this task because changing an exported sync contract requires explicit schema review even though runtime already emits the field.
- Blocks refactoring: yes.
- Blocks website development: yes; a Player website would consume this contract.

### 5. Firebase state transformations lose their domain type — `REAL_TYPE_ERROR`

- Initial/current count: 4 diagnostics (two `TS2739`, two `TS7006`).
- Representative errors: assignments at `src/lib/firebaseClubSync.ts:183-184` return `Record<string, any>` where `ManagementClubState` is required; tournament callbacks at lines 241 and 295 are implicitly `any`.
- Affected file: `src/lib/firebaseClubSync.ts`.
- Underlying cause: tournament/transaction ingestion and publication are typed as broad records, so the compiler cannot prove required arrays or tournament shapes survive the transformation.
- Pre-existing: yes.
- Real implementation defect: yes, at a production data boundary. Runtime may be correct, but the current types provide no protection.
- Project-boundary defect: domain types are private to `playerSync.ts` while Firebase needs the same state model.
- Confidence: high.
- Recommended correction: export or centralize precise management, tournament, registration, and transaction types; validate untrusted Firestore data; make transformation functions preserve `ManagementClubState`.
- Risk: high because the code reads/writes Firebase sync state.
- Verification: characterization tests for missing/extra fields, registrations, revenue transactions, protocol-v2 publication ordering, root tests, typecheck, and build. No production Firebase access.
- Safe for autonomous repair: no without characterization fixtures and explicit non-production isolation.
- Blocks refactoring: yes.
- Blocks website development: indirectly; website data correctness depends on the published shape.

### 6. Root test typing gaps — `TEST_TYPE_ERROR`

- Initial/current count: 2 diagnostics.
- Representative errors: undeclared `globalThis.IS_REACT_ACT_ENVIRONMENT` in `src/components/PokerTable.test.tsx`; heterogeneous `gamePlayCounts` fixture inference in `src/lib/appCore.test.ts`.
- Affected files: those two test files.
- Underlying cause: one missing test-global declaration and one fixture inferred as a union with optional `undefined` keys, incompatible with `Record<string, number>`.
- Pre-existing: yes.
- Real implementation defect: no demonstrated production defect; these are test-contract defects.
- Project-boundary defect: no. Tests are intentionally included by `include: ["src"]` and should remain checked.
- Confidence: high.
- Recommended correction: add a precise test-environment global declaration and give the fixture a truthful exported/structural profile type without assertions that bypass checking.
- Risk: low.
- Verification: root typecheck and `npm test`.
- Safe for autonomous repair: yes after React/ReactDOM types are restored and the final intended test types are visible.
- Blocks refactoring: yes as part of the verification gate.
- Blocks website development: no direct block.

### 7. Membership status narrowing across a callback — `REAL_TYPE_ERROR`

- Initial/current count: 1 `TS2322` at `src/lib/playerSync.ts:629`.
- Representative error: `PlayerClubMembershipRecord` allows `Denied`, while `ManagementProfile.membershipStatus` does not.
- Affected file: `src/lib/playerSync.ts`.
- Underlying cause: the function returns early for `Denied`, but the narrowed membership status is used inside a later array callback where the compiler does not retain enough proof for the assigned profile field.
- Pre-existing: yes.
- Real implementation defect: type-flow defect around a sensitive membership state; runtime intent appears to reject denied memberships.
- Project-boundary defect: duplicated profile/membership status models contribute.
- Confidence: high.
- Recommended correction: capture a precisely narrowed allowed status before entering the callback and test all five incoming statuses, without widening the management status union merely to silence the compiler.
- Risk: medium because membership synchronization and persisted state are involved.
- Verification: membership sync characterization tests, root/player typechecks, tests, and build.
- Safe for autonomous repair: no in this diagnosis task.
- Blocks refactoring: yes.
- Blocks website development: yes if membership state is shared.

### 8. Main renderer collection/state transformations — `REAL_TYPE_ERROR`

- Initial/current count: 13 diagnostics.
- Representative groups:
  - Tuple and null filtering: `src/main.tsx:1181`, `1881/1947`, and `2374/2398` (`TS2769`, `TS2322`, `TS2677`).
  - Explicitly narrowed callback parameters that discard required fields: `2826` (`TS2322`/`TS2740`), `8223`, and `9892-9893` (`TS2345`).
  - Imported profile shape mismatch: `5493` (`TS2322`).
  - Desktop/local account record and partial settings mismatch: `6194` and `6209` (`TS2322`).
- Affected file: `src/main.tsx`.
- Underlying causes: arrays lose tuple/null-discriminant information; hand-written callback parameter annotations are narrower than the actual domain objects; external/imported data is not normalized into a proven `PlayerProfile`; and `Partial<AppState>` is shallow while account restore constructs partial nested settings.
- Pre-existing: yes.
- Real implementation defect: yes at the type-contract level; some errors may reveal actual edge-case defects in import, account restore, or state updates.
- Project-boundary defect: the large entrypoint combines UI, persistence, migration, import, and domain transformations, making contextual typing fragile.
- Confidence: high that the annotations/contracts are wrong; medium on intended domain behavior.
- Recommended correction: repair in small characterized groups after React types are restored—tuple construction, null filtering, removal/replacement of overly narrow annotations with exact domain types, imported-data validation, then a deliberate deep-partial persistence model.
- Risk: medium/high, especially for persisted state and account loading.
- Verification: focused unit/characterization tests for each transformation, account migration/load tests, import tests, root typecheck, all tests, and build.
- Safe for autonomous repair: no as a single group; individual pure transformations may become safe after characterization.
- Blocks refactoring: yes.
- Blocks website development: not directly unless these management flows are reused.

### 9. Web Crypto typed-array incompatibility — `PLATFORM_TYPE_CONFLICT`

- Initial/current count: 1 `TS2345` at `src/main.tsx:1271`.
- Representative error: `Uint8Array<ArrayBufferLike>` is not assignable to the DOM `BufferSource` expected by `crypto.subtle.verify` because it could be backed by `SharedArrayBuffer`.
- Affected file: `src/main.tsx` license signature verification.
- Underlying cause: TypeScript 5.9's generic typed-array/DOM declarations are stricter than the helper's return type.
- Pre-existing: yes.
- Real implementation defect: potentially; the runtime data is probably an owned `ArrayBuffer`, but the helper contract does not prove it.
- Project-boundary defect: browser Web Crypto boundary.
- Confidence: high.
- Recommended correction: make the decoding/signature helper return an owned `ArrayBuffer`/compatible byte view by construction. Do not cast through `unknown` or assert `BufferSource`.
- Risk: medium because pilot license validation is security-sensitive.
- Verification: valid, invalid, malformed, and wrong-key signature characterization tests in a browser-compatible environment, plus typecheck/tests/build.
- Safe for autonomous repair: no without cryptographic characterization coverage.
- Blocks refactoring: yes for licensing work.
- Blocks website development: no direct block.

### 10. Legacy settings compatibility cast — `STALE_OR_DEAD_CODE`

- Initial/current count: 1 `TS2352` at `src/main.tsx:1671`.
- Representative error: the complete settings object is cast to `Record<string, "Time" | "Drop">` to read an obsolete dynamically assembled property name.
- Affected file: `src/main.tsx` state normalization.
- Underlying cause: an old persisted-setting compatibility path uses incompatible whole-object casts rather than a typed legacy input shape.
- Pre-existing: yes.
- Real implementation defect: unsafe migration typing; runtime behavior may be intentional.
- Project-boundary defect: persisted legacy schema is not represented explicitly.
- Confidence: high on the typing cause; medium on how long compatibility must remain.
- Recommended correction: define a narrow legacy settings input shape and characterize old saved-state migration before replacing the cast or removing the path.
- Risk: medium/high because old installations may depend on migration behavior.
- Verification: legacy fixture migration tests, current state normalization tests, typecheck/tests/build.
- Safe for autonomous repair: no until retention requirements and fixtures are confirmed.
- Blocks refactoring: yes.
- Blocks website development: no direct block.

## Duplicate and latent diagnostics

The React-only probe was deliberately read-only and did not modify dependency resolution. Before the Vite correction it showed:

- 3,596 initial diagnostics disappeared.
- 36 initial diagnostics remained at the same path/line/code.
- 62 diagnostics were newly exposed.
- Total displayed diagnostics became 98.

With the Vite declaration present, the equivalent probe reports 96 diagnostics: 3,596 removed, 34 current diagnostics retained, and the same 62 newly exposed.

The 62 latent diagnostics are 22 `TS2322`, 31 `TS2345`, 2 `TS2339`, 1 `TS2367`, 1 `TS2677`, and 5 `TS2769`, all in `src/main.tsx`. Most concern state-array callbacks, partial objects, literal widening, and React state setters. Classification: `UNKNOWN_REQUIRES_INVESTIGATION` until root-owned React and ReactDOM types are installed and the definitive diagnostic stream is captured. Confidence is high that they are genuine compile-time contract problems, but their exact count and messages may change once ReactDOM and all root dependencies are typed.

These latent errors are pre-existing, likely block safe renderer refactoring, and are not safe for bulk autonomous repair. They require grouping by behavior boundary and characterization tests after the dependency foundation is corrected.

## Generated, obsolete, test, and platform-specific assessment

- No root error originates in generated build output, `node_modules`, Electron files, API files, Player files, download-site files, or e2e files.
- No root error is caused by a nonexistent `tsconfig` path or a project reference; the root has no references.
- Root tests are intentionally in scope. Their errors should be fixed, not excluded.
- The Vite environment declaration was a missing renderer support type and is now resolved.
- The root `PlayerClubSnapshot` and legacy settings input are stale local contracts, but the executing code is not proven dead.
- The Web Crypto error is the only current platform-library conflict.
- Player's duplicate `MapView.ts`/`MapView.tsx` boundary is a separate verification gap, not a cause of this failure.

## Recommended remediation sequence

1. Add root-owned, React-19-compatible `@types/react` and `@types/react-dom` development dependencies. Review the lockfile and rerun only the four required checks; do not repair the newly exposed errors in the same dependency commit.
2. Capture a new definitive error inventory. Replace the 62-error probe estimate with the actual post-dependency stream.
3. Decide and document root browser/runtime support. Align `lib` with that decision or replace unsupported built-ins; do not change `target`/`lib` merely to silence errors.
4. Fix the two isolated test typing gaps.
5. Characterize and canonicalize the cross-application snapshot/membership types before changing the stale root declarations.
6. Add non-production characterization tests for Firebase registration/transaction transformations, then replace broad record types with validated domain shapes.
7. Repair pure `src/main.tsx` transformations in small groups: tuple construction and null filtering first, then callback annotations/import normalization, then account restore/deep partials.
8. Treat legacy settings and Web Crypto as separate high-risk tasks with fixtures/security tests.
9. Run `npm run typecheck`, `npm run player:typecheck`, `npm test`, and `npm run build` after every group. Begin broader refactoring only after the root gate is green or a reviewed, quantified residual baseline exists.

Do not merge root and Player TypeScript projects merely to reduce errors. Keep their platform configurations separate, and add distinct Electron/API checks only when those JavaScript surfaces adopt TypeScript or `checkJs` through a separately scoped task.

## Verification record for this diagnosis

After the Vite declaration correction, the required commands produced these results on 2026-08-05:

- FAIL: `npm run typecheck` reported exactly 3,630 diagnostics. The two `ImportMeta.env` diagnostics were absent, and no new diagnostic was introduced.
- PASS: `npm run player:typecheck` completed with no diagnostics.
- PASS: `npm test` ran 17 test files and 81 tests with zero failures or skips. Node retained its experimental SQLite warning.
- PASS: `npm run build` transformed 1,910 modules and completed in 15.55 seconds. The existing ExcelJS `eval` warning and chunk-size warnings remained.

The expected root failure therefore remains visible, with the safe correction reducing only the two Vite environment diagnostics. The same results are recorded in `docs/agent/BASELINE.md`.
