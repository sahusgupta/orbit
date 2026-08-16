# Orbit API

Standalone backend foundation for Orbit desktop, the future mobile app, and a future admin dashboard.

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
- `ORBIT_ALLOWED_ORIGINS` and `ORBIT_TRUST_PROXY`: explicit CORS and proxy policy. Vercel's single, header-overwriting proxy hop is trusted automatically so HTTPS same-origin dashboard requests are recognized; other deployments must configure proxy trust only after their exact proxy is reviewed.
- `ORBIT_ALLOW_INSECURE_LOOPBACK_AUTH`: explicit local-development bypass. It is rejected in production and Vercel runtimes.
- `ORBIT_PHONE_CHALLENGE_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`: server-side SMS OTP verification. No Twilio credential is shipped to Player clients.
- `ORBIT_ACCOUNT_DELETION_POLICY_JSON` and `ORBIT_DELETION_PSEUDONYM_SECRET`: explicit deletion/anonymization dispositions and stable protected subject identifiers. See `docs/architecture/DATA_CLASSIFICATION.md`; no legal retention policy is inferred.
- `ORBIT_LICENSE_PUBLIC_KEY_PEM`: optional newline-escaped P-256 public key override used to verify an administrator-provisioned signed pilot-license envelope. The checked-in branding public key is the default.
- `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, or `GOOGLE_APPLICATION_CREDENTIALS`: one approved Firebase Admin credential source is required by the API. Firestore is Orbit's only server datastore. The API also publishes player-safe live game documents at `clubs/{licenseKey}/games/{gameId}`, operational session history at `clubs/{licenseKey}/gameSessions/{sessionId}`, and canonical player documents at `clubs/{licenseKey}/players/{playerId}`. Membership players are documents in the `players` subcollection and are not duplicated as an array on the club document.
- `FIRESTORE_EMULATOR_HOST`: optional local-only Firestore emulator address. Never point ordinary development or tests at production.
- `ORBIT_FIRESTORE_MEMORY`: unit-test-only Firestore fake. Hosted runtimes reject it.
- `FIREBASE_WEB_API_KEY`: Firebase web-project API key used by the API only to request the configured Firebase password-reset email. It does not grant Admin access. Password changes still require one of the server-only Firebase Admin credential mechanisms above.
- `NODE_ENV`: `development`, `staging`, or `production`.
- `STRIPE_SECRET_KEY`: Stripe server secret used only by the API.
- `STRIPE_WEBHOOK_SECRET`: signing secret for `POST /webhooks/stripe`.
- `ORBIT_IDENTITY_RETURN_URL`: trusted deep link Stripe returns to after hosted verification, for example `orbitplayer://identity-complete`.
- `STRIPE_IDENTITY_VERIFICATION_FLOW_ID`: optional Stripe Dashboard verification-flow ID. Without it, the API creates a document check directly.
- `ORBIT_IDENTITY_REQUIRE_SELFIE`: matching-selfie checks default to on; set this to `false` only if the launch policy intentionally accepts document-only verification.
- `REVENUECAT_WEBHOOK_AUTH_TOKEN`: bearer token configured on the RevenueCat webhook for `POST /webhooks/revenuecat`.
- `REVENUECAT_PREMIUM_ENTITLEMENT_ID`: Player Premium entitlement ID; defaults to `player_premium`.
- `ORBIT_PAYMENT_SUCCESS_URL` and `ORBIT_PAYMENT_CANCEL_URL`: approved checkout return URLs.
- `ORBIT_DAY_PASS_PRICE_CENTS` and `ORBIT_MONTHLY_MEMBERSHIP_PRICE_CENTS`: authoritative server-side membership prices (defaults: `1000` and `3500`).
- `ORBIT_PAYMENT_CURRENCY`: three-letter currency code, defaults to `usd`.

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
- `GET /state/latest`: fetch the most recently saved venue state.
- `GET /state/:venueId`: fetch a stored venue state.
- `GET /player/snapshot?accountKey=<venueId>`: fetch mobile/player-facing snapshot.
- `POST /player/membership-requests`: apply a membership request to venue state.
- `POST /player/waitlist-requests`: apply a waitlist request to venue state.
- `POST|DELETE /player/tournament-registrations`: apply the signed-in player's tournament registration through authoritative state.
- `GET /publications` and `POST /publications/drain`: owner-protected inspection/retry controls for the durable Firebase publication outbox.
- `POST /player/membership-checkout`: create a Stripe Checkout session after verifying the player's Firebase ID token.
- `GET /player/identity/status`: return the signed-in player's sanitized age-eligibility status.
- `POST /player/identity/session`: create or resume a hosted Stripe Identity verification session.
- `DELETE /player/identity`: request Stripe redaction and remove Orbit's eligibility record during account deletion.
- `POST /player/auth/phone/start` and `/player/auth/phone/complete`: prove phone ownership with a bounded SMS OTP challenge and exchange it for a Firebase custom token.
- `DELETE /player/account`: run the resumable server-owned deletion/anonymization job after recent reauthentication and return every retained category.
- `POST /webhooks/stripe`: verify Stripe events and write paid memberships plus immutable revenue transactions to Firestore.
- `POST /webhooks/revenuecat`: verify the configured bearer token and synchronize Apple Player Premium entitlements to the server-managed Firebase player profile.
- `POST /analytical-reports`: store an analytical report.

Desktop-specific behavior remains in Electron: windows, menus, local startup behavior, and `electron-updater`.

For launch, activate Stripe Identity on Orbit's platform account and configure the Stripe webhook to send `identity.verification_session.processing`, `identity.verification_session.verified`, `identity.verification_session.requires_input`, `identity.verification_session.canceled`, and `identity.verification_session.redacted`. Orbit stores only provider session IDs and the sanitized eligibility result; date of birth, document numbers, and ID images remain with Stripe.

If `STRIPE_IDENTITY_VERIFICATION_FLOW_ID` is used, that Dashboard flow must collect a document date of birth and enable matching-selfie verification. The API fails closed when Stripe returns no date of birth.
