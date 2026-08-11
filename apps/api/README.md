# Orbit API

Standalone backend foundation for Orbit desktop, the future mobile app, and a future admin dashboard.

## Run Locally

```powershell
npm ci --prefix apps/api
$env:ORBIT_CLIENT_API_KEY="dev-orbit-key"
$env:API_PORT="4629"
$env:DATABASE_URL="file:./data/orbit-api.sqlite3"
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

All other endpoints require `x-orbit-api-key`.

## Environment Variables

- `API_PORT`: API port, defaults to `4629`.
- `ORBIT_CLIENT_API_KEY`: owner/shared service key. Desktop clients may also authenticate with their signed pilot key authorization code.
- `ORBIT_DASHBOARD_USER`: Basic-auth username for `/dashboard`; defaults to `orbit-admin`.
- `ORBIT_DASHBOARD_PASSWORD`: password for the protected operations dashboard and its license-management requests. Keep this server-side only.
- `ORBIT_LICENSE_PUBLIC_KEY_PEM`: optional newline-escaped P-256 public key override used to verify an administrator-provisioned signed pilot-license envelope. The checked-in branding public key is the default.
- `DATABASE_URL`: SQLite path for local development, for example `file:./data/orbit-api.sqlite3`. On Vercel, the API defaults to `file:/tmp/orbit-api.sqlite3` when `DATABASE_URL` is unset.
- `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, or `GOOGLE_APPLICATION_CREDENTIALS`: optional Firebase service account credentials. When configured, API state saves player-safe live game documents at `clubs/{licenseKey}/games/{gameId}`, operational session history at `clubs/{licenseKey}/gameSessions/{sessionId}`, and canonical player documents at `clubs/{licenseKey}/players/{playerId}`. Membership players are documents in the `players` subcollection and are not duplicated as an array on the club document.
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

`src/database.js` is the stable persistence facade. SQLite connection/schema and focused client, telemetry, state, and report repositories live under `src/db/`, preserving a narrow boundary for a future reviewed adapter.

`src/server.js` owns process listen/shutdown and exports the composed Express app. Non-listening middleware/route composition lives in `src/app.js`, with focused owners under `src/http/` and `src/routes/`.

Vercel's deployment filesystem is read-only except for `/tmp`, so do not set `DATABASE_URL=file:./data/orbit-api.sqlite3` there. `/tmp` prevents startup crashes, but it is ephemeral; use a persistent database provider for production logs.

## Desktop Connection

The Electron app reads:

- `ORBIT_API_URL`, default `https://orbitapp-one.vercel.app`. Use `http://127.0.0.1:4629` for local API development.
- `ORBIT_CLIENT_API_KEY`, optional when the installation has an active pilot key
- `NODE_ENV`

On launch it creates or reuses a stable `deviceId`, then sends `POST /clients/heartbeat`. It repeats the heartbeat every five minutes. API failures are logged quietly and never block app startup.

If `ORBIT_CLIENT_API_KEY` is not packaged with the app, Electron uses the activated card-house pilot `authorizationCode` as the client auth key. The API accepts these `TT-PILOT-...` authorization codes for client write/state/report operations, so existing card houses can connect on the next app launch with the key they already loaded.

Owner/admin read endpoints such as `/clients`, `/venues`, and `/telemetry/*` still require the real `ORBIT_CLIENT_API_KEY`. The dashboard remains protected by `ORBIT_DASHBOARD_USER` and `ORBIT_DASHBOARD_PASSWORD`.

## Server-Managed Pilot Licenses

Pilot authorization codes are stable credentials. Their operational expiration is stored by the API in the server-only Firestore `pilotLicenses` collection, using a SHA-256 authorization-code identifier rather than storing the raw key. The desktop checks `GET /license/status` at startup and every five minutes. Changing a license expiration in the dashboard therefore updates connected installations without issuing another key file or changing the venue account identifier.

Open the protected dashboard at:

```text
https://orbitapp-one.vercel.app/dashboard
```

The Pilot licenses section shows active, expired, and revoked keys; the venue; key suffix; last use; and expiration. An administrator can set an exact date, extend by 30 or 90 days, or revoke the license immediately.

Self-asserted legacy bootstrap is disabled. A format-valid code and matching state body cannot create a managed license. Before a desktop uses a new signed key, an administrator must submit the complete signed envelope to the authenticated `POST /dashboard/licenses` endpoint. The API verifies its P-256 signature and expiration against the configured public key before storing the one-way authorization-code identifier. Existing already-managed licenses continue to authenticate normally; an unmanaged legacy installation must be provisioned from its original signed key rather than trusted from stored client state.

After that one migration release, ordinary renewals require neither a client update nor a replacement key file. If the API cannot be reached, the desktop retains its last server-confirmed expiration instead of granting a new renewal offline.

Desktop state/report operations are API-first:

- `load-state` and `load-state-for-account` IPC calls read from the standalone API first.
- `save-state` writes to the standalone API first, then best-effort mirrors to the local desktop cache and Firestore.
- analytical reports are submitted to the standalone API first.
- if the API is unavailable, the desktop uses the legacy local fallback so current installs keep working during the transition.

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
$headers = @{ "x-orbit-api-key" = "dev-orbit-key" }
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

- `POST /state`: store an Orbit venue state payload.
- `GET /state/latest`: fetch the most recently saved venue state.
- `GET /state/:venueId`: fetch a stored venue state.
- `GET /player/snapshot?accountKey=<venueId>`: fetch mobile/player-facing snapshot.
- `POST /player/membership-requests`: apply a membership request to venue state.
- `POST /player/waitlist-requests`: apply a waitlist request to venue state.
- `POST /player/membership-checkout`: create a Stripe Checkout session after verifying the player's Firebase ID token.
- `GET /player/identity/status`: return the signed-in player's sanitized age-eligibility status.
- `POST /player/identity/session`: create or resume a hosted Stripe Identity verification session.
- `DELETE /player/identity`: request Stripe redaction and remove Orbit's eligibility record during account deletion.
- `POST /webhooks/stripe`: verify Stripe events and write paid memberships plus immutable revenue transactions to Firestore.
- `POST /webhooks/revenuecat`: verify the configured bearer token and synchronize Apple Player Premium entitlements to the server-managed Firebase player profile.
- `POST /analytical-reports`: store an analytical report.

Desktop-specific behavior remains in Electron: windows, menus, local startup behavior, and `electron-updater`.

For launch, activate Stripe Identity on Orbit's platform account and configure the Stripe webhook to send `identity.verification_session.processing`, `identity.verification_session.verified`, `identity.verification_session.requires_input`, `identity.verification_session.canceled`, and `identity.verification_session.redacted`. Orbit stores only provider session IDs and the sanitized eligibility result; date of birth, document numbers, and ID images remain with Stripe.

If `STRIPE_IDENTITY_VERIFICATION_FLOW_ID` is used, that Dashboard flow must collect a document date of birth and enable matching-selfie verification. The API fails closed when Stripe returns no date of birth.
