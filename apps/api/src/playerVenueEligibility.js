const { inspectPilotLicenses } = require('./licenseService');
const { getAccountKeyFromState, sanitizeAccountKey } = require('./orbitCore');

function getActivePlayerVenueStateLicense(state, accountKey, nowMs = Date.now()) {
  const normalizedAccountKey = sanitizeAccountKey(accountKey || getAccountKeyFromState(state));
  const access = state?.settings?.pilotAccess;
  const expiresAtMs = Date.parse(String(access?.expiresAt || ''));
  if (
    !normalizedAccountKey
    || access?.authorized !== true
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= nowMs
    || sanitizeAccountKey(access?.licenseId) !== normalizedAccountKey
    || typeof access?.authorizationCode !== 'string'
    || !access.authorizationCode.trim()
  ) return null;
  return {
    accountKey: normalizedAccountKey,
    authorizationCode: access.authorizationCode.trim(),
    expiresAtMs
  };
}

function isActiveMatchingInspection(inspection, localLicense, nowMs) {
  const license = inspection?.license;
  const remoteExpiresAtMs = Date.parse(String(license?.expiresAt || ''));
  return inspection?.managed === true
    && inspection.active === true
    && license?.status === 'active'
    && sanitizeAccountKey(license.accountKey) === localLicense.accountKey
    && Number.isFinite(remoteExpiresAtMs)
    && remoteExpiresAtMs > nowMs;
}

async function inspectPlayerVenueRecords(records, dependencies = {}) {
  const nowMs = Number((dependencies.nowMs || Date.now)());
  if (!Number.isFinite(nowMs)) return { ok: false, code: 'unavailable', eligibleRecords: [] };
  const candidates = [];
  for (const record of records || []) {
    const accountKey = sanitizeAccountKey(record?.accountKey || getAccountKeyFromState(record?.state));
    const localLicense = getActivePlayerVenueStateLicense(record?.state, accountKey, nowMs);
    if (localLicense) candidates.push({ record: { ...record, accountKey }, localLicense });
  }
  if (candidates.length === 0) return { ok: true, eligibleRecords: [] };
  const inspectMany = dependencies.inspectPilotLicenses || inspectPilotLicenses;
  let inspections;
  try {
    inspections = await inspectMany(candidates.map((candidate) => candidate.localLicense.authorizationCode));
  } catch {
    return { ok: false, code: 'unavailable', eligibleRecords: [] };
  }
  if (!Array.isArray(inspections) || inspections.length !== candidates.length) {
    return { ok: false, code: 'unavailable', eligibleRecords: [] };
  }
  return {
    ok: true,
    eligibleRecords: candidates
      .filter((candidate, index) => isActiveMatchingInspection(inspections[index], candidate.localLicense, nowMs))
      .map((candidate) => candidate.record)
  };
}

async function inspectPlayerVenueRecord(record, dependencies = {}) {
  const result = await inspectPlayerVenueRecords(record ? [record] : [], dependencies);
  if (!result.ok) return result;
  if (result.eligibleRecords.length !== 1) return { ok: false, code: 'inactive' };
  return { ok: true, record: result.eligibleRecords[0] };
}

function sendPlayerVenueEligibilityError(response, result, options = {}) {
  if (result?.code === 'unavailable') {
    response.status(503).json({
      ok: false,
      code: 'PLAYER_VENUE_LICENSE_UNAVAILABLE',
      error: 'Venue availability cannot be verified right now.'
    });
    return;
  }
  if (options.publicNotFound) {
    response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'Club not found.' });
    return;
  }
  response.status(410).json({
    ok: false,
    code: 'PLAYER_VENUE_LICENSE_INACTIVE',
    error: 'This Orbit venue is not currently available to Player.'
  });
}

module.exports = {
  getActivePlayerVenueStateLicense,
  inspectPlayerVenueRecord,
  inspectPlayerVenueRecords,
  isActiveMatchingInspection,
  sendPlayerVenueEligibilityError
};
