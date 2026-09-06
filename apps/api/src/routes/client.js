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
  recordManagementSecurityEvent,
  recordTelemetryEvent,
  recordUpdateEvent,
  recoverAbandonedPublicationClaim,
  schedulePublicationDrain,
  saveState,
  storeAnalyticalReport,
  upsertClient
} = require('../database');
const { getAccountKeyFromState, sanitizeAccountKey } = require('../orbitCore');
const { asyncRoute, blockLatestStateForPilotAuth, requireClientAuth, requireOwnerApiKey } = require('../http/auth');
const { logDomainChange, logStateChanges } = require('../http/domainEvents');
const { protectedIdentifier, redactText } = require('../http/dataProtection');
const { getManagementAccountService } = require('../managementAccountService');
const {
  analyticalReportContainsDeletedPlayer,
  enforcePlayerPrivacyTombstones
} = require('../accountDeletionService');

function preserveServerManagedState(incomingState, authoritativeState) {
  let state = { ...incomingState };
  if (authoritativeState?.selfCheckIn) {
    state.selfCheckIn = authoritativeState.selfCheckIn;
  } else {
    delete state.selfCheckIn;
  }
  for (const key of ['membershipQrTokens', 'playerPrivacyTombstones', 'tournamentInterests']) {
    if (authoritativeState && Object.hasOwn(authoritativeState, key)) state[key] = authoritativeState[key];
  }
  state = enforcePlayerPrivacyTombstones(state, authoritativeState);
  return state;
}

function createAnalyticalReportHandler(dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const storeReport = dependencies.storeAnalyticalReport || storeAnalyticalReport;
  const containsDeletedPlayer = dependencies.analyticalReportContainsDeletedPlayer
    || analyticalReportContainsDeletedPlayer;
  return async function handleAnalyticalReport(request, response) {
    const accountKey = request.orbitAuth?.accountKey;
    const suppliedAccount = request.body?.account?.accountKey || request.body?.account?.licenseId;
    if (accountKey && suppliedAccount && sanitizeAccountKey(suppliedAccount) !== accountKey) {
      response.status(403).json({ ok: false, error: 'Authenticated tenant does not match the report account.' });
      return;
    }
    const report = accountKey
      ? { ...request.body, account: { ...(request.body?.account || {}), accountKey } }
      : request.body;
    const authoritative = accountKey ? await readState(accountKey) : null;
    if (await containsDeletedPlayer(report, authoritative?.state, dependencies)) {
      response.status(409).json({
        ok: false,
        code: 'REPORT_CONTAINS_DELETED_PLAYER_DATA',
        error: 'Regenerate this analytical report from the current venue state before uploading it.'
      });
      return;
    }
    response.status(201).json(await storeReport(report));
  };
}

function createPublicationRecoveryHandler(dependencies = {}) {
  const recoverClaim = dependencies.recoverAbandonedPublicationClaim || recoverAbandonedPublicationClaim;
  const scheduleDrain = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  return async function recoverPublicationClaim(request, response) {
    const result = await recoverClaim({
      accountKey: request.body?.accountKey,
      revision: request.body?.revision,
      claimId: request.body?.claimId,
      runtimeTerminated: request.body?.runtimeTerminated,
      evidenceRef: request.body?.evidenceRef
    });
    if (!result.recovered) {
      response.status(409).json({ ok: false, code: 'PUBLICATION_CLAIM_NOT_RECOVERABLE' });
      return;
    }
    void Promise.resolve(scheduleDrain({ force: true })).catch(() => undefined);
    response.json({ ok: true, recovered: true });
  };
}

