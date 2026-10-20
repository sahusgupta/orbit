# Player card reader summary — 2026-10-15

The front Match card previously named only its game and venue to assistive technology. Its explicit button label omitted the visible availability, location, tournament start and buy-in. The same private primary-facts formatter now supplies both the visible card text and its accessible name. The name retains the `Open game at venue` action prefix and separates the visible facts with `; `. Game info remains closed initially; table counts, queue counts, fee details and ranking explanations stay outside this summary.

The shipping change is limited to [OrbitMatchScreen.tsx](../../../player-app/src/features/match/OrbitMatchScreen.tsx). It changes no layout, gesture state, navigation action, persistence, API contract or native configuration. [The render suite](../../../player-app/src/features/match/OrbitMatchScreen.render.test.tsx) retains all 88 earlier cases and adds three passing characterizations and four semantic parity cases. Coverage includes cash availability, same-card publication updates, last-loaded state, scheduled start and buy-in, missing address/distance/start/buy-in, invalid start values and a valid zero buy-in. The existing exact-label assertions were updated to the fuller name; the shared exact-match button helper was preserved.

## Focused verification

All four runs used the ignored [clean runner](../../../out/run-card-reader-summary-tests.mjs). It launches only this mocked jsdom/Vitest file with an OS environment allowlist, isolated home directories, external temporary storage, `EXPO_NO_DOTENV=1`, `VITE_ENABLE_FIREBASE_SYNC=false`, and API origins set to unreachable `http://127.0.0.1:9`. No API, Firebase, SDK, browser, native guest or hosted service was started. Each record reports unchanged selected input hashes during its run and unchanged root branch, HEAD, index hash and empty staging.

| Command | Actual result and UTC time | Record |
| --- | --- | --- |
| `node out/run-card-reader-summary-tests.mjs baseline` | Exit 0; 88/88 passed; 14:12:32.950–14:13:20.497 | [Baseline](../../../out/player-card-reader-summary/baseline-2026-10-15T14-12-32.947Z.json) |
| `node out/run-card-reader-summary-tests.mjs characterization` | Exit 0; 91/91 passed against unchanged shipping source; 14:17:15.620–14:17:26.641 | [Characterization](../../../out/player-card-reader-summary/characterization-2026-10-15T14-17-15.618Z.json) |
| `node out/run-card-reader-summary-tests.mjs red` | Exit 1 as intended; exactly four new semantic cases failed, 91 passed; 14:18:10.016–14:18:21.507 | [Desired RED](../../../out/player-card-reader-summary/red-2026-10-15T14-18-10.013Z.json) |
| `node out/run-card-reader-summary-tests.mjs fixed` | Exit 0; 95/95 passed; 14:19:27.258–14:19:38.626 | [Fixed](../../../out/player-card-reader-summary/fixed-2026-10-15T14-19-27.256Z.json) |

The unchanged shipping source for baseline, characterization and RED was SHA-256 `fda72b63b2c615ac35d1233baf161427b73eabaaab34636420233b87543aea1d`. Baseline render-test SHA was `5e1f720041bf1ed782122762250f7e51b81b5ab3e75624bd1c76ca4c318ed576`; characterization was `d5d904e7b6f6edc69f03bf5eced74d4ec50a96c4f6477e32a0adf50ad628964b`; desired RED was `7d14e096b70c030dfa63c8ccd993e02edafee64881063e171912eb268143f287`. Exact before copies are preserved under [the task evidence directory](../../../out/player-card-reader-summary/before).

After the successful focused run, shipping source SHA is `dcd8ae0f087654cb03d4b7a3c0d7b76ee340a6fd2a2c795b193b24cce64a11f8` and render-test SHA is `222def4250030f431ffde2b6fe62bea33864c1387360843493d3166afe212c48`. Root's [expanded affected suite](../../../out/player-match-listener-recovery/expanded-2026-10-15T14-20-20.031Z.json) subsequently passed 153/153, including all 95 Match render cases, at 14:20:31.494Z. [Player strict TypeScript](../../../out/player-match-listener-recovery/typecheck-2026-10-15T14-20-47.263Z.json) exited 0 at 14:21:05.487Z. Both used disabled sync, unreachable local API and the clean local environment. The combined shipping source then froze as `a4966960ee55617dbf5c5d13d22147c2d4c67faaa947cf18400a696f98635259` / 129 files behind the 39-file guard; root's aggregate full verification remains in progress at this checkpoint.

## Native QA selector compatibility

The caller audit found that [the browser smoke](../../../tests/e2e/player-match-smoke.mjs) already locates the front button by its `Open ` prefix. The general Android smoke also uses a compatible prefix. Home card names are produced by a different component and remain unchanged.

