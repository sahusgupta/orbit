const path = require('path');
const {
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listTelemetryEvents,
  listVenues
} = require('../database');
const { listPilotLicenses, renewPilotLicense, revokePilotLicense } = require('../licenseService');
const { asyncRoute, requireDashboardAuth } = require('../http/auth');
const { logDomainChange } = require('../http/domainEvents');

const publicDirectory = path.join(__dirname, '..', '..', 'public');

function registerDashboardRoutes(app, liveUpdates, startedAt) {
  app.get('/dashboard', requireDashboardAuth, (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'dashboard.html'));
  });

  app.get('/dashboard.js', requireDashboardAuth, (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'dashboard.js'));
  });

  app.get('/dashboard.css', requireDashboardAuth, (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'dashboard.css'));
  });

  app.get('/dashboard/data', requireDashboardAuth, asyncRoute(async (_request, response) => {
    const eventPage = listTelemetryEvents({ limit: 101 });
    response.json({
      ok: true,
      summary: getTelemetrySummary(),
      clients: listClients(),
      venues: listVenues(),
      events: eventPage.slice(0, 100),
      eventHistory: { hasMore: eventPage.length > 100 },
      errors: listClientErrors({ limit: 100 }),
      licenses: await listPilotLicenses()
    });
  }));

  app.get('/dashboard/history/events', requireDashboardAuth, (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const events = listTelemetryEvents({
      limit: limit + 1,
      beforeOccurredAt: request.query.beforeOccurredAt,
      beforeId: request.query.beforeId
    });
    response.json({
      ok: true,
      events: events.slice(0, limit),
      hasMore: events.length > limit
    });
  });

  app.post('/dashboard/licenses/:licenseDocumentId/renew', requireDashboardAuth, asyncRoute(async (request, response) => {
    const license = await renewPilotLicense(request.params.licenseDocumentId, request.body || {});
    logDomainChange('pilot-license-renewed', { licenseId: license.licenseId, issuedTo: license.issuedTo, expiresAt: license.expiresAt });
    response.json({ ok: true, license });
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
