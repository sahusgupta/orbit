const crypto = require('crypto');
const { StateConflictError, loadState, saveState, schedulePublicationDrain } = require('./database');
const { getTrustedIdentitySummary, handleStripeIdentityEvent, readIdentityRecord } = require('./identityService');
const { applyMembershipPaymentToState, applyMembershipRequestToState, buildPlayerClubSnapshot } = require('./orbitCore');
const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');
const { getStripe } = require('./services/stripeClient');

function getPaymentServiceStatus() {
  return {
    checkoutConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.ORBIT_PAYMENT_SUCCESS_URL && process.env.ORBIT_PAYMENT_CANCEL_URL),
    webhookConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    applePremiumWebhookConfigured: Boolean(process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN),
    dayPassCents: Number(process.env.ORBIT_DAY_PASS_PRICE_CENTS || 1000),
    monthlyMembershipCents: Number(process.env.ORBIT_MONTHLY_MEMBERSHIP_PRICE_CENTS || 3500),
    fiveHourTimePackCents: Number(process.env.ORBIT_FIVE_HOUR_TIME_PRICE_CENTS || 5000)
  };
}

function isVerifiedPlayerClaims(claims) {
  return Boolean(claims?.phone_number || (claims?.email && claims?.email_verified === true));
}

function parseMembershipPlanAmountCents(plan) {
  if (Number.isInteger(plan?.amountCents) && plan.amountCents >= 0) return plan.amountCents;
  const priceLabel = String(plan?.priceLabel || '').trim();
  if (/\bfree\b/i.test(priceLabel)) return 0;
  const match = priceLabel.replace(/,/g, '').match(/^\$?\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:\/|per\s+)(?:day|week|month|mo|year|yr))?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

const timeCheckoutProducts = Object.freeze({
  'time-30': { minutes: 30, name: '30-Minute Time Pack' },
  'time-60': { minutes: 60, name: '1-Hour Time Pack' },
  'time-120': { minutes: 120, name: '2-Hour Time Pack' },
  // Keep fulfilling checkout sessions created before the shorter options shipped.
  'time-5': { minutes: 300, name: '5-Hour Time Pack' }
});

function isTimeCheckoutProduct(product) {
  return Object.hasOwn(timeCheckoutProducts, product);
}

function getTimeCheckoutMinutes(product) {
  return timeCheckoutProducts[product]?.minutes || 0;
}

function resolveAuthoritativeCheckoutProduct(state, body = {}) {
  if (isTimeCheckoutProduct(body.product)) {
    const timeEnabled = state?.settings?.defaultCollectionMode === 'Time' ||
      (state?.settings?.collectionProfiles || []).some((profile) => profile.collectionMode === 'Time') ||
      (state?.sessions || []).some((session) => session.collectionMode === 'Time' || session.timeFeeBased);
    const hourlyFee = Number(state?.settings?.defaultHourlyFee || 0);
    if (!timeEnabled) return { ok: false, status: 409, error: 'This card house is not currently using time fees.' };
    if (!Number.isFinite(hourlyFee) || hourlyFee <= 0) {
      return { ok: false, status: 409, error: 'This card house has not configured its hourly time fee.' };
    }
    const option = timeCheckoutProducts[body.product];
    return {
      ok: true,
      value: {
        product: body.product,
        timeMinutes: option.minutes,
        amountCents: Math.round(hourlyFee * (option.minutes / 60) * 100),
        name: option.name
      }
    };
  }
  const planId = String(body.planId || '').trim();
  if (!planId) return { ok: false, status: 400, error: 'A membership plan ID is required for checkout.' };
  const plan = (state?.settings?.membershipPlans || []).find(
    (candidate) => candidate.active !== false && String(candidate.id || '') === planId
  );
  if (!plan) return { ok: false, status: 400, error: 'The selected membership plan is not available at this club.' };
  const amountCents = parseMembershipPlanAmountCents(plan);
  if (amountCents == null) return { ok: false, status: 409, error: 'The selected membership plan does not have a checkout price.' };
  if (amountCents === 0) return { ok: false, status: 409, error: 'This membership plan does not require online payment.' };
  const membershipDurationDays = Math.max(1, Number(plan.durationDays) || 1);
  return {
    ok: true,
    value: {
      product: membershipDurationDays === 1 ? 'day' : 'monthly',
      planId,
      planName: String(plan.name || 'Membership'),
      priceLabel: String(plan.priceLabel || ''),
      membershipDurationDays,
      amountCents,
      name: String(plan.name || (membershipDurationDays === 1 ? 'Day Pass' : 'Membership'))
    }
  };
}

