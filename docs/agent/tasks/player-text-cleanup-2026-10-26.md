# Player screen text cleanup - 2026-10-26

Status: complete; all 13 repository verification gates passed with main's pinned dependencies.

## Scope

Removed decorative overlines, repetitive subtitles, and duplicate page headings from the player application. The wallet uses one title in the existing app header; its slogan and tap instructions are gone. Home opens directly on game actions and listings. The club pass no longer repeats the venue heading, and extension guidance is reduced to "Venue approval required." Events and Map omit redundant headings/captions. Settings menus use single-line labels except where a dynamic identity status supplies useful information. The sample profile omits its extra title and reduces its explanation to "Changes are not saved." Onboarding keeps its primary title, fields, and actions without brand overlines or explanatory subtitles.

Published game/venue/member details, stale/error/loading notices, account verification instructions, adult declarations, privacy disclosures, and action guards remain. The wallet still isolates a card on the first tap and opens its pass on the second. No API, persisted data shape, authentication, sync, or dependency changes were made. Existing tests and native QA selectors now target the retained controls and headings.

Work used `feat/player-text-cleanup-20261026` in an isolated checkout based on local main at `4cb05f9`, with main's pinned dependencies. The original checkout's uncommitted player package and lockfile changes were excluded.

## Verification

- `npm run player:typecheck`: passed after replacing a theme test's reference to the removed greeting style with the retained game title style.
- Focused component, navigation, theme, presentation-contract, simulator, and Map QA checks: 13 files passed. The first combined run had five stale source-digest expectations; these were updated after reviewing the intentional presentation changes. Existing behavioral and security assertions remain.
- An initial focused settings test invocation encountered the sandbox's esbuild parent-directory access restriction; its approved rerun passed.
- `node tests/e2e/player-shell-smoke.mjs`: 14 checks and 64 screenshots passed across light/dark themes and 320/360/390-pixel widths. No overflow, contrast, JavaScript, forbidden-action, or outbound-request findings. Minimum exposed wallet touch area remained 88 pixels. Representative onboarding, home, settings, wallet, and pass layouts were visually reviewed. No emulator or native-device run was performed.
- JavaScript syntax checks passed for the shell, Android smoke, map-handoff, and connected-smoke harnesses. `git diff --check` passed.
- The first `npm run verify` completed all 13 gates: 12 passed, and the unit gate found one additional stale expectation for the removed home greeting style in `playerLandingDesign.test.ts`. The expectation now checks the retained game title style. That design test and the final identity render suite passed all seven focused tests.
- The final `npm run verify` exited 0: all 13 gates passed. Root unit results: 253 suites passed, one skipped; 2,280 tests passed and 16 skipped. Web tests: 20 suites and 209 tests passed. Internal-tool tests: seven suites and 85 tests passed. The final sample-profile edit was also checked with player TypeScript and the browser harness. Existing ExcelJS `eval` and renderer chunk-size warnings remain.

Runtime verification used unreachable localhost API endpoints with Firebase sync and telemetry disabled; browser QA used isolated adapters and blocked outbound requests. Logs and screenshots remain in ignored `out/` paths: `player-text-cleanup-focused-final.log`, `player-text-cleanup-browser.log`, `player-text-cleanup-verify.log`, `player-text-cleanup-verify-final.log`, and `player-shell-qa/`. No production services, pushes, or deployments were involved.
