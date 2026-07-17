const crypto = require('crypto');
global.crypto = global.crypto || crypto.webcrypto;

const cors = require('cors');
const express = require('express');
const path = require('path');
const {
  closeDatabase,
  getClient,
  getDatabasePath,
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listVenues,
  loadLatestState,
  loadState,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent,
  saveState,
  storeAnalyticalReport,
  upsertClient
} = require('./database');
const {
  applyMembershipRequestToState,
  applyWaitlistRequestToState,
  buildPlayerClubSnapshot,
  sanitizeAccountKey
} = require('./orbitCore');
const { getFirebasePublisherStatus, publishStateToFirebase } = require('./firebasePublisher');

const app = express();
const port = Number(process.env.API_PORT || 4629);
const startedAt = new Date().toISOString();
const liveClients = new Set();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function getReceivedApiKey(request) {
  return (
    request.get('x-orbit-api-key') ||
    request.get('x-orbit-auth-key') ||
    request.get('x-orbit-client-key') ||
    request.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.query.apiKey
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireDashboardAuth(request, response, next) {
  const configuredPassword = process.env.ORBIT_DASHBOARD_PASSWORD || process.env.ORBIT_DASHBOARD_API_KEY || process.env.ORBIT_CLIENT_API_KEY;
  const configuredUser = process.env.ORBIT_DASHBOARD_USER || 'orbit-admin';
  if (!configuredPassword) {
    response.status(500).send('Dashboard auth is not configured.');
    return;
  }

  const header = request.get('authorization') || '';
  const [scheme, credentials] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() === 'basic' && credentials) {
    const decoded = Buffer.from(credentials, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = separator >= 0 ? decoded.slice(0, separator) : '';
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (safeEqual(username, configuredUser) && safeEqual(password, configuredPassword)) {
      next();
      return;
    }
  }

  response.set('www-authenticate', 'Basic realm="Orbit Dashboard", charset="UTF-8"');
  response.status(401).send('Authentication required.');
}

function isPilotAuthorizationCode(value) {
  return /^TT-PILOT-[A-F0-9]{24}$/i.test(String(value || '').trim());
}

function requireOwnerApiKey(request, response, next) {
  const configuredKey = process.env.ORBIT_CLIENT_API_KEY;
  if (!configuredKey) {
    response.status(500).json({ ok: false, error: 'ORBIT_CLIENT_API_KEY is not configured.' });
    return;
  }
  const received = getReceivedApiKey(request);
  if (received !== configuredKey) {
    response.status(401).json({ ok: false, error: 'Invalid API key.' });
    return;
  }
  request.orbitAuth = { type: 'owner-api-key' };
  next();
}

function requireClientAuth(request, response, next) {
  const configuredKey = process.env.ORBIT_CLIENT_API_KEY;
  const received = getReceivedApiKey(request);
  if (configuredKey && received === configuredKey) {
    request.orbitAuth = { type: 'owner-api-key' };
    next();
    return;
  }
  if (isPilotAuthorizationCode(received)) {
    request.orbitAuth = {
      type: 'pilot-key',
      accountKey: sanitizeAccountKey(received)
    };
    next();
    return;
  }
  response.status(401).json({ ok: false, error: 'Invalid API key or pilot authorization code.' });
}

function blockLatestStateForPilotAuth(request, response, next) {
  if (request.orbitAuth?.type === 'pilot-key') {
    response.status(403).json({ ok: false, error: 'Pilot-authenticated clients must request their own venue state.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

async function publishStateForResponse(state) {
  try {
    return await publishStateToFirebase(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Firebase publish failed.';
    console.warn('[firebase] publish failed:', message);
    return { ok: false, error: message };
  }
}

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'orbit-api',
    environment: process.env.NODE_ENV || 'development',
    database: getDatabasePath(),
    firebase: getFirebasePublisherStatus(),
    startedAt
  });
});

app.get('/dashboard', requireDashboardAuth, (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get('/dashboard.js', requireDashboardAuth, (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'dashboard.js'));
});

app.get('/dashboard.css', requireDashboardAuth, (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'dashboard.css'));
});

app.get('/dashboard/data', requireDashboardAuth, (_request, response) => {
  response.json({
    ok: true,
    summary: getTelemetrySummary(),
    clients: listClients(),
    venues: listVenues(),
    events: listTelemetryEvents({ limit: 200 }),
    errors: listClientErrors({ limit: 100 })
  });
});

app.get('/dashboard/events', requireDashboardAuth, (request, response) => {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'access-control-allow-origin': '*'
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, startedAt })}\n\n`);
  liveClients.add(response);
  request.on('close', () => {
    liveClients.delete(response);
  });
});

app.use(requireClientAuth);

function broadcastLive(type, payload) {
  const body = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of liveClients) {
    client.write(body);
  }
}

app.post('/clients/heartbeat', asyncRoute(async (request, response) => {
  const client = upsertClient(request.body || {});
  broadcastLive('client', client);
  response.status(202).json({ ok: true, client });
}));

app.post('/clients/update-event', asyncRoute(async (request, response) => {
  const client = recordUpdateEvent(request.body || {});
  const event = listTelemetryEvents({ deviceId: client.deviceId, limit: 1 })[0];
  if (event) broadcastLive('telemetry', event);
  response.status(202).json({ ok: true, client });
}));

app.post('/clients/event', asyncRoute(async (request, response) => {
  const event = recordTelemetryEvent(request.body || {});
  broadcastLive('telemetry', event);
  response.status(202).json({ ok: true, event });
}));

app.post('/clients/error', asyncRoute(async (request, response) => {
  const error = recordClientError(request.body || {});
  broadcastLive('error', error);
  response.status(202).json({ ok: true, error });
}));

app.get('/clients', requireOwnerApiKey, (_request, response) => {
  response.json({ ok: true, clients: listClients() });
});

app.get('/clients/:deviceId', requireOwnerApiKey, (request, response) => {
  const client = getClient(request.params.deviceId);
  if (!client) {
    response.status(404).json({ ok: false, error: 'Client not found.' });
    return;
  }
  response.json({ ok: true, client, updateEvents: listClientUpdateEvents(request.params.deviceId) });
});

app.get('/telemetry/events', requireOwnerApiKey, (request, response) => {
  response.json({
    ok: true,
    events: listTelemetryEvents({
      venueId: request.query.venueId,
      deviceId: request.query.deviceId,
      limit: request.query.limit
    })
  });
});

app.get('/telemetry/errors', requireOwnerApiKey, (request, response) => {
  response.json({
    ok: true,
    errors: listClientErrors({
      venueId: request.query.venueId,
      deviceId: request.query.deviceId,
      limit: request.query.limit
    })
  });
});

app.get('/venues', requireOwnerApiKey, (_request, response) => {
  response.json({ ok: true, venues: listVenues() });
});

app.get('/venues/:venueId/clients', requireOwnerApiKey, (request, response) => {
  response.json({ ok: true, clients: listClients({ venueId: request.params.venueId }) });
});

app.post('/state', asyncRoute(async (request, response) => {
  const state = request.body?.state || request.body;
  const result = saveState(state);
  const firebase = await publishStateForResponse(state);
  response.status(201).json({ ok: true, ...result, firebase });
}));

app.get('/state/latest', blockLatestStateForPilotAuth, (request, response) => {
  const record = loadLatestState();
  if (!record) {
    response.status(404).json({ ok: false, error: 'No venue state found.' });
    return;
  }
  response.json({ ok: true, ...record });
});

app.get('/state/:venueId', (request, response) => {
  const record = loadState(request.params.venueId);
  if (!record) {
    response.status(404).json({ ok: false, error: 'Venue state not found.' });
    return;
  }
  response.json({ ok: true, ...record });
});

app.get('/player/snapshot', (request, response) => {
  const accountKey = sanitizeAccountKey(request.query.accountKey || request.query.venueId || '');
  const record = loadState(accountKey);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No Orbit club database is available yet.' });
    return;
  }
  const player = {
    id: request.query.playerId || '',
    name: request.query.playerName || ''
  };
  response.json({
    ok: true,
    accountKey: record.accountKey,
    savedAt: record.savedAt,
    snapshot: buildPlayerClubSnapshot(record.state, player)
  });
});

app.post('/player/membership-requests', asyncRoute(async (request, response) => {
  const record = loadState(request.body?.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this membership request.' });
    return;
  }
  const nextState = applyMembershipRequestToState(record.state, request.body);
  const result = saveState(nextState);
  const firebase = await publishStateForResponse(nextState);
  response.status(201).json({
    ok: true,
    ...result,
    firebase,
    snapshot: buildPlayerClubSnapshot(nextState, request.body?.player)
  });
}));

app.post('/player/waitlist-requests', asyncRoute(async (request, response) => {
  const record = loadState(request.body?.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this waitlist request.' });
    return;
  }
  const nextState = applyWaitlistRequestToState(record.state, request.body);
  const result = saveState(nextState);
  const firebase = await publishStateForResponse(nextState);
  response.status(201).json({
    ok: true,
    ...result,
    firebase,
    snapshot: buildPlayerClubSnapshot(nextState, request.body?.player)
  });
}));

app.post('/analytical-reports', asyncRoute(async (request, response) => {
  response.status(201).json(storeAnalyticalReport(request.body));
}));

app.use((error, _request, response, _next) => {
  response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' });
});

const server = app.listen(port, () => {
  console.log(`Orbit API listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
