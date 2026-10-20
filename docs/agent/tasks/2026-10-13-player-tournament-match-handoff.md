# Match tournament handoff

Opening a scheduled Match recommendation previously retained the Events page's event-type filter. A player who selected **My interests**, **$0 published buy-in** or **Interest open**, then opened an uninterested, paid or closed-interest future event from Match, could see an empty Events result instead of the selected event. The same problem affected saved tournament details. [The handoff](../../../player-app/src/PlayerApp.tsx) changed its venue and query but left that filter untouched; the existing pure tournament filter correctly continued to exclude the target.

The production change is one `setTournamentFilter('all')` call inside the explicit Match tournament branch. It preserves the selected venue/name query and existing Events route. Ordinary Events navigation and cash-game details keep their existing filter state. Authentication, saved history, journals, data validation and interest actions are unchanged; opening details neither expresses interest nor bypasses the closed-window or age guards.

The existing [PlayerApp orchestration suite](../../../player-app/src/PlayerApp.demo.test.tsx) passed **25 tests** before edits. Exposing the existing tournament filter callbacks in its presentation mocks reproduced **6 failed / 26 passed** against the old source: all three prior filters, each through the deck and Saved handoff. The selected published event was absent in every failing case. A separate control preserves ordinary Events filters across tab navigation and a cash-details round trip. The first regression run also exposed asynchronous `act` warnings; awaiting the actual details callbacks resolved them without suppressing diagnostics.

After the one-line fix, **54 tests across four files passed** with no `act` warnings. They cover the 32-case app suite plus actual tournament rendering, pure discovery filters and tournament action guards. Tests retain exact selected venue/query and assert no interest, withdrawal or age callback is invoked merely by opening details. The first strict compile caught two required fields missing from the new synthetic tournament DTO (`rebuysAllowed`, `addOnsAllowed`); the test fixture was completed with explicit false values, and the same 54 tests plus **Player strict TypeScript passed** afterward.

Commands used a dedicated external temporary directory, unreachable API endpoints and disabled renderer sync:

```powershell
$qaHandoffTemp='C:/Users/herob/AppData/Local/Temp/orbit-tournament-handoff-20261013'
New-Item -ItemType Directory -Path $qaHandoffTemp -Force | Out-Null
$env:TEMP=$qaHandoffTemp
$env:TMP=$qaHandoffTemp
$env:ORBIT_API_URL='http://127.0.0.1:9'
$env:EXPO_PUBLIC_ORBIT_API_URL='http://127.0.0.1:9'
$env:VITE_ENABLE_FIREBASE_SYNC='false'
npx --no-install vitest run player-app/src/PlayerApp.demo.test.tsx
npx --no-install vitest run player-app/src/PlayerApp.demo.test.tsx player-app/src/features/tournaments/TournamentScreen.render.test.tsx player-app/src/domain/discovery.test.ts player-app/src/application/usePlayerTournaments.test.tsx
npm run player:typecheck
```

The condensed React review found an event-handler state update using the existing controlled filter, with no hooks, effects, listeners, fetches, dependency changes or render waterfall added. Existing accessibility labels and touch targets are unchanged; types remain strict without `any`. Web/SSR/CSS framework suggestions were outside this React Native change.

After this correction and the independently owned finite exploration-math correction passed their checks, the combined selected production fingerprint was `b5e6d56b8643e9a0352fb45e966155429026bdb5fde9e98f8a03b05059d089ff` / 128 files. Root owns fresh aggregate verification and build/runtime coordination. Earlier `8fe1ce` native waitlist evidence remains historical; these handoff regressions ran in the mocked native presentation boundary and do not claim physical-device or hosted tournament action proof. No services, native actions, packaging, remote operations, staging, commit or push occurred in this task.

Current integrated evidence is owned by the [Map-source iPhone build record](./2026-10-13-player-iphone-map-build.md): `6d4b381?` /128, immutable `cbc60d1?` /132, all 13 verification gates / 1,887 root tests passed. The exact current physical iPhone build finished, its actual package inspection passed, and its profile contains the sole registered Expo iPhone record. Installation, native interaction, genuine App Attest and controlled real-venue acceptance remain separate. Earlier focused source/runtime results above retain their original provenance.
