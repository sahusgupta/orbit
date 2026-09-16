const { isDeepStrictEqual } = require('node:util');
const { getAccountKeyFromState, validateStatePayload } = require('../orbitCore');
const { enforcePlayerPrivacyTombstones } = require('../accountDeletionService');

/** @typedef {{ settings: Record<string, unknown> } & Record<string, unknown>} RestoreState */

/** @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeVenue(value) {
  return normalizeIdentity(value).replace(/&/g, ' and ').replace(/\s+/g, ' ');
}

/**
 * Prepare an explicitly reviewed legacy restore without reading or writing a datastore.
 * Callers must still use the authoritative state's revision and normal save boundary.
 * The returned state contains credentials and private records; only summary is log-safe.
 *
 * @param {{
 *   sourceState: RestoreState,
 *   targetState: RestoreState,
 *   expectedSourceAccountKey: string,
 *   expectedTargetAccountKey: string,
 *   expectedUsername: string,
 *   conflictPreferences?: Record<string, 'source' | 'target'>
 * }} input
 */
function buildLegacyAccountRestore(input) {
  const {
    sourceState,
    targetState,
    expectedSourceAccountKey,
    expectedTargetAccountKey,
    expectedUsername,
    conflictPreferences = {}
  } = input;
  validateStatePayload(sourceState);
  validateStatePayload(targetState);
  if (!expectedSourceAccountKey || !expectedTargetAccountKey
    || expectedSourceAccountKey === expectedTargetAccountKey
    || getAccountKeyFromState(sourceState) !== expectedSourceAccountKey
    || getAccountKeyFromState(targetState) !== expectedTargetAccountKey) {
    throw new Error('Legacy restore account identity does not match the reviewed source and target.');
  }

  // Clone first so the result never shares mutable credential or operational objects.
  const source = structuredClone(sourceState);
  const target = structuredClone(targetState);
  const sourceSettings = source.settings;
  const targetSettings = target.settings;
  const username = normalizeIdentity(expectedUsername);
  if (!username || !isRecord(sourceSettings.accountLogin) || !isRecord(targetSettings.accountLogin)
    || normalizeIdentity(sourceSettings.accountLogin.username) !== username
    || normalizeIdentity(targetSettings.accountLogin.username) !== username) {
    throw new Error('Legacy restore management login does not match the reviewed account.');
  }
  if (!isRecord(sourceSettings.pilotAccess) || !isRecord(targetSettings.pilotAccess)
    || !isRecord(sourceSettings.clubAccount) || !isRecord(targetSettings.clubAccount)) {
    throw new Error('Legacy restore requires complete source and target account identities.');
  }
  const sourceVenue = normalizeVenue(sourceSettings.clubAccount.clubName);
  const targetVenue = normalizeVenue(targetSettings.clubAccount.clubName);
  if (!sourceVenue || sourceVenue !== targetVenue) {
    throw new Error('Legacy restore venue identities do not match.');
  }
  if (!isRecord(conflictPreferences)
    || Object.values(conflictPreferences).some((value) => value !== 'source' && value !== 'target')) {
    throw new Error('Legacy restore conflict preferences must explicitly select source or target.');
  }

  /** @type {Record<string, { source: number, target: number, merged: number, resolvedConflicts: number, restored?: number }>} */
  const collections = {};
  const reviewedCollections = new Set();
  function mergeCollection(key, sourceRecords, targetRecords) {
    if (!Array.isArray(sourceRecords) || !Array.isArray(targetRecords)) {
      throw new Error(`Legacy restore collection shape mismatch: ${key}.`);
    }
    reviewedCollections.add(key);
    const entries = new Map();
    let resolvedConflicts = 0;
    for (const origin of ['source', 'target']) {
      const records = origin === 'source' ? sourceRecords : targetRecords;
      const seen = new Map();
      for (const record of records) {
        let identity;
        const identityField = key === 'settings.collectionProfiles' ? 'gameId' : 'id';
        if (typeof record === 'string') identity = `string:${record}`;
        else if (isRecord(record) && typeof record[identityField] === 'string' && record[identityField].trim()) {
          identity = `${identityField}:${record[identityField]}`;
        }
        else throw new Error(`Legacy restore collection contains a record without a stable identity: ${key}.`);
        if (seen.has(identity) && !isDeepStrictEqual(seen.get(identity), record)) {
          throw new Error(`Legacy restore collection contains conflicting duplicate identities: ${key}.`);
        }
        seen.set(identity, record);
        if (!entries.has(identity)) entries.set(identity, record);
        else if (!isDeepStrictEqual(entries.get(identity), record)) {
          const preference = conflictPreferences[key];
          if (!preference) throw new Error(`Legacy restore requires explicit conflict review: ${key}.`);
          if (preference === origin) entries.set(identity, record);
          resolvedConflicts += 1;
        }
      }
    }
    const merged = [...entries.values()];
    // The renderer prepends usage events. Keep newer target activity ahead of
    // older restored history; retain undated legacy entries in stable order.
    if (key === 'usageEvents') {
      const timestamp = (record) => {
        const parsed = isRecord(record) && typeof record.timestamp === 'string'
          ? Date.parse(record.timestamp) : NaN;
        return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
      };
      merged.sort((left, right) => {
        const leftTime = timestamp(left);
        const rightTime = timestamp(right);
        return leftTime === rightTime ? 0 : (leftTime > rightTime ? -1 : 1);
      });
    }
    collections[key] = { source: sourceRecords.length, target: targetRecords.length, merged: merged.length, resolvedConflicts };
    return merged;
  }

  // Source operational settings restore the club's configuration. Target-only
  // fields and records survive; current access and recovered login always win.
  const settings = { ...targetSettings, ...sourceSettings };
  const protectedSettings = new Set(['accountLogin', 'pilotAccess', 'clubAccount']);
  for (const key of new Set([...Object.keys(sourceSettings), ...Object.keys(targetSettings)])) {
    if (protectedSettings.has(key)) continue;
    if (Array.isArray(sourceSettings[key]) || Array.isArray(targetSettings[key])) {
      settings[key] = mergeCollection(`settings.${key}`, sourceSettings[key] ?? [], targetSettings[key] ?? []);
    }
  }
  settings.accountLogin = targetSettings.accountLogin;
  settings.pilotAccess = targetSettings.pilotAccess;
  settings.clubAccount = { ...sourceSettings.clubAccount, ...targetSettings.clubAccount };

  /** @type {RestoreState} */
  let state = { ...target, ...source, settings };
  const serverManaged = new Set(['selfCheckIn', 'membershipQrTokens', 'playerPrivacyTombstones', 'tournamentInterests']);
  for (const key of new Set([...Object.keys(source), ...Object.keys(target)])) {
    if (key === 'settings' || serverManaged.has(key)) continue;
    if (Array.isArray(source[key]) || Array.isArray(target[key])) {
      state[key] = mergeCollection(key, source[key] ?? [], target[key] ?? []);
    }
  }
  for (const key of Object.keys(conflictPreferences)) {
    if (!reviewedCollections.has(key)) throw new Error('Legacy restore conflict preference names an unknown collection.');
  }
  for (const key of ['selfCheckIn', 'membershipQrTokens', 'tournamentInterests']) {
    if (Object.hasOwn(target, key)) state[key] = target[key];
    else delete state[key];
  }
  const sourceTombstones = source.playerPrivacyTombstones ?? [];
  const targetTombstones = target.playerPrivacyTombstones ?? [];
  if (!Array.isArray(sourceTombstones) || !Array.isArray(targetTombstones)
    || [...sourceTombstones, ...targetTombstones].some((value) => typeof value !== 'string' || !value)) {
    throw new Error('Legacy restore privacy tombstones are malformed.');
  }
  const tombstones = [...new Set([...sourceTombstones, ...targetTombstones])];
  if (tombstones.length || Object.hasOwn(source, 'playerPrivacyTombstones') || Object.hasOwn(target, 'playerPrivacyTombstones')) {
    state.playerPrivacyTombstones = tombstones;
  }
  // The existing privacy boundary fails closed if its required policy is absent.
  state = enforcePlayerPrivacyTombstones(state, { playerPrivacyTombstones: tombstones });
  validateStatePayload(state);
  if (getAccountKeyFromState(state) !== expectedTargetAccountKey) {
    throw new Error('Legacy restore changed the target account identity.');
  }
  for (const [key, counts] of Object.entries(collections)) {
    const records = key.startsWith('settings.') ? state.settings[key.slice(9)] : state[key];
    counts.restored = Array.isArray(records) ? records.length : 0;
  }
  return { state, summary: { collections, privacyTombstones: tombstones.length } };
}

module.exports = { buildLegacyAccountRestore };
