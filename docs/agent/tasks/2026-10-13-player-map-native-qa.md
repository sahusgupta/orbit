# Current-source Android Map QA

This record covers the isolated Android artifact for the [Map venue handoff](./2026-10-13-player-map-venue-handoff.md). Shipping source remains `6d4b38106a72fbaaaa95eb6e7d26067b027bca07693100142dc6cc0b56c71342` /128 files, shared with the [current iPhone build](./2026-10-13-player-iphone-map-build.md). The iPhone artifact and its physical-interaction/App Attest limits remain separate. Earlier [Android build](./2026-10-12-player-android-native-qa.md) and [native smoke](./2026-10-12-player-android-smoke.md) evidence is preserved under its original source/artifact identities.

The current-source offline Map slice completed **3/3 cases**, final aggregate verification passed all 13 gates, and the owned guest/private ADB were closed. Initial gesture-prewarm failures remain unresolved; no completed frame-measurement window or physical-device acceptance is claimed.

## Offline artifact and retained build failure

| Item | Verified value |
| --- | --- |
| Package / architecture | `com.orbit.player.qa` / `x86_64` |
| APK SHA-256 / bytes | `fb2a81bc5a4e70926b24d196e06008451541736cdc4d089a2ee6ff69844f741e` /45,803,451 |
| Copied-input fingerprint | `3d8e9622e85ef8ca017319f3bfaf7c66c92be27d2cb5bd55f5c92d8a79a6c24c` /175 authored/shared/native files |
| Evidence directory | `out/player-android-qa/offline-current-6d4b-2026-10-13/` |

The source-only refresh preserved the previous `82f64b` APK (`edaae05d…`, 45,803,051 bytes), reports and authored inputs under `prior-82f/`. Independent read-only checks passed for all 175 current inputs, all 175 preserved inputs, 45 unchanged native configuration files and 126 selected-source copies outside the two synthetic overlays. Root index remained unchanged.

The first offline build ran `22:59:22.714Z` to `23:00:17.019Z`, exit 1: Ninja rejected a header path longer than 260 characters; Gradle reported 53 seconds. The failed log and terminal JSON remain intact. An initial default-boundary CIM query was denied before mutation. Root's reviewed process inspection then verified owned Gradle PID 35524 had exited with zero children. `out/clean-current-offline-map-cxx.mjs` checked ordinary resolved paths and every descendant before removing only the generated `android/app/.cxx` and copied `node_modules/expo-modules-core/android/.cxx` trees. Source and failure-log bytes were preserved; `generated-cxx-cleanup.json` records the bounded cleanup.

The retry ran `23:01:51.079Z` to `23:05:18.525Z`, exit 0. Gradle reported **3m27s, 499 tasks: 22 executed/477 up-to-date**. It used `--offline`, SDK downloads disabled, unchanged cached Gradle 9.3.1, JBR 21.0.6, SDK/Build-Tools 36, NDK 27.1.12297006 and CMake 3.30.5. No dependency update, prebuild, EAS or hosted service was used.

Fresh independent APK checks passed for the actual hash/size/package/architecture, foreground-only location permissions, synthetic native Firebase project/app/sender, bundled synthetic-project and unreachable `127.0.0.1:9` API markers, and absence of a compiled cleartext opt-in/network-security override. Only bounded marker booleans were returned; no API-key values were printed or private signing entries read. Compiled markers do not establish runtime network isolation. Evidence includes `artifact.json`, `compiled-boundary.json`, both `build-*.json` records and both `assemble-offline-*.log` files.

## Native preparation and retained failures

Root owned the fresh guest: emulator PID 69520, wrapper 68000, headless QEMU 67212 and private ADB 46248 on port 5039; target `orbit_match_qa` / `emulator-5580`. The initial network helper rejected the expected non-headless process name. Root inspected the actual exact SDK headless executable and narrowed the identity check without relaunching the guest. The completed `out/player-android-map-qa/runtime/network-proof.json` records offline guard success at `23:10:31.738Z`: airplane mode, disabled Wi-Fi/mobile, no default network/routes, down guest interfaces and no reverse mappings.

Five earlier native attempts completed with **zero of three Map cases**:

- `23:10:47.679Z`: failed before install because the AVD-name parser did not accept CRCRLF output. The desired regression first failed with 23 existing passes; the parser correction passed 24 tests.
- `23:12:14.356Z`: installed the exact approved APK, then failed before launch because the existing animator setting was `null`. The desired regression first failed with 25 existing passes; bounded nullable-setting handling passed 26 tests. No display settings had been changed at failure.
- `23:15:02.956Z`: exit 1 after the first 350 ms gesture prewarm did not settle at `Saved games, 1`. Its completed report records `settingsRestored:true`, startup `TotalTime:2103` / `WaitTime:2106` ms, and finish `23:16:21.999Z`. No Map case passed, and this failure alone does not establish a product gesture defect.
- `23:21:05.275Z`: the same prewarm selector failed again, zero cases; the completed report records observed settings restoration and finish `23:22:24.459Z`.
- `23:23:08.974Z`: prewarm still missed `Saved games, 1`, despite recorded visible geometry, the same 350 ms swipe, 889 ms command duration and a 650 ms quiet interval. It finished `23:24:29.462Z`, zero cases, with observed settings restoration. The discrepancy remains unresolved; no application source was changed and no frame measurement was accepted.

