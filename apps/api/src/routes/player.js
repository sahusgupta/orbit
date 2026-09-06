const crypto = require('crypto');
const {
  listStatePage,
  loadGlobalMutationReceipt,
  loadLatestState,
  loadStateMutationReceipt,
  loadState,
  saveState,
  schedulePublicationDrain
} = require('../database');
const {
  applyMembershipRequestToState,
  applyWaitlistRequestToState,
  buildPlayerClubSnapshot,
  getAccountKeyFromState,
  sanitizeAccountKey
} = require('../orbitCore');
const {
  capturePlayerIdentity,
  createPlayerIdentitySession,
  getPlayerIdentityStatus,
  requireVerifiedPlayerAge
} = require('../identityService');
const { createMembershipCheckout, requireFirebasePlayer } = require('../paymentService');
const { asyncRoute } = require('../http/auth');
const { protectedIdentifier } = require('../http/dataProtection');
const { logDomainChange } = require('../http/domainEvents');
const { buildAuthenticatedPlayerRequest, trustedPlayerFromClaims } = require('../playerRequestSecurity');
const { completePlayerPhoneVerification, startPlayerPhoneVerification } = require('../playerPhoneAuth');
const { deletePlayerAccount } = require('../accountDeletionService');
const { requirePlayerAppCheck } = require('../appCheckService');
const { requireActivePlayerAccount } = require('../playerDeletionGuard');
const {
  createCurrentPlayerStatePrecondition,
  isPlayerStatePreconditionError,
  sendPlayerStatePreconditionError
} = require('../playerStatePrecondition');
const {
  inspectPlayerVenueRecord,
  inspectPlayerVenueRecords,
  sendPlayerVenueEligibilityError
} = require('../playerVenueEligibility');
const { buildPlayerTournamentDocs } = require('../firebasePublisher');
const {
  applyTournamentInterestTransition,
  buildPlayerTournamentInterests,
  createTournamentInterestId,
  parseTournamentInterestRequest
} = require('../tournamentInterestService');

const maximumTournamentInterestCommitAttempts = 4;

class PlayerOperationCommitError extends Error {
  constructor(boundary) {
    super(boundary?.error || 'The Player operation was no longer valid when it reached the authoritative state.');
    this.name = 'PlayerOperationCommitError';
    this.code = boundary?.code || 'PLAYER_OPERATION_PRECONDITION_FAILED';
    this.status = Number(boundary?.status || 409);
  }
}

function readPlayerCommitTime(readNowMs) {
  const nowMs = Number(readNowMs());
  const now = new Date(nowMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(now.getTime())) {
    throw new PlayerOperationCommitError({
      status: 503,
      code: 'PLAYER_TIME_UNAVAILABLE',
      error: 'The request time could not be verified.'
    });
  }
  return { nowMs, timestamp: now.toISOString() };
}

function createPlayerOperationTransactionPrecondition(basePrecondition, readNowMs, evaluate) {
  return async function playerOperationTransactionPrecondition(context) {
    const commitTime = readPlayerCommitTime(readNowMs);
    const security = await basePrecondition({ ...context, commitNowMs: commitTime.nowMs });
    return evaluate({ ...context, ...commitTime, security });
  };
}

function sendPlayerOperationCommitError(response, error) {
  response.status(error.status || 409).json({ ok: false, code: error.code, error: error.message });
}

function opaqueStateMutationId(kind, ...parts) {
  const digest = crypto.createHash('sha256').update(parts.map((part) => String(part)).join('\u0000')).digest('hex');
  return `${kind}:${digest}`;
}

function playerRequestFingerprint(parts) {
  return parts.map((part) => String(part ?? '')).join('\u0000');
}

function receiptMatchesFingerprint(receipt, fingerprint) {
  return receipt?.fingerprintRef === crypto.createHash('sha256').update(fingerprint).digest('hex');
}

function sendPlayerRequestReceiptError(response, code) {
  const reused = code === 'MUTATION_ID_REUSED';
  response.status(409).json({
    ok: false,
    code,
    error: reused
      ? 'That request ID was already used for a different operation.'
      : 'That legacy request was already committed, but cannot be replayed safely. Retry with a new request ID.'
  });
}

function sendCommittedPlayerSnapshot(response, record, player) {
  response.json(buildPlayerMutationResponse({
    accountKey: record.accountKey,
    savedAt: record.savedAt,
    revision: record.revision
  }, {
    snapshot: buildAuthenticatedPlayerClubSnapshot(record.state, player)
  }));
}

function buildPlayerMutationResponse(result, extra = {}) {
  return {
    ok: true,
    accountKey: result.accountKey,
    savedAt: result.savedAt,
    revision: result.revision,
    ...extra
  };
}

