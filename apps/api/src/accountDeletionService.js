const crypto = require('crypto');
const { getAccountKeyFromState, sanitizeAccountKey } = require('./orbitCore');
const { firestoreDocumentId, getDatabase } = require('./db/connection');
const {
  areRequiredPublicationsPublished,
  blockAccountPublications,
  releaseAccountPublications,
  schedulePublicationDrain
} = require('./db/publicationOutbox');
const { deleteAnalyticalReportsForAccounts } = require('./db/reports');
const { invalidateAccountStateHistory, listHistoricalStates, listStatePage, loadState, saveState } = require('./db/state');
const { deletePlayerIdentityData } = require('./identityService');
const { isPlayerDeletionMarked, markPlayerDeletion } = require('./playerDeletionGuard');
const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');

const allowedDisposition = new Set(['delete', 'anonymize', 'retain']);
const repositoryDisposition = new Set(['delete', 'anonymize']);
const deletionRunningLeaseMs = 5 * 60 * 1000;

class DeletionJobLeaseLostError extends Error {
  constructor() {
    super('Another server invocation owns this account deletion job.');
    this.name = 'DeletionJobLeaseLostError';
    this.code = 'DELETION_JOB_LEASE_LOST';
  }
}

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
  // Repository-controlled records must either be erased or irreversibly
  // anonymized. Raw retention is only an explicit external-provider gate.
  if (!repositoryDisposition.has(normalized.financialRecords) || !repositoryDisposition.has(normalized.auditRecords)) {
    return null;
  }
  // Provider deletion requires provider-specific legal and operational approval.
  // The repository currently reports those records honestly but cannot erase them.
  if (normalized.providerRecords !== 'retain') return null;
  return normalized;
}

function retainedCategories(policy) {
  return [
    'security-deletion-tombstone:retained',
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

function matchesPlayer(record, playerIdentifiers, sessionIds = new Set()) {
  if (!record || typeof record !== 'object') return false;
  const identifiers = [
    record.playerId,
    record.profileId,
    record.userId,
    record.uid,
    record.hostPlayerId,
    record.orbitPlayerId,
    record.player?.id,
    record.host?.id
  ];
  if (identifiers.some((value) => playerIdentifiers.has(String(value || '')))) return true;
  if (sessionIds.has(String(record.playerSessionId || ''))) return true;
  return false;
}

const normalizedIdentifierKeys = new Set([
  'playerid', 'profileid', 'userid', 'uid', 'hostplayerid', 'orbitplayerid',
  'actorplayerid', 'targetplayerid', 'memberplayerid'
]);
const normalizedSensitiveKeys = new Set([
  'playeremail', 'email', 'emailaddress', 'contactemail',
  'playerphone', 'phone', 'phonenumber', 'contactphone',
  'birthday', 'birthdate', 'dateofbirth', 'dob',
  'address', 'streetaddress', 'postaladdress', 'mailingaddress', 'homelocation',
  'contact', 'contactinfo', 'contactdetails'
]);
const normalizedNameKeys = new Set([
  'playername', 'name', 'fullname', 'displayname', 'legalname'
]);
const freeTextTokenCharacters = 'A-Za-z0-9@._:-';

function normalizedFieldKey(key) {
  return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isIdentifierKey(key) {
  return normalizedIdentifierKeys.has(normalizedFieldKey(key));
}

function isSensitiveKey(key) {
  return normalizedSensitiveKeys.has(normalizedFieldKey(key));
}

function isNameKey(key) {
  return normalizedNameKeys.has(normalizedFieldKey(key));
}

function escapeRegularExpression(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsDelimitedToken(text, target) {
  const normalized = String(target || '');
  if (!normalized) return false;
  const pattern = new RegExp(
    `(^|[^${freeTextTokenCharacters}])${escapeRegularExpression(normalized)}(?=$|[^${freeTextTokenCharacters}])`
  );
  return pattern.test(String(text || ''));
}

function replaceDelimitedToken(text, target, replacement) {
  const normalized = String(target || '');
  if (!normalized) return String(text || '');
  const pattern = new RegExp(
    `(^|[^${freeTextTokenCharacters}])${escapeRegularExpression(normalized)}(?=$|[^${freeTextTokenCharacters}])`,
    'g'
  );
  return String(text || '').replace(pattern, (_match, prefix) => `${prefix}${replacement}`);
}

function valueContainsTarget(value, targets) {
  if (Array.isArray(value)) return value.some((entry) => valueContainsTarget(entry, targets));
  if (value && typeof value === 'object') return Object.values(value).some((entry) => valueContainsTarget(entry, targets));
  return typeof value === 'string' && [...targets].some((target) => containsDelimitedToken(value, target));
}

function redactSensitiveValue(value, playerIdentifiers, sensitiveValues, subjectId, targetContext = false) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry, playerIdentifiers, sensitiveValues, subjectId, targetContext));
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const entries = Object.entries(value);
    const hasIdentityKey = entries.some(([key]) => isIdentifierKey(key));
    const hasMatchingIdentity = entries.some(([key, entry]) =>
      isIdentifierKey(key) && playerIdentifiers.has(String(entry || ''))
    );
    const localTargetContext = hasIdentityKey ? hasMatchingIdentity : targetContext;
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
      if (isIdentifierKey(key)) {
        return [[key, playerIdentifiers.has(String(entry || '')) ? subjectId : entry]];
      }
      if (isSensitiveKey(key) && localTargetContext) return [];
      if (isNameKey(key) && localTargetContext) {
        return [[key, 'Deleted player']];
      }
      return [[key, redactSensitiveValue(
        entry,
        playerIdentifiers,
        sensitiveValues,
        subjectId,
        localTargetContext
      )]];
    }));
  }
  if (typeof value !== 'string') return value;
  let next = value;
  for (const identifier of playerIdentifiers) next = replaceDelimitedToken(next, identifier, subjectId);
  if (targetContext) {
    for (const sensitive of sensitiveValues) next = replaceDelimitedToken(next, sensitive, '[redacted]');
  }
  return next;
}

function sanitizeLegacySensitiveValues(value, sensitiveValues, key = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLegacySensitiveValues(entry, sensitiveValues, key));
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value).flatMap(([nestedKey, entry]) => {
      if (
        (isSensitiveKey(nestedKey) || isNameKey(nestedKey))
        && valueContainsTarget(entry, sensitiveValues)
      ) return [];
      return [[nestedKey, sanitizeLegacySensitiveValues(entry, sensitiveValues, nestedKey)]];
    }));
  }
  if (typeof value !== 'string') return value;
  let next = value;
  for (const sensitive of sensitiveValues) next = replaceDelimitedToken(next, sensitive, '[redacted]');
  return next;
}

function anonymizeMatchedRecord(record, subjectId, playerIdentifiers = new Set(), sensitiveValues = new Set()) {
  return redactSensitiveValue(record, playerIdentifiers, sensitiveValues, subjectId, true);
}

function containsPlayerIdentifier(value, playerIdentifiers, key = '') {
  if (Array.isArray(value)) return value.some((entry) => containsPlayerIdentifier(entry, playerIdentifiers, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([nestedKey, entry]) =>
      containsPlayerIdentifier(entry, playerIdentifiers, nestedKey)
    );
  }
  if (typeof value !== 'string') return false;
  if (isIdentifierKey(key)) return playerIdentifiers.has(value);
  return [...playerIdentifiers].some((identifier) => containsDelimitedToken(value, identifier));
}

const exactAggregateIdentifierKeys = new Set([
  ...normalizedIdentifierKeys,
  'playerids', 'profileids', 'participantplayerids', 'memberplayerids',
  'invitedplayerids', 'plannedplayerids', 'targetplayerids', 'waitlistplayerids'
]);

function containsExactStructuredPlayerIdentifier(value, playerIdentifiers, key = '') {
  const normalizedKey = normalizedFieldKey(key);
  if (Array.isArray(value)) {
    if (exactAggregateIdentifierKeys.has(normalizedKey)) {
      return value.some((entry) => playerIdentifiers.has(String(entry || '')));
    }
    return value.some((entry) => containsExactStructuredPlayerIdentifier(entry, playerIdentifiers, key));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([nestedKey, entry]) =>
      containsExactStructuredPlayerIdentifier(entry, playerIdentifiers, nestedKey)
    );
  }
  return exactAggregateIdentifierKeys.has(normalizedKey)
    && playerIdentifiers.has(String(value || ''));
}

function collectExactStructuredPlayerIdentifiers(value, output = new Set(), key = '') {
  const normalizedKey = normalizedFieldKey(key);
  if (Array.isArray(value)) {
    if (exactAggregateIdentifierKeys.has(normalizedKey)) {
      for (const entry of value) {
        const identifier = String(entry || '').trim();
        if (identifier) output.add(identifier);
      }
      return output;
    }
    for (const entry of value) collectExactStructuredPlayerIdentifiers(entry, output, key);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [nestedKey, entry] of Object.entries(value)) {
      collectExactStructuredPlayerIdentifiers(entry, output, nestedKey);
    }
    return output;
  }
  if (exactAggregateIdentifierKeys.has(normalizedKey)) {
    const identifier = String(value || '').trim();
    if (identifier) output.add(identifier);
  }
  return output;
}

function isStrongSensitiveSelector(value) {
  const text = String(value || '').trim();
  if (text.length < 7) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true;
  if (text.replace(/\D/g, '').length >= 7) return true;
  return /\d/.test(text) && /[a-z]/i.test(text) && /\s/.test(text);
}

