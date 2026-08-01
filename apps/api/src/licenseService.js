const crypto = require('crypto');
const fs = require('fs');
const admin = require('firebase-admin');
const { sanitizeAccountKey } = require('./orbitCore');

let adminApp;

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }
  return null;
}

function getAdminApp() {
  if (adminApp) return adminApp;
  if (admin.apps.length) {
    adminApp = admin.app();
    return adminApp;
  }
  const serviceAccount = readServiceAccount();
  adminApp = admin.initializeApp(serviceAccount ? { credential: admin.credential.cert(serviceAccount) } : undefined);
  return adminApp;
}

function getLicenseCollection() {
  return admin.firestore(getAdminApp()).collection('pilotLicenses');
}

function hashAuthorizationCode(value) {
  return crypto.createHash('sha256').update(String(value || '').trim()).digest('hex');
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
    record.lastAuthenticatedAt = lastAuthenticatedAt;
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

async function listPilotLicenses() {
  const snapshot = await getLicenseCollection().orderBy('expiresAt', 'asc').get();
  return snapshot.docs.map((document) => publicLicense({ id: document.id, ...document.data() }));
}

async function renewPilotLicense(id, { expiresAt, extendDays } = {}) {
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
    const base = Math.max(Date.now(), Date.parse(current.expiresAt || '') || 0);
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
  hashAuthorizationCode,
  isLicenseActive,
  listPilotLicenses,
  normalizeExpiration,
  registerPilotLicense,
  renewPilotLicense,
  revokePilotLicense
};
