# Repository consolidation - September 13, 2026

The user authorized committing pending work, merging all branches and worktrees into `main`, updating the remote repository, and removing the consolidated branches and extra worktrees. Work was prepared on `chore/consolidate-main-20260913`, starting from remote `main` at `5cdb81f`.

## Preserved work

Commit `c7bca43` preserves all eight pending release handoff files, including the [production mutation proposal](player-production-mutation-proposal.md), [execution ledger](player-release-execution.md), and [release manifest](../../../player-app/submission/2026-09-06/release-manifest.json). Their September 7 statements about remaining local and unstaged describe that historical handoff; this task supplies the later repository publication authority. Production operations described in those records were not repeated by this task.

The attestation release branch merged normally. Three other branches had already been incorporated through equivalent commits. Their original histories were joined only after checking exact Git tree equality and reachability of the preserved commit:

| Original branch | Original head | Identical preserved commit |
| --- | --- | --- |
| `codex/player-app-store-readiness` | `2ec17ef` | `f05fe3c` |
| `agent/player-camera-id-membership-flow` | `e8b6e21` | `0d75e32` |
| `feature/club-data-import` | `fa1956e` | `0461ad2` |

All remaining local and remote branch heads were already ancestors. After joining the histories, every inventoried branch head is an ancestor of the integration branch. Application source, dependency locks, CI configuration, API contracts, and security controls remain byte-identical to the starting remote `main`.

## Worktree inventory

| Extra worktree | Detached head | Inspection |
| --- | --- | --- |
| `C:/Users/herob/AppData/Local/Temp/orbit-deploy-da1d073` | `da1d073` | All 699 tracked files already absent; the only remaining untracked file is an esbuild dependency binary. |
| `C:/Users/herob/AppData/Local/Temp/orbit-release-88544b1-0.1.75` | `88544b1` | All 761 tracked files already absent; no untracked files. |
| `C:/Users/herob/AppData/Local/Temp/orbit-release-e7b08a0-0.1.75` | `e7b08a0` | All 761 tracked files already absent; no untracked files. |
| `C:/Users/herob/OneDrive/Documents/GitHub/TableManager-release-site-0.1.70` | `c2d9b98` | Clean tracked files; only ignored dependencies, build output, and TypeScript cache. |

Every detached head is an ancestor of the starting remote `main`. The three fully deleted checkouts contain no source edits to merge; recording their missing files as product deletions would destroy already-preserved source. Their removal is workspace cleanup. The primary checkout's ignored runtime data, evidence, dependencies, and caches are outside the commit scope and remain local.

All four extra worktrees were removed after confirming their commits were already on remote `main`. Git initially stopped removal of the release-site directory with `Filename too long`; its registration had already been removed. PowerShell cleanup using the verified exact directory and an extended-length path completed successfully. `git worktree list --porcelain` now reports only the primary checkout.

## Verification

- `npm run player:release:verify`: passed before integration.
- `node out/release-20260906/review-release-links.cjs`: passed; 32 local links and release-manifest/source/proposal checks.
- Release manifest JSON, existing source commit IDs, and release-source/reviewed-head tree equality: passed.
- Gitleaks 8.30.1 scanned the eight complete handoff files (265,582 bytes). It reported 14 generic-key findings; review identified deployment IDs and API tree/archive/lock hashes, not credentials. No scanner rules or repository security settings were changed. Manifest credential-related fields contain identifiers and status metadata, not secret values.
- `git diff --check` and staged whitespace review: passed.
- First `npm run verify`: eight checks passed and five failed because esbuild could not read project ancestor directories under the sandbox. Failed checks were Web tests, sales-map tests, root/API/Player unit tests, sales-map build, and renderer build. This was a configuration-loading/access failure before test assertions; the original log remains at `out/consolidation-20260913/verify.log`.
- Installation inspection found older root, Player, and Web dependencies than the committed lockfiles. `npm ci --prefix player-app`, `npm ci`, and `npm ci --prefix player-web` all passed without changing manifests or lockfiles. npm reported eight Player High advisories, 25 root advisories (one Low, 16 Moderate, eight High), and three Web advisories (two Moderate, one High). No dependency remediation or audit fix was performed. The installed API lock already matched.
- `npm run web:test` with normal filesystem access: passed, 209 tests.
- The second primary-checkout `npm run verify` passed compiler/release checks, Web lint/tests (209), and sales-map tests (85). Root discovery also included copied tests under ignored `out/release-20260906/` staging directories: 1,769 tests passed, eight emulator-only tests were skipped, and one archived `api-diagnostic-retry-8mYr6Q/apps/api/src/server.routes.test.js` test failed. The run was stopped during the subsequent Web build. This result is not a full verification pass; the log is `out/consolidation-20260913/verify-unrestricted.log`.
- Final `npm run verify` at integration commit `ef85b4a` in the clean detached checkout `C:/Users/herob/AppData/Local/Temp/orbit-consolidation-verify-20260913`: passed all 13 checks, exit 0. Fresh root, API, Player, and Web lockfile installs passed first. Results: 1,383 root/API/Player tests passed, 209 Web tests passed, and 85 sales-map tests passed. The existing eight emulator-only tests remained skipped; their separate emulator command was not run. All compiler, release, lint, and production-build checks passed. Vite retained its chunk-size advisory. Full log: `out/consolidation-20260913/verify-clean.log`.
- The clean checkout excluded untracked archived source without changing tests or their discovery configuration. After verification, its tracked files were confirmed clean and its commit confirmed preserved; the temporary worktree and directory were removed successfully. Only the primary checkout remains. The final commit adds only this consolidation record to the verified integration tree; its relative links and whitespace are checked separately.
- All 35 relative links across the eight final Markdown documents resolve. The new consolidation record passed its own Gitleaks scan with zero findings.

Verification uses unreachable loopback API endpoints and disabled renderer, Web, and Player Firebase sync/App Check, with build telemetry disabled. No new behavioral tests were added because this task preserves existing code and records repository history/documentation only; the existing release contract and full verification suite exercise the retained behavior.

Branch deletion is conditional on successful preservation in remote `main`. Final remote equality and repository cleanliness will be checked after cleanup.
