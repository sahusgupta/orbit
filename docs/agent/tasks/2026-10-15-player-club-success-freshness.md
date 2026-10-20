# Preserve current club publications after successful requests

Delayed successful membership, seat-request and cancellation responses could replace a newer club publication or re-add a venue removed while the request was pending. The earlier [rollback fix](./2026-10-15-player-seat-request-rollback.md) protected failed responses; this task covers accepted responses.

## Scope and behavior

Only [usePlayerClubs](../../../player-app/src/application/usePlayerClubs.ts), its [flow tests](../../../player-app/src/application/usePlayerClubs.flow.test.tsx) and this record changed for this task. The callers remain `PlayerApp.tsx`, the existing hook harness and the local RN Web QA entry. API response types, persisted data, authentication, membership eligibility, confirmation and request payloads are unchanged.

A request captures its current venue object and, for join/cancel, its own optimistic projection. A successful response replaces only that expected object. A different publication object or a removed venue wins; the response cannot append it again or reselect it. The backend operation still reports success, an accepted seat draft closes, and successful-request attribution remains intact. Ordinary responses still apply normally. Failure rollback retains the same identity check.

This deliberately does not invent ordering for revision strings or compare clocks. An intervening publication is retained even if it does not yet include the accepted operation; normal publication refresh reconciles it.

Membership continuation runs once after React commits the conditional response update. It reads the current matching club and game, requires the same authenticated player, and opens only the existing confirmation draft for active access. Requested access retains its review message. Removed venues/games or revoked/expired access cannot reopen a draft from the stale response. The state updater contains no navigation, continuation or telemetry side effects.

## Characterization and regression evidence

Before bytes are preserved in ignored `out/player-club-success-freshness/before.json` and its two named source copies. The unchanged hook SHA-256 was `36e2a02a41b1aaff3e84d573ddbe8d25ad78f18b37426591ebea4241095e097a`.

All runs use `node out/run-club-success-freshness-tests.mjs <stage>`, an allowlisted OS environment, external temporary directory, disabled dotenv/sync and all selected API origins set to `http://127.0.0.1:9`. Service calls are mocked; workers are capped at two. Each stage preserves its command, times, hashes, JSON test result and log under the ignored evidence directory.

| Stage | Actual result | UTC record stem |
| --- | --- | --- |
| Initial sandbox baseline | Exit 1 before tests loaded: esbuild ancestor-directory access denied | `baseline-2026-10-15T14-13-25.317Z` |
| Identical baseline outside that restriction | 16/16 passed, exit 0 | `baseline-2026-10-15T14-13-38.103Z` |
| Ordinary-success characterization, unchanged hook | 20/20 passed, exit 0 | `characterization-2026-10-15T14-14-44.645Z` |
| Desired regressions, unchanged hook | 7 failed /20 passed, exit 1 | `red-2026-10-15T14-16-35.444Z` |
| Corrected hook | 27/27 passed, exit 0 | `green-2026-10-15T14-18-17.891Z` |
| Four affected suites | 114/114 passed, exit 0 | `affected-2026-10-15T14-18-43.356Z` |

The four passing characterizations cover accepted join/cancel snapshots and Requested/Active membership continuation without automatic seat submission. Six desired cases reproduce newer-publication overwrite/removal resurrection for successful join, cancel and membership under Strict Mode. The seventh verifies that membership continuation uses the current game and table rather than the original draft. Existing rejected-response, account-switch, attribution and Strict Mode rollback cases remain intact. Affected suites also include hook helpers, PlayerApp orchestration and club-route rendering. Mock DOM-property/React `act` warnings remain visible in the affected output; none were suppressed.

Final focused hook SHA-256: `bc8a91a92ebd698cc0ffa4ef56ad31722a39ef595b1f49157c9f125c577df745`. Flow-test SHA-256: `9aab9bc4e84481488428835a8f3041e9f8ce1d9d01e1d40a9939d70daf1029fa`.

Player strict types and the required aggregate verification are owned by root after the concurrent changes settle; this focused record does not claim those runs. No SDK, hosted service, native runtime, package, deployment, commit or push was performed for this change. Prior Android/iPhone evidence retains its original source provenance and does not validate these new bytes.