function inspectPlayerState(state, playerId, subjectId, options = {}) {
  const playerIdentifiers = new Set([
    playerId,
    ...(options.playerIdentifiers || [])
  ].map(String).filter(Boolean));
  const linkedProfiles = [];
  const linkedProfileIds = new Set();
  let foundLink;
  do {
    foundLink = false;
    for (const profile of state.profiles || []) {
      const identifiers = [String(profile.id || ''), String(profile.orbitPlayerId || '')].filter(Boolean);
      if (!identifiers.some((identifier) => playerIdentifiers.has(identifier)) || linkedProfileIds.has(profile)) continue;
      linkedProfiles.push(profile);
      linkedProfileIds.add(profile);
      for (const identifier of identifiers) {
        if (!playerIdentifiers.has(identifier)) {
          playerIdentifiers.add(identifier);
          foundLink = true;
        }
      }
    }
  } while (foundLink);
  const sensitiveValues = new Set([
    ...(options.sensitiveValues || []),
    ...linkedProfiles.flatMap((profile) => [
    profile.name,
    profile.email,
    profile.phone,
    profile.birthday,
    profile.dateOfBirth,
    profile.address
    ])
  ].map((value) => String(value || '').trim()).filter((value) => value.length >= 3));
  const playerSessions = state.playerSessions || [];
  const removedSessions = playerSessions.filter((entry) => matchesPlayer(entry, playerIdentifiers));
  const sessionIds = new Set(removedSessions.map((entry) => String(entry.id || '')).filter(Boolean));
  const operationalMatch = (entry) => matchesPlayer(entry, playerIdentifiers, sessionIds);
  const directCollections = [
    'interests', 'tournamentInterests', 'membershipQrTokens', 'membershipRequests', 'waitlistRequests',
    'buyIns', 'timeFeeLogs', 'revenueTransactions', 'playerLedger'
  ];
  const auditCollections = [
    'correctionLog', 'feedback', 'history', 'nightCloses', 'usageEvents', 'tableEvents'
  ];
  const hasRetainedProfileRelationship = (state.profiles || []).some((profile) =>
    Array.isArray(profile.commonlyPlaysWithProfileIds)
      && profile.commonlyPlaysWithProfileIds.some((id) => playerIdentifiers.has(String(id || '')))
  );
  const affected = (state.playerPrivacyTombstones || []).includes(subjectId)
    || linkedProfiles.length > 0
    || hasRetainedProfileRelationship
    || removedSessions.length > 0
    || directCollections.some((key) => (state[key] || []).some(operationalMatch))
    || (state.sessions || []).some((session) =>
      (session.plannedPlayerIds || []).some((id) => playerIdentifiers.has(String(id)))
    )
    || (state.tournaments || []).some((tournament) => (tournament.players || []).some(operationalMatch))
    || (state.inAppNotifications || []).some((notification) =>
      (notification.targetPlayerIds || []).some((id) => playerIdentifiers.has(String(id)))
    )
    || auditCollections.some((key) => containsPlayerIdentifier(state[key] || [], playerIdentifiers));
  return { affected, linkedProfiles, operationalMatch, playerIdentifiers, playerSessions, sensitiveValues, sessionIds };
}

function normalizedCompanionValue(value) {
  return String(value || '').trim().toLowerCase();
}

function anonymizeRetainedProfiles(profiles, playerIdentifiers, sensitiveValues) {
  const sourceProfiles = Array.isArray(profiles) ? profiles : [];
  const profilesById = new Map(sourceProfiles.map((profile) => [String(profile?.id || ''), profile]));
  const targetSensitiveValues = new Set(
    [...sensitiveValues].map(normalizedCompanionValue).filter(Boolean)
  );

  return sourceProfiles.flatMap((profile) => {
    if (playerIdentifiers.has(String(profile?.id || ''))) return [];
    const relationshipIds = profile?.commonlyPlaysWithProfileIds;
    if (!Array.isArray(relationshipIds)) return [profile];
    const hasTargetRelationship = relationshipIds.some((id) => playerIdentifiers.has(String(id || '')));
    if (!hasTargetRelationship) return [profile];

    const commonlyPlaysWithProfileIds = relationshipIds.filter(
      (id) => !playerIdentifiers.has(String(id || ''))
    );
    if (!Array.isArray(profile.usualCompanions)) {
      return [{ ...profile, commonlyPlaysWithProfileIds }];
    }

    // A legacy companion name is only attributable to the deleted player when
    // this retained profile has an immutable relationship to that player. If a
    // still-linked peer has the same name, preserve the shared display value.
    const retainedLinkedNames = new Set(commonlyPlaysWithProfileIds
      .map((id) => profilesById.get(String(id || ''))?.name)
      .map(normalizedCompanionValue)
      .filter(Boolean));
    const usualCompanions = profile.usualCompanions.filter((value) => {
      const normalized = normalizedCompanionValue(value);
      return !targetSensitiveValues.has(normalized) || retainedLinkedNames.has(normalized);
    });
    return [{ ...profile, commonlyPlaysWithProfileIds, usualCompanions }];
  });
}

function eventSensitiveValues(record, profiles, playerIdentifiers, sensitiveValues) {
  const referencedProfileIds = [
    ...(Array.isArray(record?.profileIds) ? record.profileIds : []),
    ...(record?.profileId ? [record.profileId] : [])
  ];
  const retainedProfileIds = new Set(referencedProfileIds
    .map((id) => String(id || ''))
    .filter((id) => id && !playerIdentifiers.has(id)));
  if (!retainedProfileIds.size) return sensitiveValues;
  const retainedNames = new Set((profiles || [])
    .filter((profile) => retainedProfileIds.has(String(profile?.id || '')))
    .map((profile) => normalizedCompanionValue(profile?.name))
    .filter(Boolean));
  if (!retainedNames.size) return sensitiveValues;
  return new Set([...sensitiveValues].filter(
    (value) => !retainedNames.has(normalizedCompanionValue(value))
  ));
}

