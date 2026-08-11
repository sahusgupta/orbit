const { listStatePage, loadLatestState, loadState, saveState, schedulePublicationDrain } = require('../database');
const {
  applyMembershipRequestToState,
  applyWaitlistRequestToState,
  buildPlayerClubSnapshot,
  sanitizeAccountKey
} = require('../orbitCore');
const {
  createPlayerIdentitySession,
  deletePlayerIdentity,
  getPlayerIdentityStatus,
  requireVerifiedPlayerAge
} = require('../identityService');
const { createMembershipCheckout, requireFirebasePlayer } = require('../paymentService');
const { asyncRoute } = require('../http/auth');
const { logDomainChange } = require('../http/domainEvents');
const { buildAuthenticatedPlayerRequest, trustedPlayerFromClaims } = require('../playerRequestSecurity');
const { completePlayerPhoneVerification, startPlayerPhoneVerification } = require('../playerPhoneAuth');
const { deletePlayerAccount } = require('../accountDeletionService');
const { buildPlayerTournamentDocs } = require('../firebasePublisher');

function buildPlayerTournamentRegistrations(state, clubId, playerId) {
  return (state.tournaments || []).flatMap((tournament) => (tournament.players || [])
    .filter((player) => player.profileId === playerId || player.registrationId === `${tournament.id}:${playerId}`)
    .map((player) => ({
      id: player.registrationId || `${tournament.id}:${playerId}`,
      tournamentId: tournament.id,
      clubId,
      playerId,
      playerName: player.name || '',
      playerEmail: '',
      status: player.status === 'Checked In' || player.status === 'Active'
        ? 'checked-in'
        : player.status === 'Eliminated'
          ? 'eliminated'
          : player.status === 'Finished'
            ? 'finished'
            : 'registered',
      rebuys: Number(player.rebuys || 0),
      addOns: Number(player.addOns || 0),
      registeredAt: player.registeredAt || '',
      updatedAt: state.updatedAt || player.registeredAt || ''
    })));
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

async function handlePlayerDiscovery(request, response) {
  const limit = Math.min(Math.max(Number(request.query.limit || 25), 1), 50);
  const page = await listStatePage({ limit, afterAccountKey: request.query.cursor });
  const player = trustedPlayerFromClaims(request.orbitPlayer);
  const clubs = page.records.map((record) => buildPlayerClubSnapshot(record.state, player));
  const tournaments = page.records.flatMap((record) => buildPlayerTournamentDocs(record.state, record.accountKey, record.savedAt));
  const registrations = page.records.flatMap((record) => buildPlayerTournamentRegistrations(record.state, record.accountKey, player.id));
  response.set('cache-control', 'private, no-store');
  response.json({
    ok: true,
    clubs,
    tournaments,
    registrations,
    page: {
      count: clubs.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
    }
  });
}

async function handlePlayerSnapshot(request, response) {
  const accountKey = sanitizeAccountKey(request.query.accountKey || request.query.venueId || '');
  const record = accountKey ? await loadState(accountKey) : await loadLatestState();
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No Orbit club database is available yet.' });
    return;
  }
  const player = trustedPlayerFromClaims(request.orbitPlayer);
  response.json({
    ok: true,
    accountKey: record.accountKey,
    savedAt: record.savedAt,
    revision: record.revision,
    snapshot: buildPlayerClubSnapshot(record.state, player)
  });
}

async function handlePlayerMembershipRequest(request, response) {
  const authenticatedRequest = buildAuthenticatedPlayerRequest(request.body, request.orbitPlayer);
  if (!authenticatedRequest.ok) {
    response.status(authenticatedRequest.status).json({ ok: false, error: authenticatedRequest.error });
    return;
  }
  const requestPayload = authenticatedRequest.value;
  const record = await loadState(requestPayload.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this membership request.' });
    return;
  }
  const nextState = applyMembershipRequestToState(record.state, requestPayload);
  const result = await saveState(nextState, {
    expectedRevision: record.revision,
    mutationId: `membership:${requestPayload.player.id}:${requestPayload.id}`,
    mutationType: 'player-membership-request'
  });
  logDomainChange('membership-request-sent', {
    accountKey: result.accountKey,
    requestId: requestPayload.id,
    playerId: requestPayload.player.id,
    playerName: requestPayload.player.name || 'Player',
    planId: requestPayload.planId || '',
    planName: requestPayload.planName || requestPayload.plan || ''
  });
  void schedulePublicationDrain();
  response.status(result.duplicate ? 200 : 201).json(buildPlayerMutationResponse(result, {
    snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
  }));
}