function applyAuthoritativeMembershipPlan(state, requestPayload) {
  const plans = (state.settings?.membershipPlans || []).filter((plan) => plan.active === true);
  const requestedPlanId = String(requestPayload.planId || '').trim();
  if (!requestedPlanId) return { ok: false, error: 'A current membership plan ID is required.' };
  const plan = plans.find((candidate) => String(candidate.id || '') === requestedPlanId);
  if (!plan) return { ok: false, error: 'The selected membership plan is not available at this club.' };
  const durationDays = plan.durationDays;
  const planName = String(plan.name || '').trim();
  const priceLabel = String(plan.priceLabel || '').trim();
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3660 || !planName || !priceLabel) {
    return { ok: false, error: 'The selected membership plan is not publishable.' };
  }
  const priceMatch = priceLabel.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const free = /\bfree\b/i.test(priceLabel) || Boolean(priceMatch && Number(priceMatch[0]) === 0);
  const {
    plan: _clientPlan,
    planId: _clientPlanId,
    planName: _clientPlanName,
    priceLabel: _clientPriceLabel,
    planPriceLabel: _clientPlanPriceLabel,
    membershipDurationDays: _clientDuration,
    membershipPaymentRequired: _clientPaymentRequirement,
    ...trustedRequest
  } = requestPayload;
  const legacyPlan = plan.plan === 'day' || plan.plan === 'monthly' ? plan.plan : undefined;
  return {
    ok: true,
    value: {
      ...trustedRequest,
      ...(legacyPlan ? { plan: legacyPlan } : {}),
      planId: String(plan.id || ''),
      planName,
      priceLabel,
      planPriceLabel: priceLabel,
      membershipDurationDays: durationDays,
      membershipPaymentRequired: !free
    }
  };
}

function isPublicClubName(value) {
  const name = String(value || '').trim();
  const normalized = name.toLowerCase();
  return Boolean(name) && normalized !== 'test club' && !normalized.includes('stress');
}

function isPublicGameName(value) {
  const name = String(value || '').trim();
  return Boolean(name) && !name.toLowerCase().includes('stress');
}

function buildPublicClubSnapshot(state) {
  const snapshot = buildPlayerClubSnapshot(state, { id: '', name: '' });
  const { timeAccess: _privateTimeAccess, ...publicSnapshot } = snapshot;
  return {
    ...publicSnapshot,
    club: {
      ...snapshot.club,
      phone: snapshot.club.phone || undefined
    },
    games: snapshot.games
      .filter((game) => isPublicGameName(game.name))
      .map((game) => ({
        ...game,
        knownPlayersCount: 0,
        openTables: game.openTables.map((table) => ({
          ...table,
          social: { ...table.social, knownPlayersCount: 0 }
        }))
      })),
    memberships: [],
    waitlists: [],
    notifications: [],
    social: { ...snapshot.social, knownPlayersInHouse: 0 }
  };
}

async function listPublicStatePage(options = {}, dependencies = {}) {
  const listPage = dependencies.listStatePage || listStatePage;
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 50);
  const visibleRecords = [];
  const seenCursors = new Set();
  let afterAccountKey = String(options.afterAccountKey || '');
  let hasMoreRecords = true;

  while (visibleRecords.length <= limit && hasMoreRecords) {
    const page = await listPage({ limit: 50, afterAccountKey });
    const namedRecords = (page.records || []).filter((record) =>
      isPublicClubName(record.state?.settings?.clubAccount?.clubName)
    );
    const eligibility = await inspectPlayerVenueRecords(namedRecords, dependencies);
    if (!eligibility.ok) {
      throw Object.assign(new Error('Player venue licensing could not be verified.'), {
        code: 'PLAYER_VENUE_LICENSE_UNAVAILABLE'
      });
    }
    visibleRecords.push(...eligibility.eligibleRecords);
    hasMoreRecords = Boolean(page.hasMore);
    if (!hasMoreRecords || visibleRecords.length > limit) break;
    const nextCursor = String(page.nextCursor || '');
    if (!nextCursor || nextCursor === afterAccountKey || seenCursors.has(nextCursor)) {
      throw new Error('Public club discovery returned an invalid account cursor.');
    }
    seenCursors.add(nextCursor);
    afterAccountKey = nextCursor;
  }

  const hasMore = visibleRecords.length > limit;
  const records = visibleRecords.slice(0, limit);
  return {
    records,
    hasMore,
    nextCursor: hasMore ? records.at(-1)?.accountKey || null : null
  };
}

