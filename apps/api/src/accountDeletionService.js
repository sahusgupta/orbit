const crypto = require('crypto');
const { getDatabase } = require('./db/connection');
const { loadState, saveState } = require('./db/state');
const { deletePlayerIdentityData } = require('./identityService');
const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');

const allowedDisposition = new Set(['delete', 'anonymize', 'retain']);

function readDeletionPolicy() {
  let policy;
  try {
    policy = JSON.parse(String(process.env.ORBIT_ACCOUNT_DELETION_POLICY_JSON || ''));
  } catch {
    return null;
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
  const normalized = {
    financialRecords: String(policy.financialRecords || ''),
    auditRecords: String(policy.auditRecords || ''),
    providerRecords: String(policy.providerRecords || '')
  };
  if (!Object.values(normalized).every((value) => allowedDisposition.has(value))) return null;
  // Provider deletion requires provider-specific legal and operational approval.
  // The repository currently reports those records honestly but cannot erase them.
  if (normalized.providerRecords !== 'retain') return null;
  return normalized;
}

function retainedCategories(policy) {
  return [
    policy.financialRecords !== 'delete' ? `financial-records:${policy.financialRecords}` : '',
    policy.auditRecords !== 'delete' ? `audit-records:${policy.auditRecords}` : '',
    policy.providerRecords !== 'delete' ? `external-provider-records:${policy.providerRecords}` : ''
  ].filter(Boolean);
}

function subjectPseudonym(playerId) {
  const secret = String(process.env.ORBIT_DELETION_PSEUDONYM_SECRET || '').trim();
  if (secret.length < 32) throw new Error('Account-deletion pseudonymization is not configured.');
  return `deleted_${crypto.createHmac('sha256', secret).update(playerId).digest('hex').slice(0, 24)}`;
}

function matchesPlayer(record, playerId, names = new Set(), sessionIds = new Set()) {
  if (!record || typeof record !== 'object') return false;
  const identifiers = [record.playerId, record.profileId, record.userId, record.uid, record.hostPlayerId];
  if (identifiers.some((value) => String(value || '') === playerId)) return true;
  if (sessionIds.has(String(record.playerSessionId || ''))) return true;
  const candidateName = String(record.playerName || record.name || '').trim().toLowerCase();
  return Boolean(candidateName && names.has(candidateName));
}

function anonymizeMatchedRecord(record, subjectId) {
  const next = { ...record };
  for (const key of ['playerId', 'profileId', 'userId', 'uid', 'hostPlayerId']) {
    if (Object.hasOwn(next, key)) next[key] = subjectId;
  }
  if (Object.hasOwn(next, 'playerName')) next.playerName = 'Deleted player';
  if (Object.hasOwn(next, 'name')) next.name = 'Deleted player';
  for (const key of ['playerEmail', 'email', 'phone', 'birthday', 'note', 'notes']) {
    if (Object.hasOwn(next, key)) delete next[key];
  }
  return next;
}

function redactAuditValue(value, playerId, names, subjectId) {
  if (Array.isArray(value)) return value.map((entry) => redactAuditValue(entry, playerId, names, subjectId));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    let next = value.split(playerId).join(subjectId);
    for (const name of names) {
      if (next.toLowerCase() === name) next = 'Deleted player';
    }
    return next;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    redactAuditValue(entry, playerId, names, subjectId)
  ]));
}

