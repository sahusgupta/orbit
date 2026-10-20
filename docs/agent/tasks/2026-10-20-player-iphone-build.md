# Native iPhone EAS build

The user requested an EAS build to download on their phone after the [native UI fixes](2026-10-20-player-ui-fixes.md). Prior installation records identify their enrolled iPhone. This task uses the existing `iphone-test` internal distribution profile, managed signing, and enrolled devices. It does not authorize an API/Firebase deployment or an App Store submission.

## Build

- EAS job: [959ce769-d6d7-4155-87d8-6f4fca253b58](https://expo.dev/accounts/saussy/projects/tabletalk-player/builds/959ce769-d6d7-4155-87d8-6f4fca253b58).
- Submitted once on 2026-10-20; EAS created the job at `09:42:44.127 UTC` and finished successfully at `09:47:22.780 UTC`. Exact-job polling confirmed `FINISHED`; no duplicate build or terminal-status polling was performed.
- Project `bb2059b7-91b3-4a6b-a66e-d5618e794fd3`, bundle `com.caminuslabs.orbit`, physical iOS, internal distribution, version `1.0.0`, remote build number `1`.
- Command: pinned EAS CLI `23.2.0`, `build --platform ios --profile iphone-test --non-interactive --freeze-credentials --no-wait --json`, using Node `22.16.0`.
- Source snapshot commit `8f7aa626b777d0699bec3c4db68d1cb9a9da5df6`; manifest SHA-256 `4a382d3d3da3db618414a40fad413ad49ae933acabf40b343b9a0b8b2f464def`; selected-source fingerprint `b2ac6bbd1a21855a5a70b15cc4a54f23946ba91e64c48fb0c35c4b24a2c42a2e` (131 selected inputs).

## Packaging and boundaries

The non-main checkout was already extensively dirty. Its changes were preserved. A fresh ignored snapshot under `out/player-iphone-ui-fixes-20261020/source/` contains 135 shipping inputs and two archive control files. Its local Git commit is independent of the main checkout. Compared with the prior phone snapshot, 22 files changed, two were added, and none were removed.

Only the existing public Firebase client configurations were included. Private credentials, environment files, generated native projects, caches, test files and dependencies were excluded. Two ignored dependency junctions support local Expo configuration and do not appear in the upload. Git trust uses an isolated configuration with exactly the source and its `.git` directory; user-global Git settings were untouched. Captured EAS output is filtered in memory; raw account, signing, environment and artifact URL metadata is not stored.

The first archive inspection exited 1 before submission. Local-only clone diagnostics identified Git upload-pack rejecting `core.hooksPath=NUL` in the temporary repository's local configuration. The source objects passed strict integrity checks. After verifying that the temporary repository contained no hooks, that one local setting was removed. The source commit, file bytes, and main checkout HEAD/index remained unchanged. A local clone and separate second EAS archive inspection then passed. The failed inspection and partial outputs were preserved.

The successful archive contains all 137 authored files, each identical to its source bytes, with a clean matching commit and no unexpected environment, credential, dependency or link paths. Safe evidence is in `out/player-iphone-ui-fixes-20261020/`: `manifest.json`, `preparation-proof.json`, `archive-inspect-result-2.json`, and `physical-submit-result-1.json`. Exactly one remote build was submitted.

## Downloaded package

The exact finished job was revalidated before downloading its artifact from Expo's official HTTPS artifact host. `device-artifact/OrbitPlayer.ipa` under the evidence directory is 13,035,698 bytes, SHA-256 `87232489cd65494ff915de3d0a1f3f713c13eccd2411fe332e4ec1f1f5b7fc22`. `download-proof.json` and `inspection-summary.json` bind it to the source, submission and terminal record `physical-status-2026-10-20T09-48-03.451Z.json`.

Bounded inspection passed without extracting or executing the IPA: 155 ZIP entries, 40,514,101 expanded bytes, arm64 iPhoneOS, minimum iOS 16.4, exact bundle/version/build, production API origin and public Firebase identity, expected permission purposes, and all 14 reviewed privacy manifests. The executable certificate is present in the embedded profile; production App Attest claims and profile permissions match. Apple cryptographic trust/revocation, intended-device inclusion, installation, actual App Attest acceptance and physical interaction were not independently verified. Existing managed signing and device enrollment were reused unchanged.

The user can open the EAS build page on their enrolled iPhone and select Install. The downloaded IPA is retained locally for review; no signed download URL or raw personal signing/device metadata was stored.

## Verification

`npm run verify` completed with exit 0 and all 13 configured checks passing: root and native TypeScript; native release contract and artwork; player Web TypeScript, lint, tests and build; sales-map TypeScript, tests and build; main unit tests; desktop renderer build. The main suite passed 2,251 tests with 16 existing integration skips; Web passed 209 tests; sales-map passed 85. Existing renderer large-chunk and ExcelJS warnings remain. The first verification session ended without a terminal result; the complete rerun is recorded in `out/player-iphone-ui-fixes-20261020-verify.log`.

Local checks used unreachable loopback APIs, disabled synchronization/browser App Check, and disabled telemetry. No live application API, real account, payment or player data was exercised. Helper syntax checks and 33 synthetic artifact validation checks passed, along with 24 reused parser tests. `git diff --check` passed with ordinary line-ending notices.

The native bundle includes the UI changes, but the new freeroll registration endpoint requires a separate API release. This task does not claim backend deployment or physical-device acceptance.

Final Git handoff remains on `docs/desktop-release-0.1.79-evidence`, HEAD `9680ee0dccd73405ea38964df6796e19c94e3a69`, with 227 changed-path entries, zero staged paths and zero conflicts. The pre-existing work is preserved; this build task adds this record and ignored local build evidence. No main-checkout commit, push, pull request, signing/device enrollment change, API/Firebase deployment, or store submission was performed.
