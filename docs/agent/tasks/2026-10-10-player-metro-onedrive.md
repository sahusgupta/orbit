# Player Metro OneDrive directory entries — 2026-10-10

## Scope and cause

Fix Expo development-server indexing on Windows without changing dependencies, application behavior, API/data contracts, credentials, or publication settings. Work began on the clean `docs/desktop-release-0.1.79-evidence` branch. Git ownership in the sandbox required a per-command `safe.directory` override; no Git configuration was changed.

An isolated actual Expo CLI server reproduced the reported `DependencyGraph.doesFileExist` error. Its first failure was `EINVAL: invalid argument, readlink` on `player-app/node_modules/ansi-regex/index.js`. That file has a Windows cloud reparse attribute: Node directory listings report a symbolic link, while `lstat` identifies an ordinary file. Expo's file-map crawler trusts the directory entry and attempts to read a nonexistent link target. Metro catches its initialization failure and subsequently returns a graph with an uninitialized file index to the asset handler.

Plain Metro and direct file-map probes initialized successfully, so those probes alone did not reproduce the actual Expo startup boundary. The first CLI smoke attempts also exposed incompatible `--offline`/`--localhost` flags and an IPv4 request to a localhost listener. The final harness uses `EXPO_OFFLINE=1`, `--localhost`, and a localhost request, with watch mode enabled.

## Change

[`windows-directory-entries.cjs`](../../../player-app/scripts/windows-directory-entries.cjs) installs a Windows-only correction for callback/synchronous directory reads before Expo loads Metro. Only directory entries reported as symlinks require `lstat`; verified ordinary files/directories receive corrected type methods while retaining their own metadata and prototype. Real symlinks, normal entries, filename-only reads, Buffer/URL paths, recursive parent paths, and non-Windows behavior remain intact. Missing entries retain Metro's existing missing-file handling; other errors propagate. Installation is idempotent.

[`player-metro-filesystem.test.js`](../../../scripts/player-metro-filesystem.test.js) covers the filesystem boundary. [`README.md`](../../../player-app/README.md) documents the Windows cause and server restart.

## Verification

- `npm test -- scripts/player-metro-filesystem.test.js`: initial sandbox attempt failed before loading tests because esbuild could not traverse an ancestor directory. The command passed outside that sandbox; the final focused suite passed 12 tests.
- `npm run player:typecheck`: passed.
- Isolated actual Expo CLI smoke, watch mode and default cache: before the fix, initialization failed with `EINVAL readlink`, and the asset request produced the exact reported `exists` error and HTTP 404. After the fix, the same request returned HTTP 200, `image/png`, and bytes equal to `player-app/assets/favicon.png`, without the transformer error.
- Isolated actual Expo CLI smoke with `--clear`: the asset returned HTTP 200 with matching bytes; the iOS `node_modules/expo/AppEntry.js` development bundle compiled 1,327 modules and returned HTTP 200 with 10,020,053 JavaScript bytes. The bundle was compiled and downloaded without executing the client.
- `node --check player-app/scripts/windows-directory-entries.cjs` and `node --check player-app/metro.config.js`: passed. All three task-document relative links resolve; `git diff --check` passed.
- `npm run web:lint` outside the sandbox: passed; the initial full-run lint gate also passed without modification.
- First `npm run verify` in the sandbox: all 13 gates ran; eight passed. Player Web tests, sales-map tests, root/API/Player tests, sales-map build, and desktop renderer build failed before loading their esbuild configurations because ancestor-directory access was denied. All TypeScript gates, release contract/artwork, Web lint, and Web production build passed.
- Final `npm run verify` outside that sandbox: all 13 gates passed. Root/API/Player unit tests passed 209 files / 1,492 tests with the existing one-file/eight-test Firestore emulator skip; Player Web passed 20 files / 209 tests; sales-map passed seven files / 85 tests. The three production builds passed. Existing desktop ExcelJS `eval` and large-chunk warnings remained.

Runtime probes disabled dotenv loading and Expo network/telemetry access, removed inherited public/credential environment values, and selected an unreachable loopback API with Firebase sync disabled. They requested local assets and a development bundle without executing the Player client or contacting live services. Probe servers were stopped after each run. No dependency install, commit, push, or deployment occurred.

Final handoff contains only the Metro configuration, Windows directory-entry helper, regression tests, Player README, and this task record. Changes are unstaged and uncommitted on the original non-main branch; generated output and dependencies are not staged.
