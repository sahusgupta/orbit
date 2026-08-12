# Orbit Engineering Instructions

These instructions apply to the entire repository. A more deeply nested `AGENTS.md`, if one is added later, may add stricter rules for its subtree but must not weaken these safety requirements.

## Product and Repository

Orbit is a connected poker-room operations platform. Repository evidence shows three primary product surfaces:

- The management desktop application is React 19 and TypeScript under `src/`, built by Vite and hosted by Electron through `electron/main.cjs` and `electron/preload.cjs`.
- The backend under `apps/api/` is a CommonJS Express application. Its entrypoint is `apps/api/src/server.js`; server-only Firebase Admin Firestore is its sole persistent datastore and its sole player-safe state publisher.
- The player application under `player-app/` is an Expo/React Native application for iOS and Android. Expo loads `player-app/App.tsx`, which exports `player-app/src/PlayerApp.tsx`.

Other important areas are:

- `src/lib/`: management-domain, membership, persistence, and mobile-sync helpers.
- `apps/api/public/`: the API-hosted dashboard and public legal/support pages.
- `electron/firebaseSync.cjs`: optional Electron-to-Firebase synchronization.
- `scripts/`: development, packaging, license, Firebase, and administrative utilities.
- `tests/e2e/`: manual Playwright browser/Electron smoke and stress harnesses.
- `download-site/`: a separate Vite-built download site.
- `docs/`: onboarding, audits, architecture notes, and agent workflow records.
- `firebase.json` and `player-app/firestore.*`: Firebase rules/index configuration. These are deployment inputs, not permission to deploy.
- Electron uses an OS-encrypted JSON file as a non-authoritative offline cache. It is not a datastore authority and must not be committed.

This is not an npm workspace. The root, `apps/api/`, and `player-app/` each have their own `package-lock.json`. CI uses Node 22; no `engines`, `.nvmrc`, or `.node-version` constraint is currently committed.

## Required Task Workflow

For every engineering task:

1. Read this file and any more specific instructions before acting.
2. Run `git status --short --branch`. Do not work directly on `main`. If the branch or existing changes make the requested work unsafe, stop and report the exact condition.
3. Inspect the relevant source, tests, configuration, scripts, and documentation before editing. Confirm actual entrypoints and call sites; do not infer structure from filenames alone.
4. State the intended small scope. Preserve unrelated user changes and avoid opportunistic cleanup.
5. Identify production-facing boundaries before running code. Source defaults include hosted API and Firebase paths, so explicitly select local endpoints and disabled sync for isolated work.
6. Implement the smallest coherent change. Preserve public APIs, persisted data shapes, sync protocol behavior, security checks, and failure semantics unless the task explicitly authorizes a change.
7. Add or update tests at the same behavioral boundary as the change.
8. Run the relevant checks individually while diagnosing, then run `npm run verify` before claiming completion. Record every failure truthfully and distinguish pre-existing failures from regressions.
9. Review the complete diff, validate documentation links/paths, and run `git status` before handing off.

## Installation

Use lockfile-preserving installs from the repository root:

```powershell
npm ci
npm ci --prefix apps/api
npm ci --prefix player-app
```

Do not use the root `api:install` script for a reproducible verification install: it intentionally runs `npm install --no-package-lock`. Do not change dependency versions or run `npm audit fix` unless dependency remediation is the explicit task.

## Scope and Editing Rules

- Keep changes task-local. Do not perform unrelated renames, formatting sweeps, dependency upgrades, or cleanup.
- Inspect before editing and search all callers before moving or changing shared behavior.
- Do not change API contracts, Firebase collections/documents, persisted management state, player sync payloads, or authentication/authorization without explicit task scope.
- Do not weaken validation, authorization, Firestore rules, tests, linting, compiler strictness, audit visibility, or error handling to obtain a green check.
- Do not replace precise types with `any`, broad assertions, ignored diagnostics, or skipped tests as a shortcut.
- Preserve intentionally separate runtime boundaries: renderer code must use the Electron preload bridge; server-only secrets stay in the API/Electron process; `EXPO_PUBLIC_*` values are client-visible.
- Keep generated output and dependencies out of commits.

## Risky Refactors and Characterization Tests

Before a risky refactor, first add characterization coverage that passes against the current implementation. Risky areas include `src/main.tsx`, `electron/main.cjs`, database persistence, licensing, authentication, payment/identity flows, membership and waitlist transitions, Firebase publication, and sync protocol v2.

Characterization tests must capture externally observable inputs, outputs, persisted shapes, ordering/idempotency behavior, and failure/fallback behavior. Run them before and after the refactor. If current behavior cannot be characterized safely, stop and document the blocker rather than refactoring blind.

## Architecture Principles