async function requireFirebasePlayer(request, response, next) {
  try {
    const admin = getAdminSdk();
    const token = String(request.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) {
      response.status(401).json({ ok: false, error: 'Firebase player sign-in is required.' });
      return;
    }
    request.orbitPlayer = await admin.auth(getAdminApp()).verifyIdToken(token);
    if (!isVerifiedPlayerClaims(request.orbitPlayer)) {
      response.status(403).json({
        ok: false,
        code: 'PLAYER_IDENTITY_UNVERIFIED',
        error: 'Verify your email or phone number before using Orbit Player.'
      });
      return;
    }
    next();
  } catch {
    response.status(401).json({ ok: false, error: 'Invalid or expired Firebase player token.' });
  }
}

async function createMembershipCheckout(request, response) {
  const admin = getAdminSdk();
  const { clubId, playerName } = request.body || {};
  const requestedProduct = request.body?.product || request.body?.plan;
  if (!clubId || (!['day', 'monthly'].includes(requestedProduct) && !isTimeCheckoutProduct(requestedProduct))) {
    response.status(400).json({ ok: false, error: 'A valid club and access product are required.' });
    return;
  }
  const successUrl = process.env.ORBIT_PAYMENT_SUCCESS_URL;
  const cancelUrl = process.env.ORBIT_PAYMENT_CANCEL_URL;
  if (!successUrl || !cancelUrl) {
    response.status(503).json({ ok: false, error: 'Membership checkout return URLs are not configured.' });
    return;
  }
  const database = admin.firestore(getAdminApp());
  const authoritativeClub = await loadState(clubId);
  if (!authoritativeClub?.state) {
    response.status(404).json({ ok: false, error: 'The selected Orbit club is unavailable.' });
    return;
  }
  const resolvedProduct = resolveAuthoritativeCheckoutProduct(authoritativeClub.state, {
    ...request.body,
    product: requestedProduct
  });
  if (!resolvedProduct.ok) {
    response.status(resolvedProduct.status).json({ ok: false, error: resolvedProduct.error });
    return;
  }
  const productDetails = resolvedProduct.value;
  const product = productDetails.product;
  const playerSnapshot = buildPlayerClubSnapshot(authoritativeClub.state, {
    id: request.orbitPlayer.uid,
    name: playerName || request.orbitPlayer.name || request.orbitPlayer.email || 'Player',
    email: request.orbitPlayer.email || '',
    phone: request.orbitPlayer.phone_number || ''
  });
  if (isTimeCheckoutProduct(product) && (!playerSnapshot.timeAccess?.linked || !playerSnapshot.timeAccess.activeSession)) {
    response.status(409).json({
      ok: false,
      error: 'Ask staff to link your verified Orbit email or phone to your Core profile and seat you at a time-fee table first.'
    });
    return;
  }
  if (isTimeCheckoutProduct(product) && playerSnapshot.timeAccess.profileId) {
    const linkedProfileId = playerSnapshot.timeAccess.profileId;
    const profile = (authoritativeClub.state.profiles || []).find((candidate) => candidate.id === linkedProfileId);
    if (profile && profile.orbitPlayerId !== request.orbitPlayer.uid) {
      await saveState({
        ...authoritativeClub.state,
        profiles: authoritativeClub.state.profiles.map((candidate) => candidate.id === linkedProfileId
          ? { ...candidate, orbitPlayerId: request.orbitPlayer.uid }
          : candidate)
      }, {
        expectedRevision: authoritativeClub.revision,
        mutationId: `player-link:${request.orbitPlayer.uid}:${linkedProfileId}`,
        mutationType: 'player-core-link'
      });
      void schedulePublicationDrain();
    }
  }
  const clubSnapshot = await database.doc(`clubs/${clubId}`).get();
  if (!clubSnapshot.exists) {
    response.status(404).json({ ok: false, error: 'The selected Orbit club is not published.' });
    return;
  }
  const club = clubSnapshot.data() || {};
  const connectedAccountId = String(club.stripeAccountId || club.connectedStripeAccountId || '').trim();
  if (!connectedAccountId) {
    response.status(409).json({ ok: false, error: `${club.name || 'This card house'} has not connected its merchant checkout yet.` });
    return;
  }
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: request.orbitPlayer.email,
    client_reference_id: request.orbitPlayer.uid,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: process.env.ORBIT_PAYMENT_CURRENCY || 'usd',
        unit_amount: productDetails.amountCents,
        product_data: { name: `${club.name || 'Card House'} ${productDetails.name}` }
      }
    }],
    metadata: {
      kind: 'club_access',
      clubId,
      product,
      playerId: request.orbitPlayer.uid,
      playerName: String(playerName || request.orbitPlayer.name || request.orbitPlayer.email || 'Player').slice(0, 120),
      playerEmail: String(request.orbitPlayer.email || '').slice(0, 200),
      ...(isTimeCheckoutProduct(product) ? { timeMinutes: String(productDetails.timeMinutes) } : {}),
      ...(productDetails.planId ? {
        planId: productDetails.planId,
        planName: productDetails.planName.slice(0, 120),
        priceLabel: productDetails.priceLabel.slice(0, 120),
        membershipDurationDays: String(productDetails.membershipDurationDays)
      } : {})
    },
    success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl
  }, { stripeAccount: connectedAccountId });
  response.status(201).json({ ok: true, checkoutUrl: session.url, sessionId: session.id });
}

