const { sanitizeAccountKey } = require('./orbitCore');

const MAX_REQUEST_ID_LENGTH = 180;
const MAX_PROFILE_TEXT_LENGTH = 240;

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
  const email = boundedText(claims?.email, 320).toLowerCase();
  const phone = boundedText(claims?.phone_number, 40);
  const name = boundedText(claims?.name, 120) || boundedText(email.split('@')[0], 120) || 'Player';
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
  if (suppliedEmail && suppliedEmail !== trustedPlayer.email) {
    return { ok: false, status: 403, error: 'The request email does not match the authenticated player.' };
  }

  const clubId = sanitizeAccountKey(body.clubId || '');
  const requestId = boundedText(body.id, MAX_REQUEST_ID_LENGTH);
  if (!clubId || !requestId) {
    return { ok: false, status: 400, error: 'A club and request ID are required.' };
  }

  return {
    ok: true,
    value: {
      ...body,
      id: requestId,
      clubId,
      player: trustedPlayer
    }
  };
}

module.exports = {
  buildAuthenticatedPlayerRequest,
  trustedPlayerFromClaims
};
