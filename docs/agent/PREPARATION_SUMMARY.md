# Repository Preparation Summary

Prepared on 2026-08-05 on branch `chore/prepare-codex-workflow` from inspected commit `5feb0b64d8bee85b0071e9bea11ff4cb51564748`.

## Repository Structure

Orbit contains three independently locked npm applications rather than a configured workspace:

- Root React/TypeScript management renderer under `src/`, built by Vite and hosted by Electron from `electron/main.cjs`.
- CommonJS Express API under `apps/api/`, with SQLite persistence, an operations dashboard, and optional privileged integrations.
- Expo/React Native Player application under `player-app/` for iOS and Android.

The repository also contains manual Playwright/Electron harnesses in `tests/e2e/`, build/administrative scripts in `scripts/`, a separate Vite download site, and Firebase rules/index definitions. CI and release workflows use Node 22.

## Installation

From the repository root, install exactly from each lockfile:

```powershell
npm ci
npm ci --prefix apps/api
npm ci --prefix player-app
```

Do not use `npm audit fix` or change dependency versions as part of routine setup.

## Development Commands

```powershell
# Management renderer
npm run dev

# Electron desktop (builds first)
npm run desktop

# Local API
npm run api:dev

# Expo Player
npm run player:dev

# All three local surfaces
npm run linked:dev

# Download site
npm run download:dev
```

The example files are variable catalogs. Vite and Expo can load their supported `.env` values, but the Electron and API Node processes do not load `.env` by themselves. Set their values in the launching shell or an approved local runner. For isolated PowerShell work, establish at least:

```powershell
$env:VITE_ENABLE_FIREBASE_SYNC = "false"
$env:VITE_ORBIT_LOCAL_API_URL = "http://127.0.0.1:4629"
$env:ORBIT_API_URL = "http://127.0.0.1:4629"
$env:ORBIT_ENABLE_FIREBASE_SYNC = "false"
```

Source defaults can otherwise select hosted services. Use only approved local/test credentials for any optional integration.

## Verification

The root entrypoint is:

```powershell
npm run verify
```

The runner continues through root TypeScript, Player TypeScript, all Vitest tests, and the renderer build, then returns nonzero if any failed. Its final preparation run produced:

- FAIL: Root TypeScript, due to the documented pre-existing 3,632 diagnostics.
- PASS: Player TypeScript.
- PASS: 17 Vitest files / 81 tests, zero skipped.
- PASS: Desktop renderer build, with dependency `eval` and large-chunk warnings.

See `docs/agent/BASELINE.md` for exact command results, environment details, audit findings, and skipped coverage.

## Baseline Failures and Warnings

- Root strict TypeScript is not currently a usable green gate. Most diagnostics cascade from missing React/ReactDOM/Vite types, but independent domain mismatches remain.
- Root npm audit reports four high-severity transitive findings (`brace-expansion`, `fast-uri`, and `undici`). Player audit reports three (`brace-expansion` and `fast-uri`). The API audit reports zero.
- The renderer build warns about `eval` in bundled ExcelJS and two chunks over 500 kB.
- Vitest passes but Node warns that SQLite support is experimental.

## Missing Capabilities

- No effective lint command or lint configuration.
- No formatting validation command or formatter configuration.
- No passing root TypeScript gate.
- No safe local Player native build; existing native builds are remote EAS workflows.
- No automated, secret-free e2e entrypoint or e2e CI job.
- No Firebase emulator/rules test setup.
- No API build step or separately named API test command; root Vitest currently discovers API tests.

## Security Concerns Requiring Human Review

- `data/orbit-api.sqlite3` is tracked. Its contents were not opened. A human should decide whether it is fixture data safe for version control or a database artifact that needs a separate, carefully planned removal/history/credential response.
- Local credential-looking pilot-key, Firebase Admin, and private-key files are ignored and untracked. Their contents were not read or changed.
- Electron defaults `ORBIT_API_URL` to a hosted API and renderer Firebase sync defaults on. Runtime engineering must use explicit local isolation.
- Root and Player dependency advisories need a separately scoped compatibility/security review; automatic fixes were intentionally not applied.
- Manual stress e2e currently depends on a local private signing key and is not safe as a routine agent check.

## Recommended Next Planning Task

Plan and execute the narrow root TypeScript remediation described in `docs/agent/tasks/root-typecheck-remediation.md`: first restore compatible React/Vite declarations, then classify and fix independent diagnostics in characterized groups. Dependency-audit remediation should be a separate task. Do not begin the broader refactor or Orbit Player website plan until separately authorized.

## Files Created or Modified

Created:

- `.env.example`
- `AGENTS.md`
- `apps/api/.env.example`
- `docs/agent/BASELINE.md`
- `docs/agent/PREPARATION_SUMMARY.md`
- `docs/agent/prompts/README.md`
- `docs/agent/reviews/README.md`
- `docs/agent/tasks/README.md`
- `docs/agent/tasks/root-typecheck-remediation.md`
- `docs/architecture/README.md`
- `docs/player-web/README.md`
- `docs/refactor/README.md`
- `player-app/.env.example`
- `scripts/verify.cjs`

Modified:

- `.gitignore`
- `apps/api/README.md`
- `docs/codebase-onboarding.md`
- `package.json`
- `player-app/README.md`

No application source, business logic, UI, Firebase rules/schema, API contract, lockfile, production data, or deployment configuration was changed.
