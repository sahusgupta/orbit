const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sessionStoreFormat = 'orbit-management-session-v1';

function parseLicenseExpiration(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return Number.NaN;
  return Date.parse(normalized.includes('T') ? normalized : `${normalized}T23:59:59.999`);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeBinding(value) {
  const accountKey = String(value?.accountKey || '').trim().toLowerCase();
  const credentialFingerprint = String(value?.credentialFingerprint || '').trim().toLowerCase();
  const licenseExpiresAt = String(value?.licenseExpiresAt || '').trim();
  const expiresAt = parseLicenseExpiration(licenseExpiresAt);
  if (
    !/^[a-z0-9._-]{1,96}$/.test(accountKey) ||
    !/^[a-f0-9]{64}$/.test(credentialFingerprint) ||
    licenseExpiresAt.length > 64 ||
    !Number.isFinite(expiresAt)
  ) {
    throw new Error('Management session binding is invalid.');
  }
  return { accountKey, credentialFingerprint, expiresAt, licenseExpiresAt };
}

function createManagementSessionStore(dependencies) {
  const app = dependencies.app;
  const decodeState = dependencies.decodeState;
  const encodeState = dependencies.encodeState;
  const fileSystem = dependencies.fileSystem || fs;
  const now = dependencies.now || Date.now;
  const userDataPath = dependencies.userDataPath || (() => app.getPath('userData'));
  let cache;

  function emptyStore() {
    return { format: sessionStoreFormat, sessions: {} };
  }

  function getDataPath() {
    return path.join(userDataPath(), 'orbit-management-session.json');
  }

  function getStore() {
    if (cache) return cache;
    const filePath = getDataPath();
    if (!fileSystem.existsSync(filePath)) {
      cache = emptyStore();
      return cache;
    }
    const parsed = JSON.parse(decodeState(fileSystem.readFileSync(filePath, 'utf8')));
    if (parsed?.format !== sessionStoreFormat || !parsed.sessions || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) {
      throw new Error('The Orbit management session store is invalid.');
    }
    cache = parsed;
    return cache;
  }

  function persistStore() {
    const filePath = getDataPath();
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    fileSystem.writeFileSync(temporaryPath, encodeState(JSON.stringify(getStore())), 'utf8');
    fileSystem.renameSync(temporaryPath, filePath);
  }

  function clearSession(accountKey) {
    const normalizedAccountKey = String(accountKey || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,96}$/.test(normalizedAccountKey)) return { ok: true, active: false };
    const store = getStore();
    if (store.sessions[normalizedAccountKey]) {
      delete store.sessions[normalizedAccountKey];
      persistStore();
    }
    return { ok: true, active: false };
  }

  function saveSession(value) {
    const binding = normalizeBinding(value);
    if (binding.expiresAt <= now()) throw new Error('The pilot key has expired.');
    const store = getStore();
    store.sessions = {
      [binding.accountKey]: {
        credentialFingerprint: binding.credentialFingerprint,
        expiresAt: binding.expiresAt,
        licenseExpiresAt: binding.licenseExpiresAt,
        savedAt: new Date(now()).toISOString()
      }
    };
    persistStore();
    return { ok: true, active: true, expiresAt: new Date(binding.expiresAt).toISOString() };
  }

  function restoreSession(value) {
    const binding = normalizeBinding(value);
    const store = getStore();
    const session = store.sessions[binding.accountKey];
    if (!session) return { ok: true, active: false };
    const active = Number(session.expiresAt) > now()
      && Number(session.expiresAt) === binding.expiresAt
      && safeEqual(session.credentialFingerprint, binding.credentialFingerprint)
      && safeEqual(session.licenseExpiresAt, binding.licenseExpiresAt);
    if (!active) {
      delete store.sessions[binding.accountKey];
      persistStore();
      return { ok: true, active: false };
    }
    return { ok: true, active: true, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  return {
    clearSession,
    getDataPath,
    restoreSession,
    saveSession
  };
}

module.exports = { createManagementSessionStore, parseLicenseExpiration };
