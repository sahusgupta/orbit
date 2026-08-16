const crypto = require('crypto');
const {
  claimManagementRecoveryOverride,
  consumeManagementRecoveryOverride,
  createManagementRecoveryOverride,
  getManagementRecoveryOverride,
  listLegacyStates,
  listManagementRecoveryOverrides,
  listStatePage,
  loadLegacyState,
  loadState,
  releaseManagementRecoveryClaim,
  revokeManagementRecoveryOverride,
  saveState,
  schedulePublicationDrain,
  StateConflictError
} = require('./database');
const { protectedIdentifier } = require('./http/dataProtection');
const { sendOperationalAlert } = require('./http/operationalAlerts');
const { getPilotLicense, listPilotLicensesForAccount } = require('./licenseService');
const { getAccountKeyFromState, sanitizeAccountKey } = require('./orbitCore');
const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');

const blockedPasswords = new Set(['12345678', 'password', 'password1', 'qwerty123']);

class ManagementAccountError extends Error {
  constructor(message, { code = 'MANAGEMENT_ACCOUNT_ERROR', status = 400 } = {}) {
    super(message);
    this.name = 'ManagementAccountError';
    this.code = code;
    this.status = status;
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (username.length > 254 || !/^\S+@\S+\.\S+$/.test(username)) {
    throw new ManagementAccountError('Enter a valid management login email.', {
      code: 'INVALID_MANAGEMENT_USERNAME'
    });
  }
  return username;
}

function normalizeVenueIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '');
}

function getStateVenueIdentities(state) {
  return [
    state?.settings?.pilotAccess?.issuedTo,
    state?.settings?.clubAccount?.clubName
  ].map(normalizeVenueIdentity).filter(Boolean);
}

function bindStateToLicense(state, license, activatedAt) {
  const { accountLogin: _previousLogin, pilotAccess: _previousAccess, ...preservedSettings } = state.settings || {};
  return {
    ...state,
    settings: {
      ...preservedSettings,
      pilotAccess: {
        authorized: true,
        authorizationCode: '',
        licenseId: license.licenseId || license.accountKey,
        issuedTo: license.issuedTo || '',
        issuedAt: license.issuedAt || '',
        expiresAt: license.expiresAt,
        activatedAt,
        serverManaged: true
      }
    }
  };
}

function validateNewPassword(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128 || blockedPasswords.has(password.trim().toLowerCase())) {
    throw new ManagementAccountError('Choose a password or passphrase between 12 and 128 characters.', {
      code: 'INVALID_MANAGEMENT_PASSWORD'
    });
  }
  return password;
}

function hashManagementPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 210_000, 32, 'sha256', (error, derived) => {
      if (error) reject(error);
      else resolve(`pbkdf2-sha256$210000$${derived.toString('hex')}`);
    });
  });
}

function getAccountLogin(record) {
  const login = record?.state?.settings?.accountLogin;
  const username = normalizeUsername(login?.username);
  return login && username ? { ...login, username } : null;
}

function publicRecovery(recovery, { includeInternal = false } = {}) {
  if (!recovery) return null;
  return {
    id: recovery.id,
    status: recovery.status,
    expiresAt: recovery.expiresAt,
    createdAt: recovery.createdAt,
    consumedAt: recovery.consumedAt,
    revokedAt: recovery.revokedAt,
    ...(includeInternal ? { reason: recovery.reason } : {})
  };
}

