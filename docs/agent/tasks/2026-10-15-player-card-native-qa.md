# Compact game cards: isolated native Android verification

This follows the [game-card redesign](2026-10-15-player-game-card-redesign.md) and the full Orbit Match acceptance review. It adds current-source native presentation evidence for the user's restored colorful cards and opt-in details. It does not replace the pending new iPhone installation/layout feedback or the real-account/real-venue pilot gates.

## Fixed scope and isolation

The reviewed source is `ac6e6c5c36551e391c41fad27c4e9437ad08743a19bd286fbf0e6d402e29b076`, 129 authored inputs. The 28-file source/test guard also verifies unchanged root HEAD/index and empty staging. Root remains on `docs/desktop-release-0.1.79-evidence`, HEAD `9680ee0dccd73405ea38964df6796e19c94e3a69`.

Only the existing synthetic `com.orbit.player.qa` application is in scope, on the owned headless `orbit_match_qa` emulator at serial `emulator-5580`, private ADB port 5039 and guest ports 5580/5581. The fixture uses an invalid synthetic Firebase project, API `http://127.0.0.1:9`, disabled sync and App Check, no dotenv and a clean OS environment allowlist. Native runtime checks additionally require disabled guest networking, no default routes, no reverse mappings, a sole target and fresh process/birth/parent/executable/argument/listener ownership. No production service, account, message, signing enrollment or deployment is accessed.

## Preparation and attempts

- Read-only preflight passed at 2026-10-15T10:27:44.533Z, including current idle tools/ports and preserved prior evidence.
- Explicit preparation passed at 10:31:03.069Z. It preserved the prior CF/128 source, 175 copied inputs, APK `a031c93d`/45,809,559 bytes and both metadata records before copying current source. Exactly six app files changed and `eventCardStyles.ts` was added; all 45 native inputs and four synthetic overlays remained unchanged.
- The new 176-input fixture digest is `af95c608fd9f1113f138355f729e54d6e41b0fb123603fc84870d6f8fe4dc635`. Evidence is under the ignored `out/player-android-qa/offline-game-card-redesign-handoff-2026-10-15/`; prior dated reports remain in place.
- First offline Gradle attempt: 10:31:22.962Z–10:32:41.305Z, exit 1. Ninja rejected a generated React Native header path longer than 260 characters in the copied app and Expo modules C++ caches. No new APK was approved. The failed build record and log are preserved.
- A separate read-only inspection confirmed precisely `project/player-app/android/app/.cxx` and `project/player-app/node_modules/expo-modules-core/android/.cxx` as ordinary link-free contained generated trees. Fresh idle counts were zero and private ports were closed. The explicit cleanup completed at 10:35:51.917Z, preserving current 176 inputs, prior 175 inputs/APK/metadata, failure evidence, prior reports and the root index. No retry was bundled with cleanup.
- The unchanged offline rebuild passed, 10:36:13.240Z–10:41:01.022Z, exit 0. The new APK is `25bde78f9f3a92eadb59905fe2ca7d475fc588dec4a6d7efc1d4fd22b77a2518`, 45,817,887 bytes. All seven compiled synthetic-project/unreachable-API/no-network-security-override/no-cleartext checks passed. Existing CMake path warnings and Gradle deprecation warnings remain. Root independently rehashed the APK and frozen helper bytes before binding the new runtime approval pins. No interaction pass was inferred from compilation.
- Fresh owned guest/network checks and the exact prior-to-new installed APK comparison passed. The first native scenario attempt, 10:45:51.901Z–10:46:44.665Z, failed **0/6 checks** at cold launch before any demo tap because Android displayed **System UI isn't responding**. Root reviewed the captured exact Android title/Wait/Close dialog, XML and screenshot. The report and failure captures are preserved under `out/player-android-release-game-card-redesign-qa/disclosures-2026-10-15T10-46-09.575Z/`; display settings were restored. The separate recovery below does not convert this attempt into a pass.
- The separately reviewed one-shot System UI recovery passed, 10:48:27.559Z–10:49:28.447Z. It bound the exact failed report and current source/APK/fixture, checked current ownership/offline state and installed bytes before/after, and tapped only the exact Android Wait button once. The modal disappeared; before/after captures, the failure and recovery report remain preserved. No settings/services/data changes or force-stop were part of recovery. Root reviewed the after-action image.
- The unchanged scenario's separate second attempt passed **one case/all six checks**, 10:49:40.517Z–10:59:51.971Z, with original display settings restored. Its report and 20 PNG/XML capture pairs are under `out/player-android-release-game-card-redesign-qa/disclosures-2026-10-15T10-49-56.385Z/`. This is a separately recorded pass after the preserved failure/recovery, not an uninterrupted first-attempt pass.

