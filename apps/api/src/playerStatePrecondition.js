const { identityDocumentPath, getPublicIdentityStatus, normalizeRequiredMinimumAge } = require('./identityService');
const { hashAuthorizationCode } = require('./licenseService');
const { getAccountKeyFromState, sanitizeAccountKey } = require('./orbitCore');
const { playerDeletionMarkerPath } = require('./playerDeletionGuard');
const { getActivePlayerVenueStateLicense } = require('./playerVenueEligibility');

const preconditionResponses = Object.freeze({
  PLAYER_ACCOUNT_DELETION_IN_PROGRESS: [
    410,
    'This player account is being deleted and can no longer create or restore data.'
  ],
  AGE_VERIFICATION_REQUIRED: [
    403,
    'Current age verification is required for this venue feature.'
  ],
  PLAYER_VENUE_LICENSE_INACTIVE: [
    410,
    'This Orbit venue is not currently available to Player.'
  ]
});

class PlayerStatePreconditionError extends Error {
  constructor(code, options = {}) {
    super(preconditionResponses[code]?.[1] || 'The Player state mutation precondition failed.');
    this.name = 'PlayerStatePreconditionError';
    this.code = code;
    this.minimumAge = options.minimumAge;
  }
}

function isPlayerStatePreconditionError(error) {
  return error?.name === 'PlayerStatePreconditionError' && Boolean(preconditionResponses[error.code]);
}

function sendPlayerStatePreconditionError(response, error) {
  const [status, message] = preconditionResponses[error?.code] || [409, 'The Player state mutation could not be committed.'];
  response.status(status).json({ ok: false, code: error?.code || 'PLAYER_STATE_PRECONDITION_FAILED', error: message });
}

function createCurrentPlayerStatePrecondition(options = {}) {
  const playerId = String(options.playerId || '').trim();
  if (!playerId || playerId.includes('/')) throw new Error('A valid Firebase player ID is required.');
  const readNowMs = typeof options.nowMs === 'function' ? options.nowMs : Date.now;

  return async function currentPlayerStatePrecondition({ transaction, accountKey, currentState, commitNowMs }) {
    const nowMs = Number.isFinite(commitNowMs) ? commitNowMs : Number(readNowMs());
    if (!Number.isFinite(nowMs)) throw new PlayerStatePreconditionError('PLAYER_VENUE_LICENSE_INACTIVE');

    const deletionMarker = await transaction.getDocument(playerDeletionMarkerPath(playerId));
    if (deletionMarker) throw new PlayerStatePreconditionError('PLAYER_ACCOUNT_DELETION_IN_PROGRESS');

    const normalizedAccountKey = sanitizeAccountKey(accountKey || getAccountKeyFromState(currentState));
    const localLicense = getActivePlayerVenueStateLicense(currentState, normalizedAccountKey, nowMs);
    if (!localLicense) throw new PlayerStatePreconditionError('PLAYER_VENUE_LICENSE_INACTIVE');

    const identityRecord = await transaction.getDocument(identityDocumentPath(playerId));
    const centralLicense = await transaction.getDocument(
      `pilotLicenses/${hashAuthorizationCode(localLicense.authorizationCode)}`
    );
    const centralExpiresAtMs = Date.parse(String(centralLicense?.expiresAt || ''));
    if (
      centralLicense?.status !== 'active'
      || sanitizeAccountKey(centralLicense.accountKey) !== normalizedAccountKey
      || !Number.isFinite(centralExpiresAtMs)
      || centralExpiresAtMs <= nowMs
    ) throw new PlayerStatePreconditionError('PLAYER_VENUE_LICENSE_INACTIVE');

    const minimumAge = normalizeRequiredMinimumAge(currentState?.settings?.clubAccount?.minimumPlayerAge);
    const identity = getPublicIdentityStatus(identityRecord || {}, new Date(nowMs));
    if (
      identity.ageEligible !== true
      || ![18, 21].includes(identity.ageLevel)
      || identity.ageLevel < minimumAge
    ) throw new PlayerStatePreconditionError('AGE_VERIFICATION_REQUIRED', { minimumAge });

    return options.returnSecurityContext === true
      ? { identityRecord, minimumAge, nowMs }
      : undefined;
  };
}

module.exports = {
  PlayerStatePreconditionError,
  createCurrentPlayerStatePrecondition,
  isPlayerStatePreconditionError,
  sendPlayerStatePreconditionError
};
