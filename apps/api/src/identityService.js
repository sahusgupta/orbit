const crypto = require('crypto');
const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');
const { getStripe } = require('./services/stripeClient');
const { getAccountDeletionFinalizationScheduler } = require('./operations/accountDeletionFinalization');
const { loadState } = require('./database');
const {
  isPlayerDeletionMarkedInAdminDatabase,
  playerDeletionMarkerPath
} = require('./playerDeletionGuard');

function getRequiredMinimumAge() {
  return 18;
}

function normalizeRequiredMinimumAge(value) {
  return Number(value) === 18 ? 18 : 21;
}

async function resolveRequestMinimumAge(request, dependencies = {}) {
  const clubId = String(request.body?.clubId || request.query?.clubId || '').trim();
  if (!clubId) return 21;
  const record = await (dependencies.loadState || loadState)(clubId);
  return normalizeRequiredMinimumAge(record?.state?.settings?.clubAccount?.minimumPlayerAge);
}

function isMatchingSelfieRequired() {
  return process.env.ORBIT_IDENTITY_REQUIRE_SELFIE !== 'false';
}

function getIdentityServiceStatus() {
  return {
    configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.ORBIT_IDENTITY_RETURN_URL),
    minimumAge: getRequiredMinimumAge(),
    matchingSelfieRequired: isMatchingSelfieRequired(),
    verificationFlowConfigured: Boolean(process.env.STRIPE_IDENTITY_VERIFICATION_FLOW_ID)
  };
}

function identityDocumentPath(playerId) {
  return `players/${playerId}/private/identity`;
}

const identityProviderCleanupCollection = 'orbitIdentityProviderCleanup';

function identityProviderCleanupPath(providerSessionId) {
  const sessionId = String(providerSessionId || '').trim();
  if (!sessionId) throw new Error('A provider session ID is required for identity cleanup.');
  return `${identityProviderCleanupCollection}/${crypto.createHash('sha256').update(sessionId).digest('hex')}`;
}

const cameraCaptureKeys = new Set(['fullName', 'dateOfBirth', 'address', 'mutationId']);
const forbiddenCaptureKeyPattern = /(image|photo|selfie|barcode|pdf417|id.?number|document.?number|license.?number|raw)/i;
const opaqueIdentityMutationPattern = /^identity_[A-Za-z0-9_-]{16,171}$/;

function normalizeCameraCapture(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A valid identity capture body is required.' };
  }
  const keys = Object.keys(body);
  const rejectedKey = keys.find((key) => !cameraCaptureKeys.has(key) || forbiddenCaptureKeyPattern.test(key));
  if (rejectedKey) {
    return { ok: false, error: 'Identity capture accepts only extracted name, date of birth, address, and mutation ID.' };
  }
  const values = keys.map((key) => body[key]);
  if (values.some((value) => typeof value === 'string' && (/^data:/i.test(value.trim()) || value.length > 4_096))) {
    return { ok: false, error: 'Raw identity media is not accepted.' };
  }
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ') : '';
  const dateOfBirth = typeof body.dateOfBirth === 'string' ? body.dateOfBirth.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim().replace(/\s+/g, ' ') : '';
  const mutationId = typeof body.mutationId === 'string' ? body.mutationId.trim() : '';
  if (!fullName || fullName.length > 120 || !address || address.length > 300 || !mutationId || mutationId.length > 180) {
    return { ok: false, error: 'Name, address, and a valid mutation ID are required.' };
  }
  if (!opaqueIdentityMutationPattern.test(mutationId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return { ok: false, error: 'Date of birth or mutation ID is invalid.' };
  }
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return { ok: false, error: 'Date of birth is invalid.' };
  }
  const age = calculateAgeFromDate({ year, month, day }, now);
  if (age == null) return { ok: false, error: 'Date of birth is invalid.' };
  return { ok: true, value: { fullName, dateOfBirth, address, mutationId, age } };
}