async function handlePublicPlayerDiscovery(request, response, dependencies = {}) {
  const limit = Math.min(Math.max(Number(request.query.limit || 25), 1), 50);
  let page;
  try {
    page = await listPublicStatePage({ limit, afterAccountKey: request.query.cursor }, dependencies);
  } catch (error) {
    if (error?.code !== 'PLAYER_VENUE_LICENSE_UNAVAILABLE') throw error;
    sendPlayerVenueEligibilityError(response, { code: 'unavailable' });
    return;
  }
  const clubs = page.records.map((record) => buildPublicClubSnapshot(record.state));
  const tournaments = page.records.flatMap((record) => buildPlayerTournamentDocs(record.state, record.accountKey, record.savedAt));
  response.set('cache-control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
  response.json({
    ok: true,
    clubs,
    tournaments,
    interests: [],
    page: {
      count: clubs.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
    }
  });
}

async function handlePublicPlayerClub(request, response, dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const clubId = sanitizeAccountKey(request.params.clubId || '');
  const record = clubId ? await readState(clubId) : null;
  const clubName = record?.state?.settings?.clubAccount?.clubName;
  if (!record?.state || !isPublicClubName(clubName)) {
    response.status(404).json({ ok: false, error: 'Club not found.' });
    return;
  }
  const eligibility = await inspectPlayerVenueRecord(record, dependencies);
  if (!eligibility.ok) {
    sendPlayerVenueEligibilityError(response, eligibility, { publicNotFound: eligibility.code !== 'unavailable' });
    return;
  }
  response.set('cache-control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
  response.json({
    ok: true,
    club: buildPublicClubSnapshot(record.state),
    tournaments: buildPlayerTournamentDocs(record.state, record.accountKey, record.savedAt)
  });
}

function buildAuthenticatedPlayerClubSnapshot(state, player) {
  const snapshot = buildPlayerClubSnapshot(state, player);
  return {
    ...snapshot,
    games: snapshot.games.filter((game) => isPublicGameName(game.name))
  };
}

async function handlePlayerDiscovery(request, response, dependencies = {}) {
  const limit = Math.min(Math.max(Number(request.query.limit || 25), 1), 50);
  let page;
  try {
    page = await listPublicStatePage({ limit, afterAccountKey: request.query.cursor }, dependencies);
  } catch (error) {
    if (error?.code !== 'PLAYER_VENUE_LICENSE_UNAVAILABLE') throw error;
    sendPlayerVenueEligibilityError(response, { code: 'unavailable' });
    return;
  }
  const player = trustedPlayerFromClaims(request.orbitPlayer);
  const clubs = page.records.map((record) => buildAuthenticatedPlayerClubSnapshot(record.state, player));
  const tournaments = page.records.flatMap((record) => buildPlayerTournamentDocs(record.state, record.accountKey, record.savedAt));
  const interests = page.records.flatMap((record) => buildPlayerTournamentInterests(record.state, record.accountKey, player.id));
  response.set('cache-control', 'private, no-store');
  response.json({
    ok: true,
    clubs,
    tournaments,
    interests,
    page: {
      count: clubs.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
    }
  });
}

async function handlePlayerSnapshot(request, response, dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const readLatestState = dependencies.loadLatestState || loadLatestState;
  const accountKey = sanitizeAccountKey(request.query.accountKey || request.query.venueId || '');
  const record = accountKey ? await readState(accountKey) : await readLatestState();
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No Orbit club database is available yet.' });
    return;
  }
  const eligibility = await inspectPlayerVenueRecord(record, dependencies);
  if (!eligibility.ok) {
    sendPlayerVenueEligibilityError(response, eligibility);
    return;
  }
  const player = trustedPlayerFromClaims(request.orbitPlayer);
  response.json({
    ok: true,
    accountKey: record.accountKey,
    savedAt: record.savedAt,
    revision: record.revision,
    snapshot: buildAuthenticatedPlayerClubSnapshot(record.state, player)
  });
}

async function handlePlayerMembershipRequest(request, response, dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const readGlobalReceipt = dependencies.loadGlobalMutationReceipt || loadGlobalMutationReceipt;
  const readStateReceipt = dependencies.loadStateMutationReceipt || loadStateMutationReceipt;
  const writeState = dependencies.saveState || saveState;
  const drain = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const buildPlayerStatePrecondition = dependencies.createCurrentPlayerStatePrecondition
    || createCurrentPlayerStatePrecondition;
  const acceptedAtMs = Number((dependencies.nowMs || Date.now)());
  const acceptedAtDate = new Date(acceptedAtMs);
  if (!Number.isFinite(acceptedAtMs) || !Number.isFinite(acceptedAtDate.getTime())) {
    response.status(503).json({ ok: false, code: 'PLAYER_TIME_UNAVAILABLE', error: 'The request time could not be verified.' });
    return;
  }
  const acceptedAt = acceptedAtDate.toISOString();
  const authenticatedRequest = buildAuthenticatedPlayerRequest(request.body, request.orbitPlayer);
  if (!authenticatedRequest.ok) {
    response.status(authenticatedRequest.status).json({ ok: false, error: authenticatedRequest.error });
    return;
  }
  if (authenticatedRequest.value.type !== 'membership-request' || !('planId' in authenticatedRequest.value)) {
    response.status(400).json({ ok: false, error: 'A membership request body is required.' });
    return;
  }
  const requestPayload = {
    ...authenticatedRequest.value,
    requestedAt: acceptedAt,
    identitySummary: request.orbitIdentitySummary,
    player: {
      ...authenticatedRequest.value.player,
      ...(request.orbitIdentitySummary?.fullName ? { name: request.orbitIdentitySummary.fullName } : {})
    }
  };
  const record = await readState(requestPayload.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this membership request.' });
    return;
  }
  const eligibility = await inspectPlayerVenueRecord(record, { ...dependencies, nowMs: () => acceptedAtMs });
  if (!eligibility.ok) {
    sendPlayerVenueEligibilityError(response, eligibility);
    return;
  }
  const mutationScope = opaqueStateMutationId('membership', requestPayload.clubId, requestPayload.player.id, requestPayload.id);
  const fingerprint = playerRequestFingerprint([
    requestPayload.type,
    requestPayload.clubId,
    requestPayload.player.id,
    requestPayload.planId,
    requestPayload.paymentMethod
  ]);
  const existingGlobalReceipt = await readGlobalReceipt(mutationScope);
  if (existingGlobalReceipt) {
    if (!receiptMatchesFingerprint(existingGlobalReceipt, fingerprint)) {
      sendPlayerRequestReceiptError(response, 'MUTATION_ID_REUSED');
      return;
    }
    sendCommittedPlayerSnapshot(response, record, requestPayload.player);
    return;
  }
  if (await readStateReceipt(requestPayload.clubId, mutationScope)) {
    sendPlayerRequestReceiptError(response, 'IDEMPOTENCY_RECEIPT_STALE');
    return;
  }
  const authoritativePlan = applyAuthoritativeMembershipPlan(record.state, requestPayload);
  if (!authoritativePlan.ok) {
    response.status(400).json({ ok: false, error: authoritativePlan.error });
    return;
  }
  const nextState = applyMembershipRequestToState(record.state, authoritativePlan.value);
  let result;
  try {
    result = await writeState(nextState, {
      expectedRevision: record.revision,
      mutationId: mutationScope,
      mutationType: 'player-membership-request',
      globalMutationScope: mutationScope,
      globalMutationFingerprint: fingerprint,
      globalMutationResult: { operation: 'membership-request' },
      transactionPrecondition: buildPlayerStatePrecondition({
        playerId: requestPayload.player.id,
        nowMs: dependencies.preconditionNowMs || Date.now
      })
    });
  } catch (error) {
    if (isPlayerStatePreconditionError(error)) {
      sendPlayerStatePreconditionError(response, error);
      return;
    }
    if (error?.code !== 'IDEMPOTENCY_CONFLICT') throw error;
    sendPlayerRequestReceiptError(response, 'MUTATION_ID_REUSED');
    return;
  }
  if (result.duplicate) {
    const current = await readState(requestPayload.clubId);
    if (!current?.state) {
      sendPlayerRequestReceiptError(response, 'IDEMPOTENCY_RECEIPT_STALE');
      return;
    }
    sendCommittedPlayerSnapshot(response, current, requestPayload.player);
    return;
  }
  logDomainChange('membership-request-sent', {
    accountKey: result.accountKey,
    requestRef: protectedIdentifier(requestPayload.id),
    playerId: requestPayload.player.id,
    playerName: requestPayload.player.name || 'Player',
    planId: authoritativePlan.value.planId || '',
    planName: authoritativePlan.value.planName || authoritativePlan.value.plan || ''
  });
  void drain();
  response.status(201).json(buildPlayerMutationResponse(result, {
    snapshot: buildAuthenticatedPlayerClubSnapshot(nextState, requestPayload.player)
  }));
}

function validateAuthoritativeWaitlistTarget(state, requestPayload) {
  const authoritativeGame = (state.games || []).find((game) => String(game.id || '') === requestPayload.gameId);
  if (!authoritativeGame) {
    return { ok: false, status: 404, code: 'GAME_NOT_FOUND', error: 'The requested game is not published by this club.' };
  }
  if (requestPayload.action === 'cancel') return { ok: true };
  if (!['arrived', 'confirmed', 'interested'].includes(requestPayload.attendance)) {
    return { ok: false, status: 400, code: 'ATTENDANCE_REQUIRED', error: 'Choose whether you are here, coming, or interested.' };
  }
  if (requestPayload.attendance === 'interested') {
    return requestPayload.tableId
      ? { ok: false, status: 409, code: 'TABLE_NOT_ALLOWED_FOR_INTEREST', error: 'An interested request cannot reserve a specific table.' }
      : { ok: true };
  }
  if (!requestPayload.tableId) {
    return {
      ok: false,
      status: 409,
      code: 'TABLE_REQUIRED_FOR_ATTENDANCE',
      error: 'A running table is required when marking yourself here or confirmed.'
    };
  }
  const table = (state.sessions || []).find((session) => String(session.id || '') === requestPayload.tableId);
  if (
    !table ||
    String(table.gameId || '') !== requestPayload.gameId ||
    table.status !== 'Running'
  ) {
    return {
      ok: false,
      status: 409,
      code: 'TABLE_NOT_AVAILABLE_FOR_GAME',
      error: 'The selected table is not available for that game.'
    };
  }
  return { ok: true };
}

function validatePlayerWaitlistAuthorization(state, requestPayload, options = {}) {
  if (sanitizeAccountKey(getAccountKeyFromState(state)) !== sanitizeAccountKey(requestPayload.clubId)) {
    return { ok: false, status: 404, code: 'CLUB_NOT_FOUND', error: 'The selected Orbit club is unavailable.' };
  }
  const playerId = String(requestPayload.player?.id || '').trim();
  const linkedProfiles = (state.profiles || []).filter((profile) =>
    String(profile.id || '') === playerId || String(profile.orbitPlayerId || '') === playerId
  );
  if (linkedProfiles.length > 1) {
    return { ok: false, status: 409, code: 'PLAYER_LINK_AMBIGUOUS', error: 'Staff must resolve this player link before requests can be changed.' };
  }
  const profile = linkedProfiles[0];
  const linkedIds = new Set([playerId, profile?.id, profile?.orbitPlayerId].map((value) => String(value || '')).filter(Boolean));
  if (requestPayload.action === 'cancel') {
    const existing = (state.interests || []).some((interest) =>
      interest.gameId === requestPayload.gameId
      && ['Interested', 'Confirmed Coming', 'Arrived'].includes(interest.status)
      && linkedIds.has(String(interest.profileId || ''))
    );
    return existing
      ? { ok: true, profile }
      : { ok: false, status: 404, code: 'WAITLIST_REQUEST_NOT_FOUND', error: 'No active request was found for this player and game.' };
  }
  const expiresAt = profile?.membershipExpiresAt ?? profile?.membershipExpirationDate;
  const expiresAtMs = Date.parse(String(expiresAt || ''));
  const nowMs = Number((options.nowMs || Date.now)());
  if (
    !profile
    || profile.membershipStatus !== 'Active'
    || !Number.isFinite(expiresAtMs)
    || !Number.isFinite(nowMs)
    || expiresAtMs <= nowMs
  ) {
    return {
      ok: false,
      status: 403,
      code: 'ACTIVE_MEMBERSHIP_REQUIRED',
      error: 'An active, unexpired membership is required to join this game list.'
    };
  }
  return { ok: true, profile };
}

async function handlePlayerWaitlistRequest(request, response, dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const readGlobalReceipt = dependencies.loadGlobalMutationReceipt || loadGlobalMutationReceipt;
  const readStateReceipt = dependencies.loadStateMutationReceipt || loadStateMutationReceipt;
  const writeState = dependencies.saveState || saveState;
  const drain = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const buildPlayerStatePrecondition = dependencies.createCurrentPlayerStatePrecondition
    || createCurrentPlayerStatePrecondition;
  const preconditionNowMs = dependencies.preconditionNowMs || Date.now;
  const nowMs = dependencies.nowMs || Date.now;
  const acceptedAtMs = Number(nowMs());
  const acceptedAtDate = new Date(acceptedAtMs);
  if (!Number.isFinite(acceptedAtMs) || !Number.isFinite(acceptedAtDate.getTime())) {
    response.status(503).json({ ok: false, code: 'PLAYER_TIME_UNAVAILABLE', error: 'The request time could not be verified.' });
    return;
  }
  const acceptedAt = acceptedAtDate.toISOString();
  const authenticatedRequest = buildAuthenticatedPlayerRequest(request.body, request.orbitPlayer);
  if (!authenticatedRequest.ok) {
    response.status(authenticatedRequest.status).json({ ok: false, error: authenticatedRequest.error });
    return;
  }
  if (authenticatedRequest.value.type !== 'waitlist-request' || !('gameId' in authenticatedRequest.value)) {
    response.status(400).json({ ok: false, error: 'A waitlist request body is required.' });
    return;
  }
  const requestPayload = {
    ...authenticatedRequest.value,
    requestedAt: acceptedAt,
    identitySummary: request.orbitIdentitySummary,
    player: {
      ...authenticatedRequest.value.player,
      ...(request.orbitIdentitySummary?.fullName ? { name: request.orbitIdentitySummary.fullName } : {})
    }
  };
  if (!requestPayload.gameId) {
    response.status(400).json({ ok: false, error: 'A game is required.' });
    return;
  }
  const record = await readState(requestPayload.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this waitlist request.' });
    return;
  }
  const eligibility = await inspectPlayerVenueRecord(record, { ...dependencies, nowMs: () => acceptedAtMs });
  if (!eligibility.ok) {
    sendPlayerVenueEligibilityError(response, eligibility);
    return;
  }
  const mutationScope = opaqueStateMutationId('waitlist', requestPayload.clubId, requestPayload.player.id, requestPayload.id);
  const fingerprint = playerRequestFingerprint([
    requestPayload.type,
    requestPayload.clubId,
    requestPayload.player.id,
    requestPayload.action,
    requestPayload.gameId,
    requestPayload.attendance,
    requestPayload.tableId,
    requestPayload.expectedArrivalTime,
    requestPayload.availabilityStartTime,
    requestPayload.availabilityEndTime
  ]);
  const existingGlobalReceipt = await readGlobalReceipt(mutationScope);
  if (existingGlobalReceipt) {
    if (!receiptMatchesFingerprint(existingGlobalReceipt, fingerprint)) {
      sendPlayerRequestReceiptError(response, 'MUTATION_ID_REUSED');
      return;
    }
    sendCommittedPlayerSnapshot(response, record, requestPayload.player);
    return;
  }
  if (await readStateReceipt(requestPayload.clubId, mutationScope)) {
    sendPlayerRequestReceiptError(response, 'IDEMPOTENCY_RECEIPT_STALE');
    return;
  }
  const target = validateAuthoritativeWaitlistTarget(record.state, requestPayload);
  if (!target.ok) {
    response.status(target.status).json({ ok: false, code: target.code, error: target.error });
    return;
  }
  const authorization = validatePlayerWaitlistAuthorization(record.state, requestPayload, { nowMs: () => acceptedAtMs });
  if (!authorization.ok) {
    response.status(authorization.status).json({ ok: false, code: authorization.code, error: authorization.error });
    return;
  }
  const nextState = applyWaitlistRequestToState(record.state, requestPayload);
  let result;
  try {
    const securityPrecondition = buildPlayerStatePrecondition({
      playerId: requestPayload.player.id,
      nowMs: preconditionNowMs
    });
    result = await writeState(nextState, {
      expectedRevision: record.revision,
      mutationId: mutationScope,
      mutationType: 'player-waitlist-request',
      globalMutationScope: mutationScope,
      globalMutationFingerprint: fingerprint,
      globalMutationResult: { operation: requestPayload.action === 'cancel' ? 'waitlist-cancel' : 'waitlist-join' },
      transactionPrecondition: createPlayerOperationTransactionPrecondition(
        securityPrecondition,
        preconditionNowMs,
        ({ currentState, nowMs: commitNowMs, timestamp }) => {
          const committedRequest = { ...requestPayload, requestedAt: timestamp };
          const committedTarget = validateAuthoritativeWaitlistTarget(currentState, committedRequest);
          if (!committedTarget.ok) throw new PlayerOperationCommitError(committedTarget);
          const committedAuthorization = validatePlayerWaitlistAuthorization(currentState, committedRequest, {
            nowMs: () => commitNowMs
          });
          if (!committedAuthorization.ok) throw new PlayerOperationCommitError(committedAuthorization);
          const committedState = applyWaitlistRequestToState(currentState, committedRequest);
          return {
            nextState: committedState,
            result: { requestPayload: committedRequest, committedState }
          };
        }
      )
    });
  } catch (error) {
    if (error?.name === 'PlayerOperationCommitError') {
      sendPlayerOperationCommitError(response, error);
      return;
    }
    if (isPlayerStatePreconditionError(error)) {
      sendPlayerStatePreconditionError(response, error);
      return;
    }
    if (error?.code !== 'IDEMPOTENCY_CONFLICT') throw error;
    sendPlayerRequestReceiptError(response, 'MUTATION_ID_REUSED');
    return;
  }
  if (result.duplicate) {
    const current = await readState(requestPayload.clubId);
    if (!current?.state) {
      sendPlayerRequestReceiptError(response, 'IDEMPOTENCY_RECEIPT_STALE');
      return;
    }
    sendCommittedPlayerSnapshot(response, current, requestPayload.player);
    return;
  }
  const committedRequest = result.transactionResult?.requestPayload || requestPayload;
  const committedState = result.transactionResult?.committedState || nextState;
  logDomainChange(committedRequest.action === 'cancel' ? 'game-request-cancelled' : 'game-request-sent', {
    accountKey: result.accountKey,
    requestRef: protectedIdentifier(committedRequest.id),
    playerId: committedRequest.player.id,
    playerName: committedRequest.player.name || 'Player',
    gameId: committedRequest.gameId
  });
  void drain();
  response.status(201).json(buildPlayerMutationResponse(result, {
    snapshot: buildAuthenticatedPlayerClubSnapshot(committedState, committedRequest.player)
  }));
}

function sendTournamentInterestError(response, code) {
  const errors = {
    TOURNAMENT_NOT_FOUND: [404, 'Tournament not found.'],
    TOURNAMENT_INTEREST_NOT_FOUND: [404, 'No tournament interest was found for this player.'],
    TOURNAMENT_INTEREST_NOT_OPEN: [409, 'Tournament interest is not open yet.'],
    TOURNAMENT_INTEREST_CLOSED: [409, 'Tournament interest is closed.'],
    TOURNAMENT_INTEREST_WITHDRAWAL_CLOSED: [409, 'Tournament interest can no longer be withdrawn in the app.'],
    MUTATION_ID_REUSED: [409, 'That request ID was already used for a different tournament-interest operation.'],
    IDEMPOTENCY_RECEIPT_STALE: [409, 'That request was already committed, but its result is unavailable. Retry with a new request ID.']
  };
  const [status, error] = errors[code] || [400, 'Tournament interest could not be updated.'];
  response.status(status).json({ ok: false, code, error });
}

function createTournamentInterestHandler(dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const readReceipt = dependencies.loadGlobalMutationReceipt || loadGlobalMutationReceipt;
  const writeState = dependencies.saveState || saveState;
  const drain = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const nowMs = dependencies.nowMs || Date.now;
  const randomUUID = dependencies.randomUUID || crypto.randomUUID;
  const buildPlayerStatePrecondition = dependencies.createCurrentPlayerStatePrecondition
    || createCurrentPlayerStatePrecondition;
  const preconditionNowMs = dependencies.preconditionNowMs || Date.now;
  return async function handleTournamentInterest(request, response, action) {
    const parsed = parseTournamentInterestRequest(request.body);
    if (!parsed.ok) {
      response.status(400).json({ ok: false, code: parsed.code, error: parsed.error });
      return;
    }
    const playerId = String(request.orbitPlayer.uid || '');
    let initialTime;
    try {
      initialTime = readPlayerCommitTime(nowMs);
    } catch (error) {
      sendPlayerOperationCommitError(response, error);
      return;
    }
    const timestampMs = initialTime.nowMs;
    const timestamp = initialTime.timestamp;
    const interestId = createTournamentInterestId(randomUUID);
    const receiptId = opaqueStateMutationId('tournament-interest', playerId, parsed.value.mutationId);
    const receiptFingerprint = [action, parsed.value.clubId, parsed.value.tournamentId].join('\u0000');
    const fingerprintRef = crypto.createHash('sha256').update(receiptFingerprint).digest('hex');
    const buildReceiptInterest = (result) => result?.interestId && result?.status && result?.createdAt && result?.updatedAt
      ? {
          id: result.interestId,
          tournamentId: parsed.value.tournamentId,
          clubId: parsed.value.clubId,
          playerId,
          status: result.status,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          ...(result.withdrawnAt ? { withdrawnAt: result.withdrawnAt } : {})
        }
      : null;
    const initialRecord = await readState(parsed.value.clubId);
    if (!initialRecord?.state) {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'The selected Orbit club is unavailable.' });
      return;
    }
    const venueEligibility = await inspectPlayerVenueRecord(initialRecord, dependencies);
    if (!venueEligibility.ok) {
      sendPlayerVenueEligibilityError(response, venueEligibility);
      return;
    }
    const existingReceipt = await readReceipt(receiptId);
    if (existingReceipt) {
      if (existingReceipt.fingerprintRef !== fingerprintRef) {
        sendTournamentInterestError(response, 'MUTATION_ID_REUSED');
        return;
      }
      const interest = buildReceiptInterest(existingReceipt.result);
      if (!interest) {
        sendTournamentInterestError(response, 'IDEMPOTENCY_RECEIPT_STALE');
        return;
      }
      response.json({
        ok: true,
        accountKey: existingReceipt.accountKey,
        savedAt: existingReceipt.createdAt,
        revision: Number(existingReceipt.revision),
        interest
      });
      return;
    }
    let lastConflict;
    for (let attempt = 0; attempt < maximumTournamentInterestCommitAttempts; attempt += 1) {
      const record = attempt === 0 ? initialRecord : await readState(parsed.value.clubId);
      if (!record?.state) {
        response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'The selected Orbit club is unavailable.' });
        return;
      }
      const transition = applyTournamentInterestTransition(record.state, {
        action,
        clubId: parsed.value.clubId,
        tournamentId: parsed.value.tournamentId,
        playerId
      }, { interestId, now: timestamp, nowMs: timestampMs });
      if (!transition.ok) {
        sendTournamentInterestError(response, transition.code);
        return;
      }
      const receiptResult = {
        interestId: transition.interest.id,
        status: transition.interest.status,
        createdAt: transition.interest.createdAt,
        updatedAt: transition.interest.updatedAt,
        ...(transition.interest.withdrawnAt ? { withdrawnAt: transition.interest.withdrawnAt } : {})
      };
      try {
        const securityPrecondition = buildPlayerStatePrecondition({ playerId, nowMs: preconditionNowMs });
        const result = await writeState(transition.state, {
          expectedRevision: record.revision,
          mutationId: receiptId,
          mutationType: action === 'express' ? 'player-tournament-interest-expressed' : 'player-tournament-interest-withdrawn',
          globalMutationScope: receiptId,
          globalMutationFingerprint: receiptFingerprint,
          globalMutationResult: receiptResult,
          transactionPrecondition: createPlayerOperationTransactionPrecondition(
            securityPrecondition,
            preconditionNowMs,
            ({ currentState, nowMs: commitNowMs, timestamp: commitTimestamp }) => {
              const committedTransition = applyTournamentInterestTransition(currentState, {
                action,
                clubId: parsed.value.clubId,
                tournamentId: parsed.value.tournamentId,
                playerId
              }, { interestId, now: commitTimestamp, nowMs: commitNowMs });
              if (!committedTransition.ok) {
                throw new PlayerOperationCommitError({ code: committedTransition.code });
              }
              const committedReceipt = {
                interestId: committedTransition.interest.id,
                status: committedTransition.interest.status,
                createdAt: committedTransition.interest.createdAt,
                updatedAt: committedTransition.interest.updatedAt,
                ...(committedTransition.interest.withdrawnAt
                  ? { withdrawnAt: committedTransition.interest.withdrawnAt }
                  : {})
              };
              return {
                nextState: committedTransition.state,
                result: { transition: committedTransition, globalMutationResult: committedReceipt }
              };
            }
          )
        });
        if (result.duplicate) {
          const interest = buildReceiptInterest(result.idempotencyResult || receiptResult);
          if (!interest) {
            sendTournamentInterestError(response, 'IDEMPOTENCY_RECEIPT_STALE');
            return;
          }
          response.json(buildPlayerMutationResponse(result, { interest }));
          return;
        }
        const committedTransition = result.transactionResult?.transition || transition;
        void drain();
        response.status(action === 'express' && committedTransition.changed ? 201 : 200).json(buildPlayerMutationResponse(result, {
          interest: committedTransition.interest
        }));
        return;
      } catch (error) {
        if (error?.name === 'PlayerOperationCommitError') {
          sendTournamentInterestError(response, error.code);
          return;
        }
        if (isPlayerStatePreconditionError(error)) {
          sendPlayerStatePreconditionError(response, error);
          return;
        }
        if (error?.code === 'IDEMPOTENCY_CONFLICT') {
          sendTournamentInterestError(response, 'MUTATION_ID_REUSED');
          return;
        }
        if (error?.code !== 'STATE_REVISION_CONFLICT') throw error;
        lastConflict = error;
      }
    }
    throw lastConflict || new Error('Tournament interest could not commit after bounded retries.');
  };
}

