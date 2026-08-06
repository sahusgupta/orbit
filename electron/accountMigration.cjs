function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVenueIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getStateVenueIdentities(state) {
  if (!isRecord(state) || !isRecord(state.settings)) return [];
  return [
    state.settings.pilotAccess?.issuedTo,
    state.settings.clubAccount?.clubName
  ]
    .map(normalizeVenueIdentity)
    .filter(Boolean);
}

function findReplacementAccountRecord(records, access, targetAccountKey) {
  const venueIdentity = normalizeVenueIdentity(access?.issuedTo);
  if (!venueIdentity || !targetAccountKey || !Array.isArray(records)) return null;

  return records
    .filter((record) =>
      record?.accountKey &&
      record.accountKey !== targetAccountKey &&
      getStateVenueIdentities(record.state).includes(venueIdentity)
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.savedAt || '') || 0;
      const rightTime = Date.parse(right.savedAt || '') || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function migrateStateToPilotAccess(state, access) {
  if (!isRecord(state) || !isRecord(state.settings)) {
    throw new Error('A saved Orbit account state is required for pilot key migration.');
  }
  if (!isRecord(access) || !String(access.authorizationCode || '').trim()) {
    throw new Error('A valid replacement pilot access record is required.');
  }

  return {
    ...state,
    settings: {
      ...state.settings,
      pilotAccess: { ...access }
    }
  };
}

module.exports = {
  findReplacementAccountRecord,
  migrateStateToPilotAccess,
  normalizeVenueIdentity
};
