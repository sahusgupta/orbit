# Orbit API

Standalone backend foundation for Orbit desktop, the future mobile app, and a future admin dashboard.

## Run Locally

```powershell
npm run api:install
$env:ORBIT_CLIENT_API_KEY="dev-orbit-key"
$env:API_PORT="4629"
$env:DATABASE_URL="file:./data/orbit-api.sqlite3"
npm run api:dev
```

Health is public:

```powershell
Invoke-RestMethod http://127.0.0.1:4629/health
```

All other endpoints require `x-orbit-api-key`.

## Environment Variables

- `API_PORT`: API port, defaults to `4629`.
- `ORBIT_CLIENT_API_KEY`: owner/shared service key. Desktop clients may also authenticate with their signed pilot key authorization code.
- `DATABASE_URL`: SQLite path for local development, for example `file:./data/orbit-api.sqlite3`.
- `NODE_ENV`: `development`, `staging`, or `production`.

The database layer is intentionally small and isolated in `src/database.js` so it can later be swapped for Postgres or Supabase.

## Desktop Connection

The Electron app reads:

- `ORBIT_API_URL`, default `http://127.0.0.1:4629`
- `ORBIT_CLIENT_API_KEY`, optional when the installation has an active pilot key
- `NODE_ENV`

On launch it creates or reuses a stable `deviceId`, then sends `POST /clients/heartbeat`. It repeats the heartbeat every five minutes. API failures are logged quietly and never block app startup.

If `ORBIT_CLIENT_API_KEY` is not packaged with the app, Electron uses the activated card-house pilot `authorizationCode` as the client auth key. The API accepts these `TT-PILOT-...` authorization codes for client write/state/report operations, so existing card houses can connect on the next app launch with the key they already loaded.

Owner/admin read endpoints such as `/clients`, `/venues`, and `/telemetry/*` still require the real `ORBIT_CLIENT_API_KEY`. The dashboard remains protected by `ORBIT_DASHBOARD_USER` and `ORBIT_DASHBOARD_PASSWORD`.

Desktop state/report operations are API-first:

- `load-state` and `load-state-for-account` IPC calls read from the standalone API first.
- `save-state` writes to the standalone API first, then best-effort mirrors to the local desktop cache.
- analytical reports are submitted to the standalone API first.
- if the API is unavailable, the desktop uses the legacy local fallback so current installs keep working during the transition.

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
- `POST /analytical-reports`: store an analytical report.

Desktop-specific behavior remains in Electron: windows, menus, local startup behavior, and `electron-updater`.
