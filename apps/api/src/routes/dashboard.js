const path = require('path');
const {
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listTelemetryEvents,
  listVenues
} = require('../database');
const { listPilotLicenses, registerSignedPilotLicense, renewPilotLicense, revokePilotLicense } = require('../licenseService');
const {
  asyncRoute,
  createDashboardSession,
  getDashboardSessionCookie,
  getExpiredDashboardSessionCookie,
  requireDashboardAuth
} = require('../http/auth');
const { logDomainChange } = require('../http/domainEvents');

const publicDirectory = path.join(__dirname, '..', '..', 'public');

function registerDashboardRoutes(app, liveUpdates, startedAt) {
  app.get('/dashboard', (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'dashboard.html'));
  });

  app.get('/dashboard.js', (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'dashboard.js'));
  });

  app.get('/dashboard.css', (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'dashboard.css'));
  });

  app.post('/dashboard/session', (request, response) => {
    const token = createDashboardSession(request.body?.password);
    if (!token) {
      response.status(401).json({ ok: false, error: 'Dashboard sign-in failed.' });
      return;
    }
    response.set('set-cookie', getDashboardSessionCookie(token));
    response.set('cache-control', 'no-store');
    response.json({ ok: true });
  });

  app.delete('/dashboard/session', requireDashboardAuth, (request, response) => {
    response.set('set-cookie', getExpiredDashboardSessionCookie());
    response.set('cache-control', 'no-store');
    response.json({ ok: true });
  });

  app.get('/dashboard/data', requireDashboardAuth, asyncRoute(async (_request, response) => {
    const [eventPage, summary, clients, venues, errors, licenses] = await Promise.all([
      listTelemetryEvents({ limit: 101 }),
      getTelemetrySummary(),
      listClients({ limit: 101 }),
      listVenues({ limit: 101 }),
      listClientErrors({ limit: 101 }),
      listPilotLicenses({ limit: 101 })
    ]);
    response.json({
      ok: true,
      summary,
      clients: clients.slice(0, 100),
      clientHistory: { hasMore: clients.length > 100 },
      venues,
      events: eventPage.slice(0, 100),
      eventHistory: { hasMore: eventPage.length > 100 },
      errors: errors.slice(0, 100),
      errorHistory: { hasMore: errors.length > 100 },
      licenses: licenses.slice(0, 100),
      licenseHistory: { hasMore: licenses.length > 100 }
    });
  }));

  app.get('/dashboard/history/events', requireDashboardAuth, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const events = await listTelemetryEvents({
      limit: limit + 1,
      beforeOccurredAt: request.query.beforeOccurredAt,
      beforeId: request.query.beforeId
    });
    response.json({
      ok: true,
      events: events.slice(0, limit),
      hasMore: events.length > limit
    });
  }));

  app.get('/dashboard/history/licenses', requireDashboardAuth, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const licenses = await listPilotLicenses({
      limit: limit + 1,
      afterExpiresAt: request.query.afterExpiresAt,
      afterId: request.query.afterId
    });
    response.json({ ok: true, licenses: licenses.slice(0, limit), hasMore: licenses.length > limit });
  }));

  app.post('/dashboard/licenses/:licenseDocumentId/renew', requireDashboardAuth, asyncRoute(async (request, response) => {
    const license = await renewPilotLicense(request.params.licenseDocumentId, request.body || {});
    logDomainChange('pilot-license-renewed', { licenseId: license.licenseId, issuedTo: license.issuedTo, expiresAt: license.expiresAt });
    response.json({ ok: true, license });
  }));

  app.post('/dashboard/licenses', requireDashboardAuth, asyncRoute(async (request, response) => {
    const license = await registerSignedPilotLicense(request.body);
    logDomainChange('pilot-license-registered', { licenseId: license.licenseId, issuedTo: license.issuedTo, expiresAt: license.expiresAt });
    response.status(201).json({ ok: true, license });
  }));

  app.post('/dashboard/licenses/:licenseDocumentId/revoke', requireDashboardAuth, asyncRoute(async (request, response) => {
    const license = await revokePilotLicense(request.params.licenseDocumentId);
    logDomainChange('pilot-license-revoked', { licenseId: license.licenseId, issuedTo: license.issuedTo });
    response.json({ ok: true, license });
  }));

  app.get('/dashboard/events', requireDashboardAuth, (request, response) => {
    liveUpdates.connect(request, response, startedAt);
  });
}

module.exports = { registerDashboardRoutes };
