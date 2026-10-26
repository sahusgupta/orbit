# Player wallet focus and fictional sample names — 2026-10-26

Status: requested UI changes complete; final verification passed 11 of 13 gates, with existing dependency-upgrade failures recorded below.

## Scope and behavior

The player membership wallet now isolates a card on the first tap and opens its club pass on the second tap. **Back to wallet** restores the stack. Focus clears when the owning account changes, the published membership is replaced or removed, or the wallet becomes empty; retained memberships use the latest club snapshot. Existing membership ownership, expiry, renewal, and check-in behavior remains in place.

The sample account now uses Alex Example, Wonderland Card House, Moonbeam Poker Club, Cloud Nine Card House, and Stardust Sandbox Casino. Names, explanatory copy, and accessibility labels use sample/fictional language without the word “demo.” Displayed fixture membership IDs are `sample-austin-membership` and `sample-chicago-membership`; other internal fixture IDs and code symbols remain stable. This changes only local fictional membership IDs, with no production ID, API, persisted schema, or sync-protocol change.

Live action, device-location, and check-in credential guards are unchanged. The sample session remains in memory and separate from connected authentication, storage, and sync. Existing user changes to `player-app/package.json` and `player-app/package-lock.json` were present before this task and remain untouched.

Current usage is documented in [the player README](../../../player-app/README.md) and [App Store reviewer flow](../../../player-app/APP_STORE_SUBMISSION.md). Historical release records and SDK information were preserved.

## Verification

- `npm test -- player-app/src/demo/demoPlayerData.test.ts`: 7 tests passed. The initial sandbox invocation could not load the Vitest configuration because esbuild could not read a parent directory; the same command passed with approved execution outside that sandbox.
- Focused player component/session suite: final 12 files and 192 tests passed. The first run had 189 passing tests and three stale presentation snapshot digests; expected digests were updated after reviewing the intentional text changes.
- Isolated browser QA: 14 checks and 64 screenshots passed across light/dark themes at 320, 360, and 390 pixels. Covered first-tap isolation, back/reset/refocus, second-tap pass navigation, return to the stack, visible and accessible sample labels, overflow, contrast, JavaScript errors, forbidden actions, and outbound requests. Exposed cards retain 88-pixel tap areas.
- The new browser harness initially expected `accessibilityState` to appear through its React Native Web adapter. That adapter drops the native property, so the harness now checks the actual rendered state and interactions. Native component accessibility assertions were retained.
- Android QA helper tests: 9 passed; three JavaScript syntax checks passed. Updated native QA selectors and matching Maestro contracts for the renamed controls without changing flow boundaries or network guards. No emulator, native build, or device test was run for this task.
- The first `npm run verify` completed all 13 gates: 10 passed, and Player TypeScript, release-contract checks, and root unit tests failed. Three Map QA tests still expected old fictional venue names/addresses. Those expectations were corrected; the focused Map QA, simulator-flow, and Android-safety suites then passed all 40 tests. The unit failure was task-related and was fixed.
- The final `npm run verify` exited 1 after all 13 gates. Eleven passed: root TypeScript, player artwork, Web TypeScript/lint/tests/build, internal-tool TypeScript/tests/build, root unit tests, and desktop renderer build. Player TypeScript and the player release contract retained the three native-type diagnostics and six dependency-pin failures listed below; no wallet or sample-copy diagnostic was reported. Root unit results: 253 suites passed, one skipped; 2,280 tests passed and 16 skipped. Web tests: 20 suites/209 tests; internal-tool tests: seven suites/85 tests. Renderer output retained the ExcelJS `eval` and chunk-size warnings. Logs remain under ignored `out/player-wallet-focus-verify.log` and `out/player-wallet-focus-verify-final.log`.

The [engineering baseline](../BASELINE.md) was inspected. A separate `npm run player:release:verify` run failed six dependency-pin checks against the user's package upgrades, which were already present at the start of this task. `npm run player:typecheck` reports three errors at untouched native type boundaries under those upgraded dependencies:

- `src/app/playerPlatform.ts(11,5)`, TS2322: `AppState.currentState` includes `undefined`, which is not assignable to `PlayerAppState | null`.
- `src/PlayerApp.tsx(379,28)`, TS2339: `scrollTo` is absent from the `ScrollView` component type under the upgraded React Native types.
- `src/PlayerApp.tsx(630,23)`, TS2322: `RefObject<ScrollView component | null>` is not assignable to `Ref<ScrollViewInstance>`.

The six existing `player:release:verify` failure messages are:

1. Expo CLI/runtime must be pinned exactly for the reviewed SDK 57 release.
2. Expo Constants must be pinned to the SDK-compatible release.
3. React Native must remain pinned to the reviewed New Architecture-only runtime.
4. Expo splash plugin must use the SDK 57-compatible pinned version.
5. Expo Crypto must remain a pinned SDK-compatible direct dependency for native request identifiers.
6. Optional foreground location must use the reviewed SDK-compatible dependency.

Dependency remediation was outside this task. Verification used unreachable localhost API endpoints and disabled Firebase sync and telemetry; browser QA excluded live service modules and blocked outbound requests. No production services, credentials, deployments, or pushes were involved. Following validation on `release/player-ui-api-20261020`, the user requested a local commit and integration onto `main`. The user's package and lockfile edits are preserved separately in the original checkout. Generated logs, builds, and screenshots are not staged.