- Keep product/domain rules in pure, testable helpers where practical; UI and transport layers should orchestrate them.
- Maintain explicit boundaries among the React renderer, Electron main/preload processes, Express API, and Expo client.
- Preserve API-first desktop state operations and their documented local fallback unless a task explicitly changes that architecture.
- Preserve sync protocol v2 commit-marker/revision semantics across desktop, API, and player code.
- Keep server credentials and privileged Firebase/payment operations out of renderer and Expo client bundles.
- Treat account keys, mutation IDs, payment/webhook idempotency, and per-club data isolation as invariants.
- Prefer extending existing focused modules and tests over adding more responsibilities to the large application entrypoints.

## Verification Requirements

The root entrypoint is:

```powershell
npm run verify
```

It runs every check even when an earlier check fails and returns a nonzero status if any check fails:

- Root strict TypeScript: `npm run typecheck`
- Player strict TypeScript: `npm run player:typecheck`
- All Vitest unit tests across root, API, and player sources: `npm test`
- Vite renderer build used by the desktop application: `npm run build`

The root TypeScript check has documented pre-existing failures in `docs/agent/BASELINE.md`. Do not hide or silently repair them in unrelated work. A task is not automatically blocked by a documented baseline failure, but it must show that its affected checks did not regress.

No effective lint or formatting command is configured. `npm run lint --if-present` and `npm run format --if-present` execute no check. Do not describe them as passing lint/format validation. The API is plain JavaScript and has no separate build script; the player build scripts invoke remote EAS workflows and are not routine local verification.

Run area-specific checks during development:

- Root renderer/domain: `npm run typecheck`, `npm test`, and `npm run build`.
- Player app: `npm run player:typecheck` and `npm test` (the root Vitest discovery includes player tests).
- API: `npm test` (the root Vitest discovery includes API tests). Start the API only with an isolated local database and local/test credentials when runtime validation is required.
- Electron: `npm test` and `npm run build`; package only when packaging is explicitly in scope.

The e2e harnesses are not part of `npm run verify` or CI. `tests/e2e/management-core-smoke.mjs` requires a separately started local Vite server and Playwright Chromium. Run it only with `VITE_ENABLE_FIREBASE_SYNC=false` and a deliberately unreachable or isolated local API. `npm run stress:e2e` reads a local pilot private key and launches Electron, whose API default is hosted; do not run it during ordinary work. A future task must first provide a secret-free, fully isolated harness.

## Git Rules

- Never work directly on `main`.
- Never force-push, rewrite shared history, use destructive reset/checkout commands, or discard user changes.
- Do not push, open a pull request, tag, or publish a release unless explicitly instructed.
- Keep commits focused and use an imperative conventional message where practical.
- Review `git diff` and `git diff --cached` before committing. Stage only intended files.
- Do not commit generated builds, logs, local caches, credentials, `.env` files, or dependency directories.

## Production Safety

- Never deploy without explicit instruction. This includes Firebase rules/indexes, EAS builds/submissions, Vercel, Electron release publishing, and download-site publication.
- Never access or mutate production Firebase, Stripe, RevenueCat, Twilio, SMTP, or other live services during ordinary engineering work.
- Never run `clubs:cleanup:stress -- --execute`, `player:rules:deploy`, `dist:win:publish`, Firebase publication/import scripts, SMS sending, or comparable administrative actions without explicit scope and a reviewed target.
- Never read, print, copy, modify, or commit secrets. Report sensitive paths only. Use blank/example values and approved local test credentials.
- Assume `ORBIT_API_URL` defaults to a hosted service and renderer Firebase sync defaults on. Override both for isolated runtime work.
- If a command could send SMS/email, charge money, change identity/payment state, publish Firebase state, update a license, or touch a hosted service, stop and obtain explicit authorization plus a confirmed non-production target.

## Documentation

- Update documentation when commands, entrypoints, environment names, architecture boundaries, or operational behavior change.
- Keep `docs/agent/BASELINE.md` factual: include exact commands and results, and never convert an unexecuted or skipped check into a pass.
- Put future scoped work records in `docs/agent/tasks/`, review artifacts in `docs/agent/reviews/`, and reusable prompts in `docs/agent/prompts/`.
- Keep architecture decisions in `docs/architecture/`. Do not populate `docs/refactor/` or `docs/player-web/` with implementation plans until a separate task authorizes that planning.
- Never place credentials, tokens, private customer/player information, or production data in documentation or examples.

## Completion Criteria

A task is complete only when:

- The requested behavior or artifact exists and the diff contains no unrelated changes.
- Relevant tests were added or an explicit, justified reason for no test is documented.
- Relevant checks and `npm run verify` were actually run; results and baseline exceptions are reported accurately.
- No production behavior, API/data schema, or security posture changed outside the authorized scope.
- Documentation is current, new paths resolve, and generated/sensitive files are not staged.
- The final `git status` and commit/push state are clearly reported.

## Blocked Tasks

Stop rather than guess when work requires secrets, production access, deployment authority, an API/data-schema decision outside scope, destructive Git operations, or changes that would overwrite unrelated work. Report:

- The exact blocker and evidence.
- What was safely inspected or attempted.
- Which checks ran and their results.
- The smallest human decision or access change needed to continue.

Do not claim completion, suppress the blocker, or broaden the task to work around it.