function createFirebasePasswordProvider() {
  const admin = getAdminSdk();
  const auth = admin.auth(getAdminApp());
  return {
    async createUser(username, password) {
      try {
        const user = await auth.createUser({ email: username, password });
        return { userId: user.uid, userRef: protectedIdentifier(user.uid) };
      } catch (error) {
        if (error?.code === 'auth/email-already-exists') {
          throw new ManagementAccountError('That email is already assigned to a Firebase account.', {
            code: 'MANAGEMENT_FIREBASE_EMAIL_IN_USE',
            status: 409
          });
        }
        if (['auth/invalid-email', 'auth/invalid-password'].includes(error?.code)) {
          throw new ManagementAccountError('Firebase rejected the management login credentials.', {
            code: 'INVALID_MANAGEMENT_CREDENTIALS'
          });
        }
        throw error;
      }
    },
    async deleteUser(userId) {
      await auth.deleteUser(userId);
    },
    async updatePassword(username, password) {
      let user;
      try {
        user = await auth.getUserByEmail(username);
      } catch (error) {
        if (error?.code === 'auth/user-not-found') {
          throw new ManagementAccountError('The Firebase management login does not exist.', {
            code: 'MANAGEMENT_FIREBASE_USER_NOT_FOUND',
            status: 409
          });
        }
        throw error;
      }
      await auth.updateUser(user.uid, { password });
      await auth.revokeRefreshTokens(user.uid);
      return { userRef: protectedIdentifier(user.uid) };
    }
  };
}

async function sendFirebasePasswordResetEmail(username, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!apiKey || typeof fetchImpl !== 'function') {
    throw new ManagementAccountError('Firebase password-reset email is not configured on the API.', {
      code: 'PASSWORD_RESET_EMAIL_NOT_CONFIGURED',
      status: 503
    });
  }
  let response;
  try {
    response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: username })
    });
  } catch {
    throw new ManagementAccountError('Firebase could not send the password-reset email.', {
      code: 'PASSWORD_RESET_EMAIL_FAILED',
      status: 503
    });
  }
  if (!response.ok) {
    await response.text().catch(() => '');
    throw new ManagementAccountError('Firebase could not send the password-reset email.', {
      code: 'PASSWORD_RESET_EMAIL_FAILED',
      status: 503
    });
  }
}