async function handleRevenueCatWebhook(request, response) {
  const admin = getAdminSdk();
  const expectedToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
  const receivedToken = String(request.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expectedToken || receivedToken !== expectedToken) {
    response.status(401).json({ ok: false, error: 'Invalid RevenueCat webhook authorization.' });
    return;
  }

  const event = request.body?.event;
  const playerId = String(event?.app_user_id || '').trim();
  const entitlementIds = Array.isArray(event?.entitlement_ids) ? event.entitlement_ids : [];
  if (!event?.id || !playerId) {
    response.status(400).json({ ok: false, error: 'RevenueCat event and app user ID are required.' });
    return;
  }
  if (!revenueCatEventTimeMs(event)) {
    response.status(400).json({ ok: false, error: 'RevenueCat event timestamp is required.' });
    return;
  }

  const database = admin.firestore(getAdminApp());
  const outcome = await applyRevenueCatEvent(database, admin, event, {
    entitlementId: process.env.REVENUECAT_PREMIUM_ENTITLEMENT_ID || 'player_premium',
    entitlementIds
  });

  response.json({ ok: true, outcome });
}

async function handleStripeWebhook(request, response) {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
    const event = getStripe().webhooks.constructEvent(request.body, request.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed' && ['club_membership', 'club_access'].includes(event.data.object?.metadata?.kind)) {
      await recordMembershipPayment(event);
    }
    await handleStripeIdentityEvent(event);
    response.json({ received: true });
  } catch (error) {
      response.status(400).json({ ok: false, error: 'Webhook could not be processed.', code: 'WEBHOOK_REJECTED' });
  }
}

async function recordMembershipPayment(event, dependencies = {}) {
  const admin = dependencies.admin || getAdminSdk();
  const session = event.data.object;
  const metadata = session.metadata || {};
  const clubId = metadata.clubId;
  const playerId = metadata.playerId || session.client_reference_id;
  if (!clubId || !playerId || session.payment_status !== 'paid') return;
  const product = metadata.product || metadata.plan || 'monthly';
  const occurredAt = new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const database = dependencies.database || admin.firestore(getAdminApp());
  let reconciliation = null;
  if (dependencies.reconcileState !== false && (!dependencies.database || dependencies.loadState)) {
    reconciliation = await reconcileMembershipPayment(event, dependencies);
  }
  const eventRef = database.doc(`webhookEvents/${webhookEventDocumentId('stripe', event.id)}`);
  const transactionRef = database.doc(`clubs/${clubId}/transactions/${session.id}`);
  const membershipRef = database.doc(`clubs/${clubId}/memberships/${playerId}`);
  return database.runTransaction(async (transaction) => {
    const [eventSnapshot, paymentSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(transactionRef)
    ]);
    if (eventSnapshot.exists) return 'duplicate-event';

    const alreadyFulfilled = paymentSnapshot.exists && paymentSnapshot.data()?.paymentStatus === 'paid';
    const processedAt = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(eventRef, {
      provider: 'stripe',
      eventIdHash: hashProviderEventId(event.id),
      eventType: String(event.type || ''),
      providerCreatedAt: Number(event.created || 0),
      outcome: alreadyFulfilled ? 'duplicate-payment' : 'applied',
      processedAt
    });
    if (alreadyFulfilled) return 'duplicate-payment';

    transaction.set(transactionRef, {
      id: session.id,
      type: isTimeCheckoutProduct(product) ? 'time-package' : 'membership',
      amountCents: Number(session.amount_total || 0),
      currency: session.currency || 'usd',
      occurredAt,
      paymentStatus: 'paid',
      source: 'stripe',
      playerId,
      playerName: metadata.playerName || '',
      playerEmail: metadata.playerEmail || session.customer_details?.email || '',
      membershipPlan: isTimeCheckoutProduct(product) ? null : product,
      accessProduct: product,
      fulfilledByClubId: clubId,
      connectedStripeAccountId: event.account || '',
      stripeEventId: event.id,
      stripePaymentIntentId: String(session.payment_intent || ''),
      createdAt: processedAt
    }, { merge: true });
    if (isTimeCheckoutProduct(product)) {
      const timeWalletRef = database.doc(`clubs/${clubId}/timeWallets/${playerId}`);
      transaction.set(timeWalletRef, {
        id: `${clubId}:${playerId}`,
        clubId,
        playerId,
        playerName: metadata.playerName || '',
        balanceMinutes: admin.firestore.FieldValue.increment(getTimeCheckoutMinutes(product)),
        lastPurchaseTransactionId: session.id,
        updatedAt: processedAt
      }, { merge: true });
    } else {
      transaction.set(membershipRef, buildPaidMembershipProjection({
        reconciliation,
        id: `${clubId}:${playerId}`,
        clubId,
        playerId,
        playerName: metadata.playerName || '',
        plan: product,
        paymentTransactionId: session.id,
        updatedAt: processedAt
      }), { merge: true });
    }
    return 'applied';
  });
}

