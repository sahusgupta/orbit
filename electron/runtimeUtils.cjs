/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function getRecordProperty(value, key) {
  return isRecord(value) ? value[key] : undefined;
}

function orbitApiErrorDetails(error) {
  const cause = error instanceof Error ? error.cause : undefined;
  return {
    errorName: error instanceof Error ? error.name : 'Error',
    errorMessage: error instanceof Error ? error.message : String(error || 'Request failed'),
    errorCode: getRecordProperty(error, 'code') || getRecordProperty(cause, 'code') || '',
    cause: cause instanceof Error ? cause.message : cause ? String(cause) : ''
  };
}

function validateStatePayload(state) {
  if (!isRecord(state)) throw new Error('State payload must be an object.');
  if (!Array.isArray(state.games)) throw new Error('State payload is missing games.');
  if (!Array.isArray(state.sessions)) throw new Error('State payload is missing sessions.');
  if (!Array.isArray(state.playerSessions)) throw new Error('State payload is missing player sessions.');
  if (!isRecord(state.settings)) throw new Error('State payload is missing settings.');
}

function normalizeTextMessageBatch(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages
    .map((message) => ({
      to: String(message?.to || '').trim(),
      body: String(message?.body || '').trim(),
      profileId: message?.profileId ? String(message.profileId) : '',
      playerName: message?.playerName ? String(message.playerName) : '',
      gameId: message?.gameId ? String(message.gameId) : '',
      reason: message?.reason ? String(message.reason) : ''
    }))
    .filter((message) => message.to && message.body)
    .slice(0, 200);
}

function sanitizeAccountKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function getAccountKeyFromAccess(access) {
  if (!isRecord(access)) return '';
  return sanitizeAccountKey(access.licenseId || access.authorizationCode || access.issuedTo);
}

function getAccountKeyFromState(state) {
  const pilotKey = getAccountKeyFromAccess(state?.settings?.pilotAccess);
  if (pilotKey) return pilotKey;
  const club = state?.settings?.clubAccount;
  return sanitizeAccountKey(club?.email || club?.clubName || 'unlicensed-local') || 'unlicensed-local';
}

module.exports = {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  getRecordProperty,
  isRecord,
  normalizeTextMessageBatch,
  orbitApiErrorDetails,
  sanitizeAccountKey,
  validateStatePayload
};