The repository [connected smoke](../../../tests/e2e/player-android-qa/connectedSmoke.mjs) and [Map handoff smoke](../../../tests/e2e/player-android-qa/mapHandoffSmoke.mjs) used exact short Match names. Their selectors now accept the same fixed fictional game and venue followed by an optional, explicitly separated primary-fact suffix. Connected game identity comes from an anchored regular-expression capture rather than slicing the entire description. Map selection retains the complete accessible name for its existing exact gesture and Undo comparisons. Existing fictional eligibility, one-front-card, package, enabled, clickable and display-bound checks remain.

[Map QA guard tests](../../../scripts/player-android-map-qa.test.js) add suffix acceptance and rejection cases for altered game/venue/action prefixes, missing separators, empty suffixes, newlines, duplicate eligible cards, and foreign, disabled or clipped nodes. Root ran this pure suite: [25/25 passed, exit 0](../../../out/player-match-listener-recovery/qa-selectors-2026-10-15T14-23-16.010Z.json), at 14:23:16.012–14:23:18.608Z, with source and root HEAD/index unchanged, disabled sync, unreachable local API and no services or SDK invoked. No native QA case was executed for this selector change. Frozen ignored seat-disclosure and preference-CAS flows and all historical native proof remain untouched; their old exact-name selectors must be adapted in any separately reviewed future clone before a current-source native run.

The three QA file hashes handed to root are:

| File | SHA-256 |
| --- | --- |
| `tests/e2e/player-android-qa/connectedSmoke.mjs` | `92872bf799228be77617402d083f5abd77e759d3528ad0966f862ef0afdaa000` |
| `tests/e2e/player-android-qa/mapHandoffSmoke.mjs` | `a9c49c647fa3dbf848a60ed2ad0c707a7bc5e6cce2a5c91d82f4bcdf7ec737d5` |
| `scripts/player-android-map-qa.test.js` | `f79b4210a3605fdd1aef1894d149cbafd4c1ddf17f1a599f66c845fb31a453f4` |

## Current browser regression review

Root ran the reviewed [browser wrapper](../../../out/run-live-recovery-browser.mjs) against source `a4966960` / 129 and the exact 39-file guard. The [wrapper record](../../../out/player-live-recovery-browser-2026-10-15T14-25-20-179Z/result.json) reports child and wrapper exit 0 at 14:25:20.179–14:26:15.261Z, unchanged source guard/root HEAD/index, external temporary storage and loopback-only transport. The [completed browser report](../../../out/player-live-recovery-browser-2026-10-15T14-25-20-179Z/current-match-qa/results.json) contains 28/28 passing checks, 14 in each theme, with zero page errors, warnings or blocked requests. Checks cover compact/open/closed info, swipe and button parity, Saved and explicit request controls, remote preference conflict, local journal failure, pending retry, stale and ended listings, paging, keyboard access, 200% web text and mounted theme changes.

An independent read-only review read the wrapper and every check, then rehashed exactly the 53 listed historical assets and 53 listed current assets at 14:29:22.895Z; every bounded file size and SHA matched. The enlarged [light preference capture](../../../out/player-live-recovery-browser-2026-10-15T14-25-20-179Z/current-match-qa/light/preferences-text-stress-200pct.png) and [dark preference capture](../../../out/player-live-recovery-browser-2026-10-15T14-25-20-179Z/current-match-qa/dark/preferences-text-stress-200pct.png) retain readable section text, the long venue name, search input and Favorite/Exclude/Save/Reset controls without clipped labels. The harness also explicitly checked horizontal overflow and button text clipping. There is no successful current DOM/XML semantic snapshot in the listed assets; unchanged inherited `failure.html` files are historical evidence. Exact primary-summary semantics are therefore supported by the 95-case render suite, without claiming a fresh stored browser accessibility-tree observation.

This browser proof uses Chromium and React Native Web, a synthetic account, local HTTP transport, an in-memory datastore and a localStorage journal. It is not native Firebase Auth, SecureStore, physical reader verification, or an actual terminal-listener-error recovery case. Historical unthemed and failure assets remain preserved and are not additional current checks.

This proves the rendered semantic contract with mocked native components. It does not prove VoiceOver/TalkBack behavior, physical-device layout or frame timing. The earlier source `9dbe` iPhone build `019d7534` and Android CAS package `c9609423` predate this change; their proof remains bounded to that source. The [acceptance review](../reviews/2026-10-12-orbit-match-acceptance.md) retains the wider physical-device and real pilot gates.

The work stayed on `docs/desktop-release-0.1.79-evidence`, preserving root HEAD `9680ee0dccd73405ea38964df6796e19c94e3a69` and index SHA `ba97ba688f9c878137356ba84eb03d30a69184686ced16deb2f7de8678434f85`. No files were staged, committed, pushed or deployed; unrelated existing changes were preserved.
