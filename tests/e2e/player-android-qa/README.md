# Isolated Android native QA

This manual Windows harness snapshots the current player source into ignored `out/player-android-qa/project/player-app`. It does not generate `player-app/android`, deploy, install an APK, or start an emulator. The parent QA runner manages a separate network-disabled emulator and ADB port 5039.

```powershell
node tests/e2e/player-android-qa/prepare.mjs prepare
node tests/e2e/player-android-qa/prepare.mjs prebuild
node tests/e2e/player-android-qa/prepare.mjs tools
# Run refresh after any source changes, before compiling.
node tests/e2e/player-android-qa/prepare.mjs refresh
node tests/e2e/player-android-qa/prepare.mjs build
```

The app ID is `com.orbit.player.qa`; Firebase options, Google Services configuration, and the Maps key are synthetic and invalid. The dummy Maps metadata permits native component initialization while the emulator network is blocked; it does not establish map service access. API and legal links point to unreachable loopback port 9, App Check is disabled for this fixture, dotenv and Expo telemetry are disabled, and Expo/Java/Gradle/Android user homes are inside ignored output. No real Firebase/Maps configuration, dotenv files, certificates, or host authentication caches are read or copied. This APK cannot establish production Auth, App Check, hosted data, or network map readiness.

Native dependencies are copied into a writable overlay; pure JavaScript dependencies are linked to the existing lockfile-installed modules. The QA Metro resolver routes native package imports from linked JavaScript back through the copied app root, preserving one React Native instance. SDK install containers (`platforms`, `build-tools`, `ndk`, and `cmake`) must be real isolated directories; only existing installed versions are linked individually. A preflight guard rejects a whole-container junction before tools or Gradle can install a missing version. The overlay copies already accepted SDK license text. Exact missing NDK `27.1.12297006` and CMake `3.30.5` install only inside ignored output; no compiler downgrade is allowed. A fresh 30-day local test signing key replaces the template key without reading it. Gradle/Maven/compiler downloads contact public tooling repositories only. Build logs and a non-secret source fingerprint remain ignored.

The standalone x86_64 APK embeds JavaScript and is expected at `out/player-android-qa/project/player-app/android/app/build/outputs/apk/release/app-release.apk`. A source fingerprint mismatch prevents building until the snapshot is refreshed. Repeated `prepare` refuses to replace an existing snapshot; no command deletes or changes the separately managed AVD.

Gradle's public dependency cache is isolated at the shorter ignored `out/g` path. Windows Ninja incremental dependency checks can still reject unusually long prefab header paths over 260 characters. If that occurs, guard-clean only the generated app and Expo-core `.cxx` directories inside the isolated project and rebuild with the exact tools. Full native compilation succeeded with this recovery; no compiler downgrade or host path setting is needed.

## Separate connected fixture

[connectedPrepare.mjs](./connectedPrepare.mjs) creates a separate copied source tree and test-signed APK under the shorter ignored `out/c`, with metadata, logs and SDK homes in `out/player-android-connected-qa` and app ID `com.orbit.player.qa.connected`. The short physical project path avoids the particular generated CMake configuration path that exceeded Windows Ninja's limit in the first connected build. It never edits production Auth, SDK initialization, API contracts, Firestore rules, or the offline demo APK. The copied Firebase client validates `demo-orbit-native-match-qa` and the fixed loopback API before SDK initialization, then connects the actual Firebase JS Auth and Firestore SDKs to the emulators before use. The existing email/password interface remains the sign-in path.

```powershell
node tests/e2e/player-android-qa/connectedPrepare.mjs prepare
node tests/e2e/player-android-qa/connectedPrepare.mjs prebuild
# After a reviewed source-only change, preserve previous artifact metadata first.
node tests/e2e/player-android-qa/connectedPrepare.mjs refresh
node tests/e2e/player-android-qa/connectedPrepare.mjs build
npx --no-install vitest run tests/e2e/player-android-qa/connectedPrepare.test.js tests/e2e/player-android-qa/connectedEmulators.test.js tests/e2e/player-android-qa/connectedServer.test.js
```

The copied source/assets/shared reducer, synthetic overrides, native identity/network policy and native build inputs are fingerprinted after prebuild. Both the original selected source and the frozen copied inputs must match immediately before and after Gradle. Dependencies, generated build/cache outputs and the generated fixture key are excluded from that authored-input hash. A changed copied controller or manifest rejects the build, even when the original source is unchanged.

