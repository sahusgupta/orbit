# Orbit API

Standalone backend for Orbit desktop, Orbit Player, and the operator dashboard.

## Orbit Player iOS v1 boundary

The conservative Player iOS v1 uses authenticated membership/waitlist requests, nonbinding tournament interest, short-lived check-in credentials, profile/deletion operations, phone OTP when chosen, and on-device PDF417 capture. It does not expose Player Premium, RevenueCat purchases, player-hosted/private games, venue membership checkout, or operational tournament registration. Legacy payment/subscription routes may remain server-side for non-v1 compatibility, but they are not reachable from or enabled by the reviewed iOS client.

`POST|DELETE /player/tournament-registrations` deliberately rejects Player requests. V1 uses `/player/tournament-interests`, stored separately from entrants and financial state. Hosted Stripe Identity remains a conditional web/compatibility verification flow; it is distinct from Stripe payment/checkout behavior, which is absent from iOS v1.

### Player App Check activation gate

Player App Check is an explicit fail-closed production gate, not a switch to enable before every active protected client is ready. Complete this order:

1. Register and configure the native iOS Firebase App for the reviewed bundle identifier, then configure App Attest as its Firebase App Check provider. Register and configure the operational Player Web Firebase App with an appropriate Web App Check provider as well.
2. Ship reviewed native iOS and Player Web clients that each obtain App Check tokens and attach `x-firebase-appcheck` to phone-auth start/complete and every other protected Player API call. If Player Web is intentionally disabled instead, record that operational decision and verify its protected operations are unreachable.
3. In a nonproduction environment, verify that the API accepts each exact registered client Firebase App ID and rejects absent, invalid, wrong-client, and other-app tokens.
4. Set `ORBIT_PLAYER_APP_CHECK_APP_IDS` to the comma-separated exact Firebase App IDs for every active protected client, then set `ORBIT_REQUIRE_PLAYER_APP_CHECK=true` and rerun the protected route tests before production promotion.

Enabling the requirement before both active clients ship App Check support fails closed and makes their protected Player flows unusable. Enabling it without an allowlist returns `503 APP_CHECK_NOT_CONFIGURED`; missing, invalid, or non-allowlisted attestations are rejected with `401`. The boundary is covered by `apps/api/src/appCheckService.test.js` and the server route tests. Do not record App Check as launch-ready until nonproduction token evidence exists for every active client.

### Scale-out rate-limit gate

The current `createRateLimit` implementation stores counters in a process-local `Map`. Its state resets with the process and is neither shared nor atomic across replicas, so it is not sufficient protection for a scaled production deployment. Before running more than one API replica, choose and provision a shared durable limiter—such as a Firestore transactional counter design, a managed rate-limit service, or an appropriately scoped edge/WAF rule—then add multi-instance/retry tests and operational evidence for the selected boundary. Process-local test coverage is not evidence that this external gate is complete.

## Run Locally

```powershell
npm ci --prefix apps/api
$env:ORBIT_MACHINE_CREDENTIALS_JSON='[{"id":"local-desktop","key":"dev-orbit-key","accountKey":"local-club","scopes":["client:write"],"expiresAt":"2099-01-01T00:00:00.000Z"}]'
$env:ORBIT_OWNER_API_KEY="separate-local-owner-key"
$env:API_PORT="4629"
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
npm run api:dev
```

Health is public:

```powershell
Invoke-RestMethod http://127.0.0.1:4629/health
```

## Remove Stress-Test Clubs

Preview the exact clubs whose root Firestore `name` contains `stress`, case-insensitively:

```powershell
npm run clubs:cleanup:stress
```

The command is dry-run-only unless both execution arguments are supplied:

```powershell
npm run clubs:cleanup:stress -- --execute --confirm DELETE_STRESS_CLUBS
```

