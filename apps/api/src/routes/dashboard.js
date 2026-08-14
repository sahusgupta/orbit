const path = require('path');
const {
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listManagementSecurityEvents,
  listTelemetryEvents,
  listVenues,
  recordManagementSecurityEvent
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
const { protectedIdentifier } = require('../http/dataProtection');
const { getManagementAccountService } = require('../managementAccountService');

const publicDirectory = path.join(__dirname, '..', '..', 'public');

function registerDashboardRoutes(app, liveUpdates, startedAt) {
  const managementAccounts = getManagementAccountService();
  const dashboardActorRef = (request) => `dashboard:${protectedIdentifier(request.orbitAuth?.sessionId)}`;
  const recordSecurityActivity = async (payload) => {
    try {
      await recordManagementSecurityEvent(payload);
    } catch {
      logDomainChange('management-security-audit-write-failed', {
        tenantRef: protectedIdentifier(payload.accountKey),
        event: payload.event
      });
    }
  };
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
    const [eventPage, summary, clients, venues, errors, licenses, managementAccountRecords, securityEvents] = await Promise.all([
      listTelemetryEvents({ limit: 101 }),
      getTelemetrySummary(),
      listClients({ limit: 101 }),
      listVenues({ limit: 101 }),
      listClientErrors({ limit: 101 }),
      listPilotLicenses({ limit: 101 }),
      managementAccounts.listAccounts(),
      listManagementSecurityEvents({ limit: 101 })
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
      licenseHistory: { hasMore: licenses.length > 100 },
      managementAccounts: managementAccountRecords,
      securityEvents: securityEvents.slice(0, 100),
      securityEventHistory: { hasMore: securityEvents.length > 100 }
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

  app.get('/dashboard/management-accounts', requireDashboardAuth, asyncRoute(async (_request, response) => {
    response.json({ ok: true, managementAccounts: await managementAccounts.listAccounts() });
  }));

  app.get('/dashboard/history/security', requireDashboardAuth, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const events = await listManagementSecurityEvents({
      limit: limit + 1,
      beforeOccurredAt: request.query.beforeOccurredAt,
      beforeId: request.query.beforeId
    });
    response.json({ ok: true, events: events.slice(0, limit), hasMore: events.length > limit });
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

  app.post('/dashboard/licenses/:licenseDocumentId/management-account', requireDashboardAuth, asyncRoute(async (request, response) => {
    const result = await managementAccounts.provisionAccount({
      licenseDocumentId: request.params.licenseDocumentId,
      username: request.body?.username,
      password: request.body?.password
    });
    logDomainChange('management-account-provisioned-by-owner', {
      tenantRef: protectedIdentifier(result.accountKey),
      accountRef: protectedIdentifier(result.username),
      licenseId: result.licenseId,
      revision: result.revision
    });
    await recordSecurityActivity({
      accountKey: result.accountKey,
      event: 'management-account-provisioned',
      actorRef: dashboardActorRef(request),
      details: {
        licenseId: result.licenseId,
        revision: result.revision,
        provider: 'firebase',
        existingStatePreserved: true
      }
    });
    response.status(201).json({
      ok: true,
      account: { accountKey: result.accountKey, username: result.username, revision: result.revision },
      publication: result.publication
    });
  }));

  app.post('/dashboard/licenses/:licenseDocumentId/revoke', requireDashboardAuth, asyncRoute(async (request, response) => {
    const license = await revokePilotLicense(request.params.licenseDocumentId);
    logDomainChange('pilot-license-revoked', { licenseId: license.licenseId, issuedTo: license.issuedTo });
    response.json({ ok: true, license });
  }));

  app.post('/dashboard/management-accounts/:accountKey/recovery', requireDashboardAuth, asyncRoute(async (request, response) => {
    const recovery = await managementAccounts.startRecovery({
      accountKey: request.params.accountKey,
      durationMinutes: request.body?.durationMinutes,
      reason: request.body?.reason,
      actorRef: protectedIdentifier(request.orbitAuth?.sessionId)
    });
    logDomainChange('management-recovery-override-started', {
      tenantRef: protectedIdentifier(request.params.accountKey),
      recoveryRef: protectedIdentifier(recovery.id),
      expiresAt: recovery.expiresAt
    });
    await recordSecurityActivity({
      accountKey: request.params.accountKey,
      event: 'recovery-override-started',
      actorRef: dashboardActorRef(request),
      details: { recoveryRef: protectedIdentifier(recovery.id), expiresAt: recovery.expiresAt }
    });
    response.status(201).json({ ok: true, recovery });
  }));

  app.delete('/dashboard/management-accounts/:accountKey/recovery', requireDashboardAuth, asyncRoute(async (request, response) => {
    await managementAccounts.revokeRecovery({ accountKey: request.params.accountKey });
    logDomainChange('management-recovery-override-revoked', {
      tenantRef: protectedIdentifier(request.params.accountKey)
    });
    await recordSecurityActivity({
      accountKey: request.params.accountKey,
      event: 'recovery-override-canceled',
      actorRef: dashboardActorRef(request),
      details: { outcome: 'revoked' }
    });
    response.json({ ok: true });
  }));

  app.post('/dashboard/management-accounts/:accountKey/password', requireDashboardAuth, asyncRoute(async (request, response) => {
    const result = await managementAccounts.changePassword({
      accountKey: request.params.accountKey,
      password: request.body?.password
    });
    logDomainChange('management-password-changed-by-owner', {
      tenantRef: protectedIdentifier(result.accountKey),
      accountRef: protectedIdentifier(result.username),
      revision: result.revision
    });
    await recordSecurityActivity({
      accountKey: result.accountKey,
      event: 'management-password-changed',
      actorRef: dashboardActorRef(request),
      details: { revision: result.revision, providerSessionsRevoked: true }
    });
    response.json({
      ok: true,
      account: { accountKey: result.accountKey, username: result.username, revision: result.revision },
      publication: result.publication
    });
  }));

  app.post('/dashboard/management-accounts/:accountKey/password-reset-email', requireDashboardAuth, asyncRoute(async (request, response) => {
    await managementAccounts.sendResetEmail({ accountKey: request.params.accountKey });
    logDomainChange('management-password-reset-email-requested', {
      tenantRef: protectedIdentifier(request.params.accountKey)
    });
    await recordSecurityActivity({
      accountKey: request.params.accountKey,
      event: 'password-reset-email-requested',
      actorRef: dashboardActorRef(request),
      details: { provider: 'firebase', outcome: 'accepted' }
    });
    response.json({ ok: true, sent: true });
  }));

  app.get('/dashboard/events', requireDashboardAuth, (request, response) => {
    liveUpdates.connect(request, response, startedAt);
  });
}

module.exports = { registerDashboardRoutes };