`refresh` first verifies the previous frozen fixture, then replaces only the four ordinary copied authored source trees, selected app files and shared reducer with a before/after source check. It re-applies the same QA overrides and freezes the changed authored bytes while preserving native configuration, dependencies and the existing test key. It never refreshes or clears an installed application's data.

[connectedEmulators.mjs](./connectedEmulators.mjs) owns only an isolated Auth/Firestore emulator process tree and refuses already occupied target ports. Its clean CLI environment uses isolated homes, a digest-checked public emulator jar, disabled CLI usage reporting, the exact Android Studio JDK and a loopback network preload. [connectedServer.mjs](./connectedServer.mjs) starts the actual Express app in a separate allowlisted environment with real Auth-emulator verification, an in-memory generated Admin fixture certificate and the actual Firestore repository. It seeds two fictional verified users and one licensed canonical venue. It never starts the production server's publication timer, reads ADC, uses production credentials, injects a fake identity header or calls an external identity/payment provider. Its private IPC controls expose only bounded fixture state and local peer actions.

Auth/Firestore listen on loopback ports `19099`/`18085`; private host-only hub/logging/websocket ports are `14400`/`14500`/`18150`. They are not forwarded to the Android guest.

Native connections require a separately reviewed APK hash and parent authorization after the offline smoke completes. They use only three exact dedicated ADB reverses: Auth `19099`, Firestore `18085` and API `14639`. The guest retains disabled network interfaces and no default routes. The copied Android network policy allows cleartext for `127.0.0.1` only; it cannot restrict ports, so the native runner must reject extra reverse mappings. App Check is disabled only for this fixture and remains unproved; real emulator-issued Auth tokens do not establish production provider sign-in, physical-device or two-native-device sync. See [the connected task record](../../../docs/agent/tasks/2026-10-12-player-android-connected-qa.md) for actual results.

[connectedSmoke.mjs](./connectedSmoke.mjs) is a separate preparation-safe native runner. Its pure tests and default invocation do not start ADB, a server or Firebase. The compiled APK is pinned to `out/c/player-app/android/app/build/outputs/apk/release/app-release.apk`; metadata and reports stay under `out/player-android-connected-qa`. The exact APK **and frozen fixture** hashes require separate parent review. Runtime also verifies the installed APK and refuses any pre-existing reverse mapping. It creates/removes only its three owned reverse ports, starts the bounded child fixture through IPC, and reads only sanitized diagnostics filtered by the exact connected app PID inside the guest. It never taps OS permission/provider/identity actions.

```powershell
# Preparation only; no native or service action.
node tests/e2e/player-android-qa/connectedSmoke.mjs
npx --no-install vitest run tests/e2e/player-android-qa/connectedSmoke.test.js

# Only after separate parent approval of the APK/fixture, local emulator proof and offline guest.
$env:ORBIT_CONNECTED_QA_RUN_APPROVED = '1'
$env:ORBIT_QA_GUEST_OFFLINE_CONFIRMED = '1'
$env:ORBIT_CONNECTED_QA_APK_SHA256 = '<parent-approved connected APK SHA-256>'
$env:ORBIT_CONNECTED_QA_FIXTURE_SHA256 = '<parent-approved frozen fixture SHA-256>'
$env:ORBIT_CONNECTED_QA_SOURCE_SHA256 = '<parent-approved current original source SHA-256>'
node tests/e2e/player-android-qa/connectedSmoke.mjs --run --install --fresh
```

The connected scenarios use the existing native email/password interface with exported fictional emulator accounts. They check remote profile/discovery, API Save/Undo/preferences, accepted real Firestore listener updates and stale-draft reload, API pause with actual SecureStore pending journal/cold restoration/retry, receipt replay and owner B isolation. Private server IPC controls pause only the local API and preserve datastore/Auth/listeners. Preparation is not a runtime pass; results are recorded only after execution. Credentials/tokens/raw SDK logs never enter reports.

## Optional local native seat-request slice

The same connected runner supports separately authorized `--seat-request` mode, leaving the default seven-case fixture unchanged. The child seeds explicitly fictional provisional-age records for only its two owned users and one canonical Active membership for A. These server-owned fixtures exercise the existing eligibility/membership/transaction guards; they are not identity-provider verification or payment evidence. The real native path saves a game, opens saved details, opens the arrival modal and explicitly presses **Tell club I am here**. Save/details/modal alone must create no venue request.