Execution recursively removes each matched `clubs/{clubId}` document and its subcollections, then removes the matching `clubStates/{clubId}` saved state. Clubs without `stress` in their current root name are never selected, and each name is checked again immediately before deletion. Firebase Admin credentials are required through `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, or `GOOGLE_APPLICATION_CREDENTIALS`.

Nonpublic endpoints require an audience-appropriate identity: a scoped machine/pilot credential, an owner credential, a dashboard session, or a verified Firebase Player token. Query-string credentials are rejected.

## Environment Variables

- `API_PORT`: API port, defaults to `4629`.
- `ORBIT_MACHINE_CREDENTIALS_JSON`: array of machine credential records with `id`, `key`, tenant `accountKey`, `scopes`, and `expiresAt`. Store it only in an approved secret provider.
- `ORBIT_OWNER_API_KEY`: distinct owner automation credential. It does not authenticate ordinary client or dashboard-session traffic.
- `ORBIT_DASHBOARD_PASSWORD` and `ORBIT_DASHBOARD_SESSION_SECRET`: create a short-lived HttpOnly/Secure/SameSite=Lax dashboard cookie. The signing secret must contain at least 32 characters.
- `ORBIT_SELF_CHECK_IN_SECRET` and `ORBIT_SELF_CHECK_IN_ORIGIN`: legacy printed-check-in compatibility settings. Conservative v1 does not issue or accept name-based printed check-in credentials; the management issuer and all public action endpoints return `410`.
- `ORBIT_ALLOWED_ORIGINS` and `ORBIT_TRUST_PROXY`: explicit CORS and proxy policy. Vercel's single, header-overwriting proxy hop is trusted automatically so HTTPS same-origin dashboard requests are recognized; other deployments must configure proxy trust only after their exact proxy is reviewed.
- `ORBIT_ALLOW_INSECURE_LOOPBACK_AUTH`: explicit local-development bypass. It is rejected in production and Vercel runtimes.
- `ORBIT_LOG_HASH_SECRET`: independent server-only HMAC secret of at least 32 characters required in every hosted or production runtime. It protects player, request, provider-error, and audit references from offline guessing; do not reuse the dashboard-session, QR, phone-challenge, or deletion secret. Local/test runtimes use a process-ephemeral fallback rather than a checked-in correlation key.
- `ORBIT_PHONE_CHALLENGE_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`: server-side SMS OTP verification. No Twilio credential is shipped to Player clients.
- `ORBIT_MEMBERSHIP_QR_SECRET`: independent server-only HMAC secret of at least 32 characters for opaque membership check-in credentials. Provision it through the production secret manager; never place the value in source, a client variable, or release evidence.
- `ORBIT_MEMBERSHIP_QR_TTL_MS`: optional credential lifetime in milliseconds. The API clamps it to 30,000 through 300,000 milliseconds and defaults to 120,000; record the deployed value without exposing the signing secret.
- `ORBIT_PLAYER_APP_CHECK_APP_IDS`: comma-separated allowlist of exact Firebase App IDs permitted at the Player App Check boundary. It must cover native iOS and operational Player Web (or any later active protected client); configure and verify every entry in nonproduction before enforcement.
- `ORBIT_REQUIRE_PLAYER_APP_CHECK`: exact literal `true` enables fail-closed App Check enforcement for protected Player routes, including phone-auth routes. It is intentionally off unless explicitly activated after every active client and allowlist gate above passes.
- `ORBIT_ACCOUNT_DELETION_POLICY_JSON` and `ORBIT_DELETION_PSEUDONYM_SECRET`: explicit deletion/anonymization dispositions and stable protected subject identifiers. See `docs/architecture/DATA_CLASSIFICATION.md`; no legal retention policy is inferred.
- `ORBIT_LICENSE_PUBLIC_KEY_PEM`: optional newline-escaped P-256 public key override used to verify an administrator-provisioned signed pilot-license envelope. The checked-in branding public key is the default.
- `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, or `GOOGLE_APPLICATION_CREDENTIALS`: one approved Firebase Admin credential source is required by the API. Firestore is Orbit's only server datastore. The API also publishes player-safe live game documents at `clubs/{licenseKey}/games/{gameId}`, operational session history at `clubs/{licenseKey}/gameSessions/{sessionId}`, and canonical player documents at `clubs/{licenseKey}/players/{playerId}`. Membership players are documents in the `players` subcollection and are not duplicated as an array on the club document.
- `FIRESTORE_EMULATOR_HOST`: optional local-only Firestore emulator address. Never point ordinary development or tests at production.
- `ORBIT_FIRESTORE_MEMORY`: unit-test-only Firestore fake. Hosted runtimes reject it.
- `FIREBASE_WEB_API_KEY`: Firebase web-project API key used by the API only to request the configured Firebase password-reset email. It does not grant Admin access. Password changes still require one of the server-only Firebase Admin credential mechanisms above.
- `NODE_ENV`: `development`, `staging`, or `production`.
- `STRIPE_SECRET_KEY`: Stripe server secret used only by the API.
- `STRIPE_WEBHOOK_SECRET`: signing secret for `POST /webhooks/stripe`.
- `ORBIT_IDENTITY_RETURN_URL`: exact trusted HTTPS Player Web callback used by the separately configured hosted Stripe Identity compatibility flow, for example `https://orbitapp-one.vercel.app/me/profile`. The API ignores a client-supplied return URL. The iOS v1 has no custom URL scheme and uses its separate on-device PDF417 flow.
- `STRIPE_IDENTITY_VERIFICATION_FLOW_ID`: optional Stripe Dashboard verification-flow ID. Without it, the API creates a document check directly.
- `ORBIT_IDENTITY_REQUIRE_SELFIE`: matching-selfie checks default to on; set this to `false` only if the launch policy intentionally accepts document-only verification.
- `REVENUECAT_WEBHOOK_AUTH_TOKEN` and `REVENUECAT_PREMIUM_ENTITLEMENT_ID`: legacy server compatibility only. The iOS v1 has no RevenueCat client or Premium entitlement.
- `ORBIT_PAYMENT_SUCCESS_URL`, `ORBIT_PAYMENT_CANCEL_URL`, server-side membership price variables, and `ORBIT_PAYMENT_CURRENCY`: legacy/non-v1 checkout compatibility only. They are not public Player configuration and the iOS v1 does not call checkout.

