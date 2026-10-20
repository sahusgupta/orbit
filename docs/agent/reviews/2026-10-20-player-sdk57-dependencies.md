# Player SDK 57 dependency review — October 20, 2026

The authorized native build and repository release encountered Expo's compatibility check requiring six SDK 57 patch updates. This review covers those six direct selections and their npm-resolved transitive changes. React Native remains `0.86.3`, EAS CLI remains `23.2.0`, and Node/npm remain `22.16.0`/`10.9.2`. App identity, permissions, authentication, payment boundaries, and Firebase publication protocols are unchanged.

## Reviewed selections

| Dependency | Previous selection | Reviewed exact selection | Upstream evidence |
| --- | --- | --- | --- |
| Expo | `57.0.27` | `57.0.30` | The [SDK 57 release log](https://github.com/expo/expo/blob/sdk-57/packages/expo/CHANGELOG.md) describes releases 57.0.28–30 as maintenance without user-facing changes. |
| Asset | `~57.0.19` | `57.0.20` | [Asset release log](https://github.com/expo/expo/blob/sdk-57/packages/expo-asset/CHANGELOG.md): maintenance release. |
| Constants | `57.0.21` | `57.0.22` | [Constants release log](https://github.com/expo/expo/blob/sdk-57/packages/expo-constants/CHANGELOG.md): maintenance release. |
| Crypto | `57.0.3` | `57.0.4` | [Crypto release log](https://github.com/expo/expo/blob/sdk-57/packages/expo-crypto/CHANGELOG.md): corrects native `digest()` handling of ArrayBuffer/DataView inputs. Orbit's native identifier adapter uses `randomUUID()`. |
| Location | `57.0.20` | `57.0.21` | [Location release log](https://github.com/expo/expo/blob/sdk-57/packages/expo-location/CHANGELOG.md): maintenance release; Orbit retains explicit foreground, one-shot location only. |
| Splash Screen | `57.0.9` | `57.0.10` | [Splash Screen release log](https://github.com/expo/expo/blob/sdk-57/packages/expo-splash-screen/CHANGELOG.md): maintenance release. |

The installed Expo compatibility check subsequently reported that dependencies are up to date. The upstream [SDK 57 module recommendations](https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json) provide the package-family compatibility reference. No SDK major upgrade or unrelated direct dependency update was selected.

Expo's nested CLI advances from `57.0.28` to `57.0.31`. Its [release log](https://github.com/expo/expo/blob/sdk-57/packages/%40expo/cli/CHANGELOG.md) records tsconfig path fixes and a minimum Expo Atlas version change. Native transitive updates include `expo-modules-core` `57.0.21→57.0.23`, `expo-modules-jsi` `57.1.1→57.1.2`, and autolinking `57.0.14→57.0.16`. Their primary logs describe [host-view layout/crash repairs](https://github.com/expo/expo/blob/sdk-57/packages/expo-modules-core/CHANGELOG.md), [Xcode 26/Swift 6.2 build repairs](https://github.com/expo/expo/blob/sdk-57/packages/expo-modules-jsi/CHANGELOG.md), and [framework-linking/deterministic-resolution repairs](https://github.com/expo/expo/blob/sdk-57/packages/expo-modules-autolinking/CHANGELOG.md). These are actual native dependency changes and require current build validation.

The final standalone lock has 645 package records, previously 641; reviewed changed/new package records use the public npm registry and SHA-512 integrity values. Its SHA-256 is `3f19a022ccabd1ee73bdc1b1f94233738a8cb917e4067614fd2c7f199f411a87`. The root lock is unchanged. An initial npm command failed because both npm configuration paths resolved to `NUL`; distinct empty task-local configuration paths corrected that setup. npm also introduced an unintended parent `table_manager` dependency during resolution. That dependency, its link and unreferenced parent metadata were removed before a successful `npm ci` from the actual `player-app` directory. The independent-lock gate passed. No forced audit fix was used.

## Current advisories and native reachability

The fresh Player production audit (`npm audit --omit=dev --json` from `player-app`) returned exit 1 with **18 High, zero Critical**, and no Low/Moderate findings. The eighteen affected package names and two originating advisories match the existing review:

- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): `braces@3.0.3` can exhaust the Node call stack when parsing deeply nested patterns. Its path is Metro filesystem/glob tooling through `micromatch`.
- [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): `node-forge@1.4.0` has an RSA signature-verification flaw. Its reviewed path is Expo CLI's signing-certificate utility.

Both primary advisory records still report no patched version as of this review. These vulnerabilities remain present; the SDK patch update does not repair them. The audit artifact is ignored at `out/player-expo-patch-audit-2026-10-20T10-07-01.107Z.json`.

The [existing policy](../../../config/dependency-audit-policy.json) changes only the exact reviewed parent versions for `expo` and `@expo/cli`. Its eighteen-name allowlist, two advisory URLs, severity constraints, and **October 22, 2026** review deadline remain unchanged. Rechecking the actual new audit and lock against the unchanged policy logic passes. No new advisory, package exception, or deadline extension was accepted.

Current application source has no imports of the affected glob, Metro file-map, or signing-certificate utilities. Its affected direct native adapters import Crypto `randomUUID()` and foreground Location APIs. App configuration and the export runner do not configure update-signing certificates or a private-key signing-service flow. Controlled build source remains the input boundary for vulnerable tooling; this does not make that tooling harmless. The [October 8 review](2026-10-08-desktop-release-dependencies.md) alone is not treated as acceptance of a new native binary.

## Verification

- Standalone `npm ci`: exit 0, 634 installed packages; root and Player lock hashes unchanged by installation.
- Expo online compatibility: passed; Expo Doctor: 21/21; native strict TypeScript: passed.
- `npm run player:release:verify`: passed with the five updated exact-version assertions and all existing security/configuration assertions intact.
- `npm run check:release-controls`: passed; local documentation links and diff whitespace checks passed.
- Focused release config/environment, dependency-review constraints, bundle scanner, source-contract, UUID and foreground-location tests: **7 files, 56 tests passed**. Existing tests exercise these version-only edits; no application behavior or test boundary was changed.
- Fresh production iOS exports passed through the existing export wrapper with offline mode and telemetry disabled: Hermes bytecode, inspectable JavaScript with source maps, and the separate EAS embedded bundle with its source map. The scanner accepted 3 inspectable files/19 binary assets in the JavaScript export and 2 inspectable files/19 binary assets in the embedded export. Neither source graph contained the prohibited build-only dependencies or privileged runtime markers. Ignored evidence: `out/player-sdk57-export-20261020.log`. Cleanup was restricted to the newly generated task temp directory.
- Export warnings reported rebuilding an empty bundler cache and `NO_COLOR` being ignored because `FORCE_COLOR` was set; export and scanning still exited 0.
- Final aggregate `npm run verify` remains owned by the enclosing release task and must run after this patch review settles. A source/bundle check does not establish signed-archive acceptance, device installation, or physical-device behavior.

Dependency review and local checks did not call production application, authentication, payment, messaging, or signing services.
