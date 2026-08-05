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
  getAccountKeyFromState,
  sanitizeAccountKey
} = require('./orbitCore');
const { getFirebasePublisherStatus, publishStateToFirebase } = require('./firebasePublisher');
const {
  authenticatePilotLicense,
  listPilotLicenses,
  registerPilotLicense,
  renewPilotLicense,
  revokePilotLicense
} = require('./licenseService');
const {
  createPlayerIdentitySession,
  deletePlayerIdentity,
  getIdentityServiceStatus,
  getPlayerIdentityStatus,
  requireVerifiedPlayerAge
} = require('./identityService');
const {
  createMembershipCheckout,
  getPaymentServiceStatus,
  handleRevenueCatWebhook,
  handleStripeWebhook,
  requireFirebasePlayer
} = require('./paymentService');

const app = express();
const port = Number(process.env.API_PORT || 4629);
const host = process.env.API_HOST || '127.0.0.1';
const startedAt = new Date().toISOString();
const liveClients = new Set();

app.use(cors());
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
app.post('/webhooks/revenuecat', express.json({ limit: '256kb' }), asyncRoute(handleRevenueCatWebhook));
app.use(express.json({ limit: '2mb' }));
app.use((request, response, next) => {
  const requestId = request.get('x-orbit-request-id') || crypto.randomUUID();
  request.orbitRequestId = requestId;
  response.set('x-orbit-request-id', requestId);
  next();
});

function logDomainChange(event, details = {}) {
  console.log(`[orbit-api] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    event,
    ...details
  })}`);
}

function logStateChanges(previousState, nextState, accountKey) {
  if (!previousState) {
    logDomainChange('core-connected', { accountKey });
    return;
  }
  const previousProfiles = new Map((previousState.profiles || []).map((profile) => [profile.id, profile]));
  const previousSessions = new Map((previousState.sessions || []).map((session) => [session.id, session]));
  const previousInterests = new Set((previousState.interests || []).map((interest) => interest.id));

  for (const profile of nextState.profiles || []) {
    const previous = previousProfiles.get(profile.id);
    if (!previous) {
      logDomainChange('player-added', { accountKey, playerId: profile.id, playerName: profile.name || 'Player' });
    } else if (previous.membershipStatus !== profile.membershipStatus) {
      logDomainChange('membership-status-changed', {
        accountKey,
        playerId: profile.id,
        playerName: profile.name || 'Player',
        from: previous.membershipStatus || 'None',
        to: profile.membershipStatus || 'None'
      });
    }
  }

  for (const session of nextState.sessions || []) {
    const previous = previousSessions.get(session.id);
    if (!previous) {
      logDomainChange('game-formed', {
        accountKey,
        sessionId: session.id,
        gameId: session.gameId,
        table: session.label || '',
        status: session.status || ''
      });
    } else if (previous.status !== session.status) {
      logDomainChange('game-status-changed', {
        accountKey,
        sessionId: session.id,
        gameId: session.gameId,
        table: session.label || '',
        from: previous.status || '',
        to: session.status || ''
      });
    }
  }

  for (const interest of nextState.interests || []) {
    if (!previousInterests.has(interest.id)) {
      logDomainChange('game-request-added', {
        accountKey,
        requestId: interest.id,
        playerId: interest.profileId || '',
        playerName: interest.playerName || 'Player',
        gameId: interest.gameId,
        status: interest.status || ''
      });
    }
  }
}

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
  const dashboardKey = request.get('x-orbit-api-key') || request.query.apiKey || '';
  if (dashboardKey && safeEqual(dashboardKey, configuredPassword)) {
    next();
    return;
  }
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

async function requireClientAuth(request, response, next) {
  const remoteAddress = request.socket?.remoteAddress || '';
  const isLoopbackRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (process.env.NODE_ENV !== 'production' && isLoopbackRequest) {
    request.orbitAuth = { type: 'local-development' };
    next();
    return;
  }
  const configuredKey = process.env.ORBIT_CLIENT_API_KEY;
  const received = getReceivedApiKey(request);
  if (configuredKey && received === configuredKey) {
    request.orbitAuth = { type: 'owner-api-key' };
    next();
    return;
  }
  if (isPilotAuthorizationCode(received)) {
    const result = await authenticatePilotLicense(received);
    if (result.managed) {
      if (!result.active) {
        response.status(403).json({ ok: false, error: `Pilot license ${result.license?.status || 'expired'}.`, license: result.license });
        return;
      }
      request.orbitAuth = {
        type: 'pilot-key',
        accountKey: result.license.accountKey,
        license: result.license
      };
      next();
      return;
    }

    const legacyBootstrapEnabled = process.env.ORBIT_LICENSE_ALLOW_LEGACY_BOOTSTRAP !== 'false';
    const state = request.body?.state || request.body;
    const access = state?.settings?.pilotAccess;
    if (legacyBootstrapEnabled && access?.authorizationCode === received) {
      const license = await registerPilotLicense(access);
      if (!license || license.status !== 'active') {
        response.status(403).json({ ok: false, error: 'Pilot license is expired.', license });
        return;
      }
      request.orbitAuth = { type: 'pilot-key', accountKey: license.accountKey, license };
      next();
      return;
    }
    if (!legacyBootstrapEnabled) {
      response.status(401).json({ ok: false, error: 'Pilot license is not registered.' });
      return;
    }
    const isLegacyStatusCheck = request.method === 'GET' && request.path === '/license/status';
    const isLegacyVenueRead = request.method === 'GET' && request.path.startsWith('/state/');
    if (!isLegacyStatusCheck && !isLegacyVenueRead) {
      response.status(401).json({ ok: false, error: 'Pilot license is not registered. Sync the activated desktop installation to complete migration.' });
      return;
    }
    request.orbitAuth = {
      type: 'legacy-pilot-key',
      accountKey: '',
      authorizationCode: received
    };
    next();
    return;
  }
  response.status(401).json({ ok: false, error: 'Invalid API key or pilot authorization code.' });
}

