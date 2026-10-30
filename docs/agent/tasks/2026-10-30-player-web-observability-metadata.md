# Player Web public observability configuration

This narrow follow-up starts from main `a21fcf863ab5c39eff526c2bd16fae17bffe01f4` on `codex/player-web-observability-metadata`. It extends the [prior platform metadata fix](./2026-10-29-player-web-platform-metadata.md) by one exact name in the [release guard](../../../player-web/release-config.ts), with [boundary tests](../../../player-web/release-config.test.ts). The original twenty names, mirror conditions, canonical project pin, application URLs, Firebase identity, App Check and emulator checks remain unchanged. No dependency, SDK, JSON parser, authentication behavior or provider setting changes.

## Additional hosted field and primary-source review

The release coordinator observed the next alias-withheld candidate, `dpl_89fNgWajqkKnfATXvGjr3UeTWL2T`, reject `NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG` during configuration loading. This is additional hosted-environment coverage; the prior local full verification and browser evidence remain truthful for the prior source. The failed candidate was not promoted.

Vercel's [Analytics configuration](https://vercel.com/docs/analytics/package) and [Speed Insights configuration](https://vercel.com/docs/speed-insights/package) document `VERCEL_OBSERVABILITY_CLIENT_CONFIG` as build-time default client options encoded as JSON. Examples contain optional `analytics` or `speedInsights` objects with script and collection endpoints. Both official Next.js [Analytics client module](https://github.com/vercel/analytics/blob/main/packages/web/src/nextjs/utils.ts) and [Speed Insights client module](https://github.com/vercel/speed-insights/blob/main/packages/web/src/nextjs/utils.ts) read the exact public variable in client code. These sources establish browser intent, not an exhaustive stable JSON schema or a certification of the unseen deployment payload. Tracked Orbit source does not import those SDKs or consume this configuration.

The coordinator separately built a diagnostic-only artifact, `dpl_BqXGtZE2fah9etGKQCLbLd9ExgKF`, that logs names and counterpart-present/equal booleans before the unchanged guard. Its complete list contains eighteen public Vercel names; all counterparts are present and equal, including the observability config. No values were printed or pulled. `NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH` is absent and remains rejected. The diagnostic artifact still fails the unchanged guard and must never be promoted.

Diagnostic proof: ignored `out/reliability-live-20261029/web-platform-metadata-shapes-diagnostic.log` in the retained evidence checkout, SHA-256 `B90AEA289B312A475C8F5466E8248CA8FD32FCF89EC7122D53D54A5981670917`.

The production change adds only `VERCEL_OBSERVABILITY_CLIENT_CONFIG` to the finite reviewed set. Its public mirror still requires `VERCEL` exactly `1`, an existing string counterpart and exact equality. Equality checks configuration consistency; it is not cryptographic provenance and does not certify payload contents. The guard neither parses nor executes the JSON, installs an SDK, enables observability, nor changes provider flags. Unknown observability names, secrets/tokens and the absent base-path field remain rejected without value echo.

## Characterization and validation

- The unchanged 67-case suite passed before edits.
- Expanded tests on the unchanged guard reproduced four matching-config failures with 79 passes: documented Analytics and Speed Insights examples, combined options with all twenty-one names, and the actual eighteen-public-name shape.
- After the one-line set change, all 83 tests passed. Negative cases cover absent/different/undefined counterparts, non-Vercel hosted settings, unknown observability secret/token/suffix names, the absent base-path name, and retained project/App Check requirements. The previous 67 cases remain intact.
- Standalone Web TypeScript and ESLint both passed after the source/test freeze, without suppression or exceptions.

Focused checks use installed locked tools, a minimal allowlisted environment, unreachable loopback API URLs and disabled synchronization. Commands from `player-web` are `node node_modules/vitest/vitest.mjs run release-config.test.ts --maxWorkers=1`, `node node_modules/typescript/bin/tsc --noEmit` and `node node_modules/eslint/bin/eslint.js . --max-warnings 0`. Evidence is ignored under `out/reliability-live-20261029/web-metadata-observability-*` in the retained evidence checkout.

The prior source passed all thirteen full verification checks, 3,026 tests with sixteen existing skips, and the loopback browser smoke. Those results predate this one-name follow-up. Fresh committed-source full verification, browser smoke, CI and a new non-diagnostic hosted candidate remain release gates; no deployment or promotion is claimed by this change.