`src/database.js` is the stable asynchronous persistence facade. `src/db/connection.js` owns the server-only Firebase Admin Firestore boundary; the focused client, telemetry, state, report, recovery, security-audit, and publication-outbox repositories use it. Firestore is the sole server persistence implementation.

`src/server.js` owns process listen/shutdown and exports the composed Express app. Non-listening middleware/route composition lives in `src/app.js`, with focused owners under `src/http/` and `src/routes/`.

Hosted startup requires Firebase Admin credentials and fails closed without them. Deploy the reviewed Firestore indexes and rules, validate connectivity, and initialize any venue missing from the authoritative Firestore collection through its revision-zero desktop-cache migration; see `docs/architecture/AUTHORITATIVE_STATE.md`.

## Desktop Connection

The Electron app reads:

- `ORBIT_API_URL`, default `https://orbitapp-one.vercel.app`. Use `http://127.0.0.1:4629` for local API development.
- an installation-scoped key from `ORBIT_MACHINE_CREDENTIALS_JSON`, optional when the installation has an active managed pilot key
- `NODE_ENV`

On launch it creates or reuses a stable `deviceId`, then sends `POST /clients/heartbeat`. It repeats the heartbeat every five minutes. API failures are logged quietly and never block app startup.

If `ORBIT_CLIENT_API_KEY` is not packaged with the app, Electron uses the activated card-house pilot `authorizationCode` as the client auth key. The API accepts these `TT-PILOT-...` authorization codes for client write/state/report operations, so existing card houses can connect on the next app launch with the key they already loaded.

