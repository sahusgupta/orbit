# Club QR self-check-in

## Objective

Let a club generate a printable, club-specific QR code in Orbit Core. A player who scans it can enter their name, be matched to exactly one existing club profile, choose a currently available table, and be seated through the authoritative API. An unknown or ambiguous name must create a staff-visible manual-assistance arrival without creating a profile or seating anyone.

## Boundaries and decisions

- The phone flow is an API-hosted, mobile web page. It does not require the native Player app, Firebase player authentication, or an installed deep link.
- The QR is a bearer capability signed by the API. Its fragment is kept out of navigation requests and referrers. Core is the only issuer-facing client, issuance requires the existing tenant-bound client authentication, and every new club generation revokes only that club's prior prints.
- A name is valid only after Unicode normalization, length/control-character checks, and an exact case-insensitive match. Zero or multiple matches take the manual-assistance path.
- The API returns only the matched display name and open tables with live capacity. It never returns the player directory or other profile fields.
- Table capacity is calculated from active `playerSessions`, then checked again during the compare-and-swap mutation. The API assigns the first available seat at the selected table.
- Unknown arrivals append a bounded `staffRequests` assistance event. Equivalent pending arrivals are deduplicated, handled records are evicted before pending records, and a full pending queue fails closed. They do not enter demand/waitlist calculations, acquire a fabricated `gameId`, create a player profile, or imply check-in/seating. Core presents those durable events as walk-in alerts, including events received while Core was closed.
- Direct seating updates the existing `sessions`, `playerSessions`, `interests`, `profiles`, and `playerLedger` shapes. Sync reconciliation is extended only across those authoritative operational lists plus `staffRequests` and the read-only `selfCheckIn` generation mirror.
- No production Firebase rules, player payload schema, payment/identity behavior, or unrelated Player app source changes are in scope.

## Security and failure design

1. `POST /management/self-check-in/qr` requires current client authentication, `client:write`, an exact tenant binding, an active license, and a stable mutation ID. Core also requires an active Owner/Manager `staff-admin` session. It asks for the PDF destination before rotating the server capability, retries an interrupted response with the same issuance identity, and the signed URL never crosses into renderer code. The API response uses `Cache-Control: no-store`.
   The authenticated management UI may create the first active Owner or Manager only when no active Owner/Manager exists, including recovery from legacy Floor-only rooms. A Floor account cannot be bootstrapped ahead of an administrator, and every later staff-account change still requires a verified Owner/Manager session.
2. `POST /player/check-in/lookup` has a dedicated address-only process limit and requires a valid club capability, JSON input, a bounded name, and a stable mutation ID. Production also has a verified Vercel WAF quota of 600 requests per IP per 60 seconds across every API route; the process-local 120-per-10-minute check-in quotas are stricter defense in depth, and untrusted generic authorization headers cannot select a different application bucket.
3. A unique known profile receives a short-lived signed scan session plus a fresh table list. Unknown and ambiguous names append one idempotent, bounded staff-assistance event and return no roster details.
4. `POST /player/check-in/seat` has a separate rate limit and requires the short-lived scan session, a bounded table ID, and a stable mutation ID.
5. Seating reloads authoritative state, revalidates club/profile/table/capacity and central license status, and commits with revision preconditions and idempotency. Duplicate receipts are resolved from the authoritative committed state; revision conflicts retry from fresh state; stale/full choices return `409` without overbooking.
6. The active QR generation is server-owned. Generic desktop state writes preserve it, and Core advances its writable revision only when the corresponding full authoritative state is adopted. Staff verification, QR preflight, cancellation, and partial issuer responses use non-adopting reads so stale renderer state must conflict instead of overwriting remote check-ins.
7. Token comparison is timing-safe; secrets and full capabilities are not logged, persisted in Core state, or returned to the renderer. A scan session is one-use for seating and remains idempotent across retries. Central license revocation or renewal invalidates previously issued capabilities, and already-seated name lookups disclose no location.
8. Cross-origin requests remain subject to the existing origin policy, and all check-in responses opt out of caching and indexing.

The deliberately scoped player authorization model is possession of the current physical club QR plus an exact existing profile name. That satisfies the requested name-based walk-in flow but is not a cryptographic proof of player identity; adding a phone/PIN, authenticated Player-app handoff, or another second factor would be a separate product and data decision.

## Test plan

- Pure capability/session tests: valid, forged, malformed, wrong audience, and expired tokens.
- Pure workflow tests: input normalization; unique, unknown, and ambiguous lookup; live capacity; deterministic seating; duplicate/already-seated/full/closed/missing cases; no source mutation.
- API route tests: tenant-bound issuance, unauthenticated denial, invalid content and token rejection, unknown alert persistence without profile creation, known table choices, idempotent seat mutation, stale capacity, and route-specific rate limiting.
- Public-page tests: capability handling, accessible labeled form/table controls, pending/error/success states, and no inline script/style under the API CSP.
- Core tests: walk-in notification wording/deduplication, operational-list reconciliation, Electron API call/IPC parity, and PDF structure.
- PDF QA: create a non-production sample, reopen it, extract text, render to PNG, visually inspect the QR quiet zone, typography, margins, instructions, and footer.
- Verification: focused tests first; then API and Electron type checks, root/player checks, all tests, renderer/public builds, dependency/security gates, `npm run verify`, and complete diff/status review.

## Rollout and rollback

1. Configure the production self-check-in signing secret without printing or committing it.
2. Verify the live production WAF quota still covers both public check-in POST routes. Any future dedicated rule must follow log-first review and owner publication.
3. Deploy an alias-withheld API candidate from the exact reviewed commit and run health, static check-in page, forged-token, authenticated issuance, and isolated non-production seating smokes.
4. Promote that exact API deployment and observe errors/publication health.
5. Build the next immutable desktop candidate through the manual release workflow, review checksums/attestation/smokes, then promote the same inputs.
6. Update the download manifest and public installer link only after the desktop release exists; deploy and verify the download site candidate before promotion.
7. Roll back by promoting the prior API/public deployments and by publishing a higher-version desktop roll-forward from the last known-good source. Never decrement authoritative state revisions or replace release bytes.

## Completion evidence

Completion requires passing designed tests and release gates, a visually verified PDF, successful production API/desktop/download-site promotion, clean post-deploy smokes/log checks, and a final worktree report that separates pre-existing user changes from this task.
