const {
  getClient,
  drainPublicationOutbox,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listPublicationOutbox,
  listVenues,
  loadLatestState,
  loadState,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent,
  schedulePublicationDrain,
  saveState,
  storeAnalyticalReport,
  upsertClient
} = require('../database');
const { getAccountKeyFromState, sanitizeAccountKey } = require('../orbitCore');
const { asyncRoute, blockLatestStateForPilotAuth, requireOwnerApiKey } = require('../http/auth');
const { logStateChanges } = require('../http/domainEvents');

function registerClientRoutes(app, liveUpdates) {
  app.get('/license/status', asyncRoute(async (request, response) => {
    response.json({ ok: true, managed: true, active: true, license: request.orbitAuth?.license || null });
  }));

  app.post('/clients/heartbeat', asyncRoute(async (request, response) => {
    const client = await upsertClient(request.body || {});
    liveUpdates.broadcast('client', client);
    response.status(202).json({ ok: true, client });
  }));

  app.post('/clients/update-event', asyncRoute(async (request, response) => {
    const client = await recordUpdateEvent(request.body || {});
    const event = (await listTelemetryEvents({ deviceId: client.deviceId, limit: 1 }))[0];
    if (event) liveUpdates.broadcast('telemetry', event);
    response.status(202).json({ ok: true, client });
  }));

  app.post('/clients/event', asyncRoute(async (request, response) => {
    const event = await recordTelemetryEvent(request.body || {});
    liveUpdates.broadcast('telemetry', event);
    response.status(202).json({ ok: true, event });
  }));

  app.post('/clients/error', asyncRoute(async (request, response) => {
    const error = await recordClientError(request.body || {});
    liveUpdates.broadcast('error', error);
    response.status(202).json({ ok: true, error });
  }));

  app.get('/clients', requireOwnerApiKey, asyncRoute(async (_request, response) => {
    response.json({ ok: true, clients: await listClients() });
  }));

  app.get('/clients/:deviceId', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const client = await getClient(request.params.deviceId);
    if (!client) {
      response.status(404).json({ ok: false, error: 'Client not found.' });
      return;
    }
    response.json({ ok: true, client, updateEvents: await listClientUpdateEvents(request.params.deviceId) });
  }));

  app.get('/telemetry/events', requireOwnerApiKey, asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      events: await listTelemetryEvents({
        venueId: request.query.venueId,
        deviceId: request.query.deviceId,
        limit: request.query.limit
      })
    });
  }));

  app.get('/telemetry/errors', requireOwnerApiKey, asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      errors: await listClientErrors({
        venueId: request.query.venueId,
        deviceId: request.query.deviceId,
        limit: request.query.limit
      })
    });
  }));

  app.get('/venues', requireOwnerApiKey, asyncRoute(async (_request, response) => {
    response.json({ ok: true, venues: await listVenues() });
  }));

  app.get('/venues/:venueId/clients', requireOwnerApiKey, asyncRoute(async (request, response) => {
    response.json({ ok: true, clients: await listClients({ venueId: request.params.venueId }) });
  }));

  app.get('/publications', requireOwnerApiKey, asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      publications: await listPublicationOutbox({
        accountKey: request.query.accountKey,
        limit: request.query.limit
      })
    });
  }));

  app.post('/publications/drain', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const results = await drainPublicationOutbox({ limit: request.body?.limit || 25 });
    response.json({ ok: true, processed: results.length, results });
  }));

  app.post('/state', asyncRoute(async (request, response) => {
    const state = request.body?.state;
    const expectedRevision = Number(request.body?.expectedRevision);
    const mutationId = String(request.get('x-orbit-mutation-id') || request.body?.mutationId || '').trim();
    if (!state || !Number.isInteger(expectedRevision) || expectedRevision < 0 || !mutationId) {
      response.status(428).json({ ok: false, error: 'state, expectedRevision, and a stable mutationId are required.' });
      return;
    }
    const accountKey = getAccountKeyFromState(state);
    if (request.orbitAuth?.type === 'pilot-key' && request.orbitAuth.accountKey !== accountKey) {
      response.status(403).json({ ok: false, error: 'This pilot license cannot write another venue account.' });
      return;
    }
    const previous = await loadState(accountKey);
    const result = await saveState(state, { expectedRevision, mutationId, mutationType: 'desktop-state' });
    logStateChanges(previous?.state, state, result.accountKey);
    void schedulePublicationDrain();
    response.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  }));

  app.get('/state/latest', blockLatestStateForPilotAuth, asyncRoute(async (request, response) => {
    const record = await loadLatestState();
    if (!record) {
      response.status(404).json({ ok: false, error: 'No venue state found.' });
      return;
    }
    response.json({ ok: true, ...record });
  }));

  app.get('/state/:venueId', asyncRoute(async (request, response) => {
    if (request.orbitAuth?.type === 'pilot-key' && request.orbitAuth.accountKey !== sanitizeAccountKey(request.params.venueId)) {
      response.status(403).json({ ok: false, error: 'This pilot license cannot read another venue account.' });
      return;
    }
    const record = await loadState(request.params.venueId);
    if (!record) {
      response.status(404).json({ ok: false, error: 'Venue state not found.' });
      return;
    }
    response.json({ ok: true, ...record });
  }));

  app.post('/analytical-reports', asyncRoute(async (request, response) => {
    response.status(201).json(await storeAnalyticalReport(request.body));
  }));
}

module.exports = { registerClientRoutes };
