const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');
const { getStripe } = require('./services/stripeClient');

function getRequiredMinimumAge() {
  return 21;
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

function getPublicIdentityStatus(record = {}) {
  const verifiedAt = typeof record.verifiedAt === 'string'
    ? record.verifiedAt
    : typeof record.verifiedAt?.toDate === 'function'
      ? record.verifiedAt.toDate().toISOString()
      : null;
  return {
    status: record.status || 'unverified',
    ageVerified: record.status === 'verified' && record.ageVerified === true,
    ageLevel: Number(record.ageLevel || 0),
    minimumAge: getRequiredMinimumAge(),
    verifiedAt,
    failureCode: record.failureCode || null
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
      failureCode: age >= minimumAge ? null : 'minimum_age_not_met'
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

async function deletePlayerIdentity(request, response) {
  response.set('cache-control', 'no-store');
  const admin = getAdminSdk();
  const playerId = request.orbitPlayer.uid;
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
      response.status(503).json({ ok: false, error: 'Stripe Identity is unavailable, so verification data could not be redacted.' });
      return;
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
      response.status(409).json({
        ok: false,
        error: 'Identity verification is still processing. Try deleting the account again after it finishes.'
      });
      return;
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
  response.json({ ok: true, redactionRequested });
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
          ...(isMatchingSelfieRequired()
            ? { options: { document: { require_matching_selfie: true } } }
            : {})
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
    const minimumAge = getRequiredMinimumAge();
    if (record.status !== 'verified' || record.ageVerified !== true || Number(record.ageLevel || 0) < minimumAge) {
      response.status(403).json({
        ok: false,
        code: 'AGE_VERIFICATION_REQUIRED',
        error: `Verify that you are ${minimumAge}+ before joining or purchasing card-house access.`,
        identity: getPublicIdentityStatus(record)
      });
      return;
    }
    request.orbitIdentity = getPublicIdentityStatus(record);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  buildEligibilityUpdate,
  calculateAgeFromDate,
  createPlayerIdentitySession,
  deletePlayerIdentity,
  getAgeLevel,
  getIdentityServiceStatus,
  getPlayerIdentityStatus,
  getPublicIdentityStatus,
  handleStripeIdentityEvent,
  requireVerifiedPlayerAge
};