function anonymizePlayerState(state, playerId, subjectId, policy) {
  const profile = (state.profiles || []).find((entry) => entry.id === playerId);
  const names = new Set([String(profile?.name || '').trim().toLowerCase()].filter(Boolean));
  const playerSessions = state.playerSessions || [];
  const removedSessions = playerSessions.filter((entry) => matchesPlayer(entry, playerId, names));
  const sessionIds = new Set(removedSessions.map((entry) => String(entry.id || '')).filter(Boolean));
  const operationalMatch = (entry) => matchesPlayer(entry, playerId, names, sessionIds);
  const applyFinancial = (records = []) => policy.financialRecords === 'delete'
    ? records.filter((entry) => !operationalMatch(entry))
    : policy.financialRecords === 'anonymize'
      ? records.map((entry) => operationalMatch(entry) ? anonymizeMatchedRecord(entry, subjectId) : entry)
      : records;
  const applyAudit = (records = []) => policy.auditRecords === 'delete'
    ? records.filter((entry) => !operationalMatch(entry))
    : policy.auditRecords === 'anonymize'
      ? redactAuditValue(records, playerId, names, subjectId)
      : records;

  const notifications = (state.inAppNotifications || []).flatMap((notification) => {
    const targetPlayerIds = (notification.targetPlayerIds || []).filter((id) => id !== playerId);
    const targetPlayerNames = (notification.targetPlayerNames || []).filter((name) => !names.has(String(name).trim().toLowerCase()));
    const targetedById = (notification.targetPlayerIds || []).includes(playerId);
    const targetedByName = (notification.targetPlayerNames || []).some((name) => names.has(String(name).trim().toLowerCase()));
    if ((targetedById || targetedByName) && !targetPlayerIds.length && !targetPlayerNames.length) return [];
    return [{ ...notification, targetPlayerIds, targetPlayerNames }];
  });

  return {
    ...state,
    profiles: (state.profiles || []).filter((entry) => entry.id !== playerId),
    interests: (state.interests || []).filter((entry) => !operationalMatch(entry)),
    playerSessions: playerSessions.filter((entry) => !operationalMatch(entry)),
    sessions: (state.sessions || []).map((session) => ({
      ...session,
      plannedPlayerIds: session.plannedPlayerIds?.filter((id) => id !== playerId)
    })),
    tournaments: (state.tournaments || []).map((tournament) => ({
      ...tournament,
      players: (tournament.players || []).filter((entry) => !operationalMatch(entry))
    })),
    inAppNotifications: notifications,
    buyIns: applyFinancial(state.buyIns),
    timeFeeLogs: applyFinancial(state.timeFeeLogs),
    revenueTransactions: applyFinancial(state.revenueTransactions),
    playerLedger: applyFinancial(state.playerLedger),
    correctionLog: applyAudit(state.correctionLog),
    feedback: applyAudit(state.feedback),
    history: applyAudit(state.history),
    nightCloses: applyAudit(state.nightCloses)
  };
}

async function updateJob(database, playerId, subjectId, status, currentStep, retained, result = {}, lastError = '') {
  const now = new Date().toISOString();
  await database.run(`
    INSERT INTO account_deletion_jobs (
      player_id, subject_id, status, current_step, retained_categories_json,
      result_json, last_error, created_at, updated_at, completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
    ON CONFLICT(player_id) DO UPDATE SET
      subject_id = excluded.subject_id,
      status = excluded.status,
      current_step = excluded.current_step,
      retained_categories_json = excluded.retained_categories_json,
      result_json = excluded.result_json,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
  `, [
    playerId,
    subjectId,
    status,
    currentStep,
    JSON.stringify(retained),
    JSON.stringify(result),
    lastError,
    now,
    status === 'complete' ? now : null
  ]);
}

async function anonymizeAuthoritativeStates(playerId, subjectId, policy) {
  const database = await getDatabase();
  const accounts = await database.all('SELECT account_key FROM account_state ORDER BY account_key ASC');
  let changedAccounts = 0;
  for (const account of accounts) {
    const record = await loadState(account.account_key);
    if (!record?.state) continue;
    const state = anonymizePlayerState(record.state, playerId, subjectId, policy);
    const before = JSON.stringify(record.state);
    if (JSON.stringify(state) === before) continue;
    await saveState(state, {
      expectedRevision: record.revision,
      mutationId: `account-delete:${subjectId}:${record.accountKey}`,
      mutationType: 'player-account-deletion'
    });
    changedAccounts += 1;
  }
  return changedAccounts;
}

async function redactTelemetry(database, playerId) {
  const pattern = `%${playerId}%`;
  await database.run('UPDATE clients SET current_user_json = NULL WHERE current_user_json LIKE $1', [pattern]);
  await database.run("UPDATE client_update_events SET details_json = '{\"redacted\":true}', error = '' WHERE details_json LIKE $1 OR error LIKE $1", [pattern]);
  await database.run("UPDATE client_telemetry_events SET details_json = '{\"redacted\":true}' WHERE details_json LIKE $1", [pattern]);
  await database.run("UPDATE client_errors SET message = 'Redacted player-related error.', stack = '', details_json = '{\"redacted\":true}' WHERE message LIKE $1 OR stack LIKE $1 OR details_json LIKE $1", [pattern]);
}

async function deleteQuery(query) {
  const snapshot = await query.get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  return snapshot.docs.length;
}

