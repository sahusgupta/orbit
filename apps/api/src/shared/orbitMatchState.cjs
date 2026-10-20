// Platform-neutral Match state boundary. This module also runs in Expo.
/** @typedef {import('../../../../player-app/src/domain/orbitMatchTypes').MatchState} MatchState */
/** @typedef {import('../../../../player-app/src/domain/orbitMatchTypes').MatchPreferences} MatchPreferences */
/** @typedef {import('../../../../player-app/src/domain/orbitMatchTypes').MatchReference} MatchReference */
/** @typedef {import('../../../../player-app/src/domain/orbitMatchTypes').MatchDecision} MatchDecision */
/** @typedef {import('../../../../player-app/src/domain/orbitMatchTypes').MatchEvent} MatchEvent */
/** @typedef {import('../../../../player-app/src/domain/orbitMatchTypes').MatchOperation} MatchOperation */

const matchEventRetentionMs = 30 * 24 * 60 * 60 * 1000;
const maxMatchEvents = 200;
const maxRecentMatchPasses = 300;
const maxRecentMatchMutationIds = 500;
const entityPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const mutationPattern = /^[A-Za-z0-9_-]{16,180}$/;
const variants = ['nlh', 'plo', 'limit-holdem', 'mixed'];
const eventKinds = ['opened', 'impression', 'passed', 'saved', 'undo', 'details', 'saved-revisit', 'waitlist-success', 'empty', 'load-failed'];
const preferenceKeys = ['variants', 'stakes', 'format', 'buyIn', 'maxDistanceMiles', 'favoriteClubIds', 'excludedClubIds', 'requireSeatsNow', 'willingToWait', 'maxWaitlist', 'preferredDays', 'preferredTime', 'exploreNewVenues', 'strictVariants', 'strictStakes', 'strictBuyIn'];