function createManagementAccountService(dependencies = {}) {
  const recoveryStore = dependencies.recoveryStore || {
    claim: claimManagementRecoveryOverride,
    consume: consumeManagementRecoveryOverride,
    create: createManagementRecoveryOverride,
    get: getManagementRecoveryOverride,
    list: listManagementRecoveryOverrides,
    release: releaseManagementRecoveryClaim,
    revoke: revokeManagementRecoveryOverride
  };
  const listLegacyStatesImpl = dependencies.listLegacyStates || listLegacyStates;
  const listStatePageImpl = dependencies.listStatePage || listStatePage;
  const loadLegacyStateImpl = dependencies.loadLegacyState || loadLegacyState;
  const loadStateImpl = dependencies.loadState || loadState;
  const loadPilotLicenseImpl = dependencies.loadPilotLicense || getPilotLicense;
  const listPilotLicensesForAccountImpl = dependencies.listPilotLicensesForAccount || listPilotLicensesForAccount;
  const saveStateImpl = dependencies.saveState || saveState;
  const schedulePublication = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const passwordProvider = dependencies.passwordProvider || {
    createUser(username, password) {
      return createFirebasePasswordProvider().createUser(username, password);
    },
    deleteUser(userId) {
      return createFirebasePasswordProvider().deleteUser(userId);
    },
    updatePassword(username, password) {
      return createFirebasePasswordProvider().updatePassword(username, password);
    }
  };
  const passwordResetSender = dependencies.passwordResetSender || sendFirebasePasswordResetEmail;
  const now = dependencies.now || (() => new Date());
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const createSalt = dependencies.createSalt || (() => crypto.randomBytes(16).toString('hex'));
  const hashPassword = dependencies.hashPassword || hashManagementPassword;
  const operationalAlert = dependencies.sendOperationalAlert || sendOperationalAlert;

  async function requireManagementAccount(accountKey) {
    const record = await loadStateImpl(accountKey);
    if (!record) {
      throw new ManagementAccountError('Management account not found.', {
        code: 'MANAGEMENT_ACCOUNT_NOT_FOUND',
        status: 404
      });
    }
    const accountLogin = getAccountLogin(record);
    if (!accountLogin) {
      throw new ManagementAccountError('This venue does not have a management login.', {
        code: 'MANAGEMENT_LOGIN_NOT_CONFIGURED',
        status: 409
      });
    }
    return { record, accountLogin };
  }

  async function listAccounts() {
    const records = [];
    let afterAccountKey = '';
    do {
      const page = await listStatePageImpl({ limit: 50, afterAccountKey });
      records.push(...page.records);
      afterAccountKey = page.hasMore ? page.nextCursor : '';
    } while (afterAccountKey);
    const recoveries = await recoveryStore.list({ limit: Math.max(records.length * 3, 100), now: now() });
    const recoveryByAccount = new Map(recoveries.map((recovery) => [recovery.accountKey, recovery]));
    return records.map((record) => {
      const login = getAccountLogin(record);
      return {
        accountKey: record.accountKey,
        venueName: record.venueName || record.state?.settings?.clubAccount?.clubName || record.accountKey,
        username: login?.username || '',
        hasManagementLogin: Boolean(login),
        revision: Number(record.revision || 0),
        savedAt: record.savedAt,
        recovery: publicRecovery(recoveryByAccount.get(record.accountKey), { includeInternal: true })
      };
    });
  }

  async function listLegacyAccounts(accountKeys) {
    const records = await listLegacyStatesImpl(accountKeys);
    return records.map((record) => ({
      accountKey: record.accountKey,
      venueName: record.venueName || record.accountKey,
      savedAt: record.savedAt,
      stateSource: 'legacy-firebase'
    }));
  }

  async function provisionAccount({ licenseDocumentId, sourceAccountKey = '', username, password }) {
    const normalizedUsername = validateUsername(username);
    const newPassword = validateNewPassword(password);
    const license = await loadPilotLicenseImpl(licenseDocumentId);
    if (!license) {
      throw new ManagementAccountError('Pilot license not found.', {
        code: 'MANAGEMENT_LICENSE_NOT_FOUND',
        status: 404
      });
    }
    if (license.status !== 'active') {
      throw new ManagementAccountError('A management login can be created only for an active pilot license.', {
        code: 'MANAGEMENT_LICENSE_INACTIVE',
        status: 409
      });
    }

    let migratedFromAccountKey = '';
    let migratedFromLegacy = false;
    let record = await loadStateImpl(license.accountKey);
    if (!record) {
      const normalizedSourceAccountKey = sanitizeAccountKey(sourceAccountKey);
      if (!normalizedSourceAccountKey) {
        throw new ManagementAccountError('This active license has no authoritative club data yet. Select the prior club account to preserve its data.', {
          code: 'MANAGEMENT_STATE_NOT_FOUND',
          status: 409
        });
      }
      let sourceRecord = await loadStateImpl(normalizedSourceAccountKey);
      if (!sourceRecord) {
        sourceRecord = await loadLegacyStateImpl(normalizedSourceAccountKey);
        migratedFromLegacy = Boolean(sourceRecord);
      }
      if (!sourceRecord || sourceRecord.accountKey !== normalizedSourceAccountKey) {
        throw new ManagementAccountError('The selected prior club data was not found.', {
          code: 'MANAGEMENT_SOURCE_STATE_NOT_FOUND',
          status: 404
        });
      }
      const licenseIdentity = normalizeVenueIdentity(license.issuedTo);
      if (!licenseIdentity || !getStateVenueIdentities(sourceRecord.state).includes(licenseIdentity)) {
        throw new ManagementAccountError('The selected club data does not match the venue named by this pilot license.', {
          code: 'MANAGEMENT_SOURCE_IDENTITY_MISMATCH',
          status: 409
        });
      }
      const sourceLicenses = normalizedSourceAccountKey === license.accountKey
        ? []
        : await listPilotLicensesForAccountImpl(normalizedSourceAccountKey);
      if (sourceLicenses.some((candidate) => candidate.id !== license.id && candidate.status === 'active')) {
        throw new ManagementAccountError('The selected club data is still bound to another active pilot license. Revoke that license before copying the state.', {
          code: 'MANAGEMENT_SOURCE_LICENSE_ACTIVE',
          status: 409
        });
      }
      migratedFromAccountKey = normalizedSourceAccountKey;
      record = {
        ...sourceRecord,
        accountKey: license.accountKey,
        revision: 0,
        state: bindStateToLicense(sourceRecord.state, license, now().toISOString())
      };
    }
    if (record.accountKey !== license.accountKey || getAccountKeyFromState(record.state) !== license.accountKey) {
      throw new ManagementAccountError('The saved club data is not bound to this pilot license. Resolve the account mapping before creating credentials.', {
        code: 'MANAGEMENT_STATE_LICENSE_MISMATCH',
        status: 409
      });
    }
    if (getAccountLogin(record)) {
      throw new ManagementAccountError('This venue already has a management login. Use the password controls instead.', {
        code: 'MANAGEMENT_LOGIN_ALREADY_CONFIGURED',
        status: 409
      });
    }

    const passwordSalt = createSalt();
    const passwordHash = await hashPassword(newPassword, passwordSalt);
    const createdAt = now().toISOString();
    const operationId = randomUUID();
    const providerResult = await passwordProvider.createUser(normalizedUsername, newPassword);
    let saved;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (getAccountLogin(record)) {
          throw new ManagementAccountError('This venue already has a management login. Use the password controls instead.', {
            code: 'MANAGEMENT_LOGIN_ALREADY_CONFIGURED',
            status: 409
          });
        }
        const nextState = {
          ...record.state,
          settings: {
            ...record.state.settings,
            accountLogin: {
              username: normalizedUsername,
              passwordSalt,
              passwordHash,
              createdAt
            }
          }
        };
        try {
          saved = await saveStateImpl(nextState, {
            expectedRevision: Number(record.revision || 0),
            mutationId: `management-account-provision:${operationId}`,
            mutationType: 'management-account-provision'
          });
          break;
        } catch (error) {
          if (!(error instanceof StateConflictError) && error?.code !== 'STATE_REVISION_CONFLICT') throw error;
          const latest = await loadStateImpl(license.accountKey);
          if (!latest) throw error;
          record = latest;
          migratedFromAccountKey = '';
          migratedFromLegacy = false;
        }
      }
      if (!saved) throw new Error('Management account could not be committed after revision retries.');
    } catch (error) {
      let rollbackFailed = false;
      try {
        await passwordProvider.deleteUser(providerResult.userId);
      } catch {
        rollbackFailed = true;
      }
      void operationalAlert('management-account-provision-failed', 'critical', {
        tenantRef: protectedIdentifier(license.accountKey),
        providerUserRef: providerResult.userRef || '',
        operationRef: protectedIdentifier(operationId),
        rollbackFailed
      });
      throw error;
    }

    void schedulePublication();
    return {
      accountKey: saved.accountKey,
      licenseId: license.licenseId,
      migratedFromAccountKey,
      migratedFromLegacy,
      username: normalizedUsername,
      revision: saved.revision,
      publication: saved.publication
    };
  }

  async function startRecovery({ accountKey, durationMinutes, reason, actorRef }) {
    await requireManagementAccount(accountKey);
    return publicRecovery(await recoveryStore.create({
      accountKey,
      durationMinutes,
      reason,
      createdByRef: actorRef,
      now: now()
    }), { includeInternal: true });
  }

  async function revokeRecovery({ accountKey }) {
    await requireManagementAccount(accountKey);
    const revoked = await recoveryStore.revoke(accountKey, { now: now() });
    if (!revoked) {
      throw new ManagementAccountError('No active recovery override exists for this management account.', {
        code: 'MANAGEMENT_RECOVERY_NOT_ACTIVE',
        status: 409
      });
    }
    return { revoked: true };
  }

  async function getRecoveryStatus({ accountKey }) {
    const { accountLogin } = await requireManagementAccount(accountKey);
    const recovery = await recoveryStore.get(accountKey, { activeOnly: true, now: now() });
    return {
      active: Boolean(recovery),
      expiresAt: recovery?.expiresAt || null,
      username: accountLogin.username
    };
  }

  async function commitPassword({ accountKey, password, operationId, markAuthenticated = false }) {
    const newPassword = validateNewPassword(password);
    let { record, accountLogin } = await requireManagementAccount(accountKey);
    const providerResult = await passwordProvider.updatePassword(accountLogin.username, newPassword);
    const passwordSalt = createSalt();
    const passwordHash = await hashPassword(newPassword, passwordSalt);
    const changedAt = now().toISOString();
    let saved;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const nextState = {
          ...record.state,
          settings: {
            ...record.state.settings,
            accountLogin: {
              ...accountLogin,
              username: accountLogin.username,
              passwordSalt,
              passwordHash,
              lastLoginAt: markAuthenticated ? changedAt : accountLogin.lastLoginAt
            }
          }
        };
        try {
          saved = await saveStateImpl(nextState, {
            expectedRevision: Number(record.revision || 0),
            mutationId: `management-password:${operationId}`,
            mutationType: 'management-password-change'
          });
          break;
        } catch (error) {
          if (!(error instanceof StateConflictError) && error?.code !== 'STATE_REVISION_CONFLICT') throw error;
          const latest = await loadStateImpl(accountKey);
          if (!latest) throw error;
          record = latest;
          accountLogin = getAccountLogin(latest);
          if (!accountLogin) throw error;
        }
      }
      if (!saved) throw new Error('Management password state could not be committed after revision retries.');
    } catch (error) {
      void operationalAlert('management-password-commit-failed', 'critical', {
        tenantRef: protectedIdentifier(accountKey),
        providerUserRef: providerResult.userRef || '',
        operationRef: protectedIdentifier(operationId)
      });
      throw error;
    }

    void schedulePublication();
    return {
      accountKey: saved.accountKey,
      username: accountLogin.username,
      passwordSalt,
      passwordHash,
      lastLoginAt: markAuthenticated ? changedAt : accountLogin.lastLoginAt,
      revision: saved.revision,
      publication: saved.publication
    };
  }

  async function changePassword({ accountKey, password }) {
    return commitPassword({ accountKey, password, operationId: randomUUID() });
  }

  async function completeRecovery({ accountKey, password }) {
    const recovery = await recoveryStore.claim(accountKey, { now: now() });
    if (!recovery) {
      throw new ManagementAccountError('The owner recovery override is unavailable or expired.', {
        code: 'MANAGEMENT_RECOVERY_NOT_ACTIVE',
        status: 409
      });
    }
    try {
      const result = await commitPassword({ accountKey, password, operationId: recovery.id, markAuthenticated: true });
      const consumed = await recoveryStore.consume(recovery.id, { now: now() });
      if (!consumed) throw new Error('The recovery override could not be consumed.');
      return result;
    } catch (error) {
      await recoveryStore.release(recovery.id, { now: now() }).catch(() => undefined);
      throw error;
    }
  }

  async function sendResetEmail({ accountKey }) {
    const { accountLogin } = await requireManagementAccount(accountKey);
    await passwordResetSender(accountLogin.username);
    return { sent: true };
  }

  return {
    changePassword,
    completeRecovery,
    getRecoveryStatus,
    listAccounts,
    listLegacyAccounts,
    provisionAccount,
    revokeRecovery,
    sendResetEmail,
    startRecovery
  };
}

let defaultService;
function getManagementAccountService() {
  defaultService = defaultService || createManagementAccountService();
  return defaultService;
}

module.exports = {
  ManagementAccountError,
  createManagementAccountService,
  getManagementAccountService,
  hashManagementPassword,
  sendFirebasePasswordResetEmail,
  validateUsername,
  validateNewPassword
};
