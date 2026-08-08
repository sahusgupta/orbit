const { loadLatestState, loadState, saveState } = require('../database');
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
const { asyncRoute, optionalFirebasePlayer } = require('../http/auth');
const { logDomainChange } = require('../http/domainEvents');
const { publishStateForResponse } = require('../http/firebasePublication');

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

function registerPlayerRoutes(app) {
  app.get('/player/identity/status', requireFirebasePlayer, asyncRoute(getPlayerIdentityStatus));
  app.post('/player/identity/session', requireFirebasePlayer, asyncRoute(createPlayerIdentitySession));
  app.delete('/player/identity', requireFirebasePlayer, asyncRoute(deletePlayerIdentity));
  app.post('/player/membership-checkout', requireFirebasePlayer, requireVerifiedPlayerAge, asyncRoute(createMembershipCheckout));
  app.get('/player/snapshot', requireFirebasePlayer, asyncRoute(handlePlayerSnapshot));
  app.post('/player/membership-requests', optionalFirebasePlayer, asyncRoute(handlePlayerMembershipRequest));
  app.post('/player/waitlist-requests', optionalFirebasePlayer, asyncRoute(handlePlayerWaitlistRequest));
}

module.exports = { registerPlayerRoutes };