function calculateAgeFromDate(dateOfBirth, today = new Date()) {
  const year = Number(dateOfBirth?.year);
  const month = Number(dateOfBirth?.month);
  const day = Number(dateOfBirth?.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 125 ? age : null;
}

function getAgeLevel(age) {
  if (age >= 21) return 21;
  if (age >= 18) return 18;
  return 0;
}

function formatDateOfBirth(dateOfBirth) {
  const year = Number(dateOfBirth?.year);
  const month = Number(dateOfBirth?.month);
  const day = Number(dateOfBirth?.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatVerifiedAddress(address) {
  if (!address || typeof address !== 'object') return '';
  const region = [address.state, address.postal_code].filter(Boolean).join(' ');
  const locality = [address.city, region].filter(Boolean).join(', ');
  return [address.line1, address.line2, locality, address.country]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function getVerifiedDetails(verifiedOutputs = {}) {
  const fullName = [verifiedOutputs.first_name, verifiedOutputs.last_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return {
    fullName,
    dateOfBirth: formatDateOfBirth(verifiedOutputs.dob),
    address: formatVerifiedAddress(verifiedOutputs.address)
  };
}

function getCurrentVerifiedAge(record, now = new Date()) {
  const dateOfBirth = String(record?.verifiedDetails?.dateOfBirth || '');
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  return calculateAgeFromDate({ year, month, day }, now);
}

function getPublicIdentityStatus(record = {}, now = new Date()) {
  const verifiedAt = typeof record.verifiedAt === 'string'
    ? record.verifiedAt
    : typeof record.verifiedAt?.toDate === 'function'
      ? record.verifiedAt.toDate().toISOString()
      : null;
  const currentVerifiedAge = getCurrentVerifiedAge(record, now);
  const ageLevel = currentVerifiedAge == null ? Number(record.ageLevel || 0) : getAgeLevel(currentVerifiedAge);
  const ageEligible = (record.status === 'verified' && record.ageVerified === true) ||
    (record.status === 'provisional' && record.ageEligible === true);
  return {
    status: record.status || 'unverified',
    ageVerified: record.status === 'verified' && record.ageVerified === true && ageLevel >= getRequiredMinimumAge(),
    ageEligible: ageEligible && ageLevel >= getRequiredMinimumAge(),
    ageLevel,
    minimumAge: getRequiredMinimumAge(),
    verifiedAt,
    reviewStatus: typeof record.reviewStatus === 'string'
      ? record.reviewStatus
      : record.status === 'verified'
        ? 'approved'
        : 'not-started',
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : null,
    failureCode: record.failureCode || null,
    verifiedDetails: ['verified', 'provisional'].includes(record.status) && record.ageEligible !== false && record.verifiedDetails
      ? {
          fullName: String(record.verifiedDetails.fullName || ''),
          dateOfBirth: String(record.verifiedDetails.dateOfBirth || ''),
          address: String(record.verifiedDetails.address || '')
        }
      : null
  };
}

function buildEligibilityUpdate(session, event, minimumAge = getRequiredMinimumAge(), now = new Date()) {
  const base = {
    provider: 'stripe_identity',
    providerSessionId: String(session?.id || ''),
    providerStatus: String(session?.status || ''),
    lastStripeEventId: String(event?.id || ''),
    lastStripeEventCreated: Number(event?.created || Math.floor(now.getTime() / 1000)),
    livemode: session?.livemode === true,
    failureCode: session?.last_error?.code ? String(session.last_error.code) : null
  };

  if (session?.status === 'verified') {
    const age = calculateAgeFromDate(session.verified_outputs?.dob, now);
    if (age == null) {
      return {
        ...base,
        status: 'requires_input',
        ageVerified: false,
        ageLevel: 0,
        failureCode: 'date_of_birth_unavailable'
      };
    }
    const ageLevel = getAgeLevel(age);
    return {
      ...base,
      status: age >= minimumAge ? 'verified' : 'underage',
      ageVerified: age >= minimumAge,
      ageLevel,
      verifiedAt: now.toISOString(),
      failureCode: age >= minimumAge ? null : 'minimum_age_not_met',
      verifiedDetails: age >= minimumAge ? getVerifiedDetails(session.verified_outputs) : null
    };
  }

  return {
    ...base,
    status: ['processing', 'requires_input', 'canceled'].includes(session?.status)
      ? session.status
      : 'unverified',
    ageVerified: false,
    ageLevel: 0
  };
}

async function persistEligibilityUpdate(playerId, update, dependencies = {}) {
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const database = dependencies.database || admin.firestore(app);
  const reference = database.doc(identityDocumentPath(playerId));
  const markerReference = database.doc(playerDeletionMarkerPath(playerId));
  let applied = false;
  let deletionBlocked = false;
  let effectiveRecord = {};
  await database.runTransaction(async (transaction) => {
    const markerSnapshot = await transaction.get(markerReference);
    if (markerSnapshot.exists) {
      deletionBlocked = true;
      return;
    }
    const currentSnapshot = await transaction.get(reference);
    const current = currentSnapshot.data() || {};
    const currentEventCreated = Number(current.lastStripeEventCreated || 0);
    const nextEventCreated = Number(update.lastStripeEventCreated || 0);
    const currentSessionId = String(current.providerSessionId || '');
    const nextSessionId = String(update.providerSessionId || '');
    const belongsToOlderSession = Boolean(currentSessionId && nextSessionId && currentSessionId !== nextSessionId);
    const currentResultIsTerminal = ['verified', 'underage'].includes(current.status) && update.status !== 'redacted';
    const shouldIgnore =
      current.status === 'redacted' ||
      belongsToOlderSession ||
      currentResultIsTerminal ||
      currentEventCreated > nextEventCreated ||
      (currentEventCreated === nextEventCreated && current.lastStripeEventId === update.lastStripeEventId);
    if (shouldIgnore) {
      effectiveRecord = current;
      return;
    }
    effectiveRecord = { ...current, ...update };
    transaction.set(reference, {
      ...update,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    applied = true;
  });
  if (deletionBlocked) return false;
  const auth = admin.auth(app);
  try {
    const user = await auth.getUser(playerId);
    await auth.setCustomUserClaims(playerId, {
      ...(user.customClaims || {}),
      ageVerified: effectiveRecord.status === 'verified' && effectiveRecord.ageVerified === true,
      ageLevel: Number(effectiveRecord.ageLevel || 0)
    });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
  return applied;
}

async function handleStripeIdentityEvent(event, dependencies = {}) {
  const supportedEvents = new Set([
    'identity.verification_session.processing',
    'identity.verification_session.verified',
    'identity.verification_session.requires_input',
    'identity.verification_session.canceled',
    'identity.verification_session.redacted'
  ]);
  if (!supportedEvents.has(event?.type)) return false;

  let session = event.data?.object || {};
  const purpose = String(session.metadata?.purpose || '').trim();
  if (purpose && purpose !== 'orbit_player_age_verification') return false;
  if (event.type !== 'identity.verification_session.redacted' && purpose !== 'orbit_player_age_verification') return false;
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const database = dependencies.database || admin.firestore(app);
  let completedProviderCleanup = 0;
  if (event.type === 'identity.verification_session.redacted' && session.id) {
    const completeCleanup = dependencies.completeIdentityProviderCleanupForSession
      || completeIdentityProviderCleanupForSession;
    completedProviderCleanup = await completeCleanup(String(session.id), {
      ...dependencies,
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => app
    });
  }
  let playerId = purpose === 'orbit_player_age_verification'
    ? String(session.metadata?.playerId || session.metadata?.user_id || session.client_reference_id || '').trim()
    : '';
  if (!playerId && event.type === 'identity.verification_session.redacted' && session.id) {
    const matches = await database
      .collectionGroup('private')
      .where('providerSessionId', '==', String(session.id))
      .limit(5)
      .get();
    const identityDocument = matches.docs.find((document) => {
      const path = document.ref.path.split('/');
      return path.length === 4 && path[0] === 'players' && path[2] === 'private' && path[3] === 'identity';
    });
    playerId = identityDocument?.ref.path.split('/')[1] || '';
  }
  if (!playerId) return completedProviderCleanup > 0;
  const checkDeletionMarker = dependencies.isPlayerDeletionMarkedInAdminDatabase
    || isPlayerDeletionMarkedInAdminDatabase;
  if (await checkDeletionMarker(database, playerId)) return completedProviderCleanup > 0;
  const persistUpdate = dependencies.persistEligibilityUpdate
    || ((id, update) => persistEligibilityUpdate(id, update, { ...dependencies, database }));

  if (event.type === 'identity.verification_session.redacted') {
    await persistUpdate(playerId, {
      status: 'redacted',
      ageVerified: false,
      ageLevel: 0,
      provider: 'stripe_identity',
      providerSessionId: String(session.id || ''),
      providerStatus: 'redacted',
      verifiedAt: null,
      failureCode: null,
      verifiedDetails: null,
      lastStripeEventId: String(event.id || ''),
      lastStripeEventCreated: Number(event.created || Math.floor(Date.now() / 1000))
    });
    return true;
  }

  if (event.type === 'identity.verification_session.verified') {
    session = await (dependencies.getStripe || getStripe)().identity.verificationSessions.retrieve(session.id, {
      expand: ['verified_outputs']
    });
  }

  const update = buildEligibilityUpdate(session, event);
  await persistUpdate(playerId, update);
  return true;
}

async function readIdentityRecord(playerId) {
  const admin = getAdminSdk();
  const snapshot = await admin.firestore(getAdminApp()).doc(identityDocumentPath(playerId)).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function getPlayerIdentityStatus(request, response) {
  response.set('cache-control', 'no-store');
  const record = await readIdentityRecord(request.orbitPlayer.uid);
  response.json({ ok: true, identity: getPublicIdentityStatus(record) });
}

function getTrustedIdentitySummary(record = {}) {
  const status = getPublicIdentityStatus(record);
  return {
    fullName: status.verifiedDetails?.fullName || '',
    dateOfBirth: status.verifiedDetails?.dateOfBirth || '',
    address: status.verifiedDetails?.address || '',
    ageLevel: status.ageLevel,
    captureMethod: record.captureMethod === 'camera-pdf417' ? 'player-camera-pdf417' : 'provider',
    capturedAt: status.capturedAt || status.verifiedAt || '',
    reviewStatus: status.reviewStatus === 'approved' ? 'Approved' : 'Pending'
  };
}

function buildCameraIdentityRecord(current, capture, capturedAt) {
  const ageLevel = getAgeLevel(capture.age);
  const ageEligible = ageLevel >= getRequiredMinimumAge();
  const providerSessionIds = Array.from(new Set([
    ...(Array.isArray(current?.providerSessionIds) ? current.providerSessionIds : []),
    current?.providerSessionId
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  return {
    status: ageEligible ? 'provisional' : 'underage',
    ageVerified: false,
    ageEligible,
    ageLevel: ageEligible ? ageLevel : 0,
    reviewStatus: ageEligible ? 'pending-in-person' : 'not-started',
    captureMethod: 'camera-pdf417',
    capturedAt: capturedAt.toISOString(),
    captureMutationId: capture.mutationId,
    failureCode: ageEligible ? null : 'minimum_age_not_met',
    verifiedDetails: ageEligible
      ? { fullName: capture.fullName, dateOfBirth: capture.dateOfBirth, address: capture.address }
      : null,
    ...(providerSessionIds.length ? { providerSessionIds } : {}),
    ...(current?.providerSessionId ? { providerSessionId: String(current.providerSessionId) } : {}),
    ...(current?.provider ? { provider: String(current.provider) } : {})
  };
}

function sendIdentityDeletionBlocked(response) {
  response.status(410).json({
    ok: false,
    code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS',
    error: 'This player account is being deleted and can no longer create or restore data.'
  });
}

async function writeIdentityUnlessDeletionBlocked(database, markerReference, operation, deletionOperation) {
  let deletionBlocked = false;
  let value;
  await database.runTransaction(async (transaction) => {
    const markerSnapshot = await transaction.get(markerReference);
    if (markerSnapshot.exists) {
      deletionBlocked = true;
      if (typeof deletionOperation === 'function') await deletionOperation(transaction);
      return;
    }
    value = await operation(transaction);
  });
  return { deletionBlocked, value };
}

async function capturePlayerIdentity(request, response, dependencies = {}) {
  response.set('cache-control', 'no-store');
  const capturedAt = new Date(Number((dependencies.nowMs || Date.now)()));
  const normalized = normalizeCameraCapture(request.body, capturedAt);
  if (!normalized.ok) {
    response.status(400).json({ ok: false, error: normalized.error });
    return;
  }
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const database = dependencies.database || admin.firestore(app);
  const reference = database.doc(identityDocumentPath(request.orbitPlayer.uid));
  const markerReference = database.doc(playerDeletionMarkerPath(request.orbitPlayer.uid));
  const { mutationId } = normalized.value;
  let record;
  const committed = await writeIdentityUnlessDeletionBlocked(database, markerReference, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    if (current.captureMutationId === mutationId) {
      record = current;
      return;
    }
    record = buildCameraIdentityRecord(current, normalized.value, capturedAt);
    transaction.set(reference, {
      ...record,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: false });
  });
  if (committed.deletionBlocked) {
    sendIdentityDeletionBlocked(response);
    return;
  }
  response.status(201).json({ ok: true, identity: getPublicIdentityStatus(record) });
}

async function deletePlayerIdentityData(playerId, dependencies = {}) {
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const database = dependencies.database || admin.firestore(app);
  const reference = database.doc(identityDocumentPath(playerId));
  const snapshot = await reference.get();
  const record = snapshot.exists ? snapshot.data() || {} : {};
  const providerSessionIds = Array.from(new Set([
    ...(Array.isArray(record.providerSessionIds) ? record.providerSessionIds : []),
    record.providerSessionId
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  for (const providerSessionId of providerSessionIds) {
    const cleanupReference = database.doc(identityProviderCleanupPath(providerSessionId));
    await cleanupReference.set(buildIdentityProviderCleanupRecord(admin, {
      providerSessionId,
      reason: 'identity-redaction',
      cleanupMode: 'redact',
      deletionMarkerRef: playerDeletionMarkerPath(playerId),
      notBeforeMs: 0
    }), { merge: true });
  }

  try {
    const user = await admin.auth(app).getUser(playerId);
    await admin.auth(app).setCustomUserClaims(playerId, {
      ...(user.customClaims || {}),
      ageVerified: false,
      ageLevel: 0
    });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
  await reference.delete();
  const cleanupProviderIntents = dependencies.cleanupIdentityProviderIntentsForPlayer
    || cleanupIdentityProviderIntentsForPlayer;
  const providerCleanup = await cleanupProviderIntents(playerId, {
    ...dependencies,
    database,
    getAdminSdk: () => admin,
    getAdminApp: () => app
  });
  return { redactionRequested: providerSessionIds.length > 0, ...providerCleanup };
}

async function compensateIdentitySession(session, stripe, options = {}) {
  const sessions = stripe?.identity?.verificationSessions;
  if (!session?.id || !sessions) return false;
  const requireRedaction = options.requireRedaction === true;
  let current = session;
  if (!current.status && typeof sessions.retrieve === 'function') {
    try {
      current = await sessions.retrieve(session.id);
      const redactionStatus = String(current?.redaction?.status || '');
      if (redactionStatus === 'redacted') return true;
      if (redactionStatus === 'processing') return false;
      if (!requireRedaction && current?.status === 'canceled') return true;
    } catch (error) {
      if (error?.code === 'resource_missing') return true;
    }
  }
  if (!requireRedaction) {
    try {
      if (typeof sessions.cancel === 'function') {
        const canceled = await sessions.cancel(session.id);
        if (canceled?.status === 'canceled') return true;
      }
    } catch (error) {
      if (error?.code === 'resource_missing') return true;
      // Redaction is the secondary cleanup path for an abandoned creation session.
    }
  }
  try {
    if (typeof sessions.redact === 'function') {
      const redacted = await sessions.redact(session.id);
      return String(redacted?.redaction?.status || '') === 'redacted';
    }
  } catch (error) {
    if (error?.code === 'resource_missing') return true;
    // The local deletion marker still prevents any provider callback from restoring Player data.
  }
  return false;
}

function buildIdentityProviderCleanupRecord(admin, input) {
  return {
    provider: 'stripe_identity',
    providerSessionId: String(input.providerSessionId || ''),
    status: 'pending',
    reason: String(input.reason || 'identity-session-create'),
    cleanupMode: input.cleanupMode === 'redact' ? 'redact' : 'compensate',
    deletionMarkerRef: String(input.deletionMarkerRef || ''),
    idempotencyKey: String(input.idempotencyKey || ''),
    createParams: input.createParams || {},
    notBeforeMs: Number(input.notBeforeMs || 0),
    attempts: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function listIdentityProviderCleanupDocuments(database, playerId) {
  const markerPath = playerDeletionMarkerPath(playerId);
  const collection = database.collection(identityProviderCleanupCollection);
  const selectors = [
    ['deletionMarkerRef', markerPath],
    ['createParams.client_reference_id', playerId],
    ['createParams.metadata.playerId', playerId]
  ];
  const documents = new Map();
  for (const [field, value] of selectors) {
    const snapshot = await collection.where(field, '==', value).limit(100).get();
    for (const document of snapshot.docs || []) {
      const key = String(document.ref?.path || document.id || '');
      if (key && !documents.has(key)) documents.set(key, document);
    }
  }
  return [...documents.values()];
}

function cleanupAttemptIncrement(admin, currentAttempts) {
  return typeof admin.firestore.FieldValue.increment === 'function'
    ? admin.firestore.FieldValue.increment(1)
    : Number(currentAttempts || 0) + 1;
}

function wakeDeletionFinalizationAfterIdentityCleanup(dependencies = {}) {
  const scheduleFinalization = dependencies.scheduleDeletionFinalizationDrain
    || getAccountDeletionFinalizationScheduler();
  if (typeof scheduleFinalization !== 'function') return false;
  try {
    void Promise.resolve(scheduleFinalization({ force: true })).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function completeIdentityProviderCleanupForSession(providerSessionId, dependencies = {}) {
  const sessionId = String(providerSessionId || '').trim();
  if (!sessionId) return 0;
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const database = dependencies.database || admin.firestore(app);
  const snapshot = await database.collection(identityProviderCleanupCollection)
    .where('providerSessionId', '==', sessionId)
    .limit(100)
    .get();
  let completed = 0;
  for (const document of snapshot.docs || []) {
    await document.ref.delete();
    completed += 1;
  }
  if (completed > 0) wakeDeletionFinalizationAfterIdentityCleanup(dependencies);
  return completed;
}

async function cleanupIdentityProviderIntentsForPlayer(playerId, dependencies = {}) {
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const database = dependencies.database || admin.firestore(app);
  const listCleanupDocuments = dependencies.listIdentityProviderCleanupDocuments
    || listIdentityProviderCleanupDocuments;
  const documents = await listCleanupDocuments(database, playerId);
  if (!documents.length) {
    return { identityProviderCleanupPending: 0, identityProviderCleanupCompleted: 0 };
  }

  let stripe;
  try {
    stripe = (dependencies.getStripe || getStripe)();
  } catch {
    stripe = null;
  }
  const nowMs = Number((dependencies.nowMs || Date.now)());
  let pending = 0;
  let completed = 0;
  for (const document of documents) {
    const record = document.data() || {};
    // A future timestamp is the creator's lease. Deletion remains pending
    // instead of racing a provider call that began before the deletion marker.
    if (Number(record.notBeforeMs || 0) > nowMs) {
      pending += 1;
      continue;
    }
    let providerSessionId = String(record.providerSessionId || '').trim();
    try {
      if (
        !providerSessionId
        && stripe
        && record.createParams
        && typeof record.createParams === 'object'
        && String(record.idempotencyKey || '').trim()
      ) {
        const replayed = await stripe.identity.verificationSessions.create(record.createParams, {
          idempotencyKey: String(record.idempotencyKey)
        });
        providerSessionId = String(replayed?.id || '').trim();
      }
      if (providerSessionId && typeof document.ref.set === 'function') {
        await document.ref.set({
          providerSessionId,
          reason: 'player-account-deletion',
          status: 'pending',
          notBeforeMs: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      const cleaned = providerSessionId && stripe
        ? await compensateIdentitySession({ id: providerSessionId }, stripe, {
            requireRedaction: record.cleanupMode === 'redact'
          })
        : false;
      if (cleaned && typeof document.ref.delete === 'function') {
        await document.ref.delete();
        completed += 1;
        continue;
      }
    } catch {
      // The durable intent remains the recovery source for the next retry.
    }
    pending += 1;
    if (typeof document.ref.set === 'function') {
      try {
        await document.ref.set({
          reason: 'player-account-deletion',
          status: 'pending',
          notBeforeMs: 0,
          attempts: cleanupAttemptIncrement(admin, record.attempts),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch {
        // The existing creation intent remains durable even if this update fails.
      }
    }
  }
  if (pending) {
    const scheduleCleanup = dependencies.scheduleIdentityProviderCleanupDrain
      || scheduleIdentityProviderCleanupDrain;
    try {
      void Promise.resolve(scheduleCleanup({ force: true })).catch(() => undefined);
    } catch {
      // The next request will retry the still-durable intent.
    }
  }
  if (completed > 0) wakeDeletionFinalizationAfterIdentityCleanup(dependencies);
  return { identityProviderCleanupPending: pending, identityProviderCleanupCompleted: completed };
}

async function drainIdentityProviderCleanupQueue(dependencies = {}) {
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const database = dependencies.database || admin.firestore(app);
  const limit = Math.min(Math.max(Number(dependencies.limit || 25), 1), 100);
  const snapshot = await database.collection(identityProviderCleanupCollection)
    .where('status', '==', 'pending')
    .limit(limit)
    .get();
  if (!snapshot.docs.length) return { processed: 0, completed: 0, failed: 0, deferred: 0 };
  let stripe;
  try {
    stripe = (dependencies.getStripe || getStripe)();
  } catch {
    stripe = null;
  }
  let completed = 0;
  let failed = 0;
  let deferred = 0;
  const nowMs = Number((dependencies.nowMs || Date.now)());
  for (const document of snapshot.docs) {
    const record = document.data() || {};
    let providerSessionId = String(record.providerSessionId || '').trim();
    // `notBeforeMs` is the active creator's lease. A provider reference may be
    // written before the identity transaction commits, so its presence must not
    // let another request cancel a session that is still being returned safely.
    if (Number(record.notBeforeMs || 0) > nowMs) {
      deferred += 1;
      continue;
    }
    let cleaned = false;
    try {
      if (
        !providerSessionId
        && stripe
        && record.createParams
        && typeof record.createParams === 'object'
        && String(record.idempotencyKey || '').trim()
      ) {
        const replayed = await stripe.identity.verificationSessions.create(record.createParams, {
          idempotencyKey: String(record.idempotencyKey)
        });
        providerSessionId = String(replayed?.id || '').trim();
        if (providerSessionId) {
          await document.ref.set({
            providerSessionId,
            notBeforeMs: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
      cleaned = providerSessionId && stripe
        ? await compensateIdentitySession({ id: providerSessionId }, stripe, {
            requireRedaction: record.cleanupMode === 'redact'
          })
        : false;
    } catch {
      cleaned = false;
    }
    if (cleaned) {
      await document.ref.delete();
      completed += 1;
      continue;
    }
    await document.ref.set({
      status: 'pending',
      attempts: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    failed += 1;
  }
  if (completed > 0) wakeDeletionFinalizationAfterIdentityCleanup(dependencies);
  return { processed: snapshot.docs.length, completed, failed, deferred };
}

let scheduledIdentityProviderCleanupDrain;
let identityProviderCleanupDrainRequestedAgain = false;
let identityProviderCleanupDrainRequestedOptions;
let lastIdentityProviderCleanupDrainAt = 0;

function registerIdentityProviderCleanupContinuation(promise, options = {}) {
  if (typeof options.waitUntil !== 'function' && !process.env.VERCEL) return;
  try {
    const waitUntil = options.waitUntil || require('@vercel/functions').waitUntil;
    waitUntil(promise);
  } catch {
    // The durable cleanup intent remains available to the next request.
  }
}

function scheduleIdentityProviderCleanupDrain(options = {}) {
  const force = options.force === true;
  const nowMs = Number((options.nowMs || Date.now)());
  if (scheduledIdentityProviderCleanupDrain) {
    if (force) {
      identityProviderCleanupDrainRequestedAgain = true;
      identityProviderCleanupDrainRequestedOptions = options;
    }
    return scheduledIdentityProviderCleanupDrain;
  }
  if (!options.dependencies?.database && !process.env.STRIPE_SECRET_KEY) {
    return Promise.resolve({ processed: 0, completed: 0, failed: 0, deferred: 0, unavailable: true });
  }
  if (!force && nowMs - lastIdentityProviderCleanupDrainAt < 30_000) {
    return Promise.resolve({ processed: 0, completed: 0, failed: 0, deferred: 0, throttled: true });
  }
  lastIdentityProviderCleanupDrainAt = nowMs;
  scheduledIdentityProviderCleanupDrain = drainIdentityProviderCleanupQueue(options.dependencies || {})
    .catch(() => ({ processed: 0, completed: 0, failed: 1, deferred: 0 }))
    .finally(() => {
      scheduledIdentityProviderCleanupDrain = undefined;
      if (identityProviderCleanupDrainRequestedAgain) {
        const nextOptions = identityProviderCleanupDrainRequestedOptions || options;
        identityProviderCleanupDrainRequestedAgain = false;
        identityProviderCleanupDrainRequestedOptions = undefined;
        void scheduleIdentityProviderCleanupDrain({
          ...nextOptions,
          force: true
        }).catch(() => undefined);
      }
    });
  registerIdentityProviderCleanupContinuation(scheduledIdentityProviderCleanupDrain, options);
  return scheduledIdentityProviderCleanupDrain;
}

async function finishQueuedIdentityProviderCleanup(session, stripe, cleanupReference, scheduleCleanup, updates = {}) {
  if (typeof cleanupReference.set === 'function') {
    try {
      await cleanupReference.set({
        providerSessionId: String(session?.id || ''),
        status: 'pending',
        notBeforeMs: 0,
        ...updates
      }, { merge: true });
    } catch {
      // The pre-create intent still has the deterministic idempotency parameters needed for replay.
    }
  }
  const cleaned = await compensateIdentitySession(session, stripe);
  if (cleaned && typeof cleanupReference.delete === 'function') {
    try {
      await cleanupReference.delete();
      return true;
    } catch {
      // A retained queue record is safe; the background drain can confirm cleanup and remove it.
    }
  }
  void Promise.resolve().then(() => scheduleCleanup({ force: true })).catch(() => undefined);
  return cleaned;
}

async function createPlayerIdentitySession(request, response, dependencies = {}) {
  response.set('cache-control', 'no-store');
  const admin = (dependencies.getAdminSdk || getAdminSdk)();
  const app = (dependencies.getAdminApp || getAdminApp)();
  const playerId = request.orbitPlayer.uid;
  const returnUrl = String(process.env.ORBIT_IDENTITY_RETURN_URL || '').trim();
  if (!returnUrl || !process.env.STRIPE_SECRET_KEY) {
    response.status(503).json({ ok: false, error: 'Stripe Identity is not configured for Orbit Player.' });
    return;
  }

  const database = dependencies.database || admin.firestore(app);
  const reference = database.doc(identityDocumentPath(playerId));
  const markerReference = database.doc(playerDeletionMarkerPath(playerId));
  const checkDeletionMarker = dependencies.isPlayerDeletionMarkedInAdminDatabase
    || isPlayerDeletionMarkedInAdminDatabase;
  if (await checkDeletionMarker(database, playerId)) {
    sendIdentityDeletionBlocked(response);
    return;
  }
  const currentSnapshot = await reference.get();
  let current = currentSnapshot.data() || {};

  if (current.status === 'verified' && current.ageVerified === true) {
    response.json({ ok: true, identity: getPublicIdentityStatus(current), alreadyVerified: true });
    return;
  }
  if (current.status === 'underage') {
    response.status(403).json({
      ok: false,
      code: 'MINIMUM_AGE_NOT_MET',
      error: `You must meet Orbit's minimum age of ${getRequiredMinimumAge()} to use player access features.`,
      identity: getPublicIdentityStatus(current)
    });
    return;
  }

  if (current.providerSessionId && ['requires_input', 'processing'].includes(current.status)) {
    const stripe = (dependencies.getStripe || getStripe)();
    const existingSession = await stripe.identity.verificationSessions.retrieve(current.providerSessionId, {
      expand: ['verified_outputs']
    });
    if (existingSession.status === 'verified') {
      const reconciledAt = new Date();
      await (dependencies.persistEligibilityUpdate || persistEligibilityUpdate)(playerId, buildEligibilityUpdate(existingSession, {
        id: `orbit_identity_reconcile_${existingSession.id}_${reconciledAt.getTime()}`,
        created: Math.floor(reconciledAt.getTime() / 1000)
      }, getRequiredMinimumAge(), reconciledAt), { ...dependencies, database });
      if (await checkDeletionMarker(database, playerId)) {
        sendIdentityDeletionBlocked(response);
        return;
      }
      current = await (dependencies.readIdentityRecord || readIdentityRecord)(playerId);
      response.json({
        ok: true,
        identity: getPublicIdentityStatus(current),
        alreadyVerified: current.status === 'verified' && current.ageVerified === true
      });
      return;
    }

    const reconciled = await writeIdentityUnlessDeletionBlocked(database, markerReference, async (transaction) => {
      transaction.set(reference, {
        status: existingSession.status,
        providerStatus: existingSession.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    if (reconciled.deletionBlocked) {
      sendIdentityDeletionBlocked(response);
      return;
    }
    current = { ...current, status: existingSession.status };

    if (['requires_input', 'processing'].includes(existingSession.status)) {
      response.status(existingSession.status === 'processing' ? 202 : 200).json({
        ok: true,
        verificationUrl: existingSession.url || null,
        returnUrl,
        identity: getPublicIdentityStatus(current)
      });
      return;
    }
  }

  const attemptCount = Number(current.attemptCount || 0) + 1;
  if (attemptCount > 5) {
    response.status(429).json({ ok: false, error: 'Identity verification attempt limit reached. Contact Orbit support.' });
    return;
  }

  const verificationFlow = String(process.env.STRIPE_IDENTITY_VERIFICATION_FLOW_ID || '').trim();
  const createParams = {
    client_reference_id: playerId,
    return_url: returnUrl,
    metadata: {
      playerId,
      purpose: 'orbit_player_age_verification'
    },
    ...(verificationFlow
      ? { verification_flow: verificationFlow }
      : {
          type: /** @type {'document'} */ ('document'),
          options: {
            document: {
              require_live_capture: true,
              ...(isMatchingSelfieRequired() ? { require_matching_selfie: true } : {})
            }
          }
        })
  };
  const attemptRef = crypto.createHash('sha256')
    .update(`orbit-player-identity\u0000${playerId}\u0000${attemptCount}`)
    .digest('hex');
  const idempotencyKey = `orbit-player-identity-${attemptRef}`;
  const intentStartedAtMs = Number((dependencies.nowMs || Date.now)());
  const intentNotBeforeMs = (Number.isFinite(intentStartedAtMs) ? intentStartedAtMs : Date.now()) + 2 * 60_000;
  const cleanupReference = database.doc(identityProviderCleanupPath(attemptRef));
  const cleanupRecord = (input = {}) => buildIdentityProviderCleanupRecord(admin, {
    idempotencyKey,
    createParams,
    notBeforeMs: intentNotBeforeMs,
    deletionMarkerRef: String(markerReference.path || ''),
    ...input
  });
  const scheduleCleanup = dependencies.scheduleIdentityProviderCleanupDrain
    || scheduleIdentityProviderCleanupDrain;
  const intent = await writeIdentityUnlessDeletionBlocked(database, markerReference, async (transaction) => {
    transaction.set(cleanupReference, cleanupRecord(), { merge: false });
  });
  if (intent.deletionBlocked) {
    sendIdentityDeletionBlocked(response);
    return;
  }

  let stripe;
  let session;
  try {
    stripe = (dependencies.getStripe || getStripe)();
    session = await stripe.identity.verificationSessions.create(createParams, { idempotencyKey });
  } catch {
    try {
      await cleanupReference.set({
        reason: 'provider-create-result-unknown',
        status: 'pending',
        notBeforeMs: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch {
      // The original intent and finite creator lease remain durable.
    }
    void Promise.resolve().then(() => scheduleCleanup({ force: true })).catch(() => undefined);
    response.status(503).json({
      ok: false,
      code: 'IDENTITY_SESSION_UNAVAILABLE',
      error: 'Identity verification could not be started safely. Try again later.'
    });
    return;
  }
  let providerReferencePersisted;
  try {
    providerReferencePersisted = await writeIdentityUnlessDeletionBlocked(
      database,
      markerReference,
      async (transaction) => {
        transaction.set(cleanupReference, {
          providerSessionId: String(session.id || ''),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      },
      async (transaction) => {
        transaction.set(cleanupReference, {
          providerSessionId: String(session.id || ''),
          reason: 'player-deletion-race',
          deletionMarkerRef: String(markerReference.path || ''),
          notBeforeMs: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    );
  } catch {
    await finishQueuedIdentityProviderCleanup(session, stripe, cleanupReference, scheduleCleanup, {
      reason: 'provider-session-reference-write-failed'
    });
    response.status(503).json({
      ok: false,
      code: 'IDENTITY_SESSION_PERSISTENCE_FAILED',
      error: 'Identity verification could not be saved safely. Try again later.'
    });
    return;
  }
  if (providerReferencePersisted.deletionBlocked) {
    await finishQueuedIdentityProviderCleanup(session, stripe, cleanupReference, scheduleCleanup, {
      reason: 'player-deletion-race',
      deletionMarkerRef: String(markerReference.path || '')
    });
    sendIdentityDeletionBlocked(response);
    return;
  }
  if (!session.url) {
    await finishQueuedIdentityProviderCleanup(session, stripe, cleanupReference, scheduleCleanup, {
      reason: 'provider-session-url-missing'
    });
    response.status(503).json({
      ok: false,
      code: 'IDENTITY_SESSION_UNAVAILABLE',
      error: 'Identity verification could not be started safely. Try again later.'
    });
    return;
  }

  const nextRecord = {
    status: session.status || 'requires_input',
    ageVerified: false,
    ageLevel: 0,
    provider: 'stripe_identity',
    providerSessionId: session.id,
    providerSessionIds: admin.firestore.FieldValue.arrayUnion(session.id),
    providerStatus: session.status || 'requires_input',
    attemptCount,
    failureCode: null,
    verifiedAt: null,
    lastStripeEventId: '',
    lastStripeEventCreated: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  let persisted;
  try {
    persisted = await writeIdentityUnlessDeletionBlocked(database, markerReference, async (transaction) => {
      const latestSnapshot = await transaction.get(reference);
      const latest = latestSnapshot.exists ? latestSnapshot.data() || {} : {};
      if (latest.status === 'verified' && latest.ageVerified === true) {
        transaction.set(cleanupReference, {
          reason: 'identity-already-verified',
          notBeforeMs: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { alreadyVerified: true, record: latest };
      }
      transaction.set(reference, nextRecord, { merge: true });
      transaction.delete(cleanupReference);
      return { alreadyVerified: false, record: nextRecord };
    }, async (transaction) => {
      transaction.set(cleanupReference, {
        reason: 'player-deletion-race',
        deletionMarkerRef: String(markerReference.path || ''),
        notBeforeMs: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch {
    await finishQueuedIdentityProviderCleanup(session, stripe, cleanupReference, scheduleCleanup, {
      reason: 'identity-persistence-transaction-failed'
    });
    response.status(503).json({
      ok: false,
      code: 'IDENTITY_SESSION_PERSISTENCE_FAILED',
      error: 'Identity verification could not be saved safely. Try again later.'
    });
    return;
  }
  if (persisted.deletionBlocked) {
    await finishQueuedIdentityProviderCleanup(session, stripe, cleanupReference, scheduleCleanup, {
      reason: 'player-deletion-race',
      deletionMarkerRef: String(markerReference.path || '')
    });
    sendIdentityDeletionBlocked(response);
    return;
  }
  const persistedValue = /** @type {{ alreadyVerified: boolean, record: Record<string, unknown> } | undefined} */ (
    persisted.value
  );
  if (persistedValue?.alreadyVerified) {
    const providerCleanupComplete = await finishQueuedIdentityProviderCleanup(
      session,
      stripe,
      cleanupReference,
      scheduleCleanup,
      { reason: 'identity-already-verified' }
    );
    response.json({
      ok: true,
      identity: getPublicIdentityStatus(persistedValue.record),
      alreadyVerified: true,
      providerCleanup: providerCleanupComplete ? 'complete' : 'scheduled'
    });
    return;
  }
  response.status(201).json({
    ok: true,
    verificationUrl: session.url,
    returnUrl,
    identity: getPublicIdentityStatus(nextRecord)
  });
}

function createRequireVerifiedPlayerAge(dependencies = {}) {
  const readIdentity = dependencies.readIdentityRecord || readIdentityRecord;
  return async function requireVerifiedPlayerAge(request, response, next) {
    try {
      const record = await readIdentity(request.orbitPlayer.uid);
      const minimumAge = await resolveRequestMinimumAge(request, dependencies);
      const identity = getPublicIdentityStatus(record);
      if (identity.ageEligible !== true || identity.ageLevel < minimumAge) {
        response.status(403).json({
          ok: false,
          code: 'AGE_VERIFICATION_REQUIRED',
          error: `Verify that you are ${minimumAge}+ before using this venue feature.`,
          identity: { ...identity, minimumAge }
        });
        return;
      }
      request.orbitIdentity = { ...identity, minimumAge };
      request.orbitIdentitySummary = getTrustedIdentitySummary(record);
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requireVerifiedPlayerAge = createRequireVerifiedPlayerAge();

module.exports = {
  buildEligibilityUpdate,
  buildCameraIdentityRecord,
  calculateAgeFromDate,
  capturePlayerIdentity,
  cleanupIdentityProviderIntentsForPlayer,
  completeIdentityProviderCleanupForSession,
  compensateIdentitySession,
  createRequireVerifiedPlayerAge,
  createPlayerIdentitySession,
  drainIdentityProviderCleanupQueue,
  deletePlayerIdentityData,
  getAgeLevel,
  getVerifiedDetails,
  identityDocumentPath,
  identityProviderCleanupCollection,
  identityProviderCleanupPath,
  listIdentityProviderCleanupDocuments,
  getIdentityServiceStatus,
  getPlayerIdentityStatus,
  getPublicIdentityStatus,
  getTrustedIdentitySummary,
  handleStripeIdentityEvent,
  normalizeCameraCapture,
  normalizeRequiredMinimumAge,
  persistEligibilityUpdate,
  readIdentityRecord,
  requireVerifiedPlayerAge,
  scheduleIdentityProviderCleanupDrain
};