class MatchStateError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'MatchStateError';
    this.code = code;
    this.status = status;
  }
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value) : null;
}
function exactKeys(value, required, optional = []) {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function validText(value, maximum = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}
function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}
function boundedNumber(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function revision(value) { return Number.isSafeInteger(value) && value >= 0; }
function mutationId(value) { return typeof value === 'string' && mutationPattern.test(value); }
function uniqueList(value, maximum, valid) {
  return Array.isArray(value) && value.length <= maximum && new Set(value).size === value.length && value.every(valid);
}

/** @param {unknown} value @returns {MatchReference | null} */
function decodeReference(value) {
  const data = record(value);
  if (!data || !exactKeys(data, ['clubId', 'gameId', 'kind'])
    || typeof data.clubId !== 'string' || !entityPattern.test(data.clubId)
    || typeof data.gameId !== 'string' || !entityPattern.test(data.gameId)
    || (data.kind !== 'cash' && data.kind !== 'tournament')) return null;
  return { clubId: data.clubId, gameId: data.gameId, kind: data.kind };
}
/** @param {MatchReference} ref */
function matchReferenceKey(ref) { return JSON.stringify([ref.clubId, ref.kind, ref.gameId]); }

/** @param {unknown} value @returns {MatchPreferences | null} */
function decodePreferences(value) {
  const data = record(value);
  if (!data || !exactKeys(data, preferenceKeys)
    || !uniqueList(data.variants, 4, (item) => variants.includes(item))
    || !uniqueList(data.favoriteClubIds, 100, (item) => typeof item === 'string' && entityPattern.test(item))
    || !uniqueList(data.excludedClubIds, 100, (item) => typeof item === 'string' && entityPattern.test(item))
    || !uniqueList(data.preferredDays, 7, (item) => Number.isInteger(item) && item >= 0 && item <= 6)
    || !['any', 'cash', 'tournament'].includes(String(data.format))
    || !['any', 'day', 'evening'].includes(String(data.preferredTime))
    || !['requireSeatsNow', 'willingToWait', 'exploreNewVenues', 'strictVariants', 'strictStakes', 'strictBuyIn'].every((key) => typeof data[key] === 'boolean')
    || !(data.maxDistanceMiles === null || boundedNumber(data.maxDistanceMiles, 1, 500))
    || !(data.maxWaitlist === null || Number.isInteger(data.maxWaitlist) && boundedNumber(data.maxWaitlist, 0, 10_000))) return null;
  for (const [key, lower, upper] of [['stakes', 'minBigBlind', 'maxBigBlind'], ['buyIn', 'min', 'max']]) {
    if (data[key] === null) continue;
    const range = record(data[key]);
    if (!range || !exactKeys(range, [lower, upper])
      || !boundedNumber(range[lower], 0, 100_000) || !boundedNumber(range[upper], 0, 100_000)
      || Number(range[lower]) > Number(range[upper])) return null;
  }
  // The assertion follows the complete runtime shape/range validation above.
  const valid = /** @type {MatchPreferences} */ (data);
  return { ...valid, variants: [...valid.variants], favoriteClubIds: [...valid.favoriteClubIds], excludedClubIds: [...valid.excludedClubIds],
    preferredDays: [...valid.preferredDays], stakes: valid.stakes && { ...valid.stakes }, buyIn: valid.buyIn && { ...valid.buyIn } };
}

/** @param {unknown} value @returns {MatchDecision['summary'] | null} */
function decodeSummary(value) {
  const data = record(value);
  if (!data || !exactKeys(data, ['venueName', 'gameName']) || !validText(data.venueName) || !validText(data.gameName)) return null;
  return { venueName: String(data.venueName), gameName: String(data.gameName) };
}
/** @param {unknown} value @returns {MatchDecision | null} */
function decodeDecision(value) {
  const data = record(value);
  if (!data || !exactKeys(data, ['ref', 'summary', 'decision', 'mutationId', 'decidedAt'])
    || (data.decision !== 'saved' && data.decision !== 'passed') || !mutationId(data.mutationId) || !validTimestamp(data.decidedAt)) return null;
  const ref = decodeReference(data.ref);
  const summary = decodeSummary(data.summary);
  return ref && summary ? { ref, summary, decision: data.decision, mutationId: String(data.mutationId), decidedAt: String(data.decidedAt) } : null;
}

/** @param {unknown} value @param {boolean} persisted @returns {Omit<MatchEvent, 'at' | 'eventId'> | null} */
function decodeEventPayload(value, persisted = false) {
  const data = record(value);
  if (!data || !exactKeys(data, persisted ? ['eventId', 'kind', 'at'] : ['kind'], ['ref', 'saveMutationId'])
    || !eventKinds.includes(String(data.kind))) return null;
  const ref = data.ref === undefined ? undefined : decodeReference(data.ref);
  if (data.ref !== undefined && !ref || data.saveMutationId !== undefined && !mutationId(data.saveMutationId)) return null;
  if (['impression', 'passed', 'saved', 'undo', 'details', 'saved-revisit', 'waitlist-success'].includes(String(data.kind)) && !ref) return null;
  if (data.kind === 'waitlist-success' && !data.saveMutationId) return null;
  return {
    kind: /** @type {MatchEvent['kind']} */ (data.kind),
    ...(ref ? { ref } : {}),
    ...(data.saveMutationId ? { saveMutationId: String(data.saveMutationId) } : {})
  };
}

/** @param {unknown} value @returns {MatchState | null} */
function decodeMatchState(value) {
  const data = record(value);
  if (!data || data.schemaVersion !== 1 || !revision(data.revision) || !revision(data.preferencesRevision)
    || Number(data.preferencesRevision) > Number(data.revision) || !Array.isArray(data.decisions) || !Array.isArray(data.events)
    || data.events.length > maxMatchEvents || !uniqueList(data.recentMutationIds, maxRecentMatchMutationIds, mutationId)) return null;
  const preferences = decodePreferences(data.preferences);
  if (!preferences) return null;
  const decisions = [];
  const seen = new Set();
  let passedCount = 0;
  for (const item of data.decisions) {
    const decision = decodeDecision(item);
    if (!decision || seen.has(matchReferenceKey(decision.ref))) return null;
    if (decision.decision === 'passed' && ++passedCount > maxRecentMatchPasses) return null;
    seen.add(matchReferenceKey(decision.ref));
    decisions.push(decision);
  }
  const events = [];
  const eventIds = new Set();
  for (const item of data.events) {
    const event = record(item);
    const payload = decodeEventPayload(item, true);
    if (!event || !payload || !mutationId(event.eventId) || !validTimestamp(event.at) || eventIds.has(event.eventId)) return null;
    eventIds.add(event.eventId);
    events.push({ ...payload, eventId: String(event.eventId), at: String(event.at) });
  }
  let undo = null;
  if (data.undo !== null) {
    const entry = record(data.undo);
    if (!entry || !exactKeys(entry, ['mutationId', 'ref', 'previous']) || !mutationId(entry.mutationId)) return null;
    const ref = decodeReference(entry.ref);
    const previous = entry.previous === null ? null : decodeDecision(entry.previous);
    if (!ref || entry.previous !== null && !previous || previous && matchReferenceKey(previous.ref) !== matchReferenceKey(ref)) return null;
    undo = { mutationId: String(entry.mutationId), ref, previous };
  }
  // Internal receipt/storage fields never enter the public Player state.
  return { schemaVersion: 1, revision: Number(data.revision), preferencesRevision: Number(data.preferencesRevision), preferences, decisions, undo, events,
    recentMutationIds: [.../** @type {string[]} */ (data.recentMutationIds)] };
}

/** @param {MatchPreferences} [preferences] @returns {MatchState} */
function createMatchState(preferences) {
  const defaults = { variants: [], stakes: null, format: 'any', buyIn: null, maxDistanceMiles: null,
    favoriteClubIds: [], excludedClubIds: [], requireSeatsNow: false, willingToWait: true, maxWaitlist: null,
    preferredDays: [], preferredTime: 'any', exploreNewVenues: false, strictVariants: false, strictStakes: false, strictBuyIn: false };
  const decoded = decodePreferences(preferences || defaults);
  if (!decoded) throw new MatchStateError('MATCH_INVALID_PREFERENCES', 'Match preferences are invalid.', 400);
  return { schemaVersion: 1, revision: 0, preferencesRevision: 0, preferences: decoded, decisions: [], undo: null, events: [], recentMutationIds: [] };
}

/** @param {unknown} value @returns {MatchOperation | null} */
function decodeMatchOperation(value) {
  const data = record(value);
  if (!data || !mutationId(data.mutationId)) return null;
  const id = String(data.mutationId);
  if (data.type === 'decide' && exactKeys(data, ['mutationId', 'type', 'ref', 'summary', 'decision'])) {
    const ref = decodeReference(data.ref);
    const summary = decodeSummary(data.summary);
    return ref && summary && (data.decision === 'saved' || data.decision === 'passed') ? { mutationId: id, type: 'decide', ref, summary, decision: data.decision } : null;
  }
  if (data.type === 'remove' && exactKeys(data, ['mutationId', 'type', 'ref', 'expectedDecisionMutationId']) && mutationId(data.expectedDecisionMutationId)) {
    const ref = decodeReference(data.ref);
    return ref ? { mutationId: id, type: 'remove', ref, expectedDecisionMutationId: String(data.expectedDecisionMutationId) } : null;
  }
  if (data.type === 'undo' && exactKeys(data, ['mutationId', 'type', 'targetMutationId']) && mutationId(data.targetMutationId)) {
    return { mutationId: id, type: 'undo', targetMutationId: String(data.targetMutationId) };
  }
  if (data.type === 'preferences' && exactKeys(data, ['mutationId', 'type', 'basePreferencesRevision', 'preferences']) && revision(data.basePreferencesRevision)) {
    const preferences = decodePreferences(data.preferences);
    return preferences ? { mutationId: id, type: 'preferences', basePreferencesRevision: Number(data.basePreferencesRevision), preferences } : null;
  }
  if (data.type === 'event' && exactKeys(data, ['mutationId', 'type', 'event'])) {
    const event = decodeEventPayload(data.event);
    return event ? { mutationId: id, type: 'event', event } : null;
  }
  return null;
}

/** @param {MatchState} state @param {number} nowMs @returns {MatchState} */
function pruneMatchState(state, nowMs) {
  const saved = state.decisions.filter((item) => item.decision === 'saved');
  const passed = state.decisions.filter((item) => item.decision === 'passed' && Date.parse(item.decidedAt) >= nowMs - matchEventRetentionMs)
    .sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt) || a.mutationId.localeCompare(b.mutationId)).slice(0, maxRecentMatchPasses);
  const decisions = [...saved, ...passed];
  const undo = state.undo && decisions.some((item) => item.mutationId === state.undo.mutationId && matchReferenceKey(item.ref) === matchReferenceKey(state.undo.ref)) ? state.undo : null;
  return { ...state, decisions, undo, events: state.events.filter((event) => Date.parse(event.at) >= nowMs - matchEventRetentionMs).slice(-maxMatchEvents) };
}

