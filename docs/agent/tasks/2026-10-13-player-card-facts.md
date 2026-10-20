# Match card fact hierarchy

The previous `bbf83f` native capture `out/player-android-connected-qa/seat-request-smoke/2026-10-13T20-13-27-412Z/seat-owner-b-isolated.png` displayed the same availability three times: green **3 seats open**, the **3 / Open seats** metric, and **3 published open seats.** The selected-location distance could also repeat in metadata and a ranking reason. This was a concrete hierarchy issue against the original requirement for quiet, readable discovery cards.

The narrow [CandidateContent](../../../player-app/src/features/match/OrbitMatchScreen.tsx) change keeps the existing green status, Running-table count, queue, published buy-in, fee and metadata. It removes only the duplicate Open seats metric and suppresses only exact numeric-derived seat/distance explanation strings when the same validated fact is already displayed. Seat suppression requires a positive safe-integer Running count matching the candidate count; distance suppression requires a finite nonnegative value. Different numbers/wording and undisplayed availability remain visible. Supported stakes, variant, favorite, scheduled-time and exploration explanations remain visible. Ranking reasons/weights/scores, schema, authentication, persistence, actions, gestures, styles, touch targets and decorative accessibility hiding are unchanged.

Before editing source, the existing Match render suite passed **30 tests**. Twelve desired regressions using the actual pure ranker reproduced **4 failed / 38 passed** against the old UI: repeated cold-start seats/distance and duplicate metrics for positive/zero-seat Running games. The other new cases already preserved forming/paused/scheduled truth and meaningful preference explanations. After the correction, the [render suite](../../../player-app/src/features/match/OrbitMatchScreen.render.test.tsx) passed along with ranking, game details and app orchestration: **112 tests across four files**. The original Running-only availability assertion was intentionally updated to the retained primary status; aggregate capacity from Forming tables remains prohibited. Existing 44-point targets, gesture parity/threshold/rapid/stale/unmount behavior, reduced motion, themes and hidden next-card/feedback tests remain intact.

Executed with unreachable loopback endpoints and renderer sync disabled:

```powershell
$env:ORBIT_API_URL='http://127.0.0.1:9'
$env:EXPO_PUBLIC_ORBIT_API_URL='http://127.0.0.1:9'
$env:VITE_ENABLE_FIREBASE_SYNC='false'
npx --no-install vitest run player-app/src/features/match/OrbitMatchScreen.render.test.tsx
npx --no-install vitest run player-app/src/features/match/OrbitMatchScreen.render.test.tsx player-app/src/domain/orbitMatchCandidates.test.ts player-app/src/features/discovery/DiscoveryGameDetails.render.test.tsx player-app/src/PlayerApp.demo.test.tsx
npm run player:typecheck
```

Player strict TypeScript passed. The post-change selected source fingerprint is `8fe1ce2daf58b9c8708e16f9cd35c9527645ff7982b07a0bddb166edaaeff77b` / 128 files, including root's separate ranking finite-total guard. Root's [current checkpoint](./2026-10-13-player-card-checkpoint.md) records the refreshed artifacts and completed all13-gate/1,873-test aggregate. The current native run passed5/5 on new APK`f80469…`, report21-11-41-502Z. Root and independent review viewed its final B image/XML: exactly one primary **3 seats open**, Running tables/Waiting retained, no Open seats metric or published-seat reason, all three actions visible. The earlier five-pass result remains attributed to `bbf83f`. No new smooth-frame, physical accessibility or pilot claim is made. No services, native actions, remote operations, staging, commit or push occurred in this focused refinement edit; root coordinated the separate runtime.
