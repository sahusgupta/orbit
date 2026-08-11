const crypto = require('crypto');
const branding = require('../../../branding.config.json');
const { sanitizeAccountKey } = require('./orbitCore');
const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');

function getLicenseCollection() {
  const admin = getAdminSdk();
  return admin.firestore(getAdminApp({ allowCredentialsFile: true })).collection('pilotLicenses');
}

function hashAuthorizationCode(value) {
  return crypto.createHash('sha256').update(String(value || '').trim()).digest('hex');
}

function canonicalPayload(payload) {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .reduce((record, key) => {
        record[key] = payload[key];
        return record;
      }, {})
  );
}

function verifySignedPilotLicense(envelope, options = {}) {
  const payload = envelope?.payload;
  const signature = String(envelope?.signature || '').trim();
  const publicKeyPem = String(
    options.publicKeyPem ||
    process.env.ORBIT_LICENSE_PUBLIC_KEY_PEM?.replace(/\\n/g, '\n') ||
    branding.license?.publicKeyPem ||
    ''
  ).trim();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !signature) {
    return { ok: false, error: 'A signed pilot license envelope is required.' };
  }
  if (envelope.algorithm && envelope.algorithm !== 'ECDSA-P256-SHA256') {
    return { ok: false, error: 'The pilot license signature algorithm is not supported.' };
  }
  if (!publicKeyPem) return { ok: false, error: 'Pilot license verification is not configured.' };
  const authorizationCode = String(payload.authorizationCode || payload.code || '').trim();
  if (!/^TT-PILOT-[A-F0-9]{24}$/i.test(authorizationCode)) {
    return { ok: false, error: 'A valid pilot authorization code is required.' };
  }
  let expiresAt;
  try {
    expiresAt = normalizeExpiration(payload.expiresAt || payload.expirationDate || payload.validUntil);
  } catch {
    return { ok: false, error: 'A valid expiration date is required.' };
  }
  if (Date.parse(expiresAt) < Number(options.nowMs || Date.now())) {
    return { ok: false, error: 'The signed pilot license is expired.' };
  }
  try {
    const signatureBytes = Buffer.from(signature, 'base64');
    if (signatureBytes.length !== 64) return { ok: false, error: 'The pilot license signature is invalid.' };
    const verified = crypto.verify(
      'sha256',
      Buffer.from(canonicalPayload(payload)),
      { key: publicKeyPem, dsaEncoding: 'ieee-p1363' },
      signatureBytes
    );
    if (!verified) return { ok: false, error: 'The pilot license signature is invalid.' };
  } catch {
    return { ok: false, error: 'The pilot license signature is invalid.' };
  }
  return {
    ok: true,
    access: {
      authorizationCode,
      expiresAt,
      issuedTo: String(payload.issuedTo || '').trim(),
      issuedAt: String(payload.issuedAt || '').trim(),
      licenseId: String(payload.licenseId || '').trim()
    }
  };
}

