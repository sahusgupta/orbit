# Orbit Player SDK 58 production preparation — October 27, 2026

The user requested a production iOS artifact for App Store Connect. After distinguishing that request from the pasted development-client instructions, the user selected completion of the existing SDK 58 upgrade and an EAS **cloud production build**. The user requires a separate confirmation before any build starts. No development client, local iOS compilation, remote build, signing operation, App Store upload, or application-service deployment is authorized by this preparation record.

## Source and scope

The initial checkout was `main` at `0e15c11`, four commits ahead of `origin/main`, with existing modifications to `player-app/package.json` and `player-app/package-lock.json` upgrading Expo 57 to 58. The non-destructive branch `codex/player-ios-sdk58-production` preserves those commits and edits. No commit, push, pull request, or history rewrite was performed.

Preparation aligns Expo with `58.0.20` and Camera with `58.0.13`, the patches required by Expo's actual compatibility check. Constants `58.0.13`, Crypto `58.0.7`, Location `58.0.19`, and Splash Screen `58.0.11` retain exact release pins. React Native remains the user's SDK 58 selection `0.88.0`. The production profile pins stable `macos-tahoe-26.6-xcode-27.0` (Xcode 27.0 / `27A266a`) rather than an advancing alias. [Expo infrastructure](https://docs.expo.dev/build-reference/infrastructure/), [SDK 58 migration guidance](https://expo.dev/blog/how-to-upgrade-to-sdk-58).

The production identity remains `com.caminuslabs.orbit`, version `1.0.0`, project `@saussy/tabletalk-player`; store distribution, physical-device targeting, remote build-number increments, commit requirements, disabled product features, App Check, permissions, and privacy checks are preserved. The installed repository EAS CLI is `23.2.0`, Node is `22.16.0`, npm is `10.9.2`, and `whoami` confirmed access to the intended Expo owner. No credentials or account tokens were read or copied.

SDK 58 makes React Native's strict instance types the default. The ScrollView ref now uses `ScrollViewInstance`. The native app-state adapter preserves all supported states and `null`, normalizes an unset state to `null`, and maps an unfamiliar native string to the existing inactive-polling `unknown` state. No persistence, authentication, API, or sync protocol changed.

## Evidence and initial failures

- Initial `npm run player:release:verify`: exit 1, six SDK 57 dependency assertions mismatched the user's SDK 58 selections. The corresponding exact assertions now target the SDK 58 selections, with all security checks retained.
- Initial `npm run player:expo:check`: exit 1, Expo requested the two patches listed above.
- Initial `npm run player:typecheck`: failed with three diagnostics at the app-state and ScrollView boundaries. These are fixed by the narrow adapter/type changes above.
- Before implementation, known app-state characterization and existing lifecycle/location tests passed (3 files, 23 tests). The new undefined/unfamiliar-state cases failed against the old adapter, then passed after the fix.
- Post-fix `npm run player:typecheck`: passed. Four focused files, including `PlayerApp.demo`, passed all 95 tests.
- Existing release configuration and artwork tests passed 28/28 before and after the version/image changes.
- `npm run player:release:verify` and `npm run player:config:verify`: passed after alignment; resolved production permissions and entitlements remain checked.
- The exact Expo installation command was `npx expo install expo@58.0.20 expo-camera@58.0.13 expo-constants@58.0.13 expo-crypto@58.0.7 expo-location@58.0.19 expo-splash-screen@58.0.11 --npm`, with dotenv/telemetry disabled and exact npm saves enabled. `expo-dev-client` was not installed because the user selected production.

Additional checks completed after dependency alignment:

- `npm ci --prefix player-app`: exit 0, 607 packages installed; the Player lock remains SHA-256 `f5f65f63e284fe2710a013a8471a0d5ec553552a4e7a7fa3e4f919ee01002228`.
- `npm run player:expo:check`: passed, dependencies up to date.
- `npm run player:expo:doctor`: passed, 20/20 checks. Log: `out/player-sdk58-production-20261027/expo-doctor.log`.
- `npm run player:codegen:ios`: passed on Windows, including the required ReactCodegen and dependency-provider artifacts. Log: `out/player-sdk58-production-20261027/windows-ios-codegen.log`.
- An independent source/security diff review found no new actionable findings. All 130 changed/new lock records use the public npm registry and resolved entries have integrity metadata. No advisory policy or security validator was changed.

`npm run player:export:ios` passed the Hermes export, inspectable JavaScript/source-map scan (3 inspectable files and 19 binary assets), and actual EAS `export:embed` path/scan (2 inspectable files and 19 binary assets). Log: `out/player-sdk58-production-20261027/ios-export.log`. `npm run player:config:verify` passed again after the native compatibility plugin was wired.

The first isolated Linux iOS prebuild exposed an actual native integration regression: the installed RN Firebase 26.4 plugins could not locate SDK 58's scene-based startup anchor, warned that initialization was skipped, and failed the unchanged native App Check ordering assertion. This was not treated as an obsolete check. RN Firebase 27.1 has a compatible anchor but also [migrates to Swift Package Manager/dynamic frameworks](https://github.com/invertase/react-native-firebase/blob/v27.1.0/docs/migrating-to-v27.mdx), so this task retains the reviewed 26.4 CocoaPods/static integration and repairs only startup insertion through the [focused config plugin](../../../player-app/plugins/with-firebase-scene-initialization.cjs). Characterization covered the existing SDK 57 imports, single initialization, ordering, and bridging header before the SDK 58 regression/fix. The generated-native run below confirms real plugin execution order; fixture tests alone do not establish it.

Final native verification passed on isolated Linux with official checksum-verified Node `22.16.0`, npm `10.9.2`, sanitized environment, fresh HOME/cache, and Expo offline mode:

- `npm ci` in the isolated Player source: exit 0, 609 packages; lock unchanged.
- `node scripts/run-player-prebuild.mjs`: exit 0, including the unchanged provider-before-Firebase invariant and strengthened executable-statement/count/bridge/startup checks.
- `node scripts/run-player-codegen.mjs`: exit 0.
- Separate `expo prebuild --platform ios --no-install`: exit 0. Generated output has exactly one provider registration and Firebase configuration, in that order before delegate creation; exactly one quoted bridge import; a scene manifest referencing `$(PRODUCT_MODULE_NAME).SceneDelegate`; and the generated scene delegate extends `ExpoAppSceneDelegate`.
- Focused initialization/config/native tests: 69 passed. Unknown templates, duplicate/partial/reversed or non-executing initialization fail closed. Existing SDK 57 output is preserved.
- All 229 allowlisted source files matched canonical bytes with zero drift. Manifest SHA-256: `69c13635ecce9fe297e5dc4d17033e4c93c50998396fd47f503a0178d90fd5e5`.

Native proof and logs are saved in `out/player-sdk58-production-20261027/`: `linux-native-results.json`, `linux-source-manifest.json`, `linux-prebuild.log`, `linux-codegen.log`, and `linux-scene-prebuild.log`. The first failed prebuild's original `/tmp` directory disappeared unexpectedly before its logs were retained; only its actual tool output is claimed. The successful final check used a new `/var/tmp` directory and persisted its evidence onto Windows. Source files were frozen after that run. No CocoaPods installation, Xcode compilation, signing, or real attestation was performed.

The first aggregate `npm run verify` exited 1 with 12 summary checks passing and the unit-test check failing. It encountered `Timed out waiting for the isolated API` in unchanged `apps/api/src/server.routes.test.js`: 253 files passed, one failed, one skipped; 2,299 tests passed, with 12 route tests skipped by the failed setup and 16 other skips. This timeout is not relabeled a pass or established as pre-existing. The unchanged focused retry `npx vitest run apps/api/src/server.routes.test.js` passed all 12 tests. No timeout or assertion was modified.

The final, settled-source `npm run verify` **exited 0 with all 13 summary checks passing**. The main suite passed 254 files and 2,311 tests, with one file/16 tests skipped by existing integration conditions; Player Web passed 209 tests; the sales map passed 85 tests. Root/Player/Web/sales-map TypeScript, Web lint, release/artwork checks, and all three builds passed. Existing renderer chunk-size/ExcelJS build warnings remain. Logs: `out/player-sdk58-production-20261027/verify.log` (initial failure), `api-routes-retry.log` (passing unchanged retry), and `verify-final.log` (passing final aggregate).

Final `check:independent-locks`, `audit:module-graph`, and `check:release-controls` passed. The graph reports 276 files, 856 relative edges, and zero cycles, boundary violations, or unresolved relative imports. Final `security:dependencies` still exits 1 at the unchanged October 22 policy-expiration guard; the separate Player audit remains 3 High/5 Low/zero Critical. This gate is outside the 13-check aggregate and has not been bypassed. New local documentation links and `git diff --check` pass.

Local checks use deliberately unreachable loopback application APIs, disabled synchronization/browser App Check, and disabled telemetry. Production Expo config/export and native generation inspect authored configuration without connecting to the configured production application or Firebase services.

## Release blockers and remaining boundaries

The [dependency review](../reviews/2026-10-27-player-sdk58-dependencies.md) records the actual current audit: 3 High, 5 Low, zero Critical, arising from Zod and Deepmerge in Expo tooling. Node Forge resolved to `1.4.2`; its finding disappeared. `npm run security:dependencies` fails because the existing policy expired on October 22. No exception, deadline, severity check, or audit visibility was changed. This preparation does not approve the new advisories or declare the source ready for a production build.

The source remains uncommitted on the preparation branch and includes the four original local commits not yet on `origin/main`. The repository requires exact pushed-source CI/native evidence before a cloud build. Commit/push/PR and a current security disposition require their own explicit scope; no such action was inferred from build preparation.

The primary machine is Windows. Expo documents iOS local compilation as requiring macOS/Xcode. Ubuntu WSL is available but has no Node on its initial PATH; initial read-only Node lookups failed. A generated iOS project/code-generation check in Linux is separate from compiling/signing an IPA and cannot establish Apple trust or physical-device acceptance. Existing simulator CI selects Xcode 26.6, which meets SDK 58's documented minimum but is not evidence for the selected production Xcode 27 image.

Before any actual build, resolve the security/source gates, inspect the exact EAS source archive for source identity and excluded sensitive/generated paths, confirm the intended Apple signing team and Expo capacity, and obtain the user's requested build confirmation. The later finished IPA still needs signed-archive/privacy inspection and TestFlight device acceptance before App Review. No final production build ID or IPA is claimed here.

The prepared cloud command, from the reviewed checkout's `player-app` directory, is `node ../node_modules/eas-cli/bin/run build --platform ios --profile production`. It was **not run**. No development server or simulator was started for this production preparation.

Initial preparation handoff Git state: `codex/player-ios-sdk58-production`, 15 modified and four new task files, zero staged paths; no new commit, push, PR, build, upload, or deployment at that handoff.

## Accepted risks and CI preparation follow-up

The user subsequently instructed: "Accept the documented Expo tooling risks for this release, commit and push the branch, and open a PR for CI. Once CI passes, ask me before starting the production iOS build." This explicitly authorizes the bounded dependency disposition and Git/PR operations; it does not authorize merging, deployment, an EAS production build, or App Store submission.

The Player exception is now limited to the eight exact package versions, severities, transitive relationships, and two advisory origins in the [updated review](../reviews/2026-10-27-player-sdk58-dependencies.md), with mandatory re-review by November 3. The validator still forbids Critical findings and rejects new origins, versions, or severity changes. Root, API, and Player Web have no exceptions. Existing characterization passed 7/7 before the validator change; updated focused tests passed 19/19 afterward.

Fresh all-scope production audits exposed additional findings outside that acceptance: root Vite/Nodemailer, API Body Parser/QS/Vercel-Zod, and Critical Next.js in Player Web. The gate correctly rejected them. After a scope question citing the repository's dependency-remediation requirement, the user explicitly selected "Apply compatible security fixes." The [separate security patch review](../reviews/2026-10-27-ci-security-patches.md) records exact patched selections and subsequent validation. These findings are being remediated rather than added to the policy.

The PR includes the four existing local commits for membership-wallet presentation, sample-content isolation, supporting documentation, and screen-copy cleanup, followed by the SDK 58 preparation and accepted security work. Those existing commits are preserved without history rewriting. The target is `main`. Repository-defined pull-request workflows perform Linux verification, isolated Windows desktop mutation/focus checks, and unsigned iOS simulator QA; they do not launch an EAS production build or App Store upload. No merge or manual publishing workflow is requested.

Post-remediation local validation actually completed:

- `npm run verify`: exit 0, all 13 checks passed; 254 main-suite files / 2,323 tests passed with the existing one file / 16 tests skipped; Player Web 209 tests and sales-map 85 tests passed. Log: `out/player-sdk58-production-20261027/verify-accepted-security.log`.
- `npm run security:dependencies`: exit 0. Root, API, and Player Web each report zero production findings. Player reports only the eight explicitly accepted entries (3 High / 5 Low / zero Critical); mandatory re-review remains November 3.
- Player Web standalone TypeScript, lint, 20 files / 209 tests, clean install, and production audit passed after the Next/lint pair update. Full development-dependency audit findings are distinguished in the security patch review.
- The full API/email regression passed 50 files / 460 tests; the actual Vercel `waitUntil` / pure schema boundary passed before and after the scoped Zod override. Root and API clean installs passed without modifying their lockfiles.
- `check:release-controls`, `check:independent-locks`, documentation paths, and whitespace checks passed. Independent source reviews found no actionable issues in the native compatibility fix, scoped risk policy, or security patch selections.
- The primary-workspace `npm run security:paths` exited 1 for three ignored local artifacts (a pilot signing-key path and Firebase debug logs). Their contents were not read, copied, moved, modified, or staged. `git ls-files` confirms these paths are untracked, and `git check-ignore` confirms the existing ignore rules cover them. No ignore or scan rule was changed. The identical guard must run on a fresh archive of the committed, tracked source before push; its result is reported with the PR. The workspace failure is not relabeled a pass.

The reviewed change contains 29 intended staged files; generated output, logs, dependencies, environment files, and local sensitive-looking artifacts are excluded. Commit/push/PR and CI outcomes are reported by the enclosing chat and PR rather than predicted here. Production EAS build confirmation remains a separate required user step after CI passes. No production iOS build or App Store upload was started during this preparation.

## First PR CI result and filter correction

Commit `32a4eef9abc805479013c8c05e1a5765783c015d` was pushed and [PR 36](https://github.com/sahusgupta/orbit/pull/36) opened against `main`. The sensitive-path guard passed on a fresh Git archive of that commit, with none of the three ignored local artifacts included. GitGuardian passed all five commits, and the Windows desktop job passed. [Linux CI 40617170330](https://github.com/sahusgupta/orbit/actions/runs/40617170330) passed the complete dependency, verification, iOS export/prebuild/codegen, emulator, management, and public-site gates, then failed its final Player Web smoke on two assertions: the combined game-filter empty state and removal of a closed tournament. This failure was investigated rather than skipped or waived.

The unchanged full local smoke passed, so a separate ignored diagnostic used the exact isolated fixture flow with 4x browser CPU throttling and no history instrumentation. In one game attempt, selecting status after searching permanently changed `/games?q=PLO` into `/games?status=running`, dropping the query; the wrong state remained after the original two-second bound and a further diagnostic-only ten seconds. The remaining five game/tournament observations initially saw old DOM and reached the correct state within two seconds. Before this conclusive run, an instrumented diagnostic timed out without retained snapshots and was treated as inconclusive. A test-authoring TypeScript error from an unsupported RTL query option was corrected before the final typecheck; it was not an application failure.

All three discovery explorers cloned a possibly pending `useSearchParams` snapshot. The focused fix reads the current same-route browser query when composing an event-handler update and retains the snapshot only if the browser has moved to another route. Rendering continues to use Next's query state. No filter predicate, query key, request, authentication, history-replacement, clearing, or hash behavior changes. Three regression cases held Next's snapshot behind the browser URL and failed before the fix, then passed for games, clubs, and tournaments.

The smoke now requires both `q=PLO` and `status=running` and waits for the actual unique visible empty state. It also waits for the closed-event heading count to reach zero before checking the retained open event. Both DOM waits use the existing two-second bound; the original failure conditions and no-route-request checks remain enforced. No global timeout or assertion was weakened.

Post-fix evidence: 113 focused tests passed; standalone Web typecheck/lint, smoke syntax, and independent source/React review passed; the complete Web suite passed 21 files / 217 tests. The full isolated production browser smoke passed all 15 routes across six viewports, with 90 screenshots, 44 interactions, and zero failures. Ignored evidence includes `filter-transition-diagnostic-v2.json`, `web-filter-all-tests.log`, and `web-e2e-filter-fix.log` under `out/player-sdk58-production-20261027/`. The final follow-up remains subject to the new-head CI run; local passing results are not relabeled as CI success. Player/native sources and dependencies are unchanged by this Web-only correction.

The identical 4x CPU diagnostic was then rerun after the fix with only its output filename changed, verified by a source-equality assertion. All three game cases retained both query parameters; all three tournament cases removed the closed event and retained the open event; all six reached the correct DOM within the original two-second bound, with no ten-second fallback or page errors. Immediate DOM reads were still stale in all six cases, independently confirming the need for the stronger smoke synchronization. Before/after evidence is retained in `filter-transition-before-after-proof.json`; the original diagnostic files were preserved.