Five cases check actual accepted venue state/My Games and current-save attribution, same-ID replay, membership expiry after a second draft with no optimistic request/conversion residue, and native/actual SDK owner B isolation. A seat-mode-only local HTTP wrapper counts waitlist POST attempts without reading headers or bodies; zero attempts are required before native confirmation. Every request still passes through the unchanged Express/Auth guards. Mode-only IPC accepts exact owner roles and bounded fixture transitions. Inspection fields are restricted to owned IDs/game/table/status/attendance/timestamps, attempt/receipt counts and current-save event references; no contact, identity capture, token or arbitrary request body is exposed. API/App Check, native target and outbound guards retain their existing boundaries. The publication outbox is not drained, and no identity provider, payment, SMS, physical location or production service is called.

```powershell
# Only after separate parent review of current APK/source/copied inputs and local fixture readiness.
$env:ORBIT_CONNECTED_QA_RUN_APPROVED = '1'
$env:ORBIT_CONNECTED_QA_SEAT_REQUEST_APPROVED = '1'
$env:ORBIT_QA_GUEST_OFFLINE_CONFIRMED = '1'
$env:ORBIT_CONNECTED_QA_APK_SHA256 = '<parent-approved connected APK SHA-256>'
$env:ORBIT_CONNECTED_QA_FIXTURE_SHA256 = '<parent-approved frozen fixture SHA-256>'
$env:ORBIT_CONNECTED_QA_SOURCE_SHA256 = '<parent-approved current original source SHA-256>'
node tests/e2e/player-android-qa/connectedSmoke.mjs --run --install --fresh --seat-request
```

Reports use a separate ignored `out/player-android-connected-qa/seat-request-smoke/<attempt>/` directory. No native result is inferred from preparation or from the earlier seven-case Match run. [The seat-request record](../../../docs/agent/tasks/2026-10-13-player-native-seat-request.md) records characterization and actual outcomes.

## Native UI smoke

### Current Map handoff slice

[mapHandoffSmoke.mjs](./mapHandoffSmoke.mjs) separately pins the reviewed current offline APK and original 128-file source. It preserves guest data and the historical smoke pins. Preparation is inert:

```powershell
node tests/e2e/player-android-qa/mapHandoffSmoke.mjs

# Only after review of the exact pinned APK/source and the dedicated offline guest.
$env:ORBIT_QA_GUEST_OFFLINE_CONFIRMED = '1'
$env:ORBIT_MAP_QA_APK_SHA256 = '<reviewed pinned offline APK SHA-256>'
$env:ORBIT_MAP_QA_SOURCE_SHA256 = '<reviewed pinned original source SHA-256>'
node tests/e2e/player-android-qa/mapHandoffSmoke.mjs --run --install
```

The three cases check four fictional venue/city rows, a retained Saved game, and house/casino Map actions clearing conflicting search, stakes and game-type selections while revealing each exact eligible unsaved deck. The fixed package/guest/private ADB target and offline checks match the baseline; reverse mappings, data clearing and target overrides are rejected. Android placeholder text is accepted only with the exact known field/hint, and a search Clear control still proves nonempty input. Display cleanup deletes absent-value sentinels and preserves existing numeric values. Reports and images are separate under `out/player-android-qa/map-handoff-smoke/<attempt>/`.

Optional `--measure-gestures` adds observed Save/Pass/Undo preparation and one bounded [package frame window](./mapPerformance.mjs). Its twelve issued inputs do not independently prove twelve committed decisions, and emulator samples cannot establish phone FPS or touch latency. Repeated initial swipe preparation failures remain unresolved; no accepted frame-window result is claimed. See the [current native QA record](../../../docs/agent/tasks/2026-10-13-player-map-native-qa.md) for actual outcomes and retained failures. Hosted map tiles, Apple Maps, production authentication and physical-device behavior remain separate checks.

### Historical baseline slice

[smoke.mjs](./smoke.mjs) is a manual Android engineering test. It uses Android's UI Automator accessibility hierarchy and ADB input commands, rather than Windows desktop automation. Every command targets only **`com.orbit.player.qa` on `emulator-5580`, ADB port `5039`**. Those identifiers cannot be overridden. The parent runner must first confirm the isolated emulator is offline and the standalone APK is ready.

October 20 account onboarding requires Firebase authentication. The fresh local-guest creation/restoration cases below describe historical reviewed artifacts; they cannot establish current first-use acceptance. Their APK/source fingerprint and offline gates remain unchanged. Current selector maintenance routes demo settings and Match preferences through Profile; current first-use offline coverage is the [Maestro credential-boundary flow](../../../player-app/.maestro/README.md), which stops before authentication. No native run was performed for this update.