const handleTournamentInterest = createTournamentInterestHandler();

function rejectLegacyTournamentRegistration(_request, response) {
  response.status(410).json({
    ok: false,
    code: 'PLAYER_TOURNAMENT_REGISTRATION_DISABLED',
    error: 'Orbit Player does not create tournament registrations. Express nonbinding interest instead.'
  });
}

function requirePlayerMembershipCheckoutEnabled(_request, response, next) {
  if (process.env.ORBIT_ENABLE_PLAYER_MEMBERSHIP_CHECKOUT === 'true') {
    next();
    return;
  }
  response.status(410).json({
    ok: false,
    code: 'PLAYER_MEMBERSHIP_CHECKOUT_DISABLED',
    error: 'Orbit Player membership checkout is not available in this release.'
  });
}

function registerPlayerRoutes(app) {
  app.post('/player/auth/phone/start', requirePlayerAppCheck, asyncRoute(startPlayerPhoneVerification));
  app.post('/player/auth/phone/complete', requirePlayerAppCheck, asyncRoute(completePlayerPhoneVerification));
  app.get('/player/public/discovery', asyncRoute(handlePublicPlayerDiscovery));
  app.get('/player/public/clubs/:clubId', asyncRoute(handlePublicPlayerClub));
  app.get('/player/identity/status', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, asyncRoute(getPlayerIdentityStatus));
  app.post('/player/identity/capture', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, asyncRoute(capturePlayerIdentity));
  app.post('/player/identity/session', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, asyncRoute(createPlayerIdentitySession));
  app.delete('/player/account', requirePlayerAppCheck, requireFirebasePlayer, asyncRoute(deletePlayerAccount));
  app.post('/player/membership-checkout', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, requirePlayerMembershipCheckoutEnabled, requireVerifiedPlayerAge, asyncRoute(createMembershipCheckout));
  app.get('/player/snapshot', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, asyncRoute(handlePlayerSnapshot));
  app.get('/player/discovery', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, asyncRoute(handlePlayerDiscovery));
  app.post('/player/membership-requests', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, requireVerifiedPlayerAge, asyncRoute(handlePlayerMembershipRequest));
  app.post('/player/waitlist-requests', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, requireVerifiedPlayerAge, asyncRoute(handlePlayerWaitlistRequest));
  app.post('/player/tournament-interests', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, requireVerifiedPlayerAge, asyncRoute((request, response) => handleTournamentInterest(request, response, 'express')));
  app.delete('/player/tournament-interests', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, requireVerifiedPlayerAge, asyncRoute((request, response) => handleTournamentInterest(request, response, 'withdraw')));
  app.post('/player/tournament-registrations', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, rejectLegacyTournamentRegistration);
  app.delete('/player/tournament-registrations', requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount, rejectLegacyTournamentRegistration);
}

module.exports = {
  applyAuthoritativeMembershipPlan,
  buildAuthenticatedPlayerClubSnapshot,
  buildPlayerMutationResponse,
  buildPublicClubSnapshot,
  createTournamentInterestHandler,
  handleTournamentInterest,
  handlePlayerDiscovery,
  handlePlayerMembershipRequest,
  handlePlayerSnapshot,
  handlePlayerWaitlistRequest,
  handlePublicPlayerClub,
  handlePublicPlayerDiscovery,
  listPublicStatePage,
  opaqueStateMutationId,
  requirePlayerMembershipCheckoutEnabled,
  registerPlayerRoutes,
  rejectLegacyTournamentRegistration,
  validateAuthoritativeWaitlistTarget,
  validatePlayerWaitlistAuthorization
};
