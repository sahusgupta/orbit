# Native simulator release QA

The [GitHub macOS workflow](../../.github/workflows/player-simulator-qa.yml) builds the committed PR head in Release configuration and runs this flow on iPhone 16 and iPhone 16 Pro Max. Xcode uses its local ad-hoc simulator signing identity (`-`), which needs no Apple certificate, team, provisioning profile, or production credentials. This preserves the simulator application identity needed by Keychain; `CODE_SIGNING_ALLOWED=NO` made SecureStore fail with OSStatus `-34018` on the actual first-launch run. The workflow verifies the signature and generated application entitlement, and preserves the simulator app, signing/source/Xcode metadata, binary privacy manifests, compiler logs, screenshots, and JUnit results for 14 days. Download release evidence before that expiration. This is not a signed device/TestFlight archive. The Expo simulator artifact is a separate build and its results must not be conflated with this workflow's exact source SHA.

The compiler targets the runner's simulator architecture only. Each command reports its operation and start/completion timing, and lengthy compiler output is written to its evidence file as it arrives so cancellation does not erase the diagnostic log. CoreSimulator runtime discovery runs before compilation and has a two-minute limit. Other commands default to two minutes; dependency installation allows 15, compilation 40, device boot five, and each Maestro flow ten. A boot timeout permits one shutdown/boot retry of that same disposable device before app installation, with both attempt logs retained. A second timeout or any app-flow failure fails the check; no assertion is skipped or retried to hide a product failure.

EAS rejected Maestro validation on the current account on September 6, 2026: `Running maestro_test jobs requires a paid plan` (request `966e5cf8-f2d0-4527-8e7f-49cc7b8f60ad`). The following optional workflow can be used if an account owner later supplies an eligible plan; it is not required by the GitHub path.

Run from a clean, committed `player-app` checkout using the repository-pinned EAS CLI:

```powershell
node ../node_modules/eas-cli/bin/run workflow:run .eas/workflows/player-simulator-qa.yml --non-interactive --no-wait -F build_id=SIMULATOR_BUILD_ID
```

Use a finished `com.orbit.player` simulator build whose source SHA is recorded in the release manifest. Record the workflow source SHA separately if only automation changed after that build. The workflow is manual, uses EAS's built-in Maestro jobs on two iPhone sizes, and preserves screenshots, recordings, and JUnit results in its artifacts. It never submits a build to Apple.

The flow creates only a synthetic device-local profile, with no password, phone number, account registration, ID capture, or venue mutation. Its checks cover fresh launch with permissions denied, the mandatory adult declaration, keyboard input, background/foreground, persistence after relaunch, deletion cancellation, deletion confirmation, and absence of the deleted profile after relaunch. The production-derived binary may read public venue projections; screenshots stay on onboarding and local settings so they do not capture other players.

App Attest remains enabled. A simulator cannot establish production App Attest proof, so this flow does not claim authenticated-session, camera hardware, venue membership, QR redemption, or server-account deletion coverage. Those require the separate authorized API/browser checks and signed physical-device checklist. Do not add an App Check debug token or bypass to make simulator authentication pass.

References: [EAS Maestro jobs](https://docs.expo.dev/eas/workflows/pre-packaged-jobs/#maestro), [manual workflow inputs](https://docs.expo.dev/eas/workflows/syntax/#onworkflow_dispatchinputs).
