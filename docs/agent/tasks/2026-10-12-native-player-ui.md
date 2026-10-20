# Native Player UI simplification — 2026-10-12

## Scope and source state

The user requested a Player app that feels native, is easy to use, and has little clutter. Scope is the Expo Player presentation and navigation; API, authentication, authorization, persistence, membership/waitlist rules, sync protocol, and the separate Player website are unchanged.

Initial and final work is on `docs/desktop-release-0.1.79-evidence`, not `main`. Existing offline-demo work remains in place. Existing Metro/OneDrive changes and their helper/test/task record are preserved. The Player README retains the earlier Metro text and now documents the simplified navigation and demo-options menu.

## Changes

- Replaced the in-app marketing hero and journey with a compact Games feed: greeting, Find games, at most three factual game rows, and small Events/Clubs shortcuts. Counts respect loaded/partial/error states; the Clubs count now reflects memberships, matching its destination.
- Simplified screen headers, removed decorative background artwork, and placed standard bottom tabs in normal layout rather than over the scroll content. Games remains selected through discovery; back navigation restores its originating feed/deck.
- Reduced the demo banner to a labeled row; reset/exit are in Demo options. Notices can be dismissed. Fictional inventory, account separation, and live-action guards remain intact.
- Made discovery cards grow with content, shortened large hero sections, and moved game request/directions actions after key facts and access requirements. Secondary facts and explanations expand under More game details. Stale/missing listings remain guarded.
- Profile shows a concise account summary, with mutually exclusive Sign in, Edit profile, and Preferences disclosures. Identity, legal/support, demo, sign-out, and deletion actions remain reachable. Removed the in-app marketing FAQ/footer.
- Simplified onboarding presentation, retained its adult/contact validation and step transitions, and enabled keyboard-safe scrolling taps. Enlarged shared back, sheet-header, retry, chip, secondary, and icon actions to at least 44-point touch targets.
- Reviewed multiple TSX components using the React best-practices skill: unconditional hooks, typed props, functional disclosure updates, readable growing content, named controls, and accessible selected/expanded state.

User-facing instructions: [Player README](../../../player-app/README.md#app-navigation).

## Verification evidence

All commands selected unreachable localhost API endpoints and disabled renderer/Web Firebase sync. Expo exports additionally disabled dotenv, telemetry, and network discovery, with development App Check disabled. No production service or player data was read or changed.

- Before discovery changes, 28/28 characterization cases passed across PlayerApp, game details, My Games, and Map render tests.
- Focused integration run: 7 presentation-contract failures and 46 passes across 6 files. Failures were the intentionally changed source hashes, settings ordering, and shell style ownership. Reviewed updates retained unrelated assertions; rerun passed 53/53.
- After the final touch/keyboard/menu-label changes, the presentation suite reproduced 6 failures/6 passes from affected hashes; reviewed updates passed 12/12.
- `npm run player:typecheck` passed, including a repeat after the final ergonomic fixes.
- Two local iOS JavaScript exports passed from `player-app`: `node node_modules/expo/bin/cli export --platform ios --no-bytecode --output-dir ../out/player-ui-export-20261012-001` and the final `...-002` export. Each bundled the actual `node_modules/expo/AppEntry.js` entrypoint, 1173 modules, and a 3.5 MB JavaScript bundle. The final artifact contains the new profile-setup, details disclosure, and demo-menu labels. Output is ignored under `out/`; no signed native package or remote EAS build was created. The debug no-bytecode and existing NO_COLOR/FORCE_COLOR notices were emitted.
- First `npm run verify`: exit 1; 12 of 13 gates passed. Unit tests had 8 failures, 1523 passes, and 8 existing emulator-dependent skips (3 failed files, 210 passed, 1 skipped). Six captured the final touch/menu snapshot changes before their reviewed updates; two additional legacy design contracts still required the marketing shell and exactly two details disclosures. These expectations were aligned with the requested native design while retaining data-state, navigation, motion, brand, and accessibility checks.
- Final focused presentation contract: 12/12 passed. Updated native-home/Astryx contracts: 8/8 passed; all unrelated brand, motion, and protected-feature assertions remain intact.
- Final full unit gate: 213 files passed, 1 skipped; 1531 tests passed, 8 skipped, none failed. The existing Firestore rules suite requires an emulator host and was not enabled for this local UI task.
- Final `npm run verify`: passed, exit 0; all 13 gates passed. Root strict checks, Player TypeScript/release contract/artwork, Web TypeScript/lint/209 tests/build, sales-map TypeScript/85 tests/build, the full unit suite, and desktop renderer build completed. The desktop build retained the documented ExcelJS `eval` and large-chunk warnings.

Browser UI automation was attempted through the provided computer-use interface: its inventory had no enabled browsers, and opening the in-app browser returned `Browser is not available: iab`. No browser screenshot or physical-device visual QA is claimed. Functional render tests and real iOS JavaScript compilation provide the recorded checks.

Final diff review, documentation-path checks, and `git diff --check` passed. Final status is `docs/desktop-release-0.1.79-evidence` with the requested UI/demo changes and preserved pre-existing Metro work. The index is empty; changes remain unstaged and uncommitted. Generated build/export output remains ignored. No staging, commit, push, deployment, or unrelated cleanup was performed.
