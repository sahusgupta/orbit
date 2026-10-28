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