function registerClientRoutes(app, liveUpdates) {
  const managementAccounts = getManagementAccountService();
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
  app.use([
    '/license/status',
    '/clients/heartbeat',
    '/clients/update-event',
    '/clients/event',
    '/clients/error',
    '/state',
    '/analytical-reports',
    '/management/recovery'
  ], requireClientAuth);

  const bindTenantPayload = (request, response) => {
    const payload = request.body && typeof request.body === 'object' ? { ...request.body } : {};
    const accountKey = request.orbitAuth?.accountKey;
    if (!accountKey) return payload;
    const requestedVenue = payload.venueId || payload.venueName;
    if (requestedVenue && sanitizeAccountKey(requestedVenue) !== accountKey) {
      response.status(403).json({ ok: false, error: 'Authenticated tenant does not match the requested venue.' });
      return null;
    }
    const rawDeviceId = String(payload.deviceId || '').trim();
    const redactedDeviceId = redactText(rawDeviceId, 120);
    const safeDeviceId = redactedDeviceId === rawDeviceId
      ? rawDeviceId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120)
      : `protected-${protectedIdentifier(rawDeviceId)}`;
    return {
      ...payload,
      venueId: accountKey,
      deviceId: rawDeviceId ? `${accountKey}:${safeDeviceId}` : ''
    };
  };

  app.get('/license/status', asyncRoute(async (request, response) => {
    response.json({ ok: true, managed: true, active: true, license: request.orbitAuth?.license || null });
  }));

  app.post('/clients/heartbeat', asyncRoute(async (request, response) => {
    const payload = bindTenantPayload(request, response);
    if (!payload) return;
    const client = await upsertClient(payload);
    liveUpdates.broadcast('client', client);
    response.status(202).json({ ok: true, client });
  }));

  app.post('/clients/update-event', asyncRoute(async (request, response) => {
    const payload = bindTenantPayload(request, response);
    if (!payload) return;
    const client = await recordUpdateEvent(payload);
    const event = (await listTelemetryEvents({ deviceId: client.deviceId, limit: 1 }))[0];
    if (event) liveUpdates.broadcast('telemetry', event);
    response.status(202).json({ ok: true, client });
  }));

  app.post('/clients/event', asyncRoute(async (request, response) => {
    const payload = bindTenantPayload(request, response);
    if (!payload) return;
    const event = await recordTelemetryEvent(payload);
    liveUpdates.broadcast('telemetry', event);
    response.status(202).json({ ok: true, event });
  }));

  app.post('/clients/error', asyncRoute(async (request, response) => {
    const payload = bindTenantPayload(request, response);
    if (!payload) return;
    const error = await recordClientError(payload);
    liveUpdates.broadcast('error', error);
    response.status(202).json({ ok: true, error });
  }));

  app.get('/clients', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const clients = await listClients({
      limit: limit + 1,
      beforeLastSeenAt: request.query.beforeLastSeenAt,
      beforeDeviceId: request.query.beforeDeviceId
    });
    response.json({ ok: true, clients: clients.slice(0, limit), hasMore: clients.length > limit });
  }));

  const requirePilotRecoveryAuth = (request, response, next) => {
    if (request.orbitAuth?.type !== 'pilot-key' || !request.orbitAuth.accountKey) {
      response.status(403).json({ ok: false, error: 'A current pilot license key is required for account recovery.' });
      return;
    }
    next();
  };

  app.get('/management/recovery/status', requirePilotRecoveryAuth, asyncRoute(async (request, response) => {
    const status = await managementAccounts.getRecoveryStatus({ accountKey: request.orbitAuth.accountKey });
    response.json({ ok: true, ...status });
  }));

  app.post('/management/recovery/complete', requirePilotRecoveryAuth, asyncRoute(async (request, response) => {
    const result = await managementAccounts.completeRecovery({
      accountKey: request.orbitAuth.accountKey,
      password: request.body?.password
    });
    logDomainChange('management-recovery-override-consumed', {
      tenantRef: protectedIdentifier(result.accountKey),
      accountRef: protectedIdentifier(result.username),
      revision: result.revision
    });
    await recordSecurityActivity({
      accountKey: result.accountKey,
      event: 'recovery-override-completed',
      actorRef: `pilot:${protectedIdentifier(request.orbitAuth.license?.id || request.orbitAuth.accountKey)}`,
      details: { revision: result.revision, providerSessionsRevoked: true }
    });
    response.json({
      ok: true,
      accountKey: result.accountKey,
      accountLogin: {
        username: result.username,
        passwordSalt: result.passwordSalt,
        passwordHash: result.passwordHash,
        lastLoginAt: result.lastLoginAt
      },
      revision: result.revision,
      publication: result.publication
    });
  }));

  app.get('/clients/:deviceId', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const client = await getClient(request.params.deviceId);
    if (!client) {
      response.status(404).json({ ok: false, error: 'Client not found.' });
      return;
    }
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const updateEvents = await listClientUpdateEvents(request.params.deviceId, {
      limit: limit + 1,
      beforeOccurredAt: request.query.beforeOccurredAt,
      beforeId: request.query.beforeId
    });
    response.json({ ok: true, client, updateEvents: updateEvents.slice(0, limit), hasMore: updateEvents.length > limit });
  }));

  app.get('/telemetry/events', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const events = await listTelemetryEvents({
      venueId: request.query.venueId,
      deviceId: request.query.deviceId,
      beforeOccurredAt: request.query.beforeOccurredAt,
      beforeId: request.query.beforeId,
      limit: limit + 1
    });
    response.json({
      ok: true,
      events: events.slice(0, limit),
      hasMore: events.length > limit
    });
  }));

  app.get('/telemetry/errors', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const errors = await listClientErrors({
      venueId: request.query.venueId,
      deviceId: request.query.deviceId,
      beforeOccurredAt: request.query.beforeOccurredAt,
      beforeId: request.query.beforeId,
      limit: limit + 1
    });
    response.json({
      ok: true,
      errors: errors.slice(0, limit),
      hasMore: errors.length > limit
    });
  }));

  app.get('/venues', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const venues = await listVenues({
      limit: limit + 1,
      beforeSavedAt: request.query.beforeSavedAt,
      beforeVenueId: request.query.beforeVenueId
    });
    response.json({ ok: true, venues: venues.slice(0, limit), hasMore: venues.length > limit });
  }));

  app.get('/venues/:venueId/clients', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const clients = await listClients({
      venueId: request.params.venueId,
      limit: limit + 1,
      beforeLastSeenAt: request.query.beforeLastSeenAt,
      beforeDeviceId: request.query.beforeDeviceId
    });
    response.json({ ok: true, clients: clients.slice(0, limit), hasMore: clients.length > limit });
  }));

  app.get('/publications', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 250);
    const publications = await listPublicationOutbox({
      accountKey: request.query.accountKey,
      limit: limit + 1,
      beforeCreatedAt: request.query.beforeCreatedAt,
      beforeAccountKey: request.query.beforeAccountKey,
      beforeRevision: request.query.beforeRevision
    });
    response.json({
      ok: true,
      publications: publications.slice(0, limit),
      hasMore: publications.length > limit
    });
  }));

  app.post('/publications/drain', requireOwnerApiKey, asyncRoute(async (request, response) => {
    const results = await drainPublicationOutbox({ limit: request.body?.limit || 25 });
    response.json({ ok: true, processed: results.length, results });
  }));

  // Recovery is deliberately owner-authenticated and evidence-gated. An
  // expired timestamp alone never steals a possibly live remote writer.
  app.post(
    '/publications/recover',
    requireOwnerApiKey,
    asyncRoute(createPublicationRecoveryHandler())
  );

  app.post('/state', asyncRoute(async (request, response) => {
    const state = request.body?.state;
    const expectedRevision = Number(request.body?.expectedRevision);
    const mutationId = String(request.get('x-orbit-mutation-id') || request.body?.mutationId || '').trim();
    if (!state || !Number.isInteger(expectedRevision) || expectedRevision < 0 || !/^[a-zA-Z0-9._:-]{1,180}$/.test(mutationId)) {
      response.status(428).json({ ok: false, error: 'state, expectedRevision, and a stable mutationId are required.' });
      return;
    }
    const accountKey = getAccountKeyFromState(state);
    if (request.orbitAuth?.accountKey && request.orbitAuth.accountKey !== accountKey) {
      response.status(403).json({ ok: false, error: 'Authenticated tenant cannot write another venue account.' });
      return;
    }
    const previous = await loadState(accountKey);
    const stateWithServerManagedFields = preserveServerManagedState(state, previous?.state);
    const result = await saveState(stateWithServerManagedFields, { expectedRevision, mutationId, mutationType: 'desktop-state' });
    logStateChanges(previous?.state, stateWithServerManagedFields, result.accountKey);
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
    if (request.orbitAuth?.accountKey && request.orbitAuth.accountKey !== sanitizeAccountKey(request.params.venueId)) {
      response.status(403).json({ ok: false, error: 'Authenticated tenant cannot read another venue account.' });
      return;
    }
    const record = await loadState(request.params.venueId);
    if (!record) {
      response.status(404).json({ ok: false, error: 'Venue state not found.' });
      return;
    }
    response.json({ ok: true, ...record });
  }));

  app.post('/analytical-reports', asyncRoute(createAnalyticalReportHandler()));
}

module.exports = {
  createAnalyticalReportHandler,
  createPublicationRecoveryHandler,
  preserveServerManagedState,
  registerClientRoutes
};