Commands were invoked separately after review: `node out/prepare-offline-game-card-redesign-handoff.mjs --preflight`, `--prepare`, `--build`; then `node out/clean-game-card-redesign-generated-cxx.mjs --inspect`, `--run`; then the same preparer's `--build`. Gradle uses existing caches with `--offline --no-daemon --max-workers=2`, x86_64 only, and SDK downloads disabled. No dependencies or toolchain versions change.

## Scenario and verification boundaries

Twelve helper syntax checks and eight pure selection/approval guards passed, most recently at 10:35:13.539Z. They reject absent pins, foreign/OS controls, ambiguous controls, clipped/undersized bounds and a TextView child incorrectly treated as the disabled Undo button. An independent read-only review found no boundary weakening in the runtime chain.

The bounded native case passed compact Match/Game info; explicit Save/Pass and Undo; cash Structure/Rules/request disclosure and explicit demo Continue; tournament Structure/Rules/Request and explicit demo Express interest; reset; and a dark/150% compact Match presentation. Every action is allowlisted against the actual fictional package control and bounds. OS dialogs terminate the case; no recovery or automatic retry is allowed inside it. Display settings were restored in `finally`.

Root reviewed the actual compact/expanded Match, cash overview/Structure/Rules, event overview/Structure/Rules/Request and dark/large-text captures. Independent review additionally checked request/demo-guard and reset semantics in the exact XML: only the selected section is open, requests remain separate explicit controls, the notices stay fictional, and the actual Undo Button is disabled after reset. No primary card label/action clipping was found in these bounded views. Lower expanded explanations continue in the scroll view; no painted-legibility claim is made for content outside a particular capture.

The dark/large-text phase deliberately cold-launches, re-enters and resets the in-memory demo after changing font scale. The generated activity handles `uiMode` but not `fontScale`, so this is presentation evidence rather than continuity across Activity recreation. This case does not measure gestures, frames, physical readers, iOS Dynamic Type, secure persistence or any server confirmation.

The exact shipping source already passed `npm run verify` at 10:06:42.324Z, all 13 gates, including 2,089 root tests, Web 209 and sales 85; 16 emulator-dependent root tests were skipped. This follow-up changes no shipping source or test bytes. The existing full verification is not relabelled as a new execution.

Root work remains uncommitted and unpushed. New helper files, build outputs, logs and runtime records remain ignored. The full goal is active; this record makes no pilot-readiness claim.

## Closure and final review

The exact owned guest/wrapper/QEMU and private ADB server closed gracefully. The final read-only closure audit passed at `2026-10-15T11:01:34.467Z`: all four recorded PIDs are absent and ports 5039/5580/5581 have no listeners. Keys, guest data, APKs, source snapshots and all attempt/capture evidence remain preserved. No old PID was used as current ownership authority.

The final 28-file source/test and root HEAD/index guard passed again after native QA. `git diff --check` passed, retaining existing LF/CRLF notices. The native follow-up changes only task-local documentation and ignored local helpers/evidence; no shipping source, API/schema/rules, dependency, signing configuration or production state changed.

The final audit at 11:03:17.256Z independently verified the exact APK, all 176 copied inputs, the preserved first failure and five prior reports, the separate recovery, six passing native checks, 20 captures and closure. All 66 local link occurrences across six reviewed documents resolve to 44 unique targets. Final Git status is 97 modified and 98 untracked entries, zero staged, unchanged HEAD/index; the extra untracked entry is this task record. No root commit or push occurred.