function anonymizePlayerStateDetailed(state, playerId, subjectId, policy, options = {}) {
  const inspection = inspectPlayerState(state, playerId, subjectId, options);
  if (!inspection.affected) {
    return {
      affected: false,
      playerIdentifiers: inspection.playerIdentifiers,
      sensitiveValues: inspection.sensitiveValues,
      state
    };
  }
  const { operationalMatch, playerIdentifiers, playerSessions, sensitiveValues } = inspection;
  const applyFinancial = (records = []) => policy.financialRecords === 'delete'
    ? records.filter((entry) => !operationalMatch(entry))
    : policy.financialRecords === 'anonymize'
      ? records.map((entry) => operationalMatch(entry)
          ? anonymizeMatchedRecord(entry, subjectId, playerIdentifiers, sensitiveValues)
          : entry)
      : records;
  const auditMatch = (entry) => operationalMatch(entry) || containsPlayerIdentifier(entry, playerIdentifiers);
  const applyAudit = (records = []) => policy.auditRecords === 'delete'
    ? records.filter((entry) => !auditMatch(entry))
    : policy.auditRecords === 'anonymize'
      ? records.map((entry) => auditMatch(entry)
          ? anonymizeMatchedRecord(entry, subjectId, playerIdentifiers, sensitiveValues)
          : entry)
      : records;
  const applyTableAudit = (records = []) => policy.auditRecords === 'delete'
    ? records.filter((entry) => !auditMatch(entry))
    : policy.auditRecords === 'anonymize'
      ? records.map((entry) => auditMatch(entry)
          ? anonymizeMatchedRecord(
              entry,
              subjectId,
              playerIdentifiers,
              eventSensitiveValues(entry, state.profiles, playerIdentifiers, sensitiveValues)
            )
          : entry)
      : records;

  const notifications = (state.inAppNotifications || []).flatMap((notification) => {
    const originalIds = notification.targetPlayerIds || [];
    const retainedIndexes = originalIds.flatMap((id, index) =>
      playerIdentifiers.has(String(id)) ? [] : [index]
    );
    const targetPlayerIds = retainedIndexes.map((index) => originalIds[index]);
    const targetedById = retainedIndexes.length !== originalIds.length;
    if (targetedById && !targetPlayerIds.length) return [];
    const redactedNotification = targetedById
      ? redactSensitiveValue(notification, playerIdentifiers, sensitiveValues, subjectId, true)
      : notification;
    const originalNames = notification.targetPlayerNames || [];
    const targetPlayerNames = originalNames.filter((_name, index) =>
      index >= originalIds.length || retainedIndexes.includes(index)
    );
    return [{ ...redactedNotification, targetPlayerIds, targetPlayerNames }];
  });

  return { affected: true, playerIdentifiers, sensitiveValues, state: {
    ...state,
    playerPrivacyTombstones: Array.from(new Set([...(state.playerPrivacyTombstones || []), subjectId])),
    profiles: anonymizeRetainedProfiles(state.profiles, playerIdentifiers, sensitiveValues),
    interests: (state.interests || []).filter((entry) => !operationalMatch(entry)),
    tournamentInterests: (state.tournamentInterests || []).filter((entry) => !operationalMatch(entry)),
    membershipQrTokens: (state.membershipQrTokens || []).filter((entry) => !operationalMatch(entry)),
    membershipRequests: (state.membershipRequests || []).filter((entry) => !operationalMatch(entry)),
    waitlistRequests: (state.waitlistRequests || []).filter((entry) => !operationalMatch(entry)),
    playerSessions: playerSessions.filter((entry) => !operationalMatch(entry)),
    sessions: (state.sessions || []).map((session) => ({
      ...session,
      plannedPlayerIds: session.plannedPlayerIds?.filter((id) => !playerIdentifiers.has(String(id)))
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
    nightCloses: applyAudit(state.nightCloses),
    usageEvents: applyAudit(state.usageEvents),
    tableEvents: applyTableAudit(state.tableEvents)
  } };
}

function anonymizePlayerState(state, playerId, subjectId, policy) {
  return anonymizePlayerStateDetailed(state, playerId, subjectId, policy).state;
}

async function updateJob(
  database,
  playerId,
  subjectId,
  status,
  currentStep,
  retained,
  result = {},
  lastError = '',
  options = {}
) {
  const timestampMs = Number((options.nowMs || Date.now)());
  const safeTimestampMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const now = new Date(safeTimestampMs).toISOString();
  const path = `orbitAccountDeletionJobs/${firestoreDocumentId(subjectId)}`;
  const legacyPath = `orbitAccountDeletionJobs/${firestoreDocumentId(playerId)}`;
  const storedResult = { ...(result && typeof result === 'object' ? result : {}) };
  if (status === 'complete') {
    // Cleanup manifests and exact publication acknowledgements are needed only
    // while the server can still retry finalization. Terminal jobs retain no raw
    // Auth UID, linked legacy identifier, or tenant cleanup inventory.
    delete storedResult.cleanupManifest;
    delete storedResult.requiredPublications;
  }
  const outcome = await database.runTransaction(async (transaction) => {
    const previous = await transaction.getDocument(path);
    const previousLeaseExpiresAt = Date.parse(String(previous?.leaseExpiresAt || ''));
    const runningLeaseActive = previous?.status === 'running'
      && Number.isFinite(previousLeaseExpiresAt)
      && previousLeaseExpiresAt > safeTimestampMs;
    if (
      previous?.status === 'complete'
      || (previous?.status === 'finalizing' && !['finalizing', 'complete'].includes(status))
      || (options.expectedLeaseId && previous?.leaseId !== options.expectedLeaseId)
      || (options.startOnly === true && previous?.status === 'finalizing')
      || (options.startOnly === true && runningLeaseActive)
    ) {
      return { applied: false, record: previous };
    }
    const nextResult = (
      previous?.status === 'running' && ['running', 'failed'].includes(status)
    ) || (options.startOnly === true && previous?.status === 'failed')
      ? { ...(previous.result || {}), ...storedResult }
      : storedResult;
    const leaseId = status === 'running' ? String(options.leaseId || previous?.leaseId || '') : '';
    if (status === 'running' && !leaseId) {
      throw new Error('A running account deletion job requires an opaque lease ID.');
    }
    const record = {
      subjectId,
      status,
      currentStep,
      retainedCategories: retained,
      result: nextResult,
      lastError,
      // A raw Auth UID is retained only while the server-owned finalizer may still
      // need to repeat the idempotent Firebase Auth deletion. Completing the job
      // replaces the whole document and therefore removes this field.
      pendingAuthUid: ['running', 'finalizing'].includes(status) ? playerId : undefined,
      leaseId: status === 'running' ? leaseId : undefined,
      leaseExpiresAt: status === 'running'
        ? new Date(safeTimestampMs + deletionRunningLeaseMs).toISOString()
        : undefined,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      completedAt: status === 'complete' ? now : null
    };
    transaction.setDocument(path, record);
    return { applied: true, record };
  });
  if (legacyPath !== path) await database.deleteDocument(legacyPath);
  return outcome;
}

async function anonymizeAuthoritativeStates(playerId, subjectId, policy, dependencies = {}) {
  const listPage = dependencies.listStatePage || listStatePage;
  const readHistoricalStates = dependencies.listHistoricalStates || listHistoricalStates;
  const writeState = dependencies.saveState || saveState;
  const invalidateHistory = dependencies.invalidateAccountStateHistory || invalidateAccountStateHistory;
  let changedAccounts = 0;
  const requiredPublications = [];
  const discoveredInventory = dependencies.linkedPlayerIds
    ? {
        linkedPlayerIds: dependencies.linkedPlayerIds,
        sensitiveValues: dependencies.sensitiveValues || []
      }
    : await inventoryAuthoritativePlayer(playerId, subjectId, {
        listStatePage: listPage,
        listHistoricalStates: readHistoricalStates
      });
  const linkedPlayerIds = new Set([playerId, ...(discoveredInventory.linkedPlayerIds || [])].map(String).filter(Boolean));
  const sensitiveValues = new Set((discoveredInventory.sensitiveValues || []).map(String).filter(Boolean));
  let cursor = '';
  do {
    const page = await listPage({ limit: 25, afterAccountKey: cursor });
    for (const record of page.records) {
      if (!record?.state) continue;
      const privacyInventory = { playerIdentifiers: linkedPlayerIds, sensitiveValues };
      const result = anonymizePlayerStateDetailed(record.state, playerId, subjectId, policy, privacyInventory);
      const historicalResults = (await readHistoricalStates(record.accountKey, record.revision))
        .map((historical) => anonymizePlayerStateDetailed(
          historical.state,
          playerId,
          subjectId,
          policy,
          privacyInventory
        ))
        .filter((inspection) => inspection.affected);
      if (!result.affected && !historicalResults.length) continue;
      for (const identifier of result.playerIdentifiers) linkedPlayerIds.add(identifier);
      for (const value of result.sensitiveValues) sensitiveValues.add(value);
      for (const historical of historicalResults) {
        for (const identifier of historical.playerIdentifiers) linkedPlayerIds.add(identifier);
        for (const value of historical.sensitiveValues) sensitiveValues.add(value);
      }
      const state = result.affected
        ? result.state
        : {
            ...record.state,
            playerPrivacyTombstones: Array.from(new Set([
              ...(record.state.playerPrivacyTombstones || []),
              subjectId
            ]))
          };
      const before = JSON.stringify(record.state);
      const previouslyApplied = (record.state.playerPrivacyTombstones || []).includes(subjectId);
      if (JSON.stringify(state) === before && !previouslyApplied) continue;
      const saved = JSON.stringify(state) === before
        ? { revision: record.revision, duplicate: true }
        : await writeState(state, {
            expectedRevision: record.revision,
            mutationId: `account-delete:${subjectId}:${crypto.createHash('sha256').update(record.accountKey).digest('hex')}`,
            mutationType: 'player-account-deletion',
            invalidatePriorRevisions: true
          });
      await invalidateHistory(record.accountKey, saved.revision);
      requiredPublications.push({ accountKey: record.accountKey, revision: Number(saved.revision) });
      if (!previouslyApplied) changedAccounts += 1;
    }
    cursor = page.hasMore ? page.nextCursor || '' : '';
  } while (cursor);
  return {
    changedAccounts,
    linkedPlayerIds: [...linkedPlayerIds],
    sensitiveValues: [...sensitiveValues],
    requiredPublications
  };
}

async function inventoryAuthoritativePlayer(playerId, subjectId, dependencies = {}) {
  const listPage = dependencies.listStatePage || listStatePage;
  const readHistoricalStates = dependencies.listHistoricalStates || listHistoricalStates;
  const database = dependencies.database || await (dependencies.getDatabase || getDatabase)();
  const listLegacyDocuments = dependencies.listLegacyClubStates
    || (() => listDatabaseCollection(database, 'clubStates'));
  const linkedPlayerIds = new Set([playerId]);
  const sensitiveValues = new Set();
  const affectedAccountKeys = new Set();
  const affectedLegacyStateDocumentIds = new Set();
  let discoveredLinks;
  let passes = 0;
  do {
    discoveredLinks = false;
    let cursor = '';
    do {
      const page = await listPage({ limit: 25, afterAccountKey: cursor });
      for (const record of page.records || []) {
        if (!record?.state) continue;
        const privacyInventory = { playerIdentifiers: linkedPlayerIds, sensitiveValues };
        const currentInspection = inspectPlayerState(record.state, playerId, subjectId, privacyInventory);
        const historicalInspections = (await readHistoricalStates(record.accountKey, record.revision))
          .map((historical) => inspectPlayerState(historical.state, playerId, subjectId, privacyInventory))
          .filter((inspection) => inspection.affected);
        if (!currentInspection.affected && !historicalInspections.length) continue;
        affectedAccountKeys.add(record.accountKey);
        for (const inspection of [currentInspection, ...historicalInspections]) {
          for (const identifier of inspection.playerIdentifiers) {
            if (!linkedPlayerIds.has(identifier)) discoveredLinks = true;
            linkedPlayerIds.add(identifier);
          }
          for (const value of inspection.sensitiveValues) {
            if (!sensitiveValues.has(value)) discoveredLinks = true;
            sensitiveValues.add(value);
          }
        }
      }
      cursor = page.hasMore ? page.nextCursor || '' : '';
    } while (cursor);
    const legacyDocuments = await listLegacyDocuments();
    for (const document of legacyDocuments || []) {
      const record = document?.data || {};
      const legacyState = record.state && typeof record.state === 'object' ? record.state : {};
      const inspection = inspectPlayerState(
        legacyState,
        playerId,
        subjectId,
        { playerIdentifiers: linkedPlayerIds, sensitiveValues }
      );
      const hasImmutableLink = inspection.linkedProfiles.length > 0
        || containsExactStructuredPlayerIdentifier(legacyState, linkedPlayerIds)
        || containsExactStructuredPlayerIdentifier(record.snapshot, linkedPlayerIds);
      if (!hasImmutableLink) continue;
      affectedLegacyStateDocumentIds.add(String(document.id));
      const stateAccountKey = legacyState.settings && typeof legacyState.settings === 'object'
        ? getAccountKeyFromState(legacyState)
        : '';
      const accountKey = sanitizeAccountKey(
        record.accountKey || stateAccountKey || document.id
      );
      if (accountKey) affectedAccountKeys.add(accountKey);
      for (const identifier of inspection.playerIdentifiers) {
        if (!linkedPlayerIds.has(identifier)) discoveredLinks = true;
        linkedPlayerIds.add(identifier);
      }
      for (const value of inspection.sensitiveValues) {
        if (!sensitiveValues.has(value)) discoveredLinks = true;
        sensitiveValues.add(value);
      }
    }
    passes += 1;
    if (linkedPlayerIds.size > 500 || passes > 10) {
      throw new Error('Player deletion found too many authoritative identity links.');
    }
  } while (discoveredLinks);
  return {
    affectedAccounts: affectedAccountKeys.size,
    affectedAccountKeys: [...affectedAccountKeys],
    affectedLegacyStateDocumentIds: [...affectedLegacyStateDocumentIds],
    linkedPlayerIds: [...linkedPlayerIds],
    sensitiveValues: [...sensitiveValues]
  };
}

const firebaseProfileIdentifierKeys = [
  'id', 'uid', 'playerId', 'profileId', 'sourceProfileId', 'orbitPlayerId'
];
const firebaseProfileSensitiveKeys = new Set([
  'name', 'displayName', 'fullName', 'email', 'emailAddress', 'phone', 'phoneNumber',
  'birthday', 'dateOfBirth', 'address', 'streetAddress', 'postalAddress', 'homeLocation'
]);

function collectFirebaseProfileIdentity(documentId, profile, playerIdentifiers, sensitiveValues) {
  const addIdentifier = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) playerIdentifiers.add(normalized);
  };
  addIdentifier(documentId);
  for (const key of firebaseProfileIdentifierKeys) addIdentifier(profile?.[key]);

  const visit = (value, key = '') => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(value)) visit(nestedValue, nestedKey);
      return;
    }
    if (!firebaseProfileSensitiveKeys.has(key)) return;
    const normalized = String(value || '').trim();
    if (normalized.length >= 3) sensitiveValues.add(normalized);
  };
  visit(profile || {});
}

