const crypto = require('crypto');
const {
  claimManagementRecoveryOverride,
  consumeManagementRecoveryOverride,
  createManagementRecoveryOverride,
  getManagementRecoveryOverride,
  listManagementRecoveryOverrides,
  listStatePage,
  loadState,
  releaseManagementRecoveryClaim,
  revokeManagementRecoveryOverride,
  saveState,
  schedulePublicationDrain,
  StateConflictError
} = require('./database');
const { protectedIdentifier } = require('./http/dataProtection');
const { sendOperationalAlert } = require('./http/operationalAlerts');
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
  const listStatePageImpl = dependencies.listStatePage || listStatePage;
  const loadStateImpl = dependencies.loadState || loadState;
  const saveStateImpl = dependencies.saveState || saveState;
  const schedulePublication = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const passwordProvider = dependencies.passwordProvider || {
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
  validateNewPassword
};
