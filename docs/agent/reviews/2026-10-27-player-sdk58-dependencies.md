# Player SDK 58 dependency review — October 27, 2026

The user authorized completing the existing Expo SDK 58 upgrade and preparing a production EAS cloud build, with a separate confirmation before starting the build. After reviewing the two Expo-tooling risks documented below, the user explicitly accepted those risks for this release and authorized a bounded policy update, commit/push, and pull-request CI. The acceptance does not authorize starting a build before the user's separate confirmation and does not establish signed-build readiness.

## Reviewed dependency state

The starting working tree already upgraded Expo 57 to 58, React Native `0.86.3` to `0.88.0`, React/React DOM `19.2.3` to `19.3.0`, and the corresponding Expo/native modules. Preparation aligned the two packages reported by Expo's compatibility check and preserved exact release pins for the modules checked by Orbit's release verifier:

| Package | Current declaration |
| --- | --- |
| Expo | `58.0.20` |
| Expo Camera | `58.0.13` |
| Expo Constants | `58.0.13` |
| Expo Crypto | `58.0.7` |
| Expo Location | `58.0.19` |
| Expo Splash Screen | `58.0.11` |
| React Native | `0.88.0` |
| React / React DOM | `19.3.0` |

See the upstream [SDK 58 release notes](https://expo.dev/changelog/sdk-58), [upgrade guidance](https://expo.dev/blog/how-to-upgrade-to-sdk-58), and [native-module recommendations](https://github.com/expo/expo/blob/sdk-58/packages/expo/bundledNativeModules.json). Native compiler, strict TypeScript, scene lifecycle, and permission validation remain separate evidence boundaries.

At this review, `player-app/package-lock.json` has 628 package records and SHA-256 `f5f65f63e284fe2710a013a8471a0d5ec553552a4e7a7fa3e4f919ee01002228`. The relevant resolved packages are Expo `58.0.20`, nested Expo CLI `58.1.16`, Expo Config `58.0.8`, Local Build Cache Provider `58.0.8`, Metro Config `58.0.18`, Prebuild Config `58.0.16`, Zod `3.25.76`, Deepmerge `4.3.1`, and Node Forge `1.4.2`.

## Current advisories

Before the patch installation, `npm audit --omit=dev --json` from `player-app` returned exit 1 with nine affected package entries: four High, five Low, and zero Critical. After installation, the same command returned exit 1 with **eight affected entries: three High, five Low, and zero Critical**. Counts include propagated parent-package findings, rather than eight independent originating vulnerabilities.

| Origin | Current evidence | Available remediation |
| --- | --- | --- |
| [Zod — GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | High; `zod@3.25.76`; affected range `<4.6.6`; oversized validation input can exhaust memory. | Advisory identifies `4.6.6` as patched; the registry's current latest is `4.6.7`. Expo CLI declares `^3.25.76`; the newest published stable 3.x is `3.25.76`. A forced major-version override is not a verified compatible fix. |
| [Deepmerge — GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | Low; `deepmerge@4.3.1`; affected range `4.2.0`–`4.3.1`; crafted merge input can poison a returned object's prototype. | The current advisory lists no patched release; npm's latest is `4.3.1`. Expo Config declares `^4.3.1`. No compatible published patch was found. |

The eight current affected names are `@expo/cli`, `@expo/config`, `@expo/local-build-cache-provider`, `@expo/metro-config`, `@expo/prebuild-config`, `deepmerge`, `expo`, and `zod`.

Two previous findings have different current dispositions:

- Node Forge moved from `1.4.0` to `1.4.2` within its parents' `^1.4.0` range and is absent from the fresh audit findings. The [upstream changelog](https://github.com/digitalbazaar/forge/blob/v1.4.2/CHANGELOG.md) records the ASN.1 DigestAlgorithm signature-forgery correction in `1.4.1` and a PEM-input compatibility repair in `1.4.2`. No new override was required.
- The [Braces advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was withdrawn on October 23, 2026 as not practically exploitable. Braces remains `3.0.3`; the current audit does not report it. This is an upstream advisory withdrawal, not evidence of a package patch.

## Reachability and release boundary

`npm ls node-forge zod deepmerge --all` confirms that Zod belongs to Expo CLI, Deepmerge belongs to Expo Config, and Node Forge belongs to Expo CLI and its code-signing helper. Inspection of the installed CLI finds Zod in development-tool plugin and MCP command schemas. Expo Config invokes Deepmerge while combining authored configuration, update configuration, and plugin options. A source search found no imports of `zod`, `deepmerge`, `node-forge`, `@expo/config`, or `@expo/cli` in `player-app/src`.

These observations place the inspected paths in build/development tooling; they do not prove that all package entrypoints are unreachable or authorize an exception. A fresh production export and the existing bundle scanner must independently inspect the actual runtime graph. Controlled repository configuration is relevant to the merge-input boundary, and development tooling must not accept untrusted plugins or large external schema inputs on the strength of this review.

Initially, `config/dependency-audit-policy.json` expired on **October 22, 2026**, and `npm run security:dependencies` failed at that expiration guard before running its scope audits. The old SDK 57 package/version list and originating advisories did not cover the current findings.

The subsequent explicit user acceptance is limited to the following Player packages, exact locked versions, exact per-package severities, and the two originating advisories listed above:

| Player package | Accepted locked version | Accepted severity |
| --- | --- | --- |
| `@expo/cli` | `58.1.16` | High |
| `@expo/config` | `58.0.8` | Low |
| `@expo/local-build-cache-provider` | `58.0.8` | Low |
| `@expo/metro-config` | `58.0.18` | Low |
| `@expo/prebuild-config` | `58.0.16` | Low |
| `deepmerge` | `4.3.1` | Low |
| `expo` | `58.0.20` | High |
| `zod` | `3.25.76` | High |

The policy now references this review and expires on **November 3, 2026**, seven days after the October 27 acceptance. The validator preserves the legacy High-only default for entries without an explicit severity review and requires equality with any explicit per-package severity. It rejects severity drift, new names, different locked versions, new originating advisories, missing evidence, and unreviewed transitive chains. Critical package or origin severity is rejected even if someone attempts to list it as reviewed. Root, API, and Player Web retain zero exceptions. This is release-specific acceptance of the documented residual tooling risks, not an assertion that the vulnerabilities are fixed or general permission to accept other risks.

A fresh all-scope audit after the acceptance found additional, unaccepted findings in root dependencies (Vite and Nodemailer), the API (Body Parser, QS, and the Vercel/Zod chain with propagated parent entries), and Player Web (Critical Next.js advisories). The first policy-gate run after the bounded update accepted the exact Player findings but correctly failed these other scopes, including Critical Next.js. The user separately authorized compatible remediation of those findings; that remediation and the final aggregate audit result belong to the enclosing preparation task. No additional exception was added here.

## Packaging and checks actually performed

- `npm run check:independent-locks`: passed; no API, Player, or Player Web parent `table_manager` dependency or installed parent copy was found.
- `npm run audit:module-graph`: passed; 276 files, 856 relative edges, zero cycles, boundary violations, or unresolved relative imports; all 17 Electron runtime files were included by existing packaging rules.
- `npm run check:release-controls`: passed; existing release/CI controls remain present. This static result does not override the failed dependency-security gate.
- `npm run security:dependencies`: initially failed at the expired-policy guard; after the explicit bounded acceptance, it processed all scopes, accepted the exact eight Player entries, and failed the additional unaccepted root/API/Web findings described above. This does not record the later remediation's result.
- `npm audit --omit=dev --json` from `player-app`: failed with the current eight findings above.
- `npm ls node-forge zod deepmerge --all`: passed and confirmed the resolved tooling paths.
- `npx --no-install vitest run scripts/dependency-review-constraints.test.js`: seven existing characterization tests passed before the policy-validator change; all 19 tests passed afterward, covering explicit Low acceptance, severity drift, new origins, version changes, missing evidence, cross-scope isolation, and unconditional Critical rejection.
- No `.easignore` exists at the repository root or in `player-app`; EAS source selection therefore relies on the existing Git ignore rules. A tracked-path scan for environment, private-key, credential, and signing patterns returned only the four `.env.example` template paths. No template or credential contents were inspected by that scan. This is not a complete EAS archive inspection; inspect the exact build archive and its authored-source identity before submission.

The enclosing preparation task owns aggregate `npm run verify`, Expo checks/export, native generation, the post-remediation aggregate audit, and final diff/status evidence. This review does not assign results to checks it did not execute. Only the explicit bounded Player acceptance above was implemented by this audit; no cloud build started, signing credentials accessed, production application service called, or App Store upload performed.

## October 28 compatible patch refresh

The subsequent release preparation at committed source `758227d` encountered Expo's live compatibility check requiring seven newer SDK 58 module patches. This section records the resulting same-SDK refresh; the October 27 observations above remain historical. The current Expo [module recommendations](https://github.com/expo/expo/blob/sdk-58/packages/expo/bundledNativeModules.json) and [Expo 58.0.21 release notes](https://github.com/expo/expo/blob/sdk-58/packages/expo/CHANGELOG.md) additionally require React Native `0.88.1`. The new Camera, Font, Location, and Expo Modules Core iOS binaries are rebuilt against that React Native patch, so leaving the previous `0.88.0` pin would not complete compatibility alignment.

| Direct dependency | Prior locked selection | Refreshed exact selection | Primary release evidence |
| --- | --- | --- | --- |
| Expo | `58.0.20` | `58.0.21` | [Runtime/tooling dependencies and RN alignment](https://github.com/expo/expo/blob/sdk-58/packages/expo/CHANGELOG.md) |
| Expo Asset | `58.0.18` | `58.0.19` | [Constants and image-utils dependency updates](https://github.com/expo/expo/blob/sdk-58/packages/expo-asset/CHANGELOG.md) |
| Expo Camera | `58.0.13` | `58.0.14` | [Precompiled iOS binary rebuild](https://github.com/expo/expo/blob/sdk-58/packages/expo-camera/CHANGELOG.md) |
| Expo Constants | `58.0.13` | `58.0.14` | [Require-utils dependency update](https://github.com/expo/expo/blob/sdk-58/packages/expo-constants/CHANGELOG.md) |
| Expo Font | `58.0.10` | `58.0.11` | [Precompiled iOS binary rebuild](https://github.com/expo/expo/blob/sdk-58/packages/expo-font/CHANGELOG.md) |
| Expo Location | `58.0.19` | `58.0.20` | [iOS rebuild and Android background-service fixes](https://github.com/expo/expo/blob/sdk-58/packages/expo-location/CHANGELOG.md) |
| Expo Splash Screen | `58.0.11` | `58.0.12` | [Config-plugin and image-utils dependency updates](https://github.com/expo/expo/blob/sdk-58/packages/expo-splash-screen/CHANGELOG.md) |
| React Native | `0.88.0` | `0.88.1` | [Native/JSI, layout, and iOS fixes](https://github.com/react/react-native/releases/tag/v0.88.1) |

The inherited application configuration still disables background location and keeps the existing foreground-only permission boundary. This dependency refresh does not enable the background services mentioned by upstream Location release notes. React/React DOM `19.3.0`, Firebase native packages `26.4.0`, Maps `1.29.11`, Node/npm `22.16.0`/`10.9.2`, and EAS CLI `23.2.0` remain unchanged. The already reviewed `re2js@2.8.7` leaf correction is preserved.

Relevant transitive changes include Expo CLI `58.1.17`, Config `58.0.9`, Config Plugins `58.0.11`, Local Build Cache Provider `58.0.9`, Metro Config `58.0.19`, Prebuild Config `58.0.17`, Modules Core `58.0.28`, JSI `58.0.21`, Modules Macros `0.27.1`, and the React Native/Hermes dependency family. Upstream [Modules Core notes](https://github.com/expo/expo/blob/sdk-58/packages/expo-modules-core/CHANGELOG.md) describe native macro/event handling and inspector repairs; [Modules CLI 0.4.0](https://github.com/expo/expo/blob/sdk-58/packages/expo-modules-cli/CHANGELOG.md) adds Swift macro inspection commands. These are real native/tooling changes, not a claim of byte-identical runtime output. Fresh export, generated-native, compiler, and device evidence remain necessary.

The settled Player lock has 627 records and SHA-256 `519da33c2be26a1f5bf102fd3a206eb868f3440388441b7818ecc13c1ddc78e5`; the prior committed lock hash was `fcba9820f1d13c9bff1efa95fea7d3e004981d909b284956522a198a7289f5bd`. Comparing with `HEAD` found 52 changed/new-path records, including 44 version changes at retained paths and dependency hoisting moves. The unique package-name set did not gain or lose a package, every changed resolved URL uses the public npm registry, and the `re2js@2.8.7` record is unchanged. This audit did not run a broad `npm audit fix` or edit any dependency manifest/lockfile.

Fresh `npm audit --omit=dev --json` from Player returned exit 1 with the same eight affected names, exactly the same three High/five Low severities, zero Critical, and only the previously accepted Zod and Deepmerge origins. Their leaf versions remain `zod@3.25.76` and `deepmerge@4.3.1`; no new exception or advisory origin was accepted. The policy refresh replaces only these six exact parent-version selections:

| Accepted parent | Prior exact policy version | Current exact policy version |
| --- | --- | --- |
| `@expo/cli` | `58.1.16` | `58.1.17` |
| `@expo/config` | `58.0.8` | `58.0.9` |
| `@expo/local-build-cache-provider` | `58.0.8` | `58.0.9` |
| `@expo/metro-config` | `58.0.18` | `58.0.19` |
| `@expo/prebuild-config` | `58.0.16` | `58.0.17` |
| `expo` | `58.0.20` | `58.0.21` |

The eight-name list, both originating advisory URLs, exact severity mapping, empty root/API/Web exception lists, unconditional Critical prohibition, and **November 3** review deadline are unchanged. The policy test's Config fixture was updated to `58.0.9` so its actual-policy acceptance assertion continues to test the current exact pin; no rejection assertion was removed.

Checks performed for this refresh:

- Before changes, `npm run security:dependencies`: passed; root/API/Web had zero findings, Player retained the exact eight reviewed entries.
- After the settled patch lock and six-parent policy refresh, `npm run security:dependencies`: passed with the same counts and November 3 deadline.
- `npx --no-install vitest run scripts/dependency-review-constraints.test.js`: all 19 tests passed both before and after the fixture refresh.
- Player's raw audit remains exit 1 because the accepted vulnerabilities still exist; the successful policy gate reports those findings rather than suppressing them.

The release-preparation task and dependency-install owner record clean-install, Expo compatibility/Doctor, aggregate verification, export/native-generation, and subsequent candidate results separately. This advisory review alone proves no successful iOS compilation, signing, device installation, App Attest exchange, or App Store upload.

### Independently verified public compatibility-metadata conflict

During October 28 validation, the credential-free [SDK 58 native-module endpoint](https://api.expo.dev/v2/sdks/58.0.0/native-modules) returned React Native `0.88.1`, and every one of its 124 module names/ranges exactly matched installed Expo `58.0.21`'s published `bundledNativeModules.json`. The separate [versions/latest endpoint](https://api.expo.dev/v2/versions/latest) identified the same Expo release as `~58.0.21` but still advertised `facebookReactNativeVersion: 0.88.0`. The pinned Expo CLI merges that general version metadata after its native-module matrix, which explains its sole recommendation to downgrade the installed `0.88.1`. Upstream Expo/Camera/Font/Location release evidence above requires retaining `0.88.1`.

Before resolution, the original live `expo install --check` exited 1 with exactly that RN mismatch. Original Expo Doctor `1.20.4` ran all 20 checks and exited 1: **19/20 passed**, with only the package-version check reporting expected `0.88.0`, found `0.88.1`. Those are the raw tool results; they are not described as a 20/20 Doctor pass.

The focused [compatibility validator](../../../scripts/player-expo-compatibility.mjs) preserves the original command output and independently verifies the disputed property. The check action always runs both the live, cache-disabled `expo install --check` and a second explicitly offline bundled-SDK check. A resolution is possible only for installed Expo `58.0.21`, installed/bundled RN `0.88.1`, an otherwise successful offline check, and the exact sole live mismatch above. It then freshly fetches both fixed HTTPS endpoints without credentials, cache reuse, or redirects and requires the reviewed versions/latest conflict plus equality of the **entire** fresh native-module matrix with the bundled matrix. Any extra mismatch, different version/SDK, changed module set/range, duplicated record, unexpected output/status, malformed response, network failure, or changed endpoint remains a failure. If a cached CLI result disagrees with newly corrected live metadata, the resolution fails rather than relying on the old snapshot.

Doctor still executes its complete original online check set normally. Its resolver accepts only Doctor `1.20.4`'s exact sole package-version failure and raw 19/20 result above, then reruns the full live/offline compatibility validation and fresh endpoint proof. Any other failed check, warning, package mismatch, reduced check count, changed source version, or failure to independently reproduce the metadata conflict remains fatal. Online validation explicitly removes inherited offline, nonproduction-host, platform-narrowing, Doctor check-skip/directory-disable, and network-error-ignore overrides. No Doctor check is excluded or run offline. Normal raw 20/20 success remains a separate supported outcome.

The `check` and `doctor` actions print their original failures and a separate explanation when the property has been independently verified; successful wrapper exit does not erase the raw exit-1 evidence. Config and export actions keep their existing implementations and failure behavior. No dependency, `node_modules`, exclusion list, audit policy scope, advisory deadline, or application protocol was changed to resolve this metadata error.

Executed evidence after this change:

- `npx --no-install vitest run scripts/player-expo-compatibility.test.js scripts/dependency-review-constraints.test.js`: **80 tests passed** (61 metadata/transport/environment/Doctor tests and 19 existing policy tests). Negative cases cover wrong installed RN even when stale live data recommends it, unreviewed SDKs, extra/unknown mismatches, unsuccessful commands, offline failures, stale-versus-fresh metadata, endpoint/network/shape failures, and additional or altered Doctor failures.
- `npm run player:expo:check`: wrapper exit 0 after printing the original sole live RN mismatch, successful bundled-SDK check, and fresh official-matrix resolution.
- `npm run player:expo:doctor`: wrapper exit 0 after printing the original raw **19/20 / exit 1** Doctor result and independently verifying its sole incorrectly computed compatibility property through both checks and both fresh endpoints.
- `npm run player:config:verify` and `npm run player:release:verify`: passed; production configuration, permission, entitlement, and release assertions remain enforced.

Aggregate verification, export, actual native compilation, signing, and device acceptance remain owned by the enclosing task. This narrowly versioned resolver does not establish any of those outcomes or accept an additional security risk.