function buildPaidMembershipProjection(input) {
  const profile = input.reconciliation?.profile || {};
  const active = profile.membershipStatus === 'Active' && profile.membershipPaymentStatus === 'Paid';
  return {
    id: input.id,
    clubId: input.clubId,
    playerId: input.playerId,
    playerName: input.playerName,
    status: active ? 'Active' : profile.membershipStatus || 'Approved',
    plan: input.plan,
    joinedAt: active ? String(profile.membershipStartDate || '') : '',
    expiresAt: active ? String(profile.membershipExpirationDate || '') || null : null,
    paymentTransactionId: input.paymentTransactionId,
    membershipPaymentStatus: 'Paid',
    identityReviewStatus: profile.identityReviewStatus || 'Pending',
    updatedAt: input.updatedAt
  };
}

async function reconcileMembershipPayment(event, dependencies = {}) {
  const session = event.data.object;
  const metadata = session.metadata || {};
  const clubId = String(metadata.clubId || '').trim();
  const playerId = String(metadata.playerId || session.client_reference_id || '').trim();
  if (!clubId || !playerId || session.payment_status !== 'paid') return { outcome: 'ignored', profile: null };
  const load = dependencies.loadState || loadState;
  const save = dependencies.saveState || saveState;
  const schedule = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const readIdentity = dependencies.readIdentityRecord || readIdentityRecord;
  const product = metadata.product || metadata.plan || 'monthly';
  const occurredAt = new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const identityRecord = isTimeCheckoutProduct(product) ? {} : await readIdentity(playerId);
  const identitySummary = getTrustedIdentitySummary(identityRecord);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await load(clubId);
    if (!record?.state) throw new Error(`Authoritative club state is unavailable for paid checkout ${session.id}.`);
    if ((record.state.revenueTransactions || []).some((transaction) => transaction.id === String(session.id))) {
      void schedule();
      return {
        outcome: 'duplicate-payment',
        profile: (record.state.profiles || []).find((profile) => profile.id === playerId || profile.orbitPlayerId === playerId) || null
      };
    }
    const linkedSnapshot = isTimeCheckoutProduct(product)
      ? buildPlayerClubSnapshot(record.state, {
          id: playerId,
          name: metadata.playerName || 'Player',
          email: metadata.playerEmail || session.customer_details?.email || ''
        })
      : null;
    const corePlayerId = isTimeCheckoutProduct(product) ? linkedSnapshot?.timeAccess?.profileId : playerId;
    if (isTimeCheckoutProduct(product) && !corePlayerId) {
      throw new Error(`The paid time checkout ${session.id} is no longer linked to a Core player profile.`);
    }
    let nextState = record.state;
    if (!isTimeCheckoutProduct(product)) {
      nextState = applyMembershipRequestToState(nextState, {
        id: `stripe-${session.id}`,
        clubId,
        plan: product === 'day' ? 'day' : 'monthly',
        paymentMethod: 'app',
        priceLabel: metadata.priceLabel,
        planName: metadata.planName,
        membershipDurationDays: Number(metadata.membershipDurationDays || 0) || undefined,
        membershipPaymentRequired: true,
        requestedAt: occurredAt,
        player: {
          id: playerId,
          name: identitySummary.fullName || metadata.playerName || 'Player',
          email: metadata.playerEmail || session.customer_details?.email || '',
          preferredGameIds: []
        },
        identitySummary
      });
    }
    nextState = applyMembershipPaymentToState(nextState, {
      clubId,
      transactionId: String(session.id),
      playerId: corePlayerId,
      playerName: identitySummary.fullName || metadata.playerName || '',
      playerEmail: metadata.playerEmail || session.customer_details?.email || '',
      product,
      timeMinutes: isTimeCheckoutProduct(product) ? getTimeCheckoutMinutes(product) : 0,
      membershipDurationDays: Number(metadata.membershipDurationDays || 0) || undefined,
      amountCents: Number(session.amount_total || 0),
      occurredAt,
      stripeEventId: String(event.id || '')
    });
    try {
      const saved = await save(nextState, {
        expectedRevision: record.revision,
        mutationId: `stripe-payment:${session.id}`,
        mutationType: 'stripe-membership-payment'
      });
      void schedule();
      return {
        outcome: saved.duplicate ? 'duplicate-payment' : 'applied',
        profile: (nextState.profiles || []).find((profile) => profile.id === playerId) || null
      };
    } catch (error) {
      if (!(error instanceof StateConflictError) || attempt === 2) throw error;
    }
  }
  return { outcome: 'conflict', profile: null };
}