Owner/admin read endpoints such as `/clients`, `/venues`, and `/telemetry/*` require `ORBIT_OWNER_API_KEY`. The dashboard accepts its password only at `POST /dashboard/session`, then uses a short-lived server-signed cookie; it never stores or transmits a master key in LocalStorage or an SSE URL.

For an active managed pilot license, the dashboard can create the venue's first management login through `POST /dashboard/licenses/:licenseDocumentId/management-account`. When the active key already has authoritative state, provisioning adds only the hashed management login record. When a replacement key has a different account identifier, the owner must explicitly provide `sourceAccountKey`; the API verifies the signed venue identity, rejects a source bound to another active license, copies the prior state to the active key, replaces only pilot/login credentials, and leaves the source record unchanged as a recovery copy. Both paths preserve the club's games, players, sessions, and settings and create the corresponding Firebase email/password user. Provisioning fails closed for inactive licenses, missing or mismatched state, existing target logins, and Firebase emails already in use. If the authoritative state commit fails after Firebase user creation, the API attempts to remove that new Firebase user and raises an operational alert.

## Server-Managed Pilot Licenses

Pilot authorization codes are stable credentials. Their operational expiration is stored by the API in the server-only Firestore `pilotLicenses` collection, using a SHA-256 authorization-code identifier rather than storing the raw key. The desktop checks `GET /license/status` at startup and every five minutes. Changing a license expiration in the dashboard therefore updates connected installations without issuing another key file or changing the venue account identifier.

If an installation must select its original file again after the file's signed expiration has passed, the desktop verifies the unchanged signature and uses that signed authorization code only to request the current managed status. It accepts the file only when the API confirms an active matching license with a future expiration, then loads the existing account before allowing sign-in. Offline, inactive, revoked, malformed, mismatched, and missing-account results fail closed and never offer blank account setup. The existing account login and club state remain unchanged; the server-confirmed expiration becomes the local access expiration.

Open the protected dashboard at:

```text
https://orbitapp-one.vercel.app/dashboard
```

The Pilot licenses section shows active, expired, and revoked keys; the venue; key suffix; last use; and expiration. An administrator can set an exact date, extend by 30 or 90 days, or revoke the license immediately. Every active-key card also exposes the matching management account's recovery override, reset-email, and direct password controls when that account has a configured login.

## Management Account Recovery

The dashboard's **Pilot licenses** and **Management account access** sections can create the first login for an active key and provide protected recovery controls for existing card-house management logins. If the active key has no state, select the prior club account shown in the provisioning form; copying is allowed only when its venue identity matches and no different active license still owns it. Neither path reveals an existing password. After provisioning, the card house loads its active pilot key and signs in with the new credentials; the desktop loads the authoritative state for that key before authentication, so the saved club data remains in place.

For a card house that was locked out after its key expired:

1. Renew the managed pilot license first. Recovery never bypasses an expired or revoked license.
2. On the active key card or in **Management account access**, start a 15-, 30-, or 60-minute owner-assisted recovery override for that venue.
3. Tell the card house to load its current signed key (or an approved replacement key mapped to the same account), choose **Use owner-assisted recovery** on the Orbit sign-in screen, and select one new password of 12–128 characters.
4. The backend binds the request to the account authenticated by that pilot key, replaces the Firebase password, revokes existing Firebase refresh tokens, commits the compatible management hash through the authoritative state revision/outbox path, and consumes the override. The pilot key itself never becomes a management password.
5. Cancel an unused override from the dashboard. Expired, consumed, and canceled overrides cannot be reused.

The owner can also:

