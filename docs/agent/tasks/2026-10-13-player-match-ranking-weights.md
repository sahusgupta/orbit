# Finite Match ranking weights - 2026-10-13

The full objective re-audit found one concrete defect in the exported, configurable [ranker](../../../player-app/src/domain/orbitMatchCandidates.ts). Five individually finite weights of `1e308` overflow their sum to infinity. The old per-weight validation accepted them, allowing a non-finite normalized score and invalid ranking comparisons. Ordinary Player defaults did not exercise this edge.

The small fix requires the combined weight total to be finite, preserving the existing `RangeError`, positive-total and per-weight checks. The new [regression](../../../player-app/src/domain/orbitMatchCandidates.test.ts) rejects the overflowing configuration at the same pure boundary. Default weights, normal custom weighting, explanations, hard filters, ranking diversity and persistence are unchanged. No API, schema, identity, authorization, dependency or Metro change belongs to this task.

Caller inspection covered `usePlayerMatch`, the browser QA entry, native QA contract tests, the local publication/decoder test and the existing benchmark. Mounted Player and QA callers use the defaults; normal custom weights remain covered by the existing ranking suite. No caller rewrite is needed.

Actual isolated checks used an allowlisted child environment, unreachable `ORBIT_API_URL=http://127.0.0.1:1`, `VITE_ENABLE_FIREBASE_SYNC=false`, no dotenv and no Expo telemetry:

- Unchanged baseline: `node node_modules/vitest/vitest.mjs run player-app/src/domain/orbitMatchCandidates.test.ts` passed **32 tests**.
- Desired regression against the old ranker: the same command failed **1 test**, with **32 passing**; it did not throw for the overflowing total.
- After the finite-total guard: the same command passed **33 tests**.
- Player strict TypeScript, the installed Player compiler's `tsc --noEmit`, passed with exit 0.

Root's [current checkpoint](./2026-10-13-player-card-checkpoint.md) records the refreshed `8fe1ce` source and Android/iPhone artifacts. Actual full verification passed all13 gates, with1,873 root tests plus16 ordinary emulator skips; the current native run passed5/5 on new APK`f80469…`, with root and independent report/capture review. The earlier `bbf83` five-case native proof and 13-gate/1,860-test aggregate retain their original provenance. No native, EAS, Apple, hosted service, build or deployment operation was performed by this focused ranking edit; no files were staged, committed or pushed.

The accompanying read-only history audit found accepted-action history, current-save attribution, retained/cohort analytics, conditional undo/removal, permanent idempotency receipts, owner isolation and preference CAS at their existing pure/controller/API boundaries. Analytics remain sampled client history; they do not establish attendance or a complete funnel. Adaptive weighting and dismissal reasons are optional in the objective. Apple enrollment/signing, genuine App Attest, physical-device readers/performance/location and the controlled real-club pilot remain separate gates in the [acceptance review](../reviews/2026-10-12-orbit-match-acceptance.md).

## Follow-on: finite exploration arithmetic

A later full-objective audit found that a valid venue-only weight of `1e308` still overflowed the intermediate exploration calculation: `5 * totalWeight / (100 * venue)` became infinity divided by infinity. With exploration enabled and a known favorite or current saved venue, a different eligible venue received a `NaN` component and score even though the total itself was finite. This affects the exported configurable boundary; mounted Player callers use ordinary default weights.

The one-line follow-on calculates the same exploration cap from the normalized venue share, `0.05 / (venue / totalWeight)`, retaining the 0.5 component ceiling and five-point score influence. It accepts valid large finite weights. No hard filter, candidate fact, default weight, reason, diversity rule, persistence or API behavior changed. Caller inspection and the other bounded component arithmetic found no additional required caller change.

The same allowlisted isolated environment used an external temporary directory, unreachable local API, disabled Firebase sync, no dotenv and no telemetry. Actual focused results were:

- Unchanged current ranking suite: **33 passed**.
- New large finite venue-only regression before the formula change: **1 failed, 33 passed**, with the exploration component `NaN` instead of `0.05`.
- After the ratio calculation: **34 passed**, including unchanged ordinary custom/default scores, explanations, exclusions and diversity.
- Player strict TypeScript (`node player-app/node_modules/typescript/bin/tsc --noEmit` with Player working directory): **exit 0**.

The selected 128-file source is now `e4f8a5db6d981873133d49e7b4bab54bab015a12e9fdd73f79806ed5d7a77a47`. The earlier `8fe1ce` aggregate, Android native five-case proof and immutable iPhone source remain evidence for their exact prior bytes. Root coordinates refreshed full verification and artifacts; this focused task did not run a new aggregate, build, enrollment query, native runtime or hosted operation. No files were staged, committed or pushed.

The combined [tournament handoff and enrolled-iPhone checkpoint](./2026-10-13-player-iphone-enrolled-build.md) now freezes `b5e6d5…` /128 inputs, with this exact ranking correction unchanged. Actual full `npm run verify` passed all 13 gates at `21:40:59.752Z`: 1,881 root tests plus 16 ordinary emulator skips, Web 209 and sales 85. Immutable source `a9e3fd4…` passes all 660 comparisons and actual local archive review. Device enrollment is complete; the physical build attempt stopped before upload at missing signing credentials. The `e4f8a5` digest above is the intermediate ranking-only checkpoint, and the older native 5/5 remains evidence for `8fe1ce`.

Current integrated evidence is owned by the [Map-source iPhone build record](./2026-10-13-player-iphone-map-build.md): `6d4b381?` /128, immutable `cbc60d1?` /132, all 13 verification gates / 1,887 root tests passed. The exact current physical iPhone build finished, its actual package inspection passed, and its profile contains the sole registered Expo iPhone record. Installation, native interaction, genuine App Attest and controlled real-venue acceptance remain separate. Earlier focused source/runtime results above retain their original provenance.
