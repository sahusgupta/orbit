const { sanitizeAccountKey } = require('./orbitCore');

const MAX_REQUEST_ID_LENGTH = 180;
const MAX_PROFILE_TEXT_LENGTH = 240;
const opaqueRequestIdPattern = /^[A-Za-z0-9_-]{16,180}$/;
const membershipRequestIdPattern = /^join_[A-Za-z0-9_-]{16,175}$/;
const waitlistRequestIdPattern = /^wait_[A-Za-z0-9_-]{16,175}$/;
const opaqueEntityIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedEmail(value) {
  return normalizedText(value).toLowerCase();
}

function boundedText(value, maximum = MAX_PROFILE_TEXT_LENGTH) {
  return normalizedText(value).slice(0, maximum);
}

function boundedStringList(value, maximumItems = 50) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item) => typeof item === 'string')
      .map((item) => boundedText(item, 120))
      .filter(Boolean)
  )).slice(0, maximumItems);
}

function trustedPlayerFromClaims(claims, suppliedPlayer = {}) {
  const id = boundedText(claims?.uid, 128);
  const email = claims?.email_verified === true
    ? boundedText(claims?.email, 320).toLowerCase()
    : '';
  const phone = boundedText(claims?.phone_number, 40);
  const name = boundedText(claims?.name, 120) || 'Player';
  return {
    id,
    name,
    email,
    ...(phone ? { phone } : {}),
    preferredGameIds: boundedStringList(suppliedPlayer.preferredGameIds),
    favoriteClubIds: boundedStringList(suppliedPlayer.favoriteClubIds),
    preferredStakes: boundedText(suppliedPlayer.preferredStakes, 80) || undefined,
    typicalAvailability: boundedText(suppliedPlayer.typicalAvailability, 240) || undefined,
    homeLocation: boundedText(suppliedPlayer.homeLocation, 240) || undefined,
    searchRadiusMiles: Number.isFinite(Number(suppliedPlayer.searchRadiusMiles))
      ? Math.min(500, Math.max(1, Number(suppliedPlayer.searchRadiusMiles)))
      : undefined
  };
}

function buildAuthenticatedPlayerRequest(body, claims) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'A valid player request body is required.' };
  }
  const suppliedPlayer = body.player && typeof body.player === 'object' && !Array.isArray(body.player)
    ? body.player
    : {};
  const trustedPlayer = trustedPlayerFromClaims(claims, suppliedPlayer);
  if (!trustedPlayer.id) {
    return { ok: false, status: 401, error: 'Firebase player sign-in is required.' };
  }

  const suppliedPlayerId = boundedText(suppliedPlayer.id, 128);
  if (suppliedPlayerId && suppliedPlayerId !== trustedPlayer.id) {
    return { ok: false, status: 403, error: 'The request player does not match the authenticated player.' };
  }
  const suppliedEmail = normalizedEmail(suppliedPlayer.email);
  if (trustedPlayer.email && suppliedEmail && suppliedEmail !== trustedPlayer.email) {
    return { ok: false, status: 403, error: 'The request email does not match the authenticated player.' };
  }

  const clubId = sanitizeAccountKey(body.clubId || '');
  const requestId = boundedText(body.id, MAX_REQUEST_ID_LENGTH);
  if (!clubId || !opaqueRequestIdPattern.test(requestId)) {
    return { ok: false, status: 400, error: 'A club and request ID are required.' };
  }

  const type = normalizedText(body.type);
  const requestedAt = boundedText(body.requestedAt, 40);
  if (!Number.isFinite(Date.parse(requestedAt))) {
    return { ok: false, status: 400, error: 'A valid request timestamp is required.' };
  }

  if (type === 'membership-request') {
    if (!membershipRequestIdPattern.test(requestId)) {
      return { ok: false, status: 400, error: 'A valid opaque membership request ID is required.' };
    }
    return {
      ok: true,
      value: {
        id: requestId,
        type,
        clubId,
        player: trustedPlayer,
        planId: boundedText(body.planId, 128),
        paymentMethod: 'in-person',
        requestedAt
      }
    };
  }

  if (type === 'waitlist-request') {
    if (!waitlistRequestIdPattern.test(requestId)) {
      return { ok: false, status: 400, error: 'A valid opaque waitlist request ID is required.' };
    }
    const gameId = boundedText(body.gameId, 128);
    const tableId = boundedText(body.tableId, 128);
    if (!opaqueEntityIdPattern.test(gameId) || (tableId && !opaqueEntityIdPattern.test(tableId))) {
      return { ok: false, status: 400, error: 'A valid game and optional table are required.' };
    }
    const action = body.action === 'cancel' ? 'cancel' : 'join';
    const attendance = ['arrived', 'confirmed', 'interested'].includes(body.attendance)
      ? body.attendance
      : undefined;
    if (action === 'join' && !attendance) {
      return { ok: false, status: 400, error: 'A valid attendance intent is required.' };
    }
    if (action === 'join' && attendance === 'interested' && tableId) {
      return { ok: false, status: 400, error: 'An interested request cannot select a table.' };
    }
    if (action === 'join' && attendance !== 'interested' && !tableId) {
      return { ok: false, status: 400, error: 'Arrived and confirmed requests require a table.' };
    }
    return {
      ok: true,
      value: {
        id: requestId,
        type,
        clubId,
        player: trustedPlayer,
        gameId,
        action,
        ...(action === 'join' && attendance ? { attendance } : {}),
        ...(action === 'join' && tableId ? { tableId } : {}),
        ...(action === 'join' && boundedText(body.expectedArrivalTime, 80) ? { expectedArrivalTime: boundedText(body.expectedArrivalTime, 80) } : {}),
        ...(action === 'join' && boundedText(body.availabilityStartTime, 80) ? { availabilityStartTime: boundedText(body.availabilityStartTime, 80) } : {}),
        ...(action === 'join' && boundedText(body.availabilityEndTime, 80) ? { availabilityEndTime: boundedText(body.availabilityEndTime, 80) } : {}),
        requestedAt
      }
    };
  }

  return { ok: false, status: 400, error: 'A supported player request type is required.' };
}

module.exports = {
  buildAuthenticatedPlayerRequest,
  trustedPlayerFromClaims
};
