# Isolated Orbit Match engineering smoke

From the repository root, with lockfile-installed root and player dependencies and an installed Playwright Chromium browser:

```powershell
$env:ORBIT_API_URL='http://127.0.0.1:9'
$env:EXPO_PUBLIC_ORBIT_API_URL='http://127.0.0.1:9'
$env:VITE_ENABLE_FIREBASE_SYNC='false'
node tests/e2e/player-match-smoke.mjs
npx --no-install tsc --project tests/e2e/player-match-qa/tsconfig.json --noEmit
```

The runner builds and serves only this QA entrypoint on an ephemeral `127.0.0.1` port. It does not start the normal API, PlayerApp, Expo, Electron, or the separate player website. Playwright blocks requests to all other hosts and ports; service workers are disabled. Client bundle inspection rejects production Firebase, HTTP and storage ports. No credentials or `.env` files are read. The only accepted HTTP actor is the fictional `local-match-qa-actor`.

Actual application modules exercised: OrbitMatchScreen, GameDetailsScreen, SeatRequestModal, usePlayerClubs, playerMatchController, candidate building/ranking/saved resolution, request construction/application, and the backend Match service/reducer. The service receives an injected synthetic transaction store. Journal persistence uses a QA-only localStorage key. HTTP, subscription polling, identity/age verification and venue inventory are explicit local QA adapters. Expo icon-font/gradient rendering and unused QR rendering are presentation adapters. Auth, native secure storage, Firebase SDK listeners, Firestore transaction behavior, backend waitlist authorization and OS maps handoff require their separate tests.

The default command runs fourteen checks independently in both OS light and dark schemes (28 checks). It covers genuine Chromium touch swipes, button/keyboard parity, undo, save/pass/removal, refresh restoration, explicit seat confirmation and rejected-request rollback, preference CAS/reload and local journal failure, deferred remote-write recovery, stale catalog guards, unavailable saved records, twenty-row pagination, long names and a 200% CSS text layout stress. A published availability update flows into mounted saved details; ending that game keeps the saved record while removing operational details. A live OS scheme switch preserves saved data. Computed text contrast must meet 4.5:1, and enlarged controls must not clip. These are browser paint and layout checks, not native Dynamic Type validation.

Generated artifacts go only to ignored `out/player-match-qa/`: combined `results.json`, per-scheme `light/` and `dark/` results/screenshots, a bundled client, synthetic server-state evidence and failure captures if a check fails. Use `--scheme=light` or `--scheme=dark` for a focused diagnosis. Each run resets its synthetic server state; individual scenario resets also isolate failures. The file is evidence, not a production datastore. Browser timings describe this machine and harness; they do not establish native frame rate or production latency.

Physical iOS/Android gestures, VoiceOver/TalkBack, Dynamic Type, native animation performance, native permission prompts, Apple Maps handoff and an authenticated two-device pilot remain separate device gates.

## Actual player shell and demo

```powershell
node tests/e2e/player-shell-smoke.mjs
```

This separate runner complements the 28-check Match transport harness. It bundles actual `PlayerApp`, the real demo session/fixtures, Match/location/club/tournament hooks, native UI components, navigation, theme provider and modal interactions through React Native Web. Bundle inspection both requires these actual modules and rejects production Firebase, auth/storage/live-data hooks, HTTP, secure-storage and location SDK ports. Every browser request is restricted to the one ephemeral `127.0.0.1` static-server port.

Connected storage, identity and live-data are explicit QA fixtures. Camera, native safe-area/status bar, OS settings/directions and map canvas are adapters. Storage calls are counted and live capabilities fail closed. Auth/API availability is intentionally false; a synthetic local profile is used only to check preservation across demo entry/exit. This does not prove authentication, actual secure storage, native chrome, hardware permissions, maps tiles/handoff or backend operations.

Ten checks (five per light/dark scheme) exercise actual onboarding → demo Home → Match → save → Saved → details → Saved back navigation, plus Profile/Clubs/events/map, reset, exit/reentry and preservation of the original local QA profile. Rendered demo seat request, cancellation, tournament interest and directions show the actual demo notice while forbidden-capability counters remain empty. Connected adapters unmount during demo, and their storage-call counts remain unchanged. Actual painted text must meet 4.5:1 on captured surfaces, and 200% CSS text must not clip; browser text stress is not native Dynamic Type testing.

Results and screenshots are ignored under `out/player-shell-qa/`. `bundle-inputs.json` records exactly which actual modules and adapters were bundled. Native/device and staging gates remain as stated above.

Both harnesses check the compact card/disclosure flow: Match **Game info** starts closed, and cash **Structure**, **Rules** and seat-request options open without sending an action. Cash requests continue explicitly to the existing confirmation; the Match harness still requires the final confirmation before a synthetic waitlist request appears. The shell also captures untouched collapsed tournament cards and opens **Request** before the separate nonbinding interest action. Light/dark captures cover these summaries and expanded sections.