- **Send reset email**: asks Firebase Identity Toolkit to send its configured password-reset email. This requires `FIREBASE_WEB_API_KEY`. An email reset changes Firebase only, so keep an owner-assisted recovery override active until the card house finishes the matching password inside Orbit.
- **Set password**: directly replaces a selected card house's Firebase and authoritative Orbit management password and revokes existing Firebase sessions. Share a temporary password through a separate secure channel; Orbit never displays it again.

Successful override, reset-email, and password-change actions appear in the dashboard's durable **Security activity** section. Those records include the venue account, protected actor reference, timestamp, revision or expiry metadata, and outcome. They never contain a password, password hash or salt, reset link, email body, raw pilot key, Firebase Admin credential, or dashboard session secret. Firebase acceptance of an email request is distinct from final mailbox delivery; provider-side delivery/activity visibility depends on the Firebase project's logging configuration.

The recovery store is in the authoritative server-only Firestore collections. The feature does not change DNS, registrar settings, certificates, the canonical production hostname, legal/company attribution, or production-domain cutover.

Self-asserted legacy bootstrap is disabled. A format-valid code and matching state body cannot create a managed license. Before a desktop uses a new signed key, an administrator must submit the complete signed envelope to the authenticated `POST /dashboard/licenses` endpoint. The API verifies its P-256 signature and expiration against the configured public key before storing the one-way authorization-code identifier. Existing already-managed licenses continue to authenticate normally; an unmanaged legacy installation must be provisioned from its original signed key rather than trusted from stored client state.

After that one migration release, ordinary renewals require neither a client update nor a replacement key file. If the API cannot be reached, the desktop retains its last server-confirmed expiration instead of granting a new renewal offline.

Desktop state/report operations are API-first:

- `load-state` and `load-state-for-account` IPC calls read from the standalone API first.
- `save-state` sends a stable mutation ID and expected revision to the standalone API. A successful server commit is then mirrored to the local desktop cache. If the API is unavailable, the local write is labelled an uncommitted offline cache and never reported as authoritative.
- Only the API publication outbox writes authoritative club projections to Firebase. Renderer and Electron Firebase state publishers have no runtime call sites.
- analytical reports are submitted to the standalone API first.
- if the API is unavailable, the desktop uses an encrypted non-authoritative file cache so current installs can reopen offline; it never reports that cache as a server commit.

Firestore publication uses sync protocol v2. The API tags every child document with a unique `syncRevision` and writes `clubs/{licenseKey}` last as the commit marker. This allows mobile clients to retain the previous complete snapshot while a multi-document API publish is in flight and to ignore stale documents from older revisions.

Player deletion places a durable per-account publication fence before projection cleanup. A deletion cannot remove Firebase Auth or report completion until every affected account's exact tombstoned authoritative revision is durably `published`, all older claimed attempts have acknowledged their postflight state, and the final exact-ID projection scrub has run again. A crashed publisher is never reclaimed from elapsed time alone. After the operator has independently verified that the owning runtime is terminated, the owner-authenticated `POST /publications/recover` accepts the exact account, revision, claim ID, `runtimeTerminated: true`, and an opaque evidence reference; the API uses its own clock, converts the abandoned attempt to safe-state compensation, and keeps deletion pending until that compensation completes. The same recovery applies to a crashed compensation attempt. Caller-supplied timestamps are ignored, and an unverified live attempt must not be recovered.

The canonical club commit marker publishes `minimumAge` only when management explicitly stores the supported value `18` or `21`. Existing venue documents do not gain that field until their authoritative state is saved and republished; no migration or client default is presented as a venue-authored age policy.

Player discovery batches central pilot-license inspection once per fetched venue page. Public/detail/authenticated snapshots and venue-bound Player mutations require both a matching unexpired local license record and an active matching managed license; revoked or expired venues are omitted or rejected, and an unavailable central inspection fails closed rather than serving stale venue state.

The legacy embedded desktop HTTP backend is no longer started by default. It can be temporarily re-enabled for compatibility with:

```powershell
$env:ORBIT_ENABLE_EMBEDDED_BACKEND="true"
```

