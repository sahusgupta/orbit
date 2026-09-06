# Orbit Player release execution — 2026-09-06

This is the active execution record for the authorized continuation of [Player App Store readiness](player-app-store-readiness.md). It supersedes that task's earlier restriction against deployment/build work for this run only. Work is ongoing; no merge, API/rules deployment, signed build, TestFlight upload, or App Review submission is claimed here. Additive infrastructure changes are recorded below.

## Source and access evidence

- Initial clean branch: `codex/player-app-store-readiness`; initial/local/PR head `b713341a1d67e63d5ec3a0c301e2e044d2058ddf`.
- [PR #25](https://github.com/sahusgupta/orbit/pull/25): open, not draft, mergeable/CLEAN, no reviews or unresolved review threads. Default branch `main`; merge/squash/rebase enabled. Branch-protection REST lookup returns `403 Resource not accessible by personal access token`; this does not prove protection is absent.
- [CI run 34023254153](https://github.com/sahusgupta/orbit/actions/runs/34023254153): success on that exact initial SHA. GitGuardian also succeeds. CI logs show the full matrix, iOS export/native prebuild, Firestore emulator, and browser gates succeeded. These results do not attest later edits.
- `vercel project inspect orbit_app`: project `prj_2EEyDB2YImgK9dil3GK79Qy0UfVw`, team `sahoosegs-projects`, root `apps/api`; dashboard Node setting is currently `24.x`. Repository API configuration pins `22.x`, so the actual candidate build runtime must be verified.
- `vercel inspect https://orbitapp-one.vercel.app`: ready production deployment `dpl_CJjBqJEKrsH6sxu2mwd22m3UwWWk`, URL `https://orbit-e18gsa0uo-sahoosegs-projects.vercel.app`, created 2026-08-24. Metadata has no source SHA. Preserve this immutable deployment as the pre-change rollback target; it is not evidence of release-source compatibility.
- Initial `vercel env ls production --cwd apps/api` returned variable names/status only. Log-hash, membership-QR, deletion-pseudonym, deletion-policy, and App Check configuration variables were absent. Values were not requested. Subsequent additions are recorded below.
- Pinned Firebase CLI `projects:list`: current target `tabletalk-s` (`tabletalk-server`), project number `133175572500`. Initial `apps:list --project tabletalk-s` showed only web app `1:133175572500:web:77d0d79a654f4becfd8f01`. Subsequent iOS registration is recorded below.
- Pinned EAS `project:info --non-interactive`, from `player-app`, confirms `@saussy/tabletalk-player`, project `bb2059b7-91b3-4a6b-a66e-d5618e794fd3`. Running the same lookup from the repository root fails because that root is not an EAS project; no project was created or relinked.
- EAS existing iOS builds are old simulator/internal builds for `com.tabletalk.player`, version `0.1.0`; they cannot be uploaded as this candidate.
- EAS `credentials --platform ios`, production profile, without new Apple login: `com.orbit.player` has **No credentials set up yet**. Selecting existing App Store Connect API keys reports **There are no App Store Connect API Keys in your EAS account**. No credentials were generated or downloaded.
- Browser runtime discovery returns no available browsers. A signed-in Apple dashboard is not accessible through this session.
- EAS environment listing was rejected by automatic approval review because it can print production values. A reviewed safe alternative queried only app ID, variable names, and visibility through the existing EAS CLI authenticated GraphQL client. It succeeded: this project has no production environment overrides. No values were requested.

## Repository changes in progress

- Replace process-local quotas with atomic Firestore transactions in `orbitRateLimits`; preserve 429 responses and fail closed with 503 when shared protection cannot be evaluated.
- Use address quotas before credential verification, preventing arbitrary header rotation from creating fresh quotas. Persist only HMAC-protected references, counters, and expiry timestamps.
- Add `expiresAt` TTL configuration without a single-field index; enforce quota expiration in code independently of asynchronous TTL cleanup.
- Add concurrency, restart, expiry, transaction-retry, corrupt-state, and outage coverage; add emulator denial coverage for the server-only counter collection.
- Make the emulator test project match the existing `demo-orbit-release-ci` CLI target.

## Verification ledger for this continuation

| Command | Result |
| --- | --- |
| `npm run typecheck` before implementation | Pass: renderer, root tests, Electron, API. |
| `npx vitest run apps/api/src/http/security.test.js` before implementation | Sandbox initially denied Vite parent-directory traversal. Identical isolated rerun outside sandbox passed 7 characterization tests. |
| First durable-limiter regression run | Failed: CJS test imports used a different test-store instance, and the existing production-mode localhost route harness needed its explicit isolated datastore selection preserved. Both integration issues corrected. |
| `npx vitest run apps/api/src/http/security.test.js apps/api/src/server.routes.test.js apps/api/src/app.entry.test.js` | Pass: 3 files, 24 tests. |
| `npx vitest run apps/api/src/db/rateLimits.test.js apps/api/src/http/security.test.js apps/api/src/server.routes.test.js` | Pass: 3 files, 26 tests. |
| First `npm run typecheck:api` after editing tests | Failed on `import.meta` in CommonJS test files; replaced with `createRequire(__filename)`. Aggregate rerun subsequently passed API TypeScript. |
| First continuation `npm run verify` | Failed only the Player release contract's stale documentation assertions for the removed in-memory implementation. All other checks passed: four root TS boundaries, Player TS/artwork, Player Web TS/lint/176 tests, sales-map TS/85 tests, root/API/Player 1,282 tests (8 emulator tests skipped), and three production builds. The assertions now require the durable limiter and TTL policy; focused `npm run player:release:verify` and the subsequent full rerun pass. |
| `npm run security:paths` | Pass: no sensitive-looking project paths. |
| Final limiter `npm run verify` rerun | Pass: all 13 checks; four root TypeScript boundaries, Player TypeScript/release/artwork, Player Web TypeScript/lint/176 tests, sales-map TypeScript/85 tests, root/API/Player 1,282 passing tests (8 emulator tests skipped), and all three builds. Existing ExcelJS eval/chunk warnings remain. |
| `npm run security:dependencies` | Pass under reviewed reachability policy: root/API/Web zero production advisories; Player eight previously reviewed high build-chain exceptions, next mandatory review 2026-09-30. |
| `npm run check:independent-locks`; `npm run audit:module-graph` | Pass; no cycles, unresolved imports, dependency-boundary violations, or missing packaged runtime files. |

Local checks disable hosted sync, select unreachable loopback API origins, clear debug flags, and remove inherited credential/provider environment variables. Service inventory commands use existing CLI authentication and emit only operational metadata.

## Additive infrastructure changes

- Added `ORBIT_LOG_HASH_SECRET`, `ORBIT_MEMBERSHIP_QR_SECRET`, and `ORBIT_DELETION_PSEUDONYM_SECRET` as production **Secrets** to Vercel project `prj_2EEyDB2YImgK9dil3GK79Qy0UfVw`. Each was generated independently from 48 cryptographically random bytes and sent through stdin; no value was displayed or written locally. No overwrite flag was used. Follow-up `vercel env ls production --cwd apps/api` confirms all three names exist. The initial automatic approval rejection was resolved by presenting the user's explicit Phase 3.5/3.13 production authorization and independently verified target. Existing immutable deployment/aliases remain unchanged. Rollback before candidate promotion: remove only these three newly added variable names; do not rotate or remove existing production variables.
- Registered Firebase iOS app **Orbit Player iOS**, bundle `com.orbit.player`, app ID `1:133175572500:ios:46a75e002225158dfd8f01`, in the verified `tabletalk-s` project. Command: `node node_modules/firebase-tools/lib/bin/firebase.js apps:create IOS 'Orbit Player iOS' --bundle-id com.orbit.player --project tabletalk-s --non-interactive`. Existing web app, rules, data, and enforcement were not changed. Rollback before adoption: remove this new app registration only. App Attest registration still needs the correct Apple Team ID/signing authority.
- Public HTTPS probes: `/health`, `/privacy`, `/terms`, and `/support` return 200 without authentication. Only `/privacy` contains the exact standardized `Caminus Labs, LLC` string. These are pre-deployment observations; a content/mobile-render verification of the new legal pages remains required.
- GitHub secret-scanning alert metadata lookup returns `403 Resource not accessible by personal access token`; no alert secrets were printed. The GitGuardian success/comment is verified, but provider-side revocation is not proven by it.
- The 11 credential artifacts are present in owner-only `C:/Users/herob/AppData/Local/Orbit/SecretQuarantine/20260905-741160c`. Filename-only inspection confirms the inventory; none was opened, removed, or copied. The pilot signing key may be the only copy and must not be destroyed blindly. The directory has no standalone GitHub token file identifiable from its names.
- WSL Ubuntu exists, but `java` and Linux `node` are not in its current PATH. Local emulator/native setup is not yet reproduced; existing initial-SHA CI evidence remains distinct from final-SHA verification.

## Human gates evidenced so far

- Apple Account Holder: authenticate the intended Caminus Labs, LLC team and configure existing/new signing and submission credentials for `com.orbit.player`. EAS currently has neither. This blocks signed iOS/TestFlight work; no password or MFA code should enter chat or repository files.
- Qualified counsel/venue owner: supply existing approved territorial/venue authority and retention decisions. The repository's example deletion policy is explicitly not approval. Technical preparation continues while these decisions are located.

Remaining infrastructure configuration, App Check implementation, deployment, native QA automation, credential cleanup, and final submission artifacts remain engineering work, not completed human-only gates.