Their `results.json` records remain under `out/player-android-qa/map-handoff-smoke/` in the corresponding timestamp directories. The first two stopped at harness/preflight boundaries; the next three stopped during gesture preparation. All failed evidence remains preserved.

Root then revalidated ownership, offline state and installed APK hash for a separate bounded diagnostic. The same right swipe, `x346` to `x734` at `y1460` over 350 ms (about 148 dp, above the 72 dp threshold), saved Demo Lakeside's `2/5 No Limit Holdem`, changed Saved from 0 to 1 and promoted Demo Summit's `1/3 No Limit Holdem`. A separate Undo restored Lakeside and Saved 0. The actual `result.json` records are in `out/player-android-map-qa/gesture-diagnostic-2026-10-13T23-20-22.073Z/` and `gesture-diagnostic-2026-10-13T23-20-52.198Z/`. This successful diagnostic is separate from both the failed attempts and the later completed Map suite.

The separate primary Map run `23:25:34.482Z` completed **one of three cases**, then exited 1 at `23:28:07.687Z`. It passed the four fictional venue/city rows and retained the saved Lakeside `2/5 No Limit Holdem`: Desert Casino/Las Vegas, Lakeside/Chicago, River/Austin and Summit/Denver. Root reviewed the Map and Saved screenshots. The next case stopped at the harness's empty-Search guard: retained `failure.xml` has both text and hint `Games, clubs, or stakes`, exactly the controlled input's placeholder. This was not evidence of a retained user query or failed product handoff.

Two harness corrections retained failing characterization evidence. Null-setting cleanup previously wrote the literal `null`: the observed getter matched, but key absence was not preserved. The correction deletes the null sentinel and leaves numeric puts unchanged (desired failure `23:25:09Z`: one failed/27 passed; corrected `23:25:22Z`: 28 passed). Strict empty-field handling now accepts only the exact controlled placeholder and retains negative cases for actual input/Clear state (desired failure `23:31:57Z`: one failed/29 passed; corrected `23:32:12Z`: 30 passed). Logs/JSON remain under `out/map-native-guard-tests-*`.

## Completed current-source slice and closure

The final [Map runner](../../../tests/e2e/player-android-qa/mapHandoffSmoke.mjs) attempt, `out/player-android-qa/map-handoff-smoke/2026-10-13T23-32-38-543Z/results.json`, completed **3/3 cases, exit 0**, at `23:39:52.782Z`. It retained Lakeside's saved `2/5 No Limit Holdem` and verified all four fictional venue/city pairs. Each handoff cleared query/stakes, restored All game types, cleared Favorites, selected only the requested venue and retained Saved:

| Handoff | Exact observed unsaved deck |
| --- | --- |
| Demo River Card House / Austin | `2/5 Pot Limit Omaha`; `Demo Holdem Freeroll` |
| Demo Desert Casino / Las Vegas | `5/10 No Limit Holdem`; `4/8 Limit Holdem`; `Demo Holdem Deep Stack` |

The report retains 13 PNGs; root reviewed Saved, all venue/city pairs and the first house/casino cards. It records `settingsRestored:true` using corrected absent-setting deletion. This final run did **not** request the optional [gesture measurement](../../../tests/e2e/player-android-qa/mapPerformance.mjs); no frame-window result supersedes the unresolved prewarm failures. Reproduction boundaries are in the [QA README](../../../tests/e2e/player-android-qa/README.md#current-map-handoff-slice).

The first fresh aggregate actually ran `23:25:35.696Z` to `23:31:18.396Z`, exit 0/all 13 gates: 243 root files/1,915 tests plus 16 ordinary skips, Web 209 and sales 85 tests. Evidence is `out/orbit-match-verify-map-offline-native-external-tmp-2026-10-13-6d4b.{json,log}`. The final aggregate, `out/orbit-match-verify-map-offline-native-final-external-tmp-2026-10-13-6d4b.{json,log}`, then ran `23:32:38.052Z` to `23:36:52.327Z`, **exit 0/all 13 gates: 243 root files/1,917 tests plus 16 ordinary skips**, Web 209 and sales 85. Both used external temporary storage, unchanged selected source and no hosted runtime.

Root revalidated exact owned process births, parents, executable paths, arguments and listeners before SDK-only graceful shutdown at `23:40:24.526Z` to `23:40:37.867Z`. The owned start session closed with exit 0. At `23:40:55.679Z`, private ADB closure verified ports 5039/5580/5581 closed, no reverse mappings and all current runtime handles closed; keys, data and evidence were preserved. Completed records are `out/player-android-map-qa/runtime/{shutdown-preflight,guest-stop,terminal,closure}.json`.

The native run used no API, Auth/Firestore service, reverse mapping or EAS workflow. Hosted map tiles, Apple Maps, genuine attestation, ordinary-phone performance/accessibility and physical-device behavior remain untested. These QA checks did not change shipping source `6d4b`; this scoped pass does not establish whole-goal completion or pilot readiness.