Electron update events are sent to `POST /clients/update-event`:

- `checking-for-update`
- `update-available`
- `update-not-available`
- `update-downloaded`
- `update-error`

## Client Monitoring Endpoints

```powershell
$headers = @{ "x-orbit-api-key" = "separate-local-owner-key" }
Invoke-RestMethod http://127.0.0.1:4629/clients -Headers $headers
Invoke-RestMethod http://127.0.0.1:4629/clients/<deviceId> -Headers $headers
Invoke-RestMethod http://127.0.0.1:4629/venues/<venueId>/clients -Headers $headers
```

`GET /clients` returns installed clients with app version, platform, environment, update status, update event, last error, and last seen time. This is the foundation for an admin dashboard.

## Check From A Phone

Run the API bound through your development machine and use your machine LAN IP:

```powershell
ipconfig
```

Open from the phone browser:

```text
http://<your-lan-ip>:4629/health
```

For protected endpoints, use a REST client app that can send `x-orbit-api-key`, then call:

```text
http://<your-lan-ip>:4629/clients
```

## Current Data Endpoints

- `POST /state`: compare-and-swap an Orbit venue state using `state`, `expectedRevision`, and a stable `mutationId`. Returns HTTP 409 for a stale revision.
- `POST /management/self-check-in/qr`: deliberately returns `410 PUBLIC_SELF_CHECK_IN_KIT_DISABLED`; conservative v1 does not issue a reusable printed, name-based credential.
- `POST /player/check-in/context`, `/lookup`, and `/seat`: deliberately return `410 PUBLIC_PLAYER_CHECK_IN_DISABLED`. The static `/check-in` page clears legacy bearer fragments and directs signed-in players to show their short-lived membership QR to staff.
- `GET /state/latest`: fetch the most recently saved venue state.
- `GET /state/:venueId`: fetch a stored venue state.
- `GET /player/snapshot?accountKey=<venueId>`: fetch mobile/player-facing snapshot.
- `POST /player/membership-requests`: apply a membership request to venue state.
- `POST /player/waitlist-requests`: apply a waitlist request to venue state.
- `POST /player/membership-qr`: issue an opaque, short-lived membership check-in token only for the signed-in player's active membership after current identity age eligibility is verified against the venue's current 18+/21+ policy.
- `POST /management/membership-qr/redeem`: redeem a token with tenant-scoped staff authority. The single state transaction rechecks the token subject's current identity record and current venue minimum age before it consumes the token and records check-in; a missing, revoked, or newly insufficient identity leaves the token unused.
- `POST|DELETE /player/tournament-registrations`: reject legacy/direct Player attempts to create an operational registration.
- `POST|DELETE /player/tournament-interests`: idempotently create or withdraw the signed-in player's bounded, nonbinding interest without changing entrants or financial state.
- `GET /publications`, `POST /publications/drain`, and `POST /publications/recover`: owner-protected inspection, retry, and explicitly evidenced terminated-runtime recovery controls for the durable Firebase publication outbox.
- `POST /player/membership-checkout`: legacy/non-v1 compatibility. The production iOS v1 has checkout disabled and contains no caller or purchase UI.
- `GET /player/identity/status`: return the signed-in player's sanitized eligibility status and extracted name, date of birth, and address.
- `POST /player/identity/capture`: accept only the signed-in player's confirmed name, date of birth, address, and mutation ID after an on-device PDF417 scan. Raw barcodes, ID numbers, photos, and selfies are rejected.
- `POST /player/identity/session`: conditional hosted Stripe Identity verification used by the web/compatibility flow; it is not a payment endpoint.
- Standalone `DELETE /player/identity` is not registered in the conservative Player release. Identity-provider redaction is orchestrated only by authenticated `DELETE /player/account`, so a delayed verified webhook cannot restore a separately deleted eligibility record while provider redaction is pending.
- `POST /player/auth/phone/start` and `/player/auth/phone/complete`: prove phone ownership with a bounded SMS OTP challenge and exchange it for a Firebase custom token.
- `DELETE /player/account`: after recent reauthentication, start the server-owned deletion/anonymization job and return every retained category. The running phase uses a transactionally owned, renewed lease and persists a pseudonym-keyed cleanup manifest before destructive work; a concurrent request joins the live job, while a later authenticated retry can reclaim an expired lease and repeat the idempotent cleanup from that manifest. Orbit-controlled cleanup and exact sanitized projection acknowledgement finish before Firebase Auth removal. If an Identity creation intent, publication acknowledgement, Auth removal, post-Auth cleanup, or the terminal marker still needs replay, the API returns `202 DELETION_FINALIZATION_PENDING`; bounded server finalization resumes opportunistically without further user reauthentication, does not remove Auth while an Identity intent is unresolved, treats an already-missing Auth user as success, and replaces transient running/finalizing state containing `pendingAuthUid` with a pseudonymous `complete` state that contains no raw UID or cleanup manifest. Anti-resurrection enforcement deliberately retains a server-only `playerDeletionBlocks/{firebaseUid}` document (the UID remains in that document path for Firestore-rule lookup) and a separate `orbitPlayerDeletionMarkers/deleted_<sha256(uid)>` marker. The repository defines no expiry for these security markers; completed deletion-job payloads remain UID-free.
- `POST /webhooks/stripe`: verify Stripe events and write paid memberships plus immutable revenue transactions to Firestore.
- `POST /webhooks/revenuecat`: legacy server compatibility; the production iOS v1 has no RevenueCat client or Premium product.
- `POST /analytical-reports`: store an analytical report.