function hashProviderEventId(eventId) {
  return crypto.createHash('sha256').update(String(eventId || '')).digest('hex');
}

function webhookEventDocumentId(provider, eventId) {
  return `${provider}_${hashProviderEventId(eventId)}`;
}

function revenueCatEventTimeMs(event) {
  const candidates = [
    event?.event_timestamp_ms,
    event?.purchased_at_ms,
    event?.expiration_at_ms
  ].map(Number);
  return candidates.find((value) => Number.isFinite(value) && value > 0) || 0;
}

async function applyRevenueCatEvent(database, admin, event, options) {
  const playerId = String(event?.app_user_id || '').trim();
  const eventId = String(event?.id || '').trim();
  if (!playerId || !eventId) throw new Error('RevenueCat event and app user ID are required.');
  const entitlementId = options.entitlementId;
  const entitlementIds = options.entitlementIds;
  const expiresAtMs = Number(event.expiration_at_ms || 0);
  const eventAtMs = revenueCatEventTimeMs(event);
  const expired = event.type === 'EXPIRATION' || (expiresAtMs > 0 && expiresAtMs <= Date.now());
  const active = entitlementIds.includes(entitlementId) && !expired;
  const eventRef = database.doc(`webhookEvents/${webhookEventDocumentId('revenuecat', eventId)}`);
  const playerRef = database.doc(`players/${playerId}`);

  return database.runTransaction(async (transaction) => {
    const [eventSnapshot, playerSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(playerRef)
    ]);
    if (eventSnapshot.exists) return 'duplicate-event';

    const current = playerSnapshot.exists ? playerSnapshot.data() || {} : {};
    const currentEventAtMs = Number(current.premium?.lastRevenueCatEventAtMs || 0);
    const stale = currentEventAtMs > 0 && eventAtMs <= currentEventAtMs;
    const processedAt = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(eventRef, {
      provider: 'revenuecat',
      eventIdHash: hashProviderEventId(eventId),
      eventType: String(event.type || ''),
      providerCreatedAtMs: eventAtMs,
      outcome: stale ? 'stale' : 'applied',
      processedAt
    });
    if (stale) return 'stale';

    transaction.set(playerRef, {
      premium: {
        status: active ? 'active' : 'inactive',
        provider: 'apple',
        productId: String(event.product_id || ''),
        entitlementId,
        originalTransactionId: String(event.original_transaction_id || ''),
        expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
        environment: String(event.environment || ''),
        lastRevenueCatEventId: eventId,
        lastRevenueCatEventAtMs: eventAtMs,
        updatedAt: processedAt
      },
      subscriptionStatus: active ? 'active' : 'inactive',
      subscriptionCurrentPeriodEnd: expiresAtMs ? new Date(expiresAtMs).toISOString() : null
    }, { merge: true });
    return 'applied';
  });
}

module.exports = {
  applyRevenueCatEvent,
  buildPaidMembershipProjection,
  createMembershipCheckout,
  getPaymentServiceStatus,
  isVerifiedPlayerClaims,
  handleRevenueCatWebhook,
  handleStripeWebhook,
  parseMembershipPlanAmountCents,
  recordMembershipPayment,
  reconcileMembershipPayment,
  resolveAuthoritativeCheckoutProduct,
  requireFirebasePlayer
};
