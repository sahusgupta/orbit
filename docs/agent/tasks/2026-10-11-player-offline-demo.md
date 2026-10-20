# Player offline demo account — 2026-10-11

## Scope and initial state

The reported warning comes from `player-app/src/application/usePlayerLiveData.ts` when `EXPO_PUBLIC_ORBIT_API_URL` is absent. The requested change is an explicit demo account with dummy games in different locations, available independently of the API.

Initial branch: `docs/desktop-release-0.1.79-evidence`, not `main`. Existing changes in `player-app/README.md`, `player-app/metro.config.js`, the Metro directory-entry helper/test, and the 2026-10-10 Metro task record were preserved. The README update adds demo documentation alongside the existing Metro text.

Git's sandbox ownership check required the command-local option `-c safe.directory=C:/Users/herob/OneDrive/Documents/GitHub/TableManager`; no global Git configuration was changed.

## Behavior and boundaries

- **Try demo account** is available during onboarding, in Profile, and on loading/error screens.
- A separate in-memory demo session supplies four fictional venues, eight games, four upcoming events, two memberships, and one My Games request. Cities are Austin, Chicago, Denver, and Las Vegas.
- Stable demo IDs and fresh objects restore the same complete inventory on every entry/reset. Event and membership dates are relative to the current clock and refresh across day changes or foreground resumption. Events retain more than a day's refresh headroom before interest closes.
- **Reset demo games** restores inventory and clears saved/passed discovery decisions. **Exit demo** remounts the normal saved-profile flow.
- Demo sessions do not mount connected storage, authentication, or live-data hooks. Shared action callbacks block memberships, seats, cancellations, tournament interest/withdrawal, and directions before reaching live actions. Demo membership wallets never mount the real QR issuer. The demo profile has no sign-in, identity-capture, or deletion action.
- Connected API/configuration failure behavior remains intact; fictional inventory never replaces real venue data. API contracts, persisted profiles, authorization, Firebase publication, and sync protocol v2 were not changed. No backend account was created or seeded.
- The map uses the existing provider and may request map tiles. No native app, service, database, emulator, or deployment was started for this task.

User-facing instructions are in [the Player README](../../../player-app/README.md#demo-account).

## Tests and verification

Six PlayerApp characterization cases passed before the session split. The final orchestration suite has 15 passing cases covering entry points, populated inventory, isolation, live-action guards, reset/reentry, and returning to the connected account. Fixture tests cover selectors, boundary decoders, fresh objects, stable IDs, distant future dates, and active memberships/events. Five actual-hook tests cover press-event refresh, daily/foreground refresh, and cleanup. UI render tests cover demo entry and suppression of real check-in credentials.

Initial sandboxed Vitest runs failed during startup because esbuild could not read ancestor directories. The same isolated checks ran successfully outside that filesystem sandbox. All verification commands explicitly selected unreachable localhost API URLs and disabled renderer/Web Firebase sync; no live API or Firebase state was accessed.

The first full `npm test` completed with 3 failures, 1512 passes, and 8 skips (1 failed file, 210 passed, 1 skipped). The three failures were intentional source-digest changes for the optional onboarding/settings demo entry and the demo-wallet QR guard. Only those three reviewed digests were updated, with new explicit demo assertions; all unrelated component/style digests and existing behavior assertions were retained. The 12-test presentation-contract suite then passed.

- `npm run player:typecheck`: passed after implementation.
- Focused PlayerApp suite: 15/15 passed.
- Demo fixture suite: 6/6 passed.
- Demo session hook suite: 5/5 passed.
- Focused onboarding/settings/clubs/wallet render suites: 26/26 passed.
- `src/lib/playerOnboardingPresentation.test.ts`: 12/12 passed after reviewed digest updates.
- Final full unit gate: 212 files passed, 1 skipped; 1520 tests passed, 8 skipped. The existing Firestore rules suite skips when no emulator host is configured; no emulator was started.
- `npm run verify`: passed, exit 0. All 13 gates passed: root TypeScript (renderer/tests/Electron/API), Player TypeScript, Player release contract/artwork, Web TypeScript/lint/tests/build, sales-map TypeScript/tests/build, full unit tests, and desktop renderer build. Web tests passed 209/209; sales-map tests passed 85/85. The desktop build retained the documented ExcelJS `eval` and large-chunk warnings.

Final diff review, documentation-path checks, and `git diff --check` passed. Final status remains on `docs/desktop-release-0.1.79-evidence` with this task's edits/new files and the preserved pre-existing Metro work. The index is empty; changes are unstaged and uncommitted. Generated builds remain ignored.

No native-device or browser e2e validation, remote EAS build, package publication, deployment, staging, commit, or push was performed.