async function handlePlayerWaitlistRequest(request, response) {
  const authenticatedRequest = buildAuthenticatedPlayerRequest(request.body, request.orbitPlayer);
  if (!authenticatedRequest.ok) {
    response.status(authenticatedRequest.status).json({ ok: false, error: authenticatedRequest.error });
    return;
  }
  const requestPayload = authenticatedRequest.value;
  if (!requestPayload.gameId) {
    response.status(400).json({ ok: false, error: 'A game is required.' });
    return;
  }
  const record = await loadState(requestPayload.clubId);
  if (!record?.state) {
    response.status(404).json({ ok: false, error: 'No matching club database was found for this waitlist request.' });
    return;
  }
  const nextState = applyWaitlistRequestToState(record.state, requestPayload);
  const result = await saveState(nextState, {
    expectedRevision: record.revision,
    mutationId: `waitlist:${requestPayload.player.id}:${requestPayload.id}`,
    mutationType: 'player-waitlist-request'
  });
  logDomainChange(requestPayload.action === 'cancel' ? 'game-request-cancelled' : 'game-request-sent', {
    accountKey: result.accountKey,
    requestId: requestPayload.id,
    playerId: requestPayload.player.id,
    playerName: requestPayload.player.name || 'Player',
    gameId: requestPayload.gameId
  });
  void schedulePublicationDrain();
  response.status(result.duplicate ? 200 : 201).json(buildPlayerMutationResponse(result, {
    snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
  }));
}

async function handleTournamentRegistration(request, response) {
  const clubId = sanitizeAccountKey(request.body?.clubId || '');
  const tournamentId = String(request.body?.tournamentId || '').trim().slice(0, 180);
  const clientMutationId = String(request.body?.mutationId || '').trim().slice(0, 180);
  if (!clubId || !tournamentId || !clientMutationId) {
    response.status(400).json({ ok: false, error: 'A club, tournament, and mutation ID are required.' });
    return;
  }
  const record = await loadState(clubId);
  const tournament = (record?.state?.tournaments || []).find((item) => item.id === tournamentId);
  if (!record?.state || !tournament) {
    response.status(404).json({ ok: false, error: 'Tournament not found.' });
    return;
  }
  const closesAt = Date.parse(tournament.registrationClosesAt || tournament.scheduledAt || tournament.startedAt || '');
  if (tournament.status !== 'Draft' || (Number.isFinite(closesAt) && Date.now() >= closesAt)) {
    response.status(409).json({ ok: false, error: 'Registration for this tournament is closed.' });
    return;
  }
  const player = trustedPlayerFromClaims(request.orbitPlayer);
  const registrationId = `${tournamentId}:${player.id}`;
  const registeredAt = new Date().toISOString();
  const existing = (tournament.players || []).find((item) => item.registrationId === registrationId || item.profileId === player.id);
  const registration = {
    id: registrationId,
    tournamentId,
    clubId,
    playerId: player.id,
    playerName: player.name,
    playerEmail: player.email,
    status: 'registered',
    rebuys: Number(existing?.rebuys || 0),
    addOns: Number(existing?.addOns || 0),
    registeredAt: existing?.registeredAt || registeredAt,
    updatedAt: registeredAt
  };
  const nextPlayer = {
    ...(existing || {}),
    id: existing?.id || registrationId,
    registrationId,
    profileId: player.id,
    name: player.name,
    email: player.email,
    buyIn: Number(tournament.buyIn || 0),
    rebuys: registration.rebuys,
    addOns: registration.addOns,
    startingStack: Number(tournament.startingStack || 0),
    status: existing?.status || 'Registered',
    registeredAt: registration.registeredAt
  };
  const nextState = {
    ...record.state,
    tournaments: record.state.tournaments.map((item) => item.id === tournamentId
      ? { ...item, players: [...(item.players || []).filter((entry) => entry !== existing), nextPlayer] }
      : item)
  };
  const result = await saveState(nextState, {
    expectedRevision: record.revision,
    mutationId: `tournament-register:${player.id}:${clientMutationId}`,
    mutationType: 'player-tournament-register'
  });
  void schedulePublicationDrain();
  response.status(result.duplicate ? 200 : 201).json(buildPlayerMutationResponse(result, { registration }));
}

