const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');
const { getStripe } = require('./services/stripeClient');
const { loadState } = require('./database');

function getRequiredMinimumAge() {
  return 18;
}

function normalizeRequiredMinimumAge(value) {
  return Number(value) === 18 ? 18 : 21;
}

async function resolveRequestMinimumAge(request) {
  const clubId = String(request.body?.clubId || request.query?.clubId || '').trim();
  if (!clubId) return 21;
  const record = await loadState(clubId);
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

const cameraCaptureKeys = new Set(['fullName', 'dateOfBirth', 'address', 'mutationId']);
const forbiddenCaptureKeyPattern = /(image|photo|selfie|barcode|pdf417|id.?number|document.?number|license.?number|raw)/i;

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
  if (!/^[A-Za-z0-9._:-]+$/.test(mutationId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
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

function getPublicIdentityStatus(record = {}) {
  const verifiedAt = typeof record.verifiedAt === 'string'
    ? record.verifiedAt
    : typeof record.verifiedAt?.toDate === 'function'
      ? record.verifiedAt.toDate().toISOString()
      : null;
  const currentVerifiedAge = getCurrentVerifiedAge(record);
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

async function persistEligibilityUpdate(playerId, update) {
  const admin = getAdminSdk();
  const database = admin.firestore(getAdminApp());
  const reference = database.doc(identityDocumentPath(playerId));
  let applied = false;
  let effectiveRecord = {};
  await database.runTransaction(async (transaction) => {
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
  const auth = admin.auth(getAdminApp());
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

async function handleStripeIdentityEvent(event) {
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
  let playerId = purpose === 'orbit_player_age_verification'
    ? String(session.metadata?.playerId || session.metadata?.user_id || session.client_reference_id || '').trim()
    : '';
  if (!playerId && event.type === 'identity.verification_session.redacted' && session.id) {
    const admin = getAdminSdk();
    const matches = await admin.firestore(getAdminApp())
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
  if (!playerId) return false;

  if (event.type === 'identity.verification_session.redacted') {
    await persistEligibilityUpdate(playerId, {
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
    session = await getStripe().identity.verificationSessions.retrieve(session.id, {
      expand: ['verified_outputs']
    });
  }

  const update = buildEligibilityUpdate(session, event);
  await persistEligibilityUpdate(playerId, update);
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

async function capturePlayerIdentity(request, response) {
  response.set('cache-control', 'no-store');
  const capturedAt = new Date();
  const normalized = normalizeCameraCapture(request.body, capturedAt);
  if (!normalized.ok) {
    response.status(400).json({ ok: false, error: normalized.error });
    return;
  }
  const admin = getAdminSdk();
  const database = admin.firestore(getAdminApp());
  const reference = database.doc(identityDocumentPath(request.orbitPlayer.uid));
  const { mutationId } = normalized.value;
  let record;
  await database.runTransaction(async (transaction) => {
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
  response.status(201).json({ ok: true, identity: getPublicIdentityStatus(record) });
}

class IdentityDeletionError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'IdentityDeletionError';
    this.status = status;
  }
}

async function deletePlayerIdentityData(playerId) {
  const admin = getAdminSdk();
  const database = admin.firestore(getAdminApp());
  const reference = database.doc(identityDocumentPath(playerId));
  const snapshot = await reference.get();
  const record = snapshot.exists ? snapshot.data() || {} : {};
  const providerSessionIds = Array.from(new Set([
    ...(Array.isArray(record.providerSessionIds) ? record.providerSessionIds : []),
    record.providerSessionId
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  let redactionRequested = false;

  if (providerSessionIds.length) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new IdentityDeletionError('Stripe Identity is unavailable, so verification data could not be redacted.', 503);
    }
    const sessions = [];
    for (const providerSessionId of providerSessionIds) {
      try {
        sessions.push(await getStripe().identity.verificationSessions.retrieve(providerSessionId));
      } catch (error) {
        if (error?.code !== 'resource_missing') throw error;
      }
    }
    const unfinishedSession = sessions.find((session) => {
      const redactionStatus = String(session.redaction?.status || '');
      return session.status === 'processing' && !['processing', 'redacted'].includes(redactionStatus);
    });
    if (unfinishedSession) {
      throw new IdentityDeletionError('Identity verification is still processing. Try deleting the account again after it finishes.', 409);
    }
    for (const session of sessions) {
      const redactionStatus = String(session.redaction?.status || '');
      if (!['processing', 'redacted'].includes(redactionStatus) && ['requires_input', 'requires_action', 'verified'].includes(session.status)) {
        await getStripe().identity.verificationSessions.redact(session.id);
        redactionRequested = true;
      } else {
        redactionRequested = redactionRequested || redactionStatus === 'processing';
      }
    }
  }

  try {
    const user = await admin.auth(getAdminApp()).getUser(playerId);
    await admin.auth(getAdminApp()).setCustomUserClaims(playerId, {
      ...(user.customClaims || {}),
      ageVerified: false,
      ageLevel: 0
    });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
  await reference.delete();
  return { redactionRequested };
}

async function deletePlayerIdentity(request, response) {
  response.set('cache-control', 'no-store');
  try {
    response.json({ ok: true, ...await deletePlayerIdentityData(request.orbitPlayer.uid) });
  } catch (error) {
    if (error instanceof IdentityDeletionError) {
      response.status(error.status).json({ ok: false, error: error.message });
      return;
    }
    throw error;
  }
}

async function createPlayerIdentitySession(request, response) {
  response.set('cache-control', 'no-store');
  const admin = getAdminSdk();
  const playerId = request.orbitPlayer.uid;
  const returnUrl = String(process.env.ORBIT_IDENTITY_RETURN_URL || '').trim();
  if (!returnUrl || !process.env.STRIPE_SECRET_KEY) {
    response.status(503).json({ ok: false, error: 'Stripe Identity is not configured for Orbit Player.' });
    return;
  }

  const database = admin.firestore(getAdminApp());
  const reference = database.doc(identityDocumentPath(playerId));
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
    const existingSession = await getStripe().identity.verificationSessions.retrieve(current.providerSessionId, {
      expand: ['verified_outputs']
    });
    if (existingSession.status === 'verified') {
      const reconciledAt = new Date();
      await persistEligibilityUpdate(playerId, buildEligibilityUpdate(existingSession, {
        id: `orbit_identity_reconcile_${existingSession.id}_${reconciledAt.getTime()}`,
        created: Math.floor(reconciledAt.getTime() / 1000)
      }, getRequiredMinimumAge(), reconciledAt));
      current = await readIdentityRecord(playerId);
      response.json({
        ok: true,
        identity: getPublicIdentityStatus(current),
        alreadyVerified: current.status === 'verified' && current.ageVerified === true
      });
      return;
    }

    await reference.set({
      status: existingSession.status,
      providerStatus: existingSession.status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
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
    provided_details: request.orbitPlayer.email ? { email: request.orbitPlayer.email } : undefined,
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
  const session = await getStripe().identity.verificationSessions.create(
    createParams,
    { idempotencyKey: `orbit-player-identity-${playerId}-${attemptCount}` }
  );
  if (!session.url) throw new Error('Stripe did not return an identity verification URL.');

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
  await reference.set(nextRecord, { merge: true });
  response.status(201).json({
    ok: true,
    verificationUrl: session.url,
    returnUrl,
    identity: getPublicIdentityStatus(nextRecord)
  });
}

async function requireVerifiedPlayerAge(request, response, next) {
  try {
    const record = await readIdentityRecord(request.orbitPlayer.uid);
    const minimumAge = await resolveRequestMinimumAge(request);
    const identity = getPublicIdentityStatus(record);
    if (identity.ageEligible !== true || identity.ageLevel < minimumAge) {
      response.status(403).json({
        ok: false,
        code: 'AGE_VERIFICATION_REQUIRED',
        error: `Verify that you are ${minimumAge}+ before joining or purchasing card-house access.`,
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
}

module.exports = {
  buildEligibilityUpdate,
  buildCameraIdentityRecord,
  calculateAgeFromDate,
  capturePlayerIdentity,
  createPlayerIdentitySession,
  deletePlayerIdentity,
  deletePlayerIdentityData,
  getAgeLevel,
  getVerifiedDetails,
  getIdentityServiceStatus,
  getPlayerIdentityStatus,
  getPublicIdentityStatus,
  getTrustedIdentitySummary,
  handleStripeIdentityEvent,
  normalizeCameraCapture,
  normalizeRequiredMinimumAge,
  readIdentityRecord,
  requireVerifiedPlayerAge
};
