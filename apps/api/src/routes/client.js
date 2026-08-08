const {
  getClient,
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
} = require('../database');
const { getAccountKeyFromState, sanitizeAccountKey } = require('../orbitCore');
const { registerPilotLicense } = require('../licenseService');
const { asyncRoute, blockLatestStateForPilotAuth, requireOwnerApiKey } = require('../http/auth');
const { logStateChanges } = require('../http/domainEvents');
const { publishStateForResponse } = require('../http/firebasePublication');

function registerClientRoutes(app, liveUpdates) {
  app.get('/license/status', asyncRoute(async (request, response) => {
    if (request.orbitAuth?.type === 'legacy-pilot-key') {
      const accountKey = sanitizeAccountKey(request.query.accountKey || '');
      const record = accountKey ? loadState(accountKey) : null;
      const access = record?.state?.settings?.pilotAccess;
      if (access) {
        const license = await registerPilotLicense(access);
        response.json({ ok: true, managed: true, active: license.status === 'active', license });
        return;
      }
      response.json({ ok: true, managed: false, active: false, license: null });
      return;
    }
    response.json({ ok: true, managed: true, active: true, license: request.orbitAuth?.license || null });
  }));

  app.post('/clients/heartbeat', asyncRoute(async (request, response) => {
    const client = upsertClient(request.body || {});
    liveUpdates.broadcast('client', client);
    response.status(202).json({ ok: true, client });
  }));

  app.post('/clients/update-event', asyncRoute(async (request, response) => {
    const client = recordUpdateEvent(request.body || {});
    const event = listTelemetryEvents({ deviceId: client.deviceId, limit: 1 })[0];
    if (event) liveUpdates.broadcast('telemetry', event);
    response.status(202).json({ ok: true, client });
  }));

  app.post('/clients/event', asyncRoute(async (request, response) => {
    const event = recordTelemetryEvent(request.body || {});
    liveUpdates.broadcast('telemetry', event);
    response.status(202).json({ ok: true, event });
  }));

  app.post('/clients/error', asyncRoute(async (request, response) => {
    const error = recordClientError(request.body || {});
    liveUpdates.broadcast('error', error);
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
    const accountKey = getAccountKeyFromState(state);
    if (request.orbitAuth?.type === 'pilot-key' && request.orbitAuth.accountKey !== accountKey) {
      response.status(403).json({ ok: false, error: 'This pilot license cannot write another venue account.' });
      return;
    }
    const previous = loadState(accountKey);
    const result = saveState(state);
    logStateChanges(previous?.state, state, result.accountKey);
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
    if (request.orbitAuth?.type === 'pilot-key' && request.orbitAuth.accountKey !== sanitizeAccountKey(request.params.venueId)) {
      response.status(403).json({ ok: false, error: 'This pilot license cannot read another venue account.' });
      return;
    }
    const record = loadState(request.params.venueId);
    if (
      request.orbitAuth?.type === 'legacy-pilot-key' &&
      record?.state?.settings?.pilotAccess?.authorizationCode !== request.orbitAuth.authorizationCode
    ) {
      response.status(403).json({ ok: false, error: 'This legacy pilot key cannot read another venue account.' });
      return;
    }
    if (!record) {
      response.status(404).json({ ok: false, error: 'Venue state not found.' });
      return;
    }
    response.json({ ok: true, ...record });
  });

  app.post('/analytical-reports', asyncRoute(async (request, response) => {
    response.status(201).json(storeAnalyticalReport(request.body));
  }));
}

module.exports = { registerClientRoutes };