Desktop-specific behavior remains in Electron: windows, menus, local startup behavior, and `electron-updater`.

The current Player flow scans the PDF417 barcode on the device and submits only the confirmed name, date of birth, and address. The API treats that result as provisional age eligibility; each card house must approve the physical ID on the player's first visit. The raw barcode, ID number, and ID image are never accepted by the endpoint or published to player-safe club documents.

Hosted Stripe Identity records and webhooks remain available for the conditional web/compatibility verification flow. The native Player camera flow does not require it. Stripe Connect checkout remains server-side legacy/non-v1 compatibility and is not exposed by the production iOS v1.

### Stripe Identity session creation and cleanup

`POST /player/identity/session` establishes a server-only `orbitIdentityProviderCleanup` creation intent before it calls Stripe. The intent contains the exact retry parameters, an opaque idempotency key, a protected deletion-marker reference, and—after Stripe responds—the provider session reference. It contains no player email, ID image, barcode, document number, or verified identity output. The Firebase immutable subject identifier remains temporarily present in the provider creation parameters because it is required to deterministically reconcile the existing webhook contract; clients cannot read or write this collection.

The successful Firestore transaction persists the same provider session on the private identity record and deletes its creation intent atomically. If Stripe returns but the reference write or identity transaction fails, the API never returns the verification URL: it first attempts cancellation/redaction and retains the intent when provider cleanup cannot be confirmed. A bounded request-triggered worker replays session creation with the same Stripe idempotency key to recover a response lost to a process crash, then confirms cancellation/redaction before deleting the creation intent. Abandoned creation sessions may be cancelled, but a provider session already linked to an identity record uses an explicit redaction-only intent. Stripe `processing` and `canceled` states remain pending; Orbit removes that intent only after Stripe reports `redacted` or the resource is confirmed missing. The signed redacted webhook and bounded cleanup worker both wake the durable account-deletion finalizer, whose serverless continuation is registered with Vercel when available. Account-deletion markers independently block delayed identity events from restoring Player data. No fixed retention duration is asserted: a failed cleanup intent remains server-only and retryable until the required provider cleanup is confirmed, and its disposition must be included in operational deletion/provider-record review.