async function handleTournamentUnregistration(request, response) {
  const clubId = sanitizeAccountKey(request.body?.clubId || '');
  const tournamentId = String(request.body?.tournamentId || '').trim().slice(0, 180);
  const clientMutationId = String(request.body?.mutationId || '').trim().slice(0, 180);
  if (!clubId || !tournamentId || !clientMutationId) {
    response.status(400).json({ ok: false, error: 'A club, tournament, and mutation ID are required.' });
    return;
  }
  const record = await loadState(clubId);
  const tournament = (record?.state?.tournaments || []).find((item) => item.id === tournamentId);
  if (!record?.state || !tournament) {
    response.status(404).json({ ok: false, error: 'Tournament not found.' });
    return;
  }
  const startsAt = Date.parse(tournament.scheduledAt || tournament.startedAt || '');
  if (tournament.status !== 'Draft' || (Number.isFinite(startsAt) && Date.now() >= startsAt)) {
    response.status(409).json({ ok: false, error: 'Self-unregistration is no longer available. Contact tournament staff.' });
    return;
  }
  const playerId = request.orbitPlayer.uid;
  const registrationId = `${tournamentId}:${playerId}`;
  const nextState = {
    ...record.state,
    tournaments: record.state.tournaments.map((item) => item.id === tournamentId
      ? {
          ...item,
          players: (item.players || []).filter((entry) => entry.registrationId !== registrationId && entry.profileId !== playerId)
        }
      : item)
  };
  const result = await saveState(nextState, {
    expectedRevision: record.revision,
    mutationId: `tournament-unregister:${playerId}:${clientMutationId}`,
    mutationType: 'player-tournament-unregister'
  });
  void schedulePublicationDrain();
  response.json(buildPlayerMutationResponse(result, { registrationId }));
}

function registerPlayerRoutes(app) {
  app.post('/player/auth/phone/start', asyncRoute(startPlayerPhoneVerification));
  app.post('/player/auth/phone/complete', asyncRoute(completePlayerPhoneVerification));
  app.get('/player/identity/status', requireFirebasePlayer, asyncRoute(getPlayerIdentityStatus));
  app.post('/player/identity/session', requireFirebasePlayer, asyncRoute(createPlayerIdentitySession));
  app.delete('/player/identity', requireFirebasePlayer, asyncRoute(deletePlayerIdentity));
  app.delete('/player/account', requireFirebasePlayer, asyncRoute(deletePlayerAccount));
  app.post('/player/membership-checkout', requireFirebasePlayer, requireVerifiedPlayerAge, asyncRoute(createMembershipCheckout));
  app.get('/player/snapshot', requireFirebasePlayer, asyncRoute(handlePlayerSnapshot));
  app.get('/player/discovery', requireFirebasePlayer, asyncRoute(handlePlayerDiscovery));
  app.post('/player/membership-requests', requireFirebasePlayer, requireVerifiedPlayerAge, asyncRoute(handlePlayerMembershipRequest));
  app.post('/player/waitlist-requests', requireFirebasePlayer, requireVerifiedPlayerAge, asyncRoute(handlePlayerWaitlistRequest));
  app.post('/player/tournament-registrations', requireFirebasePlayer, requireVerifiedPlayerAge, asyncRoute(handleTournamentRegistration));
  app.delete('/player/tournament-registrations', requireFirebasePlayer, requireVerifiedPlayerAge, asyncRoute(handleTournamentUnregistration));
}

module.exports = { buildPlayerMutationResponse, registerPlayerRoutes };