/** @param {MatchState} source @param {MatchOperation} input @param {number} [nowMs] @returns {MatchState} */
function applyMatchOperation(source, input, nowMs = Date.now()) {
  const state = decodeMatchState(source);
  const operation = decodeMatchOperation(input);
  if (!state || !operation || !Number.isFinite(nowMs)) throw new MatchStateError('MATCH_INVALID_STATE', 'Match state or operation is invalid.', 400);
  if (state.recentMutationIds.includes(operation.mutationId)) return state;
  if (!Number.isSafeInteger(state.revision + 1)) throw new MatchStateError('MATCH_REVISION_EXHAUSTED', 'Match state needs maintenance.', 503);
  const at = new Date(nowMs).toISOString();
  let next = pruneMatchState(state, nowMs);
  /** @type {Omit<MatchEvent, 'at' | 'eventId'> | null} */
  let event = null;
  if (operation.type === 'decide') {
    const key = matchReferenceKey(operation.ref);
    const previous = next.decisions.find((item) => matchReferenceKey(item.ref) === key) || null;
    next = { ...next, decisions: [...next.decisions.filter((item) => matchReferenceKey(item.ref) !== key),
      { ref: operation.ref, summary: operation.summary, decision: operation.decision, mutationId: operation.mutationId, decidedAt: at }],
      undo: { mutationId: operation.mutationId, ref: operation.ref, previous } };
    event = { kind: operation.decision, ref: operation.ref };
  } else if (operation.type === 'remove') {
    const current = next.decisions.find((item) => matchReferenceKey(item.ref) === matchReferenceKey(operation.ref));
    if (!current || current.mutationId !== operation.expectedDecisionMutationId) throw new MatchStateError('MATCH_DECISION_CONFLICT', 'This saved game changed on another device. Refresh before removing it.');
    next = { ...next, decisions: next.decisions.filter((item) => item !== current), undo: next.undo?.mutationId === current.mutationId ? null : next.undo };
  } else if (operation.type === 'undo') {
    const undo = next.undo;
    const current = undo && next.decisions.find((item) => matchReferenceKey(item.ref) === matchReferenceKey(undo.ref));
    if (!undo || undo.mutationId !== operation.targetMutationId || current?.mutationId !== operation.targetMutationId) throw new MatchStateError('MATCH_UNDO_CONFLICT', 'That swipe changed on another device and cannot be undone.');
    next = { ...next, decisions: [...next.decisions.filter((item) => item !== current), ...(undo.previous ? [undo.previous] : [])], undo: null };
    event = { kind: 'undo', ref: undo.ref };
  } else if (operation.type === 'preferences') {
    if (operation.basePreferencesRevision !== next.preferencesRevision) throw new MatchStateError('MATCH_PREFERENCES_CONFLICT', 'Match preferences changed on another device. Refresh before saving them.');
    next = { ...next, preferences: operation.preferences, preferencesRevision: next.preferencesRevision + 1 };
  } else {
    event = operation.event;
    if (event.kind === 'waitlist-success' && !next.decisions.some((item) => item.decision === 'saved' && item.mutationId === event.saveMutationId && event.ref && matchReferenceKey(item.ref) === matchReferenceKey(event.ref))) {
      throw new MatchStateError('MATCH_ATTRIBUTION_CONFLICT', 'The saved recommendation for this request is no longer current.');
    }
  }
  if (event) next = { ...next, events: [...next.events, { ...event, eventId: operation.mutationId, at }] };
  return pruneMatchState({ ...next, revision: state.revision + 1,
    recentMutationIds: [...state.recentMutationIds, operation.mutationId].slice(-maxRecentMatchMutationIds) }, nowMs);
}

module.exports = { MatchStateError, applyMatchOperation, createMatchState, decodeMatchOperation, decodeMatchState, matchEventRetentionMs, matchReferenceKey, maxMatchEvents, maxRecentMatchPasses, maxRecentMatchMutationIds, pruneMatchState };