function normalizeExpiration(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('A valid expiration date is required.');
  const parsed = new Date(text.includes('T') ? text : `${text.slice(0, 10)}T23:59:59.999Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error('A valid expiration date is required.');
  return parsed.toISOString();
}

function isLicenseActive(license, nowMs = Date.now()) {
  return license?.status !== 'revoked' && Date.parse(license?.expiresAt || '') >= nowMs;
}

function publicLicense(record) {
  if (!record) return null;
  return {
    id: record.id,
    licenseId: record.licenseId,
    accountKey: record.accountKey,
    issuedTo: record.issuedTo || '',
    codeLast4: record.codeLast4 || '',
    status: isLicenseActive(record) ? 'active' : record.status === 'revoked' ? 'revoked' : 'expired',
    expiresAt: record.expiresAt,
    issuedAt: record.issuedAt || '',
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || '',
    lastAuthenticatedAt: record.lastAuthenticatedAt || ''
  };
}

async function findLicenseByAuthorizationCode(authorizationCode) {
  const id = hashAuthorizationCode(authorizationCode);
  const snapshot = await getLicenseCollection().doc(id).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function authenticatePilotLicense(authorizationCode) {
  const record = await findLicenseByAuthorizationCode(authorizationCode);
  if (!record) return { managed: false, active: false, license: null };
  const active = isLicenseActive(record);
  if (active) {
    const lastAuthenticatedAt = new Date().toISOString();
    await getLicenseCollection().doc(record.id).set({ lastAuthenticatedAt }, { merge: true });
    Object.assign(record, { lastAuthenticatedAt });
  }
  return { managed: true, active, license: publicLicense(record) };
}

async function registerPilotLicense(access) {
  const authorizationCode = String(access?.authorizationCode || '').trim();
  if (!/^TT-PILOT-[A-F0-9]{24}$/i.test(authorizationCode)) throw new Error('A valid pilot authorization code is required.');
  const id = hashAuthorizationCode(authorizationCode);
  const reference = getLicenseCollection().doc(id);
  const existing = await reference.get();
  if (existing.exists) return publicLicense({ id, ...existing.data() });
  const now = new Date().toISOString();
  const licenseId = String(access?.licenseId || '').trim() || `lic_${id.slice(0, 16)}`;
  const record = {
    licenseId,
    accountKey: sanitizeAccountKey(licenseId || authorizationCode),
    issuedTo: String(access?.issuedTo || '').trim(),
    codeLast4: authorizationCode.slice(-4).toUpperCase(),
    status: 'active',
    expiresAt: normalizeExpiration(access?.expiresAt),
    issuedAt: String(access?.issuedAt || access?.activatedAt || now),
    createdAt: now,
    updatedAt: now,
    lastAuthenticatedAt: now
  };
  await reference.create(record);
  return publicLicense({ id, ...record });
}

async function registerSignedPilotLicense(envelope) {
  const verification = verifySignedPilotLicense(envelope);
  if (!verification.ok) {
    throw new Error(verification.error);
  }
  return registerPilotLicense(verification.access);
}

async function listPilotLicenses(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 251);
  const admin = getAdminSdk();
  let query = getLicenseCollection()
    .orderBy('expiresAt', 'asc')
    .orderBy(admin.firestore.FieldPath.documentId(), 'asc');
  if (options.afterExpiresAt && options.afterId) {
    query = query.startAfter(String(options.afterExpiresAt), String(options.afterId));
  }
  const snapshot = await query.limit(limit).get();
  return snapshot.docs.map((document) => publicLicense({ id: document.id, ...document.data() }));
}

/**
 * @param {unknown} id
 * @param {{ expiresAt?: unknown, extendDays?: unknown }} [options]
 */
async function renewPilotLicense(id, options = {}) {
  const { expiresAt, extendDays } = options;
  const reference = getLicenseCollection().doc(String(id || ''));
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error('Pilot license was not found.');
  const current = { id: snapshot.id, ...snapshot.data() };
  let nextExpiration;
  if (expiresAt) {
    nextExpiration = normalizeExpiration(expiresAt);
  } else {
    const days = Number(extendDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Renewal days must be between 1 and 3650.');
    const base = Math.max(Date.now(), Date.parse(snapshot.get('expiresAt') || '') || 0);
    nextExpiration = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
  }
  const updatedAt = new Date().toISOString();
  await reference.set({ expiresAt: nextExpiration, status: 'active', updatedAt }, { merge: true });
  return publicLicense({ ...current, expiresAt: nextExpiration, status: 'active', updatedAt });
}

async function revokePilotLicense(id) {
  const reference = getLicenseCollection().doc(String(id || ''));
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error('Pilot license was not found.');
  const updatedAt = new Date().toISOString();
  await reference.set({ status: 'revoked', updatedAt }, { merge: true });
  return publicLicense({ id: snapshot.id, ...snapshot.data(), status: 'revoked', updatedAt });
}

module.exports = {
  authenticatePilotLicense,
  canonicalPayload,
  hashAuthorizationCode,
  isLicenseActive,
  listPilotLicenses,
  normalizeExpiration,
  registerSignedPilotLicense,
  renewPilotLicense,
  revokePilotLicense,
  verifySignedPilotLicense
};