function blockLatestStateForPilotAuth(request, response, next) {
  if (request.orbitAuth?.type === 'pilot-key' || request.orbitAuth?.type === 'legacy-pilot-key') {
    response.status(403).json({ ok: false, error: 'Pilot-authenticated clients must request their own venue state.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function optionalFirebasePlayer(request, response, next) {
  if (!request.get('authorization')) {
    next();
    return;
  }
  requireFirebasePlayer(request, response, next);
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
    payments: getPaymentServiceStatus(),
    identity: getIdentityServiceStatus(),
    startedAt
  });
});

app.get('/player/identity/status', requireFirebasePlayer, asyncRoute(getPlayerIdentityStatus));
app.post('/player/identity/session', requireFirebasePlayer, asyncRoute(createPlayerIdentitySession));
app.delete('/player/identity', requireFirebasePlayer, asyncRoute(deletePlayerIdentity));
app.post('/player/membership-checkout', requireFirebasePlayer, requireVerifiedPlayerAge, asyncRoute(createMembershipCheckout));
app.get('/player/snapshot', requireFirebasePlayer, asyncRoute(handlePlayerSnapshot));
app.post('/player/membership-requests', optionalFirebasePlayer, asyncRoute(handlePlayerMembershipRequest));
app.post('/player/waitlist-requests', optionalFirebasePlayer, asyncRoute(handlePlayerWaitlistRequest));

app.get(['/privacy', '/privacy.html'], (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});

app.get(['/terms', '/terms.html'], (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'terms.html'));
});

app.get(['/support', '/support.html'], (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'support.html'));
});

app.get('/legal.css', (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'legal.css'));
});

app.get('/orbit-logo.svg', (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'orbit-logo.svg'));
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

async function handlePlayerSnapshot(request, response) {
  const accountKey = sanitizeAccountKey(request.query.accountKey || request.query.venueId || '');
  const record = accountKey ? loadState(accountKey) : loadLatestState();
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No Orbit club database is available yet.' });
    return;
  }
  const player = {
    id: request.orbitPlayer.uid,
    name: request.query.playerName || request.orbitPlayer.name || ''
  };
  response.json({
    ok: true,
    accountKey: record.accountKey,
    savedAt: record.savedAt,
    snapshot: buildPlayerClubSnapshot(record.state, player)
  });
}

async function handlePlayerMembershipRequest(request, response) {
  const requestPayload = {
    ...request.body,
    player: {
      ...(request.body?.player || {}),
      id: request.orbitPlayer?.uid || request.body?.player?.id || request.body?.id,
      email: request.orbitPlayer?.email || request.body?.player?.email || ''
    }
  };
  if (!requestPayload.clubId || !requestPayload.id || !requestPayload.player.id || !requestPayload.player.name) {
    response.status(400).json({ ok: false, error: 'A club, request ID, and player identity are required.' });
    return;
  }
  const record = loadState(requestPayload.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this membership request.' });
    return;
  }
  const nextState = applyMembershipRequestToState(record.state, requestPayload);
  const result = saveState(nextState);
  logDomainChange('membership-request-sent', {
    accountKey: result.accountKey,
    requestId: requestPayload.id,
    playerId: requestPayload.player.id,
    playerName: requestPayload.player.name || 'Player',
    planId: requestPayload.planId || '',
    planName: requestPayload.planName || requestPayload.plan || ''
  });
  const firebase = await publishStateForResponse(nextState);
  response.status(201).json({
    ok: true,
    ...result,
    firebase,
    snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
  });
}

async function handlePlayerWaitlistRequest(request, response) {
  const requestPayload = {
    ...request.body,
    player: {
      ...(request.body?.player || {}),
      id: request.orbitPlayer?.uid || request.body?.player?.id || request.body?.id,
      email: request.orbitPlayer?.email || request.body?.player?.email || ''
    }
  };
  if (!requestPayload.clubId || !requestPayload.id || !requestPayload.gameId || !requestPayload.player.id || !requestPayload.player.name) {
    response.status(400).json({ ok: false, error: 'A club, game, request ID, and player identity are required.' });
    return;
  }
  const record = loadState(requestPayload.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this waitlist request.' });
    return;
  }
  const nextState = applyWaitlistRequestToState(record.state, requestPayload);
  const result = saveState(nextState);
  logDomainChange(requestPayload.action === 'cancel' ? 'game-request-cancelled' : 'game-request-sent', {
    accountKey: result.accountKey,
    requestId: requestPayload.id,
    playerId: requestPayload.player.id,
    playerName: requestPayload.player.name || 'Player',
    gameId: requestPayload.gameId
  });
  const firebase = await publishStateForResponse(nextState);
  response.status(201).json({
    ok: true,
    ...result,
    firebase,
    snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
  });
}

app.post('/analytical-reports', asyncRoute(async (request, response) => {
  response.status(201).json(storeAnalyticalReport(request.body));
}));

app.use((error, request, response, _next) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'api-error',
    requestId: request.orbitRequestId || '',
    method: request.method,
    pathname: request.path,
    message: error instanceof Error ? error.message : 'Request failed.',
    stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack
  }));
  response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' });
});

const server = app.listen(port, host, () => {
  console.log(`Orbit API listening on http://${host}:${port}`);
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
