# Simulator visible-footer fixture correction — 2026-10-31

The [original simulator job](https://github.com/sahusgupta/orbit/actions/runs/41192222563/job/124511149796) tested source `6fb38d5a4e57110d2c14c8483543c8a4c996ed4e` with Xcode 26.6 (`17F113`), iOS 26.2 (`23C54`), and Maestro 2.7.0. Production-derived Release compilation and ad-hoc simulator signature verification passed. The iPhone 16 Pro Max flow passed; the iPhone 16 flow failed while scrolling to `Continue to account`, so its enlarged-text flow was not reached. These results provide no App Store signing, submission, physical-device, or App Attest hardware proof.

The preserved screenshot, hierarchy, and Maestro log show the disabled button fully visible at unchanged bounds `[162,680][367,728]`, with visibility `1.0` on all five attempts. The extra centering requirement kept issuing swipes. A subsequent hierarchy query spent about 8.7 seconds retrieving the app hierarchy and 18.7 seconds retrieving the status bar, exhausting the 20-second scroll budget before Maestro's visible-item fallback. The reported failure was `No visible element found`, with no explicit request-timeout exception, compiler error, runner termination, or app crash evidenced. The [pinned Maestro implementation](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.7.0/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L702-L735) explains why centering can continue despite full visibility.

Only the two `Continue to account` scroll commands in [local-profile.yaml](../../../player-app/.maestro/local-profile.yaml) replace `centerElement: true` with explicit `visibilityPercentage: 100`. The default 20-second timeout, selectors, denied permissions, disabled → adult declaration → enabled assertions, and credential non-submission remain unchanged. No product UI, runtime, dependency, signing, or workflow configuration changes are included.

Verification:

- Existing [flow-contract tests](../../../scripts/player-simulator-flows.test.js): 6/6 passed before editing.
- Added parsed-YAML regression: failed on the original centering setting, with the existing 6 tests still passing.
- Corrected fixture: 7/7 passed using `node out/security-renderer-tooling-20261031/run-isolated.mjs node_modules/vitest/vitest.mjs run scripts/player-simulator-flows.test.js`.
- Parsed comparison against `HEAD` confirmed exactly the two intended setting replacements and no other flow-command changes; `git diff --check` passed.
- `node out/security-renderer-tooling-20261031/run-isolated.mjs verify` exited 0: all 13 checks passed. The main suite passed 2,837 tests with 16 skipped (269 files passed, one skipped); Web passed 322 tests and the sales map passed 85. Builds reported non-blocking chunk-size warnings. The wrapper selects loopback API endpoints, disables sync and Expo dotenv loading, and removes inherited service environment values.
- The corrected fixture has not yet run on macOS. Exact-head native CI must still pass both iPhone sizes and the enlarged-text flow after review and push.

Original CI evidence and separate red/green logs remain under ignored `out/security-renderer-tooling-20261031/simulator-ci-review/`. The downloaded artifact SHA-256 is `04bb5e699d74c712d423e1b0cb6ce9ce4a040bc8f36b44dde9bc69f485ddda69`. At the local verification handoff, the correction had not been committed, pushed, or rerun in CI. No EAS build, credential operation, or submission was performed.