async function cleanupFirebasePlayer(playerId, subjectId, policy) {
  const admin = getAdminSdk();
  const database = admin.firestore(getAdminApp());
  let deletedDocuments = 0;
  const clubs = await database.collection('clubs').get();
  for (const club of clubs.docs) {
    const clubReference = club.ref;
    for (const collectionName of ['membershipRequests', 'waitlistRequests', 'memberships', 'waitlists', 'tournamentRegistrations']) {
      deletedDocuments += await deleteQuery(clubReference.collection(collectionName).where('playerId', '==', playerId));
    }
    deletedDocuments += await deleteQuery(clubReference.collection('notifications').where('targetPlayerIds', 'array-contains', playerId));
    const transactionQuery = clubReference.collection('transactions').where('playerId', '==', playerId);
    if (policy.financialRecords === 'delete') {
      deletedDocuments += await deleteQuery(transactionQuery);
    } else if (policy.financialRecords === 'anonymize') {
      const transactions = await transactionQuery.get();
      await Promise.all(transactions.docs.map((document) => document.ref.set({
        playerId: subjectId,
        playerName: 'Deleted player',
        playerEmail: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })));
    }
    await Promise.all([
      clubReference.collection('memberships').doc(playerId).delete(),
      clubReference.collection('timeWallets').doc(playerId).delete(),
      clubReference.collection('players').doc(playerId).delete()
    ]);
  }
  deletedDocuments += await deleteQuery(database.collection('privateGames').where('hostPlayerId', '==', playerId));
  const playerReference = database.doc(`players/${playerId}`);
  if (typeof database.recursiveDelete === 'function') await database.recursiveDelete(playerReference);
  else {
    await database.doc(`players/${playerId}/private/identity`).delete();
    await playerReference.delete();
  }
  return deletedDocuments;
}

async function deletePlayerAccount(request, response) {
  response.set('cache-control', 'no-store');
  const policy = readDeletionPolicy();
  if (!policy) {
    response.status(503).json({
      ok: false,
      code: 'DELETION_POLICY_NOT_CONFIGURED',
      error: 'Account deletion is unavailable until the approved retention dispositions are configured.'
    });
    return;
  }
  const authTime = Number(request.orbitPlayer.auth_time || 0) * 1000;
  if (!authTime || Date.now() - authTime > 5 * 60 * 1000) {
    response.status(401).json({ ok: false, code: 'RECENT_LOGIN_REQUIRED', error: 'Sign in again before deleting this account.' });
    return;
  }

  const playerId = request.orbitPlayer.uid;
  const database = await getDatabase();
  let subjectId;
  try {
    subjectId = subjectPseudonym(playerId);
  } catch {
    response.status(503).json({
      ok: false,
      code: 'DELETION_PSEUDONYM_NOT_CONFIGURED',
      error: 'Account deletion pseudonymization is unavailable.'
    });
    return;
  }
  const retained = retainedCategories(policy);
  let currentStep = 'authoritative-state';
  try {
    await updateJob(database, playerId, subjectId, 'running', currentStep, retained);
    const changedAccounts = await anonymizeAuthoritativeStates(playerId, subjectId, policy);
    currentStep = 'telemetry';
    await updateJob(database, playerId, subjectId, 'running', currentStep, retained, { changedAccounts });
    await redactTelemetry(database, playerId);
    currentStep = 'identity-provider';
    await updateJob(database, playerId, subjectId, 'running', currentStep, retained, { changedAccounts });
    const identity = await deletePlayerIdentityData(playerId);
    currentStep = 'firebase-data';
    await updateJob(database, playerId, subjectId, 'running', currentStep, retained, { changedAccounts, ...identity });
    const deletedFirebaseDocuments = await cleanupFirebasePlayer(playerId, subjectId, policy);
    currentStep = 'firebase-auth';
    await updateJob(database, playerId, subjectId, 'running', currentStep, retained, { changedAccounts, deletedFirebaseDocuments, ...identity });
    const admin = getAdminSdk();
    await admin.auth(getAdminApp()).deleteUser(playerId);
    const result = { changedAccounts, deletedFirebaseDocuments, ...identity };
    await updateJob(database, playerId, subjectId, 'complete', 'complete', retained, result);
    response.json({ ok: true, status: 'complete', retainedCategories: retained, ...result });
  } catch (error) {
    await updateJob(database, playerId, subjectId, 'failed', currentStep, retained, {}, error instanceof Error ? error.name : 'DeletionError');
    throw error;
  }
}

module.exports = {
  anonymizeMatchedRecord,
  anonymizePlayerState,
  deletePlayerAccount,
  matchesPlayer,
  readDeletionPolicy,
  retainedCategories
};
