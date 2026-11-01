# Player Web landing scroll and timer lifecycle — October 31, 2026

This focused task reduces redundant landing-page geometry scans and retires owned swipe timers. It follows the authorized overnight resource/reliability work. Scope is the [landing component](../../../player-web/src/components/home/player-landing.tsx), its new [lifecycle tests](../../../player-web/src/components/home/player-landing.lifecycle.test.tsx), and this record. The existing static-markup test continues using real Motion and is unchanged.

## Behavior preserved

- The initial effect measures the restored position synchronously, after attaching one passive scroll listener. Initial navigation state and story selection are not postponed until an animation frame.
- Each actual scroll event still updates navigation shadow synchronously; the threshold remains strictly `scrollY > 40`.
- Story selection preserves the existing clamped quarter-range thresholds. A missing element or non-positive scroll range preserves the current section.
- Accepted drag offsets remain strictly greater than `100` or less than `-100`; exactly either threshold does nothing.
- Every accepted swipe independently advances the card after 300 ms. A right swipe shows its preview immediately and independently clears it after 2,400 ms. Overlapping swipes are not debounced; a later left swipe does not clear an active preview.
- Changing story sections does not cancel parent-owned swipe callbacks. Returning to the swipe section shows the advanced card and the remaining original preview lifetime.

## Implementation

Only expensive story-geometry measurement is coalesced: each scroll burst owns at most one pending animation frame. Its callback retires the pending handle before reading current geometry, allowing a later scroll event to schedule the next frame. The nullable frame handle supports ID `0`; full component cleanup removes the listener and cancels its pending frame.

A parent-owned Set records pending swipe timeout handles. Each callback removes its own handle before applying the unchanged state update. Full landing unmount clears only remaining handles and empties the Set. Completed handles are not cleared again. StrictMode effect replay is covered.

JSX presentation, CSS, routes, authentication, APIs, polling intervals, sync protocol, native code, dependencies and provider configuration are unchanged.

## Characterization, regressions and measurements

All focused runs used the existing isolated Node wrapper from `player-web/`, with loopback API endpoints, memory storage and disabled synchronization:

`node ../out/resource-reliability-20261031/run-isolated.mjs node_modules/vitest/vitest.mjs run src/components/home/player-landing.lifecycle.test.tsx`

- Baseline 03 passed 25 characterization tests against unchanged source `F8DCE6BD87234FA44FCE10B7C733E5F7786C927F583B1C386D9005492DF7C4C1`. Card advances are asserted through distinct text inside the real drag card, not callback identity or mount counts.
- RED 02 retained all 25 passes and failed seven new scheduling/resource tests against that same old source; test hash `3372F87279DA780FC8394E06FFFCC4F41896F40B467AFBBF2087806A2E013F4C`. Failures covered burst coalescing, repeated frames, current geometry, frame-zero cancellation, pending timers, completed-handle retirement and StrictMode cleanup.
- GREEN 01 passed 31/32 tests. Its later StrictMode assertion incorrectly expected the total timer count to equal the landing's two new timers; it observed 12. That failed run is preserved. The test was corrected to verify ownership by strict handle identity; the earlier RAF regression was retained unchanged.
- Final GREEN 02 passed all 32 tests, exit 0, with no skips. Source/test hashes remained unchanged throughout the run.
- The final StrictMode diagnostic observed 10 timers before the manual swipe and 12 afterward, with exactly two newly created delays: `[2400, 300]`. Full unmount cleared both owned handles by strict identity and reduced the global count from 12 to zero. The origin of the pre-existing ten timers was not established.
- A deterministic burst of 100 raw scroll events after mount performed 100 manual story `getBoundingClientRect` reads in baseline and one in final GREEN 02, with the same final section. This counts only that component's explicit story scan. It is not a measurement of all Motion/browser layout work, frame rate, production CPU/memory, network requests or Firestore quota savings.

Final frozen local file inputs (raw bytes):

- Component SHA-256: `7553595337E14CD17289ED870EA272CC8B52891170FBEE0DC7461A8BBDF1B6C3`.
- Lifecycle test SHA-256: `3580BDF887CE64E9722FA6D5AF631DDF357932A0D182F25BB4901F8F34154CE1`.

## Validation

- Initial area TypeScript command completed with exit 0 (terminal `14338`), before the small initial-callback lint correction.
- Initial full Player Web lint completed with exit 1 (terminal `43469`): direct `setScrolled` in the effect violated the existing effect rule. The original initial `onScroll` callback invocation pattern was restored. No lint rule or suppression was changed.
- The corrected component-only ESLint run completed with exit 0 (terminal `14768`).
- Full `npm run verify`, invoked through `node out/resource-reliability-20261031/sdk-integration/run-isolated.mjs verify`, completed with exit 0 in original terminal `42628`, observed at `2026-10-31 21:57:39 UTC`. All 13 checks passed, including final full Player Web lint, root/Player/Web/sales-map TypeScript, release contract/artwork, all three test suites and all three production builds. Tests: 354 Web + 85 sales-map + 3,060 main = 3,499 passed; 16 existing main-suite skips. Existing React act/reduced-motion, ExcelJS eval and chunk-size warnings remain visible in the raw log.
- Independent static review found no material issue in the final component/test inputs. It examined the production caller, existing real-Motion SSR coverage, scheduling ownership, preserved swipe semantics and the focused test adapter. No browser frame-rate or production resource benchmark was performed.
- Git-normalized LF component SHA-256 is `9936e293728c156f150516bf5399ee5695c1f75a5aa2dacb0e4f6fa58c52c9ce`; the lifecycle test already uses LF and retains its raw hash above.

## Evidence and limits

Ignored, local-only evidence is under `out/player-web-scheduling-characterization-20261031-agent/`; it is not portable with a repository clone. Each run has its raw `.log` and command/terminal-code/before-and-after-hash `.json` pair: `characterization-baseline-03`, `scheduling-regressions-red-02`, `scheduling-regressions-green-01`, and `scheduling-regressions-green-02`. Earlier failed characterization attempts remain preserved separately.

Final aggregate evidence is `out/player-web-scheduling-20261031/full-verify-result.json` (SHA-256 `7b7fadd340584f2508190ed37d295f6be905ce84a422796cce4400b24b30d546`), bound to the frozen input hashes and original terminal exit. Its unchanged raw log is `out/player-web-scheduling-20261031/full-verify.log` (SHA-256 `685b393169668b47111cb79329334f00a5f1be803c3ec527d26806e25e0e1cfa`). The independent static review is `out/player-web-scheduling-independent-review-20261031/independent-static-review.json` (SHA-256 `ee07d2c56d5108fb30171231789932cdbe3f1e1bfc0afd8c179363bed6042cd8`). These files are also local ignored evidence.

GREEN 02 JSON includes the scroll measurement and both StrictMode timer diagnostics. The initial static-markup and feature-card tests remain separate real-Motion coverage; this focused lifecycle suite uses a typed Motion adapter to preserve actual children, DOM attributes, refs and the real drag callback while excluding animation clocks.

No service, provider operation, browser/desktop control, deployment or EAS operation was performed by this scoped change. The [sustained recovery record](2026-10-31-sustained-reliability-failure.md) retains the unmet full-soak/game-coverage gates and the failed native recovery evidence. This landing improvement does not satisfy those native gates or establish that the prior heap failure is repaired.
