const crypto = require('crypto');
global.crypto = global.crypto || crypto.webcrypto;

const cors = require('cors');
const express = require('express');
const {
  closeDatabase,
  getClient,
  getDatabasePath,
  listClients,
  listClientUpdateEvents,
  listVenues,
  loadLatestState,
  loadState,
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

const app = express();
const port = Number(process.env.API_PORT || 4629);
const startedAt = new Date().toISOString();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function requireApiKey(request, response, next) {
  const configuredKey = process.env.ORBIT_CLIENT_API_KEY;
  if (!configuredKey) {
    response.status(500).json({ ok: false, error: 'ORBIT_CLIENT_API_KEY is not configured.' });
    return;
  }
  const received = request.get('x-orbit-api-key') || request.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (received !== configuredKey) {
    response.status(401).json({ ok: false, error: 'Invalid API key.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'orbit-api',
    environment: process.env.NODE_ENV || 'development',
    database: getDatabasePath(),
    startedAt
  });
});

app.use(requireApiKey);

app.post('/clients/heartbeat', asyncRoute(async (request, response) => {
  const client = upsertClient(request.body || {});
  response.status(202).json({ ok: true, client });
}));

app.post('/clients/update-event', asyncRoute(async (request, response) => {
  const client = recordUpdateEvent(request.body || {});
  response.status(202).json({ ok: true, client });
}));

app.get('/clients', (_request, response) => {
  response.json({ ok: true, clients: listClients() });
});

app.get('/clients/:deviceId', (request, response) => {
  const client = getClient(request.params.deviceId);
  if (!client) {
    response.status(404).json({ ok: false, error: 'Client not found.' });
    return;
  }
  response.json({ ok: true, client, updateEvents: listClientUpdateEvents(request.params.deviceId) });
});

app.get('/venues', (_request, response) => {
  response.json({ ok: true, venues: listVenues() });
});

app.get('/venues/:venueId/clients', (request, response) => {
  response.json({ ok: true, clients: listClients({ venueId: request.params.venueId }) });
});

app.post('/state', asyncRoute(async (request, response) => {
  const result = saveState(request.body?.state || request.body);
  response.status(201).json({ ok: true, ...result });
}));

app.get('/state/latest', (request, response) => {
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
  response.status(201).json({
    ok: true,
    ...result,
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
  response.status(201).json({
    ok: true,
    ...result,
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