```powershell
# Preparation/syntax only: does not invoke ADB.
node tests/e2e/player-android-qa/smoke.mjs
npx --no-install vitest run tests/e2e/player-android-qa/smoke.test.js

# Run only after parent confirmation of this guest and this exact QA artifact.
$env:ORBIT_QA_GUEST_OFFLINE_CONFIRMED = '1'
$env:ORBIT_QA_ADB_PATH = 'C:/Users/herob/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$env:ORBIT_QA_APK_SHA256 = '<parent-approved QA APK SHA-256>'
node tests/e2e/player-android-qa/smoke.mjs --run --install --fresh
```

Omit `--install` if the approved QA APK is already installed. `--fresh` clears only the QA package's synthetic local data; the full scenario begins at onboarding. A rerun after its local-profile scenario therefore needs `--fresh`. `ORBIT_QA_APK_PATH`, if used, must resolve inside ignored `out/player-android-qa`. Installation requires both an approved hash and `aapt` verification of the QA package and launcher. The script never reads or prints ADB keys: it supplies only the isolated key path and Android user home to child processes, and does not inherit host service credentials.

The task-specific `--run --resume-last-two` mode cannot install or clear data. It requires the fixed preserved `03-59-37-822Z` report's sixteen passing cases, expected permission-resource mismatch and restored settings, plus the exact final source and parent-approved artifact hash. It independently hashes the installed base APK before cold launch, verifies retained guest profile/manual origin and writes a separate linked two-case report. Other failures/artifacts cannot use this resume path. It accepts only the exact Android/Google resource namespace variants of the denial button inside the Google permission-controller package; grant controls and unrelated namespaces remain prohibited.

The separately reviewed `--demo-sanity` mode runs only three current-build checks: preserved guest entry and loaded demo Save; all four fictional venue/address/city rows; Reset and Exit preserving the guest. It rejects `--fresh` and `--resume-last-two`, requires the exact pinned rebuilt baseline/source hashes, checks the installed APK, freshly recomputes the original 128-file source with secret exclusions, and refuses all reverse mappings. Parent approval must be renewed when source/artifact pins change. It writes a new three-case report and never relabels the historical eighteen-case evidence.

```powershell
# Only after parent review of the mode's exact pinned baseline artifact/current source.
$env:ORBIT_QA_GUEST_OFFLINE_CONFIRMED = '1'
$env:ORBIT_QA_APK_SHA256 = '<parent-approved pinned baseline APK SHA-256>'
$env:ORBIT_QA_SOURCE_SHA256 = '<parent-approved pinned original source SHA-256>'
node tests/e2e/player-android-qa/smoke.mjs --run --install --demo-sanity
```

Before installation or every cold launch, the script checks emulator identity and boot status, airplane mode, disabled Wi-Fi/mobile data, empty IPv4 routing, no IPv6 default route, DOWN guest `eth0`/`wlan0`, and no active default network. It refuses app actions on a mismatch. Network/interface changes remain owned by the parent runner. Test-only OS theme, font scale and animation settings are restored in `finally`.

The intended scenarios exercise actual bundled native PlayerApp, onboarding and age declaration, demo catalog, two membership clubs and four published venue-list locations, native short/pass/save gestures, Undo, real Saved/details/back mode, demo operational notices, manual-origin validation and demo GPS suppression, reset/exit, both OS schemes, 150% native font scale, reduced motion and live scheme switching. Font scale is set before preview entry because Android may recreate an activity for that configuration change. Cold launches check that demo history is ephemeral and that a local guest's profile, Match preferences and manual origin restore through actual device storage. A local-guest permission case requests location permission and taps only the exact Google Android permission-controller **Don't allow** button for the QA app's location request; it never grants permission or reads a physical fix, and checks that the manual origin survives the failure. Other OS actions fail closed. No sign-in, account creation, ID verification, check-in, payment or hosted mutation is exercised.

Screenshots, accessibility evidence, startup timing and package-scoped `gfxinfo` remain ignored under `out/player-android-qa/smoke/`. Each attempt gets a separate directory, with `results.json` at the root pointing to the latest attempt. Native images require review; UI hierarchy geometry alone does not establish painted contrast or unclipped glyphs. Emulator startup/frame observations do not establish physical-device 60 fps. Invalid synthetic Firebase/Maps configuration and unreachable API endpoints prevent interpreting this run as connected auth, hosted tiles, real waitlist authorization, a customer test account or a pilot. See [the task record](../../../docs/agent/tasks/2026-10-12-player-android-smoke.md) for actual results, failed attempts and pending scenarios.
