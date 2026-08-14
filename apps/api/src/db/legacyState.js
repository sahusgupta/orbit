const { getAccountKeyFromState, sanitizeAccountKey, validateStatePayload } = require('../orbitCore');
const { firestoreDocumentId, getDatabase } = require('./connection');

function legacyStatePath(accountKey) {
  return `clubStates/${firestoreDocumentId(accountKey)}`;
}

function normalizeSavedAt(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return '';
}

function mapLegacyStateDocument(accountKey, document) {
  const normalizedAccountKey = sanitizeAccountKey(accountKey);
  if (!normalizedAccountKey) return null;
  if (!document?.state) return null;

  try {
    validateStatePayload(document.state);
  } catch {
    return null;
  }
  if (getAccountKeyFromState(document.state) !== normalizedAccountKey) return null;

  return {
    accountKey: normalizedAccountKey,
    venueName: document.state.settings?.clubAccount?.clubName || normalizedAccountKey,
    savedAt: normalizeSavedAt(document.savedAt || document.updatedAt),
    state: document.state,
    source: 'legacy-firebase'
  };
}

async function loadLegacyState(accountKey) {
  const normalizedAccountKey = sanitizeAccountKey(accountKey);
  if (!normalizedAccountKey) return null;
  const database = await getDatabase();
  return mapLegacyStateDocument(
    normalizedAccountKey,
    await database.getDocument(legacyStatePath(normalizedAccountKey))
  );
}

async function listLegacyStates(accountKeys) {
  const normalizedAccountKeys = [...new Set((accountKeys || []).map(sanitizeAccountKey).filter(Boolean))].slice(0, 250);
  const records = await Promise.all(normalizedAccountKeys.map((accountKey) => loadLegacyState(accountKey)));
  return records.filter(Boolean);
}

module.exports = {
  listLegacyStates,
  loadLegacyState,
  mapLegacyStateDocument
};
