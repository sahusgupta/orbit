# Native player UI fixes — 2026-10-20

Scope: native iPhone/Android player app. The user explicitly kept payments and payment-method management out of launch, and selected operational registration for free events with nonbinding interest for paid events.

Initial branch: `docs/desktop-release-0.1.79-evidence`, already containing substantial uncommitted native, API, release and documentation work. Existing changes were preserved; this task adds narrow changes to those current files. Git required a per-command `-c safe.directory=C:/Users/herob/OneDrive/Documents/GitHub/TableManager` because the sandbox account differs from the repository owner; no global Git configuration changed.

## Behavior

- Short pages occupy the available viewport. Onboarding centers profile fields, keeps actions at the bottom, avoids the iOS keyboard and presents a horizontal one-line adult checkbox with its complete accessible label.
- First use offers account creation, demo access and sign-in. Firebase Authentication handles passwords and verified sessions; the existing private Firebase profile stores profile fields only. Explicit sign-in cannot fall through into account creation on a mistyped email. Existing verified-account restoration, age declaration and cleanup guards remain.
- Match cards occupy the available screen with compact accessible icon controls. Primary navigation is an icon group in the bottom corner with reserved layout space, so it does not cover actions. Match preferences and demo reset/exit are in Profile.
- Map search filters published location/address matches and frames their valid coordinates, with venue/game fallback search. Clearing search restores the venue extent. No geocoder or new device-location request is used.
- Club selection opens a separate membership details route. The extension action opens existing published membership options and submits the existing venue request. Staff confirms expiry; active access is preserved while requests are reviewed. Stale selections expose no membership mutation or QR issuance controls.
- Free-event registration adds the authenticated player to the existing venue tournament entrant list with zero buy-in, rebuys and add-ons. Enabled unknown/nonzero extra prices are rejected. Current account, age, venue, open-window and zero-payment checks run at transaction commit. Replays and revision-conflict retries cannot add duplicate entrants. Public discovery exposes no entrant identity; authenticated discovery returns only the caller's registration. Registration changes remain staff-managed. Paid events retain interest and never create an entrant, debt or payment.
- Shared privacy/terms drafts and release-policy checks describe this scope. The shared legal copies remain synchronized; the separate player website's product UI was not redesigned. No Firestore collection/schema, rule, index or sync-v2 protocol change was needed.

## Safety and review

Commands used unreachable loopback API endpoints and disabled Firebase synchronization. Aggregate verification also disables browser Firebase/App Check and telemetry. Browser harnesses use explicit local service/native adapters and block external requests. No production service, real account, SMS, email, payment, secret, deployment or remote build was used.

Characterization ran before authentication and registration changes: native onboarding/settings/membership/events/session/identity coverage passed 134 tests across six files; additional API interest/route/hook coverage passed 41 tests across three files. Later focused coverage includes Firebase creation versus sign-in intent, verified remote profile restoration, registration privacy, current-state commit checks, replay/concurrency, stale catalog acknowledgements, account changes, map framing, membership route guards and demo isolation.

Review corrected stale registration acknowledgements after venue removal, UID retention in registration replay receipts, explicit sign-in accidentally creating an account, direct Pressable events being mistaken for profile arguments, and navigation overlapping actions. No tests, validation or security checks were skipped or weakened.

## Verification

- Initial sandbox-only Vitest startup failed because esbuild could not traverse an ancestor directory. The same local tests ran successfully with approved execution outside that filesystem sandbox.
- An intermediate strict API check found three new errors in structured error typing and a mock result shape; these were fixed. `npm run typecheck --prefix apps/api` then passed.
- Intermediate presentation contracts failed on intentionally changed UI digests, removed demo-menu tokens and unused tab-label styles. The reviewed digests and behavioral assertions were updated, and the unused styles removed. An integration-test import initially reached the native QR package's untransformed JSX; its new detail-screen leaf now uses the composition test's existing explicit UI-adapter pattern, while the detail and wallet components retain their separate real render tests. The integrated contracts and session suite subsequently passed 80 tests, before the final explicit sign-in intent assertion was added.
- The first updated standalone Match browser run passed 27 of 28 checks; its exact theme-state comparison raced an optimistic timestamp by seven milliseconds. The harness now waits for pending/working to finish before comparing the full state. Both appearances then passed all 28 checks without relaxing equality.
- Native strict TypeScript and focused component/domain/API tests passed during development. The renderer build passed, with the existing ExcelJS `eval` and large-chunk warnings.
- Isolated Chromium/React Native Web shell QA passed in light and dark appearances, including 320-point account/checkbox layout, 200% text, centered fields, bottom actions, expanded cards, membership extension navigation, demo restoration and zero outbound requests. Native maps, the physical keyboard and real Firebase providers require device validation; browser adapters do not prove those integrations.
- Final isolated browser commands: `node tests/e2e/player-shell-smoke.mjs` passed 12 checks; `node tests/e2e/player-match-smoke.mjs` passed 28 checks. Screenshots were inspected in both appearances. Ignored artifacts are in `out/player-shell-qa/` and `out/player-match-qa/`.
- `npm run verify` passed all 13 configured checks: root TypeScript, native TypeScript, native release contract/artwork, Web TypeScript/lint/tests/build, sales-map TypeScript/tests/build, the main unit suite, and the desktop renderer build. The aggregate run recorded 2,250 main tests passing with 16 existing integration tests skipped, 209 Web tests passing, and 85 sales-map tests passing. No new skip was introduced. The isolated Firestore Emulator suites were not run.
- After the aggregate run, a final membership-list feedback fix was checked with `npm test -- player-app/src/PlayerApp.demo.test.tsx src/lib/playerOnboardingPresentation.test.ts`: 82 tests passed across two files. This preserves visible confirmations/errors after returning from an extension request.
- Remaining Maestro and Android QA selectors were updated to use Profile and the account-first screens. The new isolated first-use flow stops at the disabled credential action without authenticating; obsolete first-use local-guest assertions are documented as historical. Existing APK/source/fixture gates were preserved. Four affected static QA test files passed 55 tests; no native harness or device was run.
- Local links in the changed documentation resolve. Final diff whitespace checks pass (Git reports normal LF-to-CRLF notices). The branch remains `docs/desktop-release-0.1.79-evidence`; the worktree contains the pre-existing changes plus this task's unstaged changes, with nothing staged.

## Handoff

Source changes only. No commit, push, pull request, deployment, EAS build or submission was requested or performed. The updated API and native app must be released together through a separately authorized release task; source tests do not establish launch readiness or physical-device acceptance.