function deletionDocumentId(value) {
  return String(value || '').trim().replace(/\//g, '-').slice(0, 128);
}

async function listDatabaseCollection(database, collectionPath, filters = []) {
  const records = [];
  let cursor;
  do {
    const page = await database.queryCollection(collectionPath, {
      filters,
      orders: [{ field: '__name__', direction: 'asc' }],
      startAfter: cursor ? [cursor] : undefined,
      limit: 200
    });
    records.push(...page);
    cursor = page.length === 200 ? page.at(-1).id : undefined;
  } while (cursor);
  return records;
}

async function deleteLinkedGameSessions(database, clubIds, playerIds) {
  const playerIdentifiers = new Set((playerIds || []).map(String).filter(Boolean));
  const normalizedClubIds = [...new Set((clubIds || []).map(deletionDocumentId).filter(Boolean))];
  const affectedClubIds = new Set();
  let deletedGameSessions = 0;
  for (const clubId of normalizedClubIds) {
    let cursor;
    do {
      const collectionPath = `clubs/${clubId}/gameSessions`;
      const documents = await database.queryCollection(collectionPath, {
        orders: [{ field: '__name__', direction: 'asc' }],
        startAfter: cursor ? [cursor] : undefined,
        limit: 100
      });
      for (const document of documents) {
        if (!containsExactStructuredPlayerIdentifier(document.data, playerIdentifiers)) continue;
        const documentPath = `${collectionPath}/${document.id}`;
        const deleted = await database.runTransaction(async (transaction) => {
          const current = await transaction.getDocument(documentPath);
          if (!current || !containsExactStructuredPlayerIdentifier(current, playerIdentifiers)) return false;
          // gameSessions is a private denormalized projection. Removing the
          // matched aggregate avoids retaining unkeyed legacy names while the
          // authoritative financial/audit records follow their configured policy.
          transaction.deleteDocument(documentPath);
          return true;
        });
        if (deleted) {
          deletedGameSessions += 1;
          affectedClubIds.add(clubId);
        }
      }
      cursor = documents.length === 100 ? documents.at(-1).id : undefined;
    } while (cursor);
  }
  return { deletedGameSessions, affectedClubIds: [...affectedClubIds] };
}

function accountKeyForLegacyStateDocument(documentId, record) {
  const state = record?.state && typeof record.state === 'object' ? record.state : {};
  const stateAccountKey = state.settings && typeof state.settings === 'object'
    ? getAccountKeyFromState(state)
    : '';
  return sanitizeAccountKey(record?.accountKey || stateAccountKey || documentId);
}

async function replaceLinkedLegacyClubStates(
  database,
  documentIds,
  accountKeys,
  playerIds,
  options = {}
) {
  const playerIdentifiers = new Set((playerIds || []).map(String).filter(Boolean));
  const allowedAccountKeys = new Set((accountKeys || []).map(sanitizeAccountKey).filter(Boolean));
  const updatedAt = new Date(Number((options.nowMs || Date.now)())).toISOString();
  let replacedLegacyClubStates = 0;
  for (const documentId of [...new Set((documentIds || []).map(String).filter(Boolean))]) {
    const documentPath = `clubStates/${documentId}`;
    const replaced = await database.runTransaction(async (transaction) => {
      const current = await transaction.getDocument(documentPath);
      if (!current) return false;
      const state = current.state && typeof current.state === 'object' ? current.state : {};
      const stateInspection = inspectPlayerState(
        state,
        '',
        'deleted_subject',
        { playerIdentifiers }
      );
      const stillLinked = stateInspection.linkedProfiles.length > 0
        || containsExactStructuredPlayerIdentifier(state, playerIdentifiers)
        || containsExactStructuredPlayerIdentifier(current.snapshot, playerIdentifiers);
      if (!stillLinked) return false;
      const accountKey = accountKeyForLegacyStateDocument(documentId, current);
      if (!accountKey || !allowedAccountKeys.has(accountKey)) return false;
      transaction.setDocument(documentPath, {
        accountKey,
        deprecated: true,
        legacyStateRemovedForPlayerDeletion: true,
        syncSource: 'orbit-account-deletion',
        updatedAt
      });
      return true;
    });
    if (replaced) replacedLegacyClubStates += 1;
  }
  return { replacedLegacyClubStates };
}

/**
 * Inventories Firebase-published profiles only through immutable identifiers.
 * Exact document-ID reads are required because older profile projections may
 * not contain `orbitPlayerId`, while still containing contact values that must
 * be removed from linked notifications and telemetry.
 */
async function inventoryFirebasePlayer(database, playerId, linkedPlayerIds = []) {
  const playerIdentifiers = new Set([playerId, ...(linkedPlayerIds || [])].map(String).filter(Boolean));
  const sensitiveValues = new Set();
  const affectedClubIds = new Set();
  const clubs = await listDatabaseCollection(database, 'clubs');
  const inspected = new Set();
  const queue = [...playerIdentifiers];
  const maximumLinkedIdentifiers = 500;

  while (queue.length) {
    const identifier = String(queue.shift() || '').trim();
    if (!identifier || inspected.has(identifier)) continue;
    inspected.add(identifier);
    const rootPlayerId = deletionDocumentId(identifier);
    if (rootPlayerId) {
      const rootProfile = await database.getDocument(`players/${rootPlayerId}`);
      if (rootProfile) collectFirebaseProfileIdentity(identifier, rootProfile, playerIdentifiers, sensitiveValues);
      const privateIdentity = await database.getDocument(`players/${rootPlayerId}/private/identity`);
      if (privateIdentity) {
        collectFirebaseProfileIdentity(identifier, privateIdentity, playerIdentifiers, sensitiveValues);
      }
    }
    for (const club of clubs) {
      const clubId = deletionDocumentId(club.id);
      const profileId = deletionDocumentId(identifier);
      if (!clubId || !profileId) continue;
      const collectionPath = `clubs/${clubId}/players`;
      const exactProfile = await database.getDocument(`${collectionPath}/${profileId}`);
      if (exactProfile) {
        affectedClubIds.add(club.id);
        collectFirebaseProfileIdentity(identifier, exactProfile, playerIdentifiers, sensitiveValues);
      }
      const linkedProfiles = await listDatabaseCollection(database, collectionPath, [
        { field: 'orbitPlayerId', op: '==', value: identifier }
      ]);
      for (const linkedProfile of linkedProfiles) {
        affectedClubIds.add(club.id);
        collectFirebaseProfileIdentity(linkedProfile.id, linkedProfile.data, playerIdentifiers, sensitiveValues);
      }
    }
    if (playerIdentifiers.size > maximumLinkedIdentifiers) {
      throw new Error('Player deletion found too many immutable Firebase profile links.');
    }
    for (const linkedIdentifier of playerIdentifiers) {
      if (!inspected.has(linkedIdentifier) && !queue.includes(linkedIdentifier)) queue.push(linkedIdentifier);
    }
  }

  return {
    affectedClubIds: [...affectedClubIds],
    clubIds: clubs.map((club) => club.id),
    linkedPlayerIds: [...playerIdentifiers],
    sensitiveValues: [...sensitiveValues]
  };
}

async function redactTelemetry(database, playerIds, sensitiveInput = [], subjectId = 'deleted_subject') {
  const playerIdentifiers = new Set((Array.isArray(playerIds) ? playerIds : [playerIds]).map(String).filter(Boolean));
  const sensitiveValues = new Set((Array.isArray(sensitiveInput) ? sensitiveInput : []).map(String).filter(Boolean));
  const sensitiveSelectors = new Set([...sensitiveValues].filter(isStrongSensitiveSelector));
  /** @type {Array<[string, (record: Record<string, unknown>) => Record<string, unknown>]>} */
  const targets = [
    ['orbitClients', (record) => ({ ...record, currentUser: null })],
    ['orbitClientUpdateEvents', (record) => ({ ...record, details: { redacted: true }, error: '' })],
    ['orbitTelemetryEvents', (record) => ({ ...record, details: { redacted: true } })],
    ['orbitClientErrors', (record) => ({
      ...record,
      message: 'Redacted player-related error.',
      stack: '',
      details: { redacted: true }
    })]
  ];
  for (const [collectionName, redact] of targets) {
    let cursor;
    do {
      const documents = await database.queryCollection(collectionName, {
        orders: [{ field: '__name__', direction: 'asc' }],
        startAfter: cursor ? [cursor] : undefined,
        limit: 200
      });
      for (const document of documents) {
        const linkedByImmutableId = containsExactStructuredPlayerIdentifier(document.data, playerIdentifiers);
        const linkedByStrongSensitiveValue = valueContainsTarget(document.data, sensitiveSelectors);
        if (!linkedByImmutableId && !linkedByStrongSensitiveValue) continue;
        const next = linkedByImmutableId
          ? redactSensitiveValue(redact(document.data), playerIdentifiers, sensitiveValues, subjectId, true)
          : sanitizeLegacySensitiveValues(document.data, sensitiveSelectors);
        await database.setDocument(
          `${collectionName}/${document.id}`,
          next
        );
      }
      cursor = documents.length === 200 ? documents.at(-1).id : undefined;
    } while (cursor);
  }
}

function enforcePlayerPrivacyTombstones(incomingState, authoritativeState) {
  const tombstones = Array.from(new Set(authoritativeState?.playerPrivacyTombstones || []));
  if (!tombstones.length) return incomingState;
  const policy = readDeletionPolicy();
  if (!policy) throw new Error('Account deletion policy is required to preserve privacy tombstones.');
  const identifiers = collectExactStructuredPlayerIdentifiers(incomingState);
  for (const profile of incomingState.profiles || []) {
    for (const value of [profile.id, profile.orbitPlayerId]) {
      const identifier = String(value || '').trim();
      if (identifier) identifiers.add(identifier);
    }
  }
  let nextState = { ...incomingState, playerPrivacyTombstones: tombstones };
  for (const identifier of identifiers) {
    const pseudonym = subjectPseudonym(identifier);
    if (tombstones.includes(pseudonym)) {
      nextState = anonymizePlayerState(nextState, identifier, pseudonym, policy);
    }
  }
  return nextState;
}

async function analyticalReportContainsDeletedPlayer(report, authoritativeState, dependencies = {}) {
  const identifiers = collectExactStructuredPlayerIdentifiers(report);
  if (identifiers.size > 500) {
    throw new Error('Analytical report contains too many player identifiers to validate safely.');
  }
  const tombstones = new Set(authoritativeState?.playerPrivacyTombstones || []);
  if (tombstones.size) {
    for (const identifier of identifiers) {
      if (tombstones.has((dependencies.subjectPseudonym || subjectPseudonym)(identifier))) return true;
    }
  }
  const checkDeletionMarker = dependencies.isPlayerDeletionMarked || isPlayerDeletionMarked;
  for (const identifier of identifiers) {
    if (await checkDeletionMarker(identifier, dependencies)) return true;
  }
  return false;
}

async function visitQueryPages(query, admin, operation, pageSize = 200) {
  let cursor = null;
  let visited = 0;
  do {
    let pageQuery = query.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    if (!snapshot.docs.length) break;
    await operation(snapshot.docs);
    visited += snapshot.docs.length;
    cursor = snapshot.docs.at(-1);
    if (snapshot.docs.length < pageSize) break;
  } while (cursor);
  return visited;
}

async function deleteQuery(query, admin) {
  return visitQueryPages(query, admin, (documents) => Promise.all(documents.map((document) => document.ref.delete())));
}

function removeNotificationRecipient(
  notification,
  playerId,
  sensitiveValues = new Set(),
  subjectId = 'deleted_subject',
  linkedPlayerIdentifiers = new Set([String(playerId)])
) {
  const originalIds = Array.isArray(notification.targetPlayerIds) ? notification.targetPlayerIds : [];
  const retainedIndexes = originalIds.flatMap((id, index) => String(id) === String(playerId) ? [] : [index]);
  if (retainedIndexes.length === originalIds.length) return notification;
  if (!retainedIndexes.length) return null;
  const originalNames = Array.isArray(notification.targetPlayerNames) ? notification.targetPlayerNames : [];
  return {
    ...redactSensitiveValue(notification, linkedPlayerIdentifiers, sensitiveValues, subjectId, true),
    targetPlayerIds: retainedIndexes.map((index) => originalIds[index]),
    targetPlayerNames: originalNames.filter((_name, index) =>
      index >= originalIds.length || retainedIndexes.includes(index)
    )
  };
}

async function cleanupFirebaseNotifications(
  database,
  clubReference,
  admin,
  playerId,
  playerIdentifiers,
  sensitiveValues,
  subjectId
) {
  let deleted = 0;
  await visitQueryPages(
    clubReference.collection('notifications').where('targetPlayerIds', 'array-contains', playerId),
    admin,
    async (notifications) => {
      for (const notification of notifications) {
        await database.runTransaction(async (transaction) => {
          const current = await transaction.get(notification.ref);
          if (!current.exists) return;
          const next = removeNotificationRecipient(
            current.data(),
            playerId,
            sensitiveValues,
            subjectId,
            playerIdentifiers
          );
          if (!next) {
            transaction.delete(notification.ref);
            deleted += 1;
            return;
          }
          transaction.set(notification.ref, {
            ...next,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
      }
    }
  );
  return deleted;
}

async function cleanupLegacyClubStateRequests(database, admin, playerIdentifiers) {
  let deleted = 0;
  await visitQueryPages(database.collection('clubStates'), admin, async (clubStates) => {
    for (const clubState of clubStates) {
      for (const identifier of playerIdentifiers) {
        for (const collectionName of ['membershipRequests', 'waitlistRequests']) {
          for (const field of ['player.id', 'playerId']) {
            deleted += await deleteQuery(clubState.ref.collection(collectionName).where(field, '==', identifier), admin);
          }
        }
      }
    }
  });
  return deleted;
}

async function cleanupFirebasePlayer(
  playerId,
  linkedPlayerIds,
  subjectId,
  policy,
  precomputedInventory,
  dependencies = {}
) {
  const firebaseInventory = precomputedInventory || await inventoryFirebasePlayer(
    await (dependencies.getDatabase || getDatabase)(),
    playerId,
    linkedPlayerIds
  );
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const database = dependencies.database || admin.firestore((dependencies.getAdminApp || getAdminApp)());
  const playerIdentifiers = new Set([
    playerId,
    ...(linkedPlayerIds || []),
    ...(firebaseInventory.linkedPlayerIds || [])
  ].map(String).filter(Boolean));
  const sensitiveValues = new Set((firebaseInventory.sensitiveValues || []).map(String).filter(Boolean));
  let deletedDocuments = 0;
  await visitQueryPages(database.collection('clubs'), admin, async (clubs) => {
    for (const club of clubs) {
      const clubReference = club.ref;
      for (const linkedIdentifier of [...playerIdentifiers]) {
        await visitQueryPages(
          clubReference.collection('players').where('orbitPlayerId', '==', linkedIdentifier),
          admin,
          async (profiles) => {
            for (const profile of profiles) {
              collectFirebaseProfileIdentity(
                profile.id,
                profile.data?.() || {},
                playerIdentifiers,
                sensitiveValues
              );
            }
          }
        );
      }
      playerIdentifiers.delete('');
      for (const identifier of playerIdentifiers) {
        for (const collectionName of ['membershipRequests', 'waitlistRequests', 'memberships', 'waitlists', 'tournamentInterests', 'tournamentRegistrations']) {
          deletedDocuments += await deleteQuery(clubReference.collection(collectionName).where('playerId', '==', identifier), admin);
        }
        deletedDocuments += await cleanupFirebaseNotifications(
          database,
          clubReference,
          admin,
          identifier,
          playerIdentifiers,
          sensitiveValues,
          subjectId
        );
        const transactionQuery = clubReference.collection('transactions').where('playerId', '==', identifier);
        if (policy.financialRecords === 'delete') {
          deletedDocuments += await deleteQuery(transactionQuery, admin);
        } else if (policy.financialRecords === 'anonymize') {
          await visitQueryPages(transactionQuery, admin, (transactions) => Promise.all(transactions.map((document) => {
            const redacted = anonymizeMatchedRecord(
              document.data?.() || {},
              subjectId,
              playerIdentifiers,
              sensitiveValues
            );
            return document.ref.set({
              ...redacted,
              playerId: subjectId,
              playerName: 'Deleted player',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          })));
        }
        await Promise.all([
          clubReference.collection('memberships').doc(identifier).delete(),
          clubReference.collection('timeWallets').doc(identifier).delete(),
          clubReference.collection('players').doc(identifier).delete()
        ]);
      }
    }
  });
  deletedDocuments += await cleanupLegacyClubStateRequests(database, admin, playerIdentifiers);
  for (const identifier of playerIdentifiers) {
    for (const field of ['hostPlayerId', 'playerId']) {
      deletedDocuments += await deleteQuery(database.collection('privateGames').where(field, '==', identifier), admin);
    }
    for (const field of ['participantPlayerIds', 'memberPlayerIds', 'invitedPlayerIds']) {
      deletedDocuments += await deleteQuery(database.collection('privateGames').where(field, 'array-contains', identifier), admin);
    }
  }
  for (const identifier of playerIdentifiers) {
    const rootPlayerId = deletionDocumentId(identifier);
    if (!rootPlayerId) continue;
    const playerReference = database.doc(`players/${rootPlayerId}`);
    if (typeof database.recursiveDelete === 'function') await database.recursiveDelete(playerReference);
    else {
      await database.doc(`players/${rootPlayerId}/private/identity`).delete();
      await playerReference.delete();
    }
  }
  return deletedDocuments;
}

async function deleteFirebaseAuthUser(playerId, dependencies = {}) {
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  try {
    await admin.auth(app).deleteUser(playerId);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
}

async function finalizePlayerDataCleanup(playerId, subjectId, policy, dependencies = {}) {
  const database = dependencies.database || await (dependencies.getDatabase || getDatabase)();
  const inventoryAuthoritative = dependencies.inventoryAuthoritativePlayer || inventoryAuthoritativePlayer;
  const inventoryFirebase = dependencies.inventoryFirebasePlayer || inventoryFirebasePlayer;
  const deleteGameSessions = dependencies.deleteLinkedGameSessions || deleteLinkedGameSessions;
  const deleteAnalyticalReports = dependencies.deleteAnalyticalReportsForAccounts || deleteAnalyticalReportsForAccounts;
  const replaceLegacyClubStates = dependencies.replaceLinkedLegacyClubStates || replaceLinkedLegacyClubStates;
  const cleanupFirebase = dependencies.cleanupFirebasePlayer || cleanupFirebasePlayer;
  const anonymizeStates = dependencies.anonymizeAuthoritativeStates || anonymizeAuthoritativeStates;
  const createDeletionMarker = dependencies.markPlayerDeletion || markPlayerDeletion;
  const priorLinkedPlayerIds = Array.isArray(dependencies.linkedPlayerIds)
    ? dependencies.linkedPlayerIds
    : [];
  const priorAffectedAccountKeys = Array.isArray(dependencies.affectedAccountKeys)
    ? dependencies.affectedAccountKeys
    : [];
  const priorFirebaseClubIds = Array.isArray(dependencies.firebaseClubIds)
    ? dependencies.firebaseClubIds
    : [];
  const priorLegacyStateDocumentIds = Array.isArray(dependencies.affectedLegacyStateDocumentIds)
    ? dependencies.affectedLegacyStateDocumentIds
    : [];
  const authoritativeInventory = await inventoryAuthoritative(playerId, subjectId, { database });
  const firebaseInventory = await inventoryFirebase(database, playerId, [
    ...priorLinkedPlayerIds,
    ...(authoritativeInventory.linkedPlayerIds || [])
  ]);
  const linkedPlayerIds = [...new Set([
    playerId,
    ...priorLinkedPlayerIds,
    ...(authoritativeInventory.linkedPlayerIds || []),
    ...(firebaseInventory.linkedPlayerIds || [])
  ].map(String).filter(Boolean))];
  for (const identifier of linkedPlayerIds) {
    await createDeletionMarker(database, identifier, { nowMs: dependencies.nowMs });
  }
  const gameSessionCleanup = await deleteGameSessions(
    database,
    [...new Set([
      ...priorAffectedAccountKeys,
      ...priorFirebaseClubIds,
      ...(authoritativeInventory.affectedAccountKeys || []),
      ...(firebaseInventory.clubIds || []),
      ...(firebaseInventory.affectedClubIds || [])
    ])],
    linkedPlayerIds
  );
  const cleanupInventory = {
    ...firebaseInventory,
    clubIds: [...new Set([
      ...priorFirebaseClubIds,
      ...priorAffectedAccountKeys,
      ...(firebaseInventory.clubIds || [])
    ])],
    affectedClubIds: [...new Set([
      ...priorFirebaseClubIds,
      ...priorAffectedAccountKeys,
      ...(firebaseInventory.affectedClubIds || [])
    ])]
  };
  const deletedFirebaseDocuments = await cleanupFirebase(
    playerId,
    linkedPlayerIds,
    subjectId,
    policy,
    cleanupInventory
  );
  const analyticalReports = await deleteAnalyticalReports([
    ...new Set([
      ...(authoritativeInventory.affectedAccountKeys || []),
      ...priorAffectedAccountKeys,
      ...priorFirebaseClubIds,
      ...(firebaseInventory.affectedClubIds || []),
      ...(gameSessionCleanup.affectedClubIds || [])
    ])
  ], { database });
  const legacyStates = await replaceLegacyClubStates(
    database,
    [...new Set([
      ...priorLegacyStateDocumentIds,
      ...(authoritativeInventory.affectedLegacyStateDocumentIds || [])
    ])],
    [...new Set([
      ...priorAffectedAccountKeys,
      ...(authoritativeInventory.affectedAccountKeys || [])
    ])],
    linkedPlayerIds,
    { nowMs: dependencies.nowMs }
  );
  const authoritative = await anonymizeStates(playerId, subjectId, policy, {
    linkedPlayerIds,
    sensitiveValues: [
      ...(authoritativeInventory.sensitiveValues || []),
      ...(firebaseInventory.sensitiveValues || [])
    ]
  });
  return {
    changedAccounts: Number(authoritative.changedAccounts || 0),
    deletedFirebaseDocuments: Number(deletedFirebaseDocuments || 0),
    deletedGameSessions: Number(gameSessionCleanup.deletedGameSessions || 0),
    requiredPublications: Array.isArray(authoritative.requiredPublications)
      ? authoritative.requiredPublications
      : [],
    ...analyticalReports,
    ...legacyStates
  };
}

function mergeRequiredPublications(...groups) {
  return [...new Map(groups.flatMap((group) => Array.isArray(group) ? group : [])
    .map((requirement) => ({
      accountKey: sanitizeAccountKey(requirement?.accountKey),
      revision: Number(requirement?.revision)
    }))
    .filter((requirement) => requirement.accountKey && Number.isInteger(requirement.revision) && requirement.revision > 0)
    .map((requirement) => [`${requirement.accountKey}:${requirement.revision}`, requirement])).values()];
}

function normalizeCleanupManifest(value = {}) {
  const source = value && typeof value === 'object'
    ? /** @type {{ linkedPlayerIds?: unknown[], affectedAccountKeys?: unknown[], firebaseClubIds?: unknown[], affectedLegacyStateDocumentIds?: unknown[] }} */ (value)
    : {};
  return {
    linkedPlayerIds: [...new Set((source.linkedPlayerIds || []).map(String).filter(Boolean))],
    affectedAccountKeys: [...new Set((source.affectedAccountKeys || []).map(sanitizeAccountKey).filter(Boolean))],
    firebaseClubIds: [...new Set((source.firebaseClubIds || []).map(sanitizeAccountKey).filter(Boolean))],
    affectedLegacyStateDocumentIds: [...new Set((source.affectedLegacyStateDocumentIds || []).map(String).filter(Boolean))]
  };
}

function publicDeletionResult(value = {}) {
  const result = { ...(value && typeof value === 'object' ? value : {}) };
  delete result.cleanupManifest;
  delete result.requiredPublications;
  return result;
}

function schedulePublicationWork(schedule, dependencies = {}) {
  try {
    void Promise.resolve(schedule({ force: true, dependencies })).catch(() => undefined);
  } catch {
    // The outbox and finalizing job remain durable for the next request.
  }
}

async function resumeExpiredRunningDeletionJobs(dependencies = {}) {
  const database = dependencies.database || await (dependencies.getDatabase || getDatabase)();
  const nowMs = Number((dependencies.nowMs || Date.now)());
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const pageSize = Math.min(Math.max(Number(dependencies.pageSize || 25), 1), 100);
  const maximumPages = Math.min(Math.max(Number(dependencies.maximumPages || 4), 1), 20);
  const cursorPath = 'orbitServiceCursors/accountDeletionRunningResumer';
  const cursorRecord = await database.getDocument(cursorPath);
  let cursor = String(cursorRecord?.afterJobId || '').trim();
  let wrapped = false;
  let pagesVisited = 0;
  let resumed = 0;
  let failed = 0;

  while (pagesVisited < maximumPages) {
    const jobs = await database.queryCollection('orbitAccountDeletionJobs', {
      filters: [{ field: 'status', op: '==', value: 'running' }],
      orders: [{ field: '__name__', direction: 'asc' }],
      startAfter: cursor ? [cursor] : undefined,
      limit: pageSize
    });
    if (!jobs.length) {
      if (cursor && !wrapped) {
        cursor = '';
        wrapped = true;
        continue;
      }
      break;
    }
    pagesVisited += 1;
    for (const job of jobs) {
      const record = job.data || {};
      const leaseExpiresAt = Date.parse(String(record.leaseExpiresAt || ''));
      if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt > safeNowMs) continue;
      const playerId = String(record.pendingAuthUid || '').trim();
      const subjectId = String(record.subjectId || '').trim();
      if (!playerId || !subjectId) {
        failed += 1;
        continue;
      }
      const response = {
        statusCode: 200,
        body: undefined,
        set() { return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };
      try {
        const handler = createDeletePlayerAccountHandler({
          ...dependencies,
          getDatabase: async () => database,
          // The durable job was created only after authenticated authorization.
          // Reuse its exact pseudonymous key instead of depending on a second
          // client login or recomputing a potentially rotated secret.
          subjectPseudonym: () => subjectId,
          keepRunningJobForServerRetry: true,
          // Avoid recursively joining this drain. Any finalizing record written
          // by the resumed worker is processed immediately after this scan.
          scheduleDeletionFinalizationDrain: async () => ({ finalized: 0, failed: 0 }),
          nowMs: () => safeNowMs
        });
        await handler(
          { orbitPlayer: { uid: playerId, auth_time: safeNowMs / 1000 } },
          response
        );
        resumed += 1;
      } catch {
        // The handler preserves the renewed running lease and its manifest so a
        // later server-owned drain can retry without requiring the player.
        failed += 1;
      }
    }
    cursor = jobs.at(-1).id;
    await database.setDocument(cursorPath, {
      afterJobId: cursor,
      updatedAt: new Date(safeNowMs).toISOString()
    });
    if (jobs.length < pageSize) break;
  }
  return { resumed, failed, pagesVisited };
}

async function finalizePendingDeletionJobs(dependencies = {}) {
  const database = dependencies.database || await (dependencies.getDatabase || getDatabase)();
  const writeJob = dependencies.updateJob || updateJob;
  const getDeletionPolicy = dependencies.readDeletionPolicy || readDeletionPolicy;
  const finalizeData = dependencies.finalizePlayerDataCleanup || finalizePlayerDataCleanup;
  const createDeletionMarker = dependencies.markPlayerDeletion || markPlayerDeletion;
  const deleteIdentity = dependencies.deletePlayerIdentityData || deletePlayerIdentityData;
  const publicationsPublished = dependencies.areRequiredPublicationsPublished || areRequiredPublicationsPublished;
  const schedulePublications = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const pageSize = Math.min(Math.max(Number(dependencies.pageSize || 25), 1), 100);
  const maximumPages = Math.min(Math.max(Number(dependencies.maximumPages || 4), 1), 20);
  const cursorPath = 'orbitServiceCursors/accountDeletionFinalizer';
  const cursorRecord = await database.getDocument(cursorPath);
  let cursor = String(cursorRecord?.afterJobId || '').trim();
  let wrapped = false;
  let pagesVisited = 0;
  let finalized = 0;
  let failed = 0;
  while (pagesVisited < maximumPages) {
    const jobs = await database.queryCollection('orbitAccountDeletionJobs', {
      filters: [{ field: 'status', op: '==', value: 'finalizing' }],
      orders: [{ field: '__name__', direction: 'asc' }],
      startAfter: cursor ? [cursor] : undefined,
      limit: pageSize
    });
    if (!jobs.length) {
      if (cursor && !wrapped) {
        cursor = '';
        wrapped = true;
        continue;
      }
      break;
    }
    pagesVisited += 1;
    for (const job of jobs) {
      const record = job.data || {};
      const playerId = String(record.pendingAuthUid || '').trim();
      const subjectId = String(record.subjectId || '').trim();
      if (!playerId || !subjectId) {
        failed += 1;
        continue;
      }
      try {
        const policy = getDeletionPolicy();
        if (!policy) throw new Error('Account deletion finalization policy is not configured.');
        await createDeletionMarker(database, playerId, { nowMs: dependencies.nowMs });
        const priorResult = record.result && typeof record.result === 'object' ? record.result : {};
        let requiredPublications = mergeRequiredPublications(priorResult.requiredPublications);
        if (!await publicationsPublished(database, requiredPublications)) {
          schedulePublicationWork(schedulePublications, dependencies.publicationDependencies || {});
          failed += 1;
          continue;
        }
        const identity = await deleteIdentity(playerId);
        if (Number(identity.identityProviderCleanupPending || 0) > 0) {
          failed += 1;
          continue;
        }
        const cleanupManifest = normalizeCleanupManifest(priorResult.cleanupManifest);
        const cleanupOptions = { ...dependencies, ...cleanupManifest, database };
        const preAuthCleanup = await finalizeData(playerId, subjectId, policy, cleanupOptions);
        requiredPublications = mergeRequiredPublications(
          requiredPublications,
          preAuthCleanup.requiredPublications
        );
        if (!await publicationsPublished(database, requiredPublications)) {
          await writeJob(
            database,
            playerId,
            subjectId,
            'finalizing',
            'projection-publication',
            Array.isArray(record.retainedCategories) ? record.retainedCategories : [],
            { ...priorResult, ...preAuthCleanup, cleanupManifest, requiredPublications }
          );
          schedulePublicationWork(schedulePublications, dependencies.publicationDependencies || {});
          failed += 1;
          continue;
        }
        await deleteFirebaseAuthUser(playerId, dependencies);
        const postAuthCleanup = await finalizeData(playerId, subjectId, policy, cleanupOptions);
        requiredPublications = mergeRequiredPublications(
          requiredPublications,
          postAuthCleanup.requiredPublications
        );
        if (!await publicationsPublished(database, requiredPublications)) {
          await writeJob(
            database,
            playerId,
            subjectId,
            'finalizing',
            'projection-publication',
            Array.isArray(record.retainedCategories) ? record.retainedCategories : [],
            { ...priorResult, ...preAuthCleanup, ...postAuthCleanup, cleanupManifest, requiredPublications }
          );
          schedulePublicationWork(schedulePublications, dependencies.publicationDependencies || {});
          failed += 1;
          continue;
        }
        await writeJob(
          database,
          playerId,
          subjectId,
          'complete',
          'complete',
          Array.isArray(record.retainedCategories) ? record.retainedCategories : [],
          {
            ...priorResult,
            ...preAuthCleanup,
            ...postAuthCleanup,
            ...identity
          }
        );
        finalized += 1;
      } catch {
        // The durable `finalizing` record deliberately remains unchanged. The
        // persisted cursor rotates later jobs ahead of a permanently failing job.
        failed += 1;
      }
    }
    cursor = jobs.at(-1).id;
    await database.setDocument(cursorPath, {
      afterJobId: cursor,
      updatedAt: new Date().toISOString()
    });
    if (jobs.length < pageSize) break;
  }
  return { finalized, failed, pagesVisited };
}

let scheduledFinalizationDrain;
let finalizationDrainRequestedAgain = false;
let lastFinalizationDrainAt = 0;

function registerDeletionFinalizationContinuation(promise, options = {}) {
  if (typeof options.waitUntil !== 'function' && !process.env.VERCEL) return;
  try {
    const waitUntil = options.waitUntil || require('@vercel/functions').waitUntil;
    waitUntil(promise);
  } catch {
    // The durable finalizing job remains available to the next request if the
    // current runtime cannot extend this invocation.
  }
}

function scheduleDeletionFinalizationDrain(options = {}) {
  const force = options.force === true;
  const now = Number((options.nowMs || Date.now)());
  if (scheduledFinalizationDrain) {
    if (force) finalizationDrainRequestedAgain = true;
    return scheduledFinalizationDrain;
  }
  if (!force && now - lastFinalizationDrainAt < 30_000) {
    return Promise.resolve({ finalized: 0, failed: 0, throttled: true });
  }
  lastFinalizationDrainAt = now;
  const dependencies = options.dependencies || {};
  scheduledFinalizationDrain = resumeExpiredRunningDeletionJobs(dependencies)
    .then(() => finalizePendingDeletionJobs(dependencies))
    .finally(() => {
    scheduledFinalizationDrain = undefined;
    if (finalizationDrainRequestedAgain) {
      finalizationDrainRequestedAgain = false;
      void scheduleDeletionFinalizationDrain({
        force: true,
        dependencies,
        waitUntil: options.waitUntil
      }).catch(() => undefined);
    }
    });
  registerDeletionFinalizationContinuation(scheduledFinalizationDrain, options);
  return scheduledFinalizationDrain;
}

function createDeletePlayerAccountHandler(dependencies = {}) {
  const getDeletionPolicy = dependencies.readDeletionPolicy || readDeletionPolicy;
  const getSubjectId = dependencies.subjectPseudonym || subjectPseudonym;
  const openDatabase = dependencies.getDatabase || getDatabase;
  const writeJob = dependencies.updateJob || updateJob;
  const anonymizeStates = dependencies.anonymizeAuthoritativeStates || anonymizeAuthoritativeStates;
  const inventoryPlayer = dependencies.inventoryAuthoritativePlayer || inventoryAuthoritativePlayer;
  const inventoryFirebase = dependencies.inventoryFirebasePlayer || inventoryFirebasePlayer;
  const scrubTelemetry = dependencies.redactTelemetry || redactTelemetry;
  const deleteAnalyticalReports = dependencies.deleteAnalyticalReportsForAccounts || deleteAnalyticalReportsForAccounts;
  const deleteGameSessions = dependencies.deleteLinkedGameSessions || deleteLinkedGameSessions;
  const replaceLegacyClubStates = dependencies.replaceLinkedLegacyClubStates || replaceLinkedLegacyClubStates;
  const deleteIdentity = dependencies.deletePlayerIdentityData || deletePlayerIdentityData;
  const cleanupFirebase = dependencies.cleanupFirebasePlayer || cleanupFirebasePlayer;
  const createDeletionMarker = dependencies.markPlayerDeletion || markPlayerDeletion;
  const finalizeData = dependencies.finalizePlayerDataCleanup || finalizePlayerDataCleanup;
  const blockPublications = dependencies.blockAccountPublications || blockAccountPublications;
  const releasePublications = dependencies.releaseAccountPublications || releaseAccountPublications;
  const publicationsPublished = dependencies.areRequiredPublicationsPublished || areRequiredPublicationsPublished;
  const schedulePublications = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const loadAdminSdk = dependencies.getAdminSdk || getAdminSdk;
  const loadAdminApp = dependencies.getAdminApp || getAdminApp;
  const scheduleFinalization = dependencies.scheduleDeletionFinalizationDrain || scheduleDeletionFinalizationDrain;
  const readAuthoritativeState = dependencies.loadState || loadState;
  const nowMs = dependencies.nowMs || Date.now;
  const queueFinalization = () => {
    try {
      void Promise.resolve(scheduleFinalization({ force: true })).catch(() => undefined);
    } catch {
      // The durable finalizing job is the recovery source; request handling must
      // not replace it with a non-resumable failed marker if scheduling itself fails.
    }
  };
  return async function deletePlayerAccount(request, response) {
  response.set('cache-control', 'no-store');
  const policy = getDeletionPolicy();
  if (!policy) {
    response.status(503).json({
      ok: false,
      code: 'DELETION_POLICY_NOT_CONFIGURED',
      error: 'Account deletion is unavailable until the approved retention dispositions are configured.'
    });
    return;
  }
  const authTime = Number(request.orbitPlayer.auth_time || 0) * 1000;
  if (!authTime || nowMs() - authTime > 5 * 60 * 1000) {
    response.status(401).json({ ok: false, code: 'RECENT_LOGIN_REQUIRED', error: 'Sign in again before deleting this account.' });
    return;
  }

  const playerId = request.orbitPlayer.uid;
  const database = await openDatabase();
  let subjectId;
  try {
    subjectId = getSubjectId(playerId);
  } catch {
    response.status(503).json({
      ok: false,
      code: 'DELETION_PSEUDONYM_NOT_CONFIGURED',
      error: 'Account deletion pseudonymization is unavailable.'
    });
    return;
  }
  const retained = retainedCategories(policy);
  const leaseId = `delete_${(dependencies.randomUUID || crypto.randomUUID)().replace(/[^A-Za-z0-9_-]/g, '')}`;
  let currentStep = 'authoritative-inventory';
  let ownsRunningLease = false;
  const writeOwnedJob = async (status, step, result = {}, lastError = '') => {
    const outcome = await writeJob(
      database,
      playerId,
      subjectId,
      status,
      step,
      retained,
      result,
      lastError,
      {
        expectedLeaseId: leaseId,
        ...(status === 'running' ? { leaseId } : {}),
        nowMs
      }
    );
    if (outcome?.applied === false) throw new DeletionJobLeaseLostError();
    return outcome;
  };
  try {
    await createDeletionMarker(database, playerId, { nowMs });
    const started = await writeJob(
      database,
      playerId,
      subjectId,
      'running',
      currentStep,
      retained,
      {},
      '',
      { startOnly: true, leaseId, nowMs }
    );
    if (started?.applied === false) {
      const existing = started.record || {};
      const existingResult = publicDeletionResult(existing.result);
      if (existing.status === 'complete') {
        response.json({
          ok: true,
          status: 'complete',
          retainedCategories: Array.isArray(existing.retainedCategories) ? existing.retainedCategories : retained,
          ...existingResult
        });
        return;
      }
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Account deletion is already running on the server.',
        jobFinalization: 'scheduled',
        retainedCategories: Array.isArray(existing.retainedCategories) ? existing.retainedCategories : retained,
        ...existingResult
      });
      return;
    }
    ownsRunningLease = true;
    const resumeManifest = normalizeCleanupManifest(started?.record?.result?.cleanupManifest);
    const resumeRequirements = mergeRequiredPublications(started?.record?.result?.requiredPublications);
    const authoritativeInventory = await inventoryPlayer(playerId, subjectId, { database });
    const firebaseInventory = await inventoryFirebase(database, playerId, authoritativeInventory.linkedPlayerIds);
    const inventory = {
      affectedAccounts: authoritativeInventory.affectedAccounts,
      affectedAccountKeys: [...new Set([
        ...(authoritativeInventory.affectedAccountKeys || []),
        ...resumeManifest.affectedAccountKeys
      ])],
      affectedLegacyStateDocumentIds: [...new Set([
        ...(authoritativeInventory.affectedLegacyStateDocumentIds || []),
        ...resumeManifest.affectedLegacyStateDocumentIds
      ])],
      firebaseAffectedClubIds: [...new Set(firebaseInventory.affectedClubIds || [])],
      firebaseClubIds: [...new Set([...(firebaseInventory.clubIds || []), ...resumeManifest.firebaseClubIds])],
      linkedPlayerIds: [...new Set([
        ...(authoritativeInventory.linkedPlayerIds || []),
        ...(firebaseInventory.linkedPlayerIds || []),
        ...resumeManifest.linkedPlayerIds
      ])],
      sensitiveValues: [...new Set([
        ...(authoritativeInventory.sensitiveValues || []),
        ...(firebaseInventory.sensitiveValues || [])
      ])]
    };
    for (const identifier of inventory.linkedPlayerIds) {
      await createDeletionMarker(database, identifier, { nowMs });
    }
    const inventoryCleanupManifest = normalizeCleanupManifest({
      linkedPlayerIds: inventory.linkedPlayerIds,
      affectedAccountKeys: inventory.affectedAccountKeys,
      firebaseClubIds: [...new Set([...inventory.firebaseClubIds, ...inventory.firebaseAffectedClubIds])],
      affectedLegacyStateDocumentIds: inventory.affectedLegacyStateDocumentIds
    });
    currentStep = 'publication-fence';
    await writeOwnedJob('running', currentStep, {
      affectedAccounts: inventory.affectedAccounts,
      cleanupManifest: inventoryCleanupManifest,
      requiredPublications: resumeRequirements
    });
    await blockPublications(database, inventory.affectedAccountKeys, subjectId);
    currentStep = 'telemetry';
    await writeOwnedJob('running', currentStep, { affectedAccounts: inventory.affectedAccounts });
    await scrubTelemetry(database, inventory.linkedPlayerIds, inventory.sensitiveValues, subjectId);
    // Every cleanup below that depends on the discovered account/profile links
    // completes before either full legacy or authoritative state is removed.
    // A failed step can therefore re-inventory the same immutable links on retry.
    currentStep = 'firebase-game-sessions';
    await writeOwnedJob('running', currentStep, { affectedAccounts: inventory.affectedAccounts });
    const gameSessionCleanup = await deleteGameSessions(
      database,
      [...new Set([...inventory.firebaseClubIds, ...inventory.affectedAccountKeys])],
      inventory.linkedPlayerIds
    );
    const gameSessions = { deletedGameSessions: Number(gameSessionCleanup.deletedGameSessions || 0) };
    const reportAccountKeys = [...new Set([
      ...inventory.affectedAccountKeys,
      ...inventory.firebaseAffectedClubIds,
      ...(gameSessionCleanup.affectedClubIds || [])
    ])];
    currentStep = 'analytical-reports';
    await writeOwnedJob('running', currentStep, {
      affectedAccounts: inventory.affectedAccounts,
      ...gameSessions
    });
    const analyticalReports = await deleteAnalyticalReports(reportAccountKeys, { database });
    currentStep = 'identity-provider';
    await writeOwnedJob('running', currentStep, {
      affectedAccounts: inventory.affectedAccounts,
      ...analyticalReports,
      ...gameSessions
    });
    const identity = await deleteIdentity(playerId);
    currentStep = 'firebase-data';
    await writeOwnedJob('running', currentStep, {
      affectedAccounts: inventory.affectedAccounts,
      ...analyticalReports,
      ...gameSessions,
      ...identity
    });
    const deletedFirebaseDocuments = await cleanupFirebase(
      playerId,
      inventory.linkedPlayerIds,
      subjectId,
      policy,
      firebaseInventory
    );
    currentStep = 'legacy-state';
    await writeOwnedJob('running', currentStep, {
      affectedAccounts: inventory.affectedAccounts,
      deletedFirebaseDocuments,
      ...gameSessions,
      ...analyticalReports,
      ...identity
    });
    const legacyStates = await replaceLegacyClubStates(
      database,
      inventory.affectedLegacyStateDocumentIds,
      inventory.affectedAccountKeys,
      inventory.linkedPlayerIds,
      { nowMs }
    );
    currentStep = 'authoritative-state';
    await writeOwnedJob('running', currentStep, {
      affectedAccounts: inventory.affectedAccounts,
      deletedFirebaseDocuments,
      ...gameSessions,
      ...analyticalReports,
      ...legacyStates,
      ...identity
    });
    const authoritative = await anonymizeStates(playerId, subjectId, policy, {
      linkedPlayerIds: inventory.linkedPlayerIds,
      sensitiveValues: inventory.sensitiveValues
    });
    const { changedAccounts } = authoritative;
    const recoveredSafeRevisions = [];
    for (const accountKey of inventory.affectedAccountKeys) {
      const current = await readAuthoritativeState(accountKey);
      if (
        current?.state
        && (current.state.playerPrivacyTombstones || []).includes(subjectId)
        && Number.isInteger(Number(current.revision))
        && Number(current.revision) > 0
      ) {
        recoveredSafeRevisions.push({ accountKey, revision: Number(current.revision) });
      }
    }
    const requiredPublications = mergeRequiredPublications(
      resumeRequirements,
      authoritative.requiredPublications,
      recoveredSafeRevisions
    );
    const fencedAccounts = [...new Set([
      ...inventory.affectedAccountKeys,
      ...requiredPublications.map((requirement) => requirement.accountKey)
    ])];
    currentStep = 'projection-publication';
    const result = {
      changedAccounts,
      deletedFirebaseDocuments,
      ...gameSessions,
      ...analyticalReports,
      ...legacyStates,
      ...identity
    };
    const cleanupManifest = normalizeCleanupManifest({
      linkedPlayerIds: inventory.linkedPlayerIds,
      affectedAccountKeys: inventory.affectedAccountKeys,
      firebaseClubIds: [...new Set([
        ...inventory.firebaseClubIds,
        ...inventory.firebaseAffectedClubIds,
        ...(gameSessionCleanup.affectedClubIds || [])
      ])],
      affectedLegacyStateDocumentIds: inventory.affectedLegacyStateDocumentIds
    });
    const internalResult = { ...result, cleanupManifest, requiredPublications };
    await writeOwnedJob('running', currentStep, internalResult);
    await releasePublications(database, fencedAccounts, subjectId, requiredPublications);
    if (requiredPublications.length) {
      schedulePublicationWork(schedulePublications, dependencies.publicationDependencies || {});
    }
    await writeOwnedJob('finalizing', currentStep, internalResult);
    if (!await publicationsPublished(database, requiredPublications)) {
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Account data was removed, but the sanitized venue projection is still publishing on the server.',
        jobFinalization: 'scheduled',
        retainedCategories: retained,
        ...result
      });
      return;
    }
    if (Number(identity.identityProviderCleanupPending || 0) > 0) {
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Account data was removed, but identity-provider cleanup is still pending on the server.',
        jobFinalization: 'scheduled',
        retainedCategories: retained,
        ...result
      });
      return;
    }
    let preAuthCleanup;
    try {
      preAuthCleanup = await finalizeData(playerId, subjectId, policy, {
        database,
        ...cleanupManifest,
        inventoryAuthoritativePlayer: inventoryPlayer,
        inventoryFirebasePlayer: inventoryFirebase,
        deleteLinkedGameSessions: deleteGameSessions,
        deleteAnalyticalReportsForAccounts: deleteAnalyticalReports,
        replaceLinkedLegacyClubStates: replaceLegacyClubStates,
        cleanupFirebasePlayer: cleanupFirebase,
        anonymizeAuthoritativeStates: anonymizeStates,
        nowMs
      });
    } catch {
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Account access remains blocked while the server repeats the final account-data cleanup.',
        jobFinalization: 'scheduled',
        retainedCategories: retained,
        ...result
      });
      return;
    }
    const finalRequiredPublications = mergeRequiredPublications(
      requiredPublications,
      preAuthCleanup.requiredPublications
    );
    if (!await publicationsPublished(database, finalRequiredPublications)) {
      await writeJob(database, playerId, subjectId, 'finalizing', 'projection-publication', retained, {
        ...internalResult,
        ...preAuthCleanup,
        cleanupManifest,
        requiredPublications: finalRequiredPublications
      });
      schedulePublicationWork(schedulePublications, dependencies.publicationDependencies || {});
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Account data was removed, but the final sanitized venue projection is still publishing on the server.',
        jobFinalization: 'scheduled',
        retainedCategories: retained,
        ...result
      });
      return;
    }
    try {
      await deleteFirebaseAuthUser(playerId, { getAdminSdk: loadAdminSdk, getAdminApp: loadAdminApp });
    } catch (error) {
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Account data was removed, but Firebase account finalization is still pending on the server.',
        jobFinalization: 'scheduled',
        retainedCategories: retained,
        ...result
      });
      return;
    }
    try {
      const postAuthCleanup = await finalizeData(playerId, subjectId, policy, {
        database,
        ...cleanupManifest,
        inventoryAuthoritativePlayer: inventoryPlayer,
        inventoryFirebasePlayer: inventoryFirebase,
        deleteLinkedGameSessions: deleteGameSessions,
        deleteAnalyticalReportsForAccounts: deleteAnalyticalReports,
        replaceLinkedLegacyClubStates: replaceLegacyClubStates,
        cleanupFirebasePlayer: cleanupFirebase,
        anonymizeAuthoritativeStates: anonymizeStates,
        nowMs
      });
      const postAuthRequiredPublications = mergeRequiredPublications(
        finalRequiredPublications,
        postAuthCleanup.requiredPublications
      );
      if (!await publicationsPublished(database, postAuthRequiredPublications)) {
        await writeJob(database, playerId, subjectId, 'finalizing', 'projection-publication', retained, {
          ...internalResult,
          ...preAuthCleanup,
          ...postAuthCleanup,
          cleanupManifest,
          requiredPublications: postAuthRequiredPublications
        });
        schedulePublicationWork(schedulePublications, dependencies.publicationDependencies || {});
        queueFinalization();
        response.status(202).json({
          ok: true,
          status: 'pending',
          code: 'DELETION_FINALIZATION_PENDING',
          error: 'Firebase account access was removed, but the final sanitized venue projection is still publishing.',
          jobFinalization: 'scheduled',
          retainedCategories: retained,
          ...result
        });
        return;
      }
    } catch {
      // Firebase Auth is already gone. Keep the durable finalizing job and
      // persistent deletion barriers in place until a server replay completes
      // the post-auth cleanup.
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Firebase account access was removed, but the server is still finalizing account-data cleanup.',
        jobFinalization: 'scheduled',
        retainedCategories: retained,
        ...result
      });
      return;
    }
    try {
      await writeJob(database, playerId, subjectId, 'complete', 'complete', retained, result);
    } catch {
      // The durable finalizing record retains the UID only until the server-owned
      // replay worker observes Auth user-not-found and writes a clean terminal job.
      // Do not claim complete until that durable terminal state exists.
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Firebase account access was removed, but the server is still recording account deletion completion.',
        jobFinalization: 'scheduled',
        retainedCategories: retained,
        ...result
      });
      return;
    }
    response.json({ ok: true, status: 'complete', retainedCategories: retained, ...result });
  } catch (error) {
    if (error?.code === 'DELETION_JOB_LEASE_LOST') {
      queueFinalization();
      response.status(202).json({
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        error: 'Another server invocation is continuing account deletion.',
        jobFinalization: 'scheduled',
        retainedCategories: retained
      });
      return;
    }
    if (ownsRunningLease) {
      await writeJob(
        database,
        playerId,
        subjectId,
        dependencies.keepRunningJobForServerRetry === true ? 'running' : 'failed',
        currentStep,
        retained,
        {},
        error instanceof Error ? error.name : 'DeletionError',
        {
          expectedLeaseId: leaseId,
          ...(dependencies.keepRunningJobForServerRetry === true ? { leaseId } : {}),
          nowMs
        }
      );
    }
    throw error;
  }
  };
}

const deletePlayerAccount = createDeletePlayerAccountHandler();

module.exports = {
  analyticalReportContainsDeletedPlayer,
  anonymizeMatchedRecord,
  anonymizeAuthoritativeStates,
  anonymizePlayerState,
  cleanupFirebasePlayer,
  cleanupLegacyClubStateRequests,
  collectExactStructuredPlayerIdentifiers,
  deleteLinkedGameSessions,
  createDeletePlayerAccountHandler,
  deletePlayerAccount,
  enforcePlayerPrivacyTombstones,
  inventoryAuthoritativePlayer,
  inventoryFirebasePlayer,
  finalizePlayerDataCleanup,
  finalizePendingDeletionJobs,
  matchesPlayer,
  readDeletionPolicy,
  redactTelemetry,
  resumeExpiredRunningDeletionJobs,
  replaceLinkedLegacyClubStates,
  removeNotificationRecipient,
  retainedCategories,
  scheduleDeletionFinalizationDrain,
  updateJob,
  visitQueryPages
};
