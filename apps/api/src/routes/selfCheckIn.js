const crypto = require('crypto');
const path = require('path');
const {
  loadState,
  saveState,
  schedulePublicationDrain
} = require('../database');
const { asyncRoute, requireClientAuth } = require('../http/auth');
const { protectedIdentifier } = require('../http/dataProtection');
const { logDomainChange } = require('../http/domainEvents');
const { sendOperationalAlert } = require('../http/operationalAlerts');
const { inspectPilotLicense } = require('../licenseService');
const { sanitizeAccountKey } = require('../orbitCore');
const {
  appendSelfCheckInAssistanceRequest,
  findSelfCheckInProfile,
  getAvailableSelfCheckInTables,
  seatSelfCheckInPlayer
} = require('../selfCheckIn');
const {
  createSelfCheckInSecurity,
  normalizePlayerName,
  validateMutationId,
  validateTableId
} = require('../selfCheckInSecurity');

const publicDirectory = path.join(__dirname, '..', '..', 'public');
const maximumCommitAttempts = 4;
const checkInTokenHeader = 'x-orbit-check-in-token';
const checkInSessionHeader = 'x-orbit-check-in-session';

function stableId(prefix, material, length = 40) {
  const digest = crypto.createHash('sha256').update(String(material)).digest('hex').slice(0, length);
  return `${prefix}${digest}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, allowedKeys) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function requireJsonBody(request, response, allowedKeys) {
  if (!request.is('application/json')) {
    response.status(415).json({ ok: false, code: 'JSON_REQUIRED', error: 'This endpoint accepts application/json only.' });
    return false;
  }
  if (!hasExactKeys(request.body, allowedKeys)) {
    response.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'The request contains unsupported fields.' });
    return false;
  }
  return true;
}

function requireSelfCheckInIssuer(request, response, next) {
  const scopes = Array.isArray(request.orbitAuth?.scopes) ? request.orbitAuth.scopes : [];
  if (!request.orbitAuth?.accountKey || !scopes.includes('client:write')) {
    response.status(403).json({
      ok: false,
      code: 'SELF_CHECK_IN_ISSUER_FORBIDDEN',
      error: 'Tenant-scoped client write access is required.'
    });
    return;
  }
  next();
}

function setPrivateResponseHeaders(response) {
  response.set('cache-control', 'private, no-store, max-age=0');
  response.set('pragma', 'no-cache');
  response.set('x-robots-tag', 'noindex, nofollow');
}

function readConfiguredOrigin(request, configuredOrigin) {
  const configured = String(configuredOrigin || process.env.ORBIT_SELF_CHECK_IN_ORIGIN || '').trim();
  const fallback = process.env.NODE_ENV !== 'production'
    ? `${request.protocol}://${request.get('host')}`
    : '';
  try {
    const parsed = new URL(configured || fallback);
    const loopbackHttp = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (
      (parsed.protocol !== 'https:' && !loopbackHttp) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function getSecurity(dependencies) {
  return (dependencies.createSecurity || createSelfCheckInSecurity)({
    secret: dependencies.secret ?? process.env.ORBIT_SELF_CHECK_IN_SECRET,
    nowMs: dependencies.nowMs,
    randomUUID: dependencies.randomUUID
  });
}

function sendTokenError(response, result) {
  const expired = result.code === 'expired';
  const revoked = result.code === 'revoked';
  response.status(expired || revoked ? 410 : 401).json({
    ok: false,
    code: expired ? 'CHECK_IN_TOKEN_EXPIRED' : revoked ? 'CHECK_IN_TOKEN_REVOKED' : 'INVALID_CHECK_IN_TOKEN',
    error: expired || revoked
      ? 'This club check-in code is no longer active. Ask club staff for the current code.'
      : 'The club check-in code is invalid.'
  });
}

function readBoundedHeader(request, name) {
  const value = request.get(name);
  return typeof value === 'string' && value.length <= 4_096 ? value : '';
}

function getClubName(state) {
  return String(state.settings?.clubAccount?.clubName || 'Orbit Club').trim().slice(0, 120) || 'Orbit Club';
}

function getActiveSeat(state, profileId) {
  const playerSession = (state.playerSessions || []).find((session) => session.profileId === profileId && !session.leftAt);
  if (!playerSession) return null;
  const table = (state.sessions || []).find((candidate) => candidate.id === playerSession.tableId);
  const game = (state.games || []).find((candidate) => candidate.id === playerSession.gameId);
  return {
    playerSession,
    tableLabel: String(table?.label || 'Assigned table').slice(0, 120),
    gameName: String(game?.name || '').slice(0, 120),
    seatNumber: Number(playerSession.seatNumber || 0)
  };
}

function getActiveStateLicense(state, accountKey, nowMs) {
  const access = state.settings?.pilotAccess;
  const expiresAtMs = Date.parse(access?.expiresAt || '');
  if (
    access?.authorized !== true ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= nowMs ||
    sanitizeAccountKey(access?.licenseId) !== accountKey ||
    typeof access?.authorizationCode !== 'string' ||
    !access.authorizationCode.trim()
  ) return null;
  return { access, expiresAtMs };
}

async function verifyActiveClubLicense(state, accountKey, dependencies, nowMs) {
  const localLicense = getActiveStateLicense(state, accountKey, nowMs);
  if (!localLicense) return { ok: false, code: 'inactive' };
  const inspect = dependencies.inspectPilotLicense || inspectPilotLicense;
  try {
    const result = await inspect(localLicense.access.authorizationCode);
    if (
      !result?.managed ||
      !result.active ||
      sanitizeAccountKey(result.license?.accountKey) !== accountKey
    ) return { ok: false, code: 'inactive' };
    const updatedAtMs = Date.parse(
      result.license?.updatedAt || result.license?.createdAt || result.license?.issuedAt || ''
    );
    if (!Number.isFinite(updatedAtMs)) return { ok: false, code: 'inactive' };
    return { ok: true, expiresAtMs: localLicense.expiresAtMs, updatedAtMs };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}

function sendLicenseError(response, result) {
  const unavailable = result.code === 'unavailable';
  response.status(unavailable ? 503 : 410).json({
    ok: false,
    code: unavailable ? 'CHECK_IN_UNAVAILABLE' : 'PILOT_LICENSE_INACTIVE',
    error: unavailable
      ? 'Club self-check-in is temporarily unavailable.'
      : 'This club self-check-in code is no longer active.'
  });
}

async function commitWithRetries(accountKey, input, dependencies) {
  const readState = dependencies.loadState || loadState;
  const writeState = dependencies.saveState || saveState;
  let lastConflict;
  for (let attempt = 0; attempt < maximumCommitAttempts; attempt += 1) {
    const record = await readState(accountKey);
    if (!record?.state) return { kind: 'missing' };
    const transition = input.transform(record.state);
    if (!transition.state) return { kind: 'unchanged', record, transition };
    try {
      const result = await writeState(transition.state, {
        expectedRevision: record.revision,
        mutationId: input.mutationId,
        mutationType: input.mutationType
      });
      if (result?.duplicate) {
        const authoritativeRecord = await readState(accountKey);
        if (!authoritativeRecord?.state) throw new Error('The authoritative state was unavailable after an idempotent replay.');
        return {
          kind: 'duplicate',
          record: authoritativeRecord,
          transition: input.onDuplicate
            ? input.onDuplicate(authoritativeRecord.state, result)
            : input.transform(authoritativeRecord.state),
          result
        };
      }
      return { kind: 'saved', record, transition, result };
    } catch (error) {
      if (error?.code !== 'STATE_REVISION_CONFLICT') throw error;
      lastConflict = error;
    }
  }
  throw lastConflict || new Error('Self-check-in could not commit after bounded retries.');
}

function createSelfCheckInHandlers(dependencies = {}) {
  const nowIso = dependencies.nowIso || (() => new Date().toISOString());
  const drain = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const alertOperations = dependencies.sendOperationalAlert || sendOperationalAlert;

  async function issueClubKit(request, response) {
    setPrivateResponseHeaders(response);
    if (!requireJsonBody(request, response, ['mutationId'])) return;
    const accountKey = request.orbitAuth.accountKey;
    const clientMutationId = request.body.mutationId;
    if (!validateMutationId(clientMutationId)) {
      response.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'A valid request ID is required.' });
      return;
    }
    const origin = readConfiguredOrigin(request, dependencies.publicOrigin);
    if (!origin) {
      response.status(503).json({
        ok: false,
        code: 'SELF_CHECK_IN_ORIGIN_NOT_CONFIGURED',
        error: 'The public self-check-in origin is not configured.'
      });
      return;
    }
    let security;
    try {
      security = getSecurity(dependencies);
    } catch {
      response.status(503).json({
        ok: false,
        code: 'SELF_CHECK_IN_NOT_CONFIGURED',
        error: 'Club self-check-in signing is not configured.'
      });
      return;
    }

    const generation = `generation-${stableId('', `${accountKey}\u0000${clientMutationId}`)}`;
    const generatedAt = nowIso();
    const issuedAtMs = dependencies.nowMs ? dependencies.nowMs() : Date.now();
    const readState = dependencies.loadState || loadState;
    const initialRecord = await readState(accountKey);
    if (!initialRecord?.state) {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'The authenticated club database was not found.' });
      return;
    }
    if (!getActiveStateLicense(initialRecord.state, accountKey, issuedAtMs)) {
      response.status(403).json({
        ok: false,
        code: 'PILOT_LICENSE_INACTIVE',
        error: 'An active club license is required to generate a self-check-in code.'
      });
      return;
    }
    const centralLicense = await verifyActiveClubLicense(
      initialRecord.state,
      accountKey,
      dependencies,
      issuedAtMs
    );
    if (!centralLicense.ok) {
      sendLicenseError(response, centralLicense);
      return;
    }
    const committed = await commitWithRetries(accountKey, {
      mutationId: `self-check-in-kit:${stableId('', `${accountKey}\u0000${clientMutationId}`)}`,
      mutationType: 'self-check-in-kit-generated',
      onDuplicate: (state) => state.selfCheckIn?.capabilityGeneration === generation
        ? { replayed: true }
        : { code: 'SELF_CHECK_IN_ISSUANCE_SUPERSEDED' },
      transform: (state) => {
        const license = getActiveStateLicense(state, accountKey, issuedAtMs);
        if (!license) {
          return { code: 'PILOT_LICENSE_INACTIVE' };
        }
        if (state.selfCheckIn?.capabilityGeneration === generation) return { replayed: true };
        return {
          state: {
            ...state,
            selfCheckIn: { capabilityGeneration: generation, generatedAt }
          }
        };
      }
    }, dependencies);
    if (committed.kind === 'missing') {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'The authenticated club database was not found.' });
      return;
    }
    if (committed.transition.code === 'PILOT_LICENSE_INACTIVE') {
      response.status(403).json({
        ok: false,
        code: 'PILOT_LICENSE_INACTIVE',
        error: 'An active club license is required to generate a self-check-in code.'
      });
      return;
    }
    if (committed.transition.code === 'SELF_CHECK_IN_ISSUANCE_SUPERSEDED') {
      response.status(409).json({
        ok: false,
        code: 'SELF_CHECK_IN_ISSUANCE_SUPERSEDED',
        error: 'A newer club self-check-in code is already active. Generate a new PDF instead of retrying this request.'
      });
      return;
    }
    const state = committed.transition.state || committed.record.state;
    const license = getActiveStateLicense(state, accountKey, issuedAtMs);
    if (!license) {
      response.status(403).json({ ok: false, code: 'PILOT_LICENSE_INACTIVE', error: 'An active club license is required to generate a self-check-in code.' });
      return;
    }
    const issued = security.issueClubCapability({
      clubId: accountKey,
      generation,
      expiresAtMs: license.expiresAtMs
    });
    const checkInUrl = `${origin}/check-in#token=${encodeURIComponent(issued.token)}`;
    if (committed.kind === 'saved') {
      logDomainChange('self-check-in-kit-generated', {
        tenantRef: protectedIdentifier(accountKey),
        generationRef: protectedIdentifier(generation)
      });
      void drain();
    }
    response.status(committed.kind === 'saved' ? 201 : 200).json({
      ok: true,
      accountKey,
      clubName: getClubName(state),
      checkInUrl,
      expiresAt: issued.expiresAt,
      revision: committed.result?.revision ?? committed.record.revision,
      selfCheckIn: state.selfCheckIn,
      rotatedPreviousCode: committed.kind === 'saved' && Boolean(committed.record.state.selfCheckIn?.capabilityGeneration)
    });
  }

  async function lookupPlayer(request, response) {
    setPrivateResponseHeaders(response);
    if (!requireJsonBody(request, response, ['name', 'mutationId'])) return;
    const normalized = normalizePlayerName(request.body.name);
    const clientMutationId = request.body.mutationId;
    if (!normalized || !validateMutationId(clientMutationId)) {
      response.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'Enter a valid player name and request ID.' });
      return;
    }
    let security;
    try {
      security = getSecurity(dependencies);
    } catch {
      response.status(503).json({ ok: false, code: 'SELF_CHECK_IN_NOT_CONFIGURED', error: 'Club self-check-in is unavailable.' });
      return;
    }
    const capabilityToken = readBoundedHeader(request, checkInTokenHeader);
    const unboundCapability = security.verifyClubCapability(capabilityToken);
    if (!unboundCapability.ok) {
      sendTokenError(response, unboundCapability);
      return;
    }
    const readState = dependencies.loadState || loadState;
    const record = await readState(unboundCapability.value.clubId);
    if (!record?.state) {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'This club is not available.' });
      return;
    }
    const capability = security.verifyClubCapability(capabilityToken, {
      expectedGeneration: record.state.selfCheckIn?.capabilityGeneration
    });
    if (!capability.ok || !record.state.selfCheckIn?.capabilityGeneration) {
      sendTokenError(response, capability.ok ? { code: 'revoked' } : capability);
      return;
    }
    const license = await verifyActiveClubLicense(
      record.state,
      capability.value.clubId,
      dependencies,
      dependencies.nowMs ? dependencies.nowMs() : Date.now()
    );
    if (!license.ok) {
      sendLicenseError(response, license);
      return;
    }
    if (capability.value.issuedAt < license.updatedAtMs) {
      sendTokenError(response, { code: 'revoked' });
      return;
    }
    const clubName = getClubName(record.state);
    const match = findSelfCheckInProfile(record.state, normalized.lookupKey);
    if (match.kind === 'matched') {
      const existingSeat = getActiveSeat(record.state, match.profile.id);
      if (existingSeat) {
        response.json({
          ok: true,
          status: 'already-seated',
          clubName,
          message: 'You are already checked in. Ask club staff if you need help with your seat.'
        });
        return;
      }
      const session = security.issueScanSession({
        clubId: capability.value.clubId,
        profileId: match.profile.id,
        generation: capability.value.generation,
        capabilityExpiresAt: capability.value.expiresAt
      });
      response.json({
        ok: true,
        status: 'recognized',
        clubName,
        playerName: match.profile.name,
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
        tables: getAvailableSelfCheckInTables(record.state)
      });
      return;
    }

    const operationKey = stableId('', `${capability.value.tokenId}\u0000${clientMutationId}`);
    const requestId = `sci-help-${operationKey}`;
    const reason = match.kind === 'ambiguous' ? 'ambiguous' : 'not-found';
    const createdAt = nowIso();
    const committed = await commitWithRetries(capability.value.clubId, {
      mutationId: `self-check-in-help:${operationKey}`,
      mutationType: 'self-check-in-assistance-requested',
      transform: (state) => {
        if (!getActiveStateLicense(
          state,
          capability.value.clubId,
          dependencies.nowMs ? dependencies.nowMs() : Date.now()
        )) {
          return { code: 'PILOT_LICENSE_INACTIVE' };
        }
        if (state.selfCheckIn?.capabilityGeneration !== capability.value.generation) {
          return { code: 'CHECK_IN_TOKEN_REVOKED' };
        }
        const existing = (state.staffRequests || []).find((candidate) => candidate.id === requestId);
        if (existing) {
          if (existing.playerName !== normalized.displayName || existing.reason !== reason) {
            return { code: 'IDEMPOTENCY_CONFLICT' };
          }
          return { request: existing };
        }
        const requestRecord = {
          id: requestId,
          playerName: normalized.displayName,
          reason,
          createdAt
        };
        const appended = appendSelfCheckInAssistanceRequest(state, requestRecord);
        if (!appended.ok) return { code: appended.code };
        if (appended.duplicate) return { request: appended.request };
        return { request: appended.request, state: appended.state };
      }
    }, dependencies);
    if (committed.kind === 'missing') {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'This club is not available.' });
      return;
    }
    if (committed.transition.code === 'CHECK_IN_TOKEN_REVOKED') {
      sendTokenError(response, { code: 'revoked' });
      return;
    }
    if (committed.transition.code === 'PILOT_LICENSE_INACTIVE') {
      sendLicenseError(response, { code: 'inactive' });
      return;
    }
    if (
      committed.transition.code === 'IDEMPOTENCY_CONFLICT' ||
      committed.transition.code === 'SELF_CHECK_IN_ASSISTANCE_ID_CONFLICT'
    ) {
      response.status(409).json({
        ok: false,
        code: 'IDEMPOTENCY_CONFLICT',
        error: 'That request ID was already used for different check-in details.'
      });
      return;
    }
    if (committed.transition.code === 'SELF_CHECK_IN_ASSISTANCE_QUEUE_FULL') {
      void alertOperations('self-check-in-assistance-queue-full', 'warning', {
        tenantRef: protectedIdentifier(capability.value.clubId),
        requestId: request.orbitRequestId || ''
      });
      response.status(503).json({
        ok: false,
        code: 'CHECK_IN_UNAVAILABLE',
        error: 'Club self-check-in needs staff attention before another request can be accepted.'
      });
      return;
    }
    if (committed.kind === 'saved') {
      logDomainChange('self-check-in-assistance-requested', {
        tenantRef: protectedIdentifier(capability.value.clubId),
        requestRef: protectedIdentifier(requestId),
        reason
      });
      void drain();
    }
    response.status(202).json({
      ok: true,
      status: 'needs-assistance',
      clubName,
      message: 'Club staff have been alerted. Please wait for someone to assist you.'
    });
  }

  async function seatPlayer(request, response) {
    setPrivateResponseHeaders(response);
    if (!requireJsonBody(request, response, ['tableId', 'mutationId'])) return;
    const tableId = request.body.tableId;
    const clientMutationId = request.body.mutationId;
    if (!validateTableId(tableId) || !validateMutationId(clientMutationId)) {
      response.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'Choose a valid table and request ID.' });
      return;
    }
    let security;
    try {
      security = getSecurity(dependencies);
    } catch {
      response.status(503).json({ ok: false, code: 'SELF_CHECK_IN_NOT_CONFIGURED', error: 'Club self-check-in is unavailable.' });
      return;
    }
    const sessionToken = readBoundedHeader(request, checkInSessionHeader);
    const unboundSession = security.verifyScanSession(sessionToken);
    if (!unboundSession.ok) {
      sendTokenError(response, unboundSession);
      return;
    }
    const readState = dependencies.loadState || loadState;
    const initialRecord = await readState(unboundSession.value.clubId);
    if (!initialRecord?.state) {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'This club is not available.' });
      return;
    }
    const initialSession = security.verifyScanSession(sessionToken, {
      expectedGeneration: initialRecord.state.selfCheckIn?.capabilityGeneration
    });
    if (!initialSession.ok || !initialRecord.state.selfCheckIn?.capabilityGeneration) {
      sendTokenError(response, initialSession.ok ? { code: 'revoked' } : initialSession);
      return;
    }
    const activeLicense = await verifyActiveClubLicense(
      initialRecord.state,
      unboundSession.value.clubId,
      dependencies,
      dependencies.nowMs ? dependencies.nowMs() : Date.now()
    );
    if (!activeLicense.ok) {
      sendLicenseError(response, activeLicense);
      return;
    }
    if (unboundSession.value.issuedAt < activeLicense.updatedAtMs) {
      sendTokenError(response, { code: 'revoked' });
      return;
    }
    const operationKey = stableId('', unboundSession.value.tokenId);
    const playerSessionId = `sci-session-${operationKey}`;
    const timestamp = nowIso();
    const committed = await commitWithRetries(unboundSession.value.clubId, {
      mutationId: `self-check-in-seat:${operationKey}`,
      mutationType: 'self-check-in-player-seated',
      transform: (state) => {
        if (!getActiveStateLicense(state, unboundSession.value.clubId, dependencies.nowMs ? dependencies.nowMs() : Date.now())) {
          return { code: 'PILOT_LICENSE_INACTIVE' };
        }
        const session = security.verifyScanSession(sessionToken, {
          expectedGeneration: state.selfCheckIn?.capabilityGeneration
        });
        if (!session.ok || !state.selfCheckIn?.capabilityGeneration) return { code: 'CHECK_IN_TOKEN_REVOKED' };
        const profile = (state.profiles || []).find((candidate) => candidate.id === session.value.profileId);
        if (!profile) return { code: 'PLAYER_NOT_FOUND' };
        const existingSeat = getActiveSeat(state, profile.id);
        if (existingSeat) return { alreadySeated: { ...existingSeat, playerName: profile.name } };
        if ((state.playerSessions || []).some((candidate) => candidate.id === playerSessionId)) {
          return { code: 'CHECK_IN_SESSION_USED' };
        }
        const seated = seatSelfCheckInPlayer(state, {
          profileId: profile.id,
          tableId,
          timestamp,
          interestId: `sci-interest-${operationKey}`,
          playerSessionId,
          ledgerId: `sci-ledger-${operationKey}`
        });
        if (!seated.ok) return { code: seated.code, error: seated.error };
        return { state: seated.state, seated };
      }
    }, dependencies);
    if (committed.kind === 'missing') {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'This club is not available.' });
      return;
    }
    const transition = committed.transition;
    if (transition.code === 'CHECK_IN_TOKEN_REVOKED') {
      sendTokenError(response, { code: 'revoked' });
      return;
    }
    if (transition.code === 'PILOT_LICENSE_INACTIVE') {
      sendLicenseError(response, { code: 'inactive' });
      return;
    }
    if (transition.alreadySeated) {
      response.json({
        ok: true,
        status: 'already-seated',
        clubName: getClubName(committed.record.state),
        playerName: transition.alreadySeated.playerName,
        tableLabel: transition.alreadySeated.tableLabel,
        seatNumber: transition.alreadySeated.seatNumber
      });
      return;
    }
    if (transition.code === 'TABLE_UNAVAILABLE') {
      response.status(409).json({
        ok: false,
        code: 'TABLE_UNAVAILABLE',
        error: 'That table is no longer available. Choose another table.',
        tables: getAvailableSelfCheckInTables(committed.record.state)
      });
      return;
    }
    if (transition.code) {
      const notFound = transition.code === 'PLAYER_NOT_FOUND';
      response.status(notFound ? 404 : 409).json({
        ok: false,
        code: transition.code,
        error: notFound
          ? 'The player profile is no longer available.'
          : 'This check-in session has already been used. Please scan the club code again.'
      });
      return;
    }
    const seated = transition.seated;
    if (committed.kind === 'saved') {
      logDomainChange('self-check-in-player-seated', {
        tenantRef: protectedIdentifier(unboundSession.value.clubId),
        subjectRef: protectedIdentifier(seated.profileId),
        tableRef: protectedIdentifier(seated.tableId),
        gameId: seated.gameId
      });
      void drain();
    }
    response.status(committed.kind === 'saved' ? 201 : 200).json({
      ok: true,
      status: 'seated',
      clubName: getClubName(committed.transition.state),
      playerName: seated.playerName,
      tableLabel: seated.tableLabel,
      gameName: seated.gameName,
      seatNumber: seated.seatNumber
    });
  }

  return { issueClubKit, lookupPlayer, seatPlayer };
}

function registerSelfCheckInRoutes(app, dependencies = {}) {
  const handlers = createSelfCheckInHandlers(dependencies);
  app.get('/check-in', (_request, response) => {
    setPrivateResponseHeaders(response);
    response.sendFile(path.join(publicDirectory, 'self-check-in.html'));
  });
  app.get('/self-check-in.css', (_request, response) => {
    setPrivateResponseHeaders(response);
    response.sendFile(path.join(publicDirectory, 'self-check-in.css'));
  });
  app.get('/self-check-in.js', (_request, response) => {
    setPrivateResponseHeaders(response);
    response.sendFile(path.join(publicDirectory, 'self-check-in.js'));
  });
  app.post('/management/self-check-in/qr', requireClientAuth, requireSelfCheckInIssuer, asyncRoute(handlers.issueClubKit));
  app.post('/player/check-in/lookup', asyncRoute(handlers.lookupPlayer));
  app.post('/player/check-in/seat', asyncRoute(handlers.seatPlayer));
}

module.exports = {
  checkInSessionHeader,
  checkInTokenHeader,
  commitWithRetries,
  createSelfCheckInHandlers,
  readConfiguredOrigin,
  registerSelfCheckInRoutes,
  requireSelfCheckInIssuer,
  stableId
};
