const crypto = require('crypto');
const { handleStripeIdentityEvent } = require('./identityService');
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

async function requireFirebasePlayer(request, response, next) {
  try {
    const admin = getAdminSdk();
    const token = String(request.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) {
      response.status(401).json({ ok: false, error: 'Firebase player sign-in is required.' });
      return;
    }
    request.orbitPlayer = await admin.auth(getAdminApp()).verifyIdToken(token);
    next();
  } catch {
    response.status(401).json({ ok: false, error: 'Invalid or expired Firebase player token.' });
  }
}

async function createMembershipCheckout(request, response) {
  const admin = getAdminSdk();
  const { clubId, playerName } = request.body || {};
  const product = request.body?.product || request.body?.plan;
  if (!clubId || !['day', 'monthly', 'time-5'].includes(product)) {
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
  const productDetails = product === 'day'
    ? { amountCents: Number(process.env.ORBIT_DAY_PASS_PRICE_CENTS || 1000), name: 'Day Pass' }
    : product === 'monthly'
      ? { amountCents: Number(process.env.ORBIT_MONTHLY_MEMBERSHIP_PRICE_CENTS || 3500), name: 'Monthly Membership' }
      : { amountCents: Number(process.env.ORBIT_FIVE_HOUR_TIME_PRICE_CENTS || 5000), name: '5-Hour Time Pack' };
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
      playerEmail: String(request.orbitPlayer.email || '').slice(0, 200)
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
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Webhook processing failed.' });
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
  const planDays = product === 'day' ? 1 : 30;
  const joinedAt = occurredAt.slice(0, 10);
  const expires = new Date(`${joinedAt}T12:00:00Z`);
  expires.setUTCDate(expires.getUTCDate() + planDays);
  const database = dependencies.database || admin.firestore(getAdminApp());
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
      type: product === 'time-5' ? 'time-package' : 'membership',
      amountCents: Number(session.amount_total || 0),
      currency: session.currency || 'usd',
      occurredAt,
      paymentStatus: 'paid',
      source: 'stripe',
      playerId,
      playerName: metadata.playerName || '',
      playerEmail: metadata.playerEmail || session.customer_details?.email || '',
      membershipPlan: product === 'time-5' ? null : product,
      accessProduct: product,
      fulfilledByClubId: clubId,
      connectedStripeAccountId: event.account || '',
      stripeEventId: event.id,
      stripePaymentIntentId: String(session.payment_intent || ''),
      createdAt: processedAt
    }, { merge: true });
    if (product === 'time-5') {
      const timeWalletRef = database.doc(`clubs/${clubId}/timeWallets/${playerId}`);
      transaction.set(timeWalletRef, {
        id: `${clubId}:${playerId}`,
        clubId,
        playerId,
        playerName: metadata.playerName || '',
        balanceMinutes: admin.firestore.FieldValue.increment(300),
        lastPurchaseTransactionId: session.id,
        updatedAt: processedAt
      }, { merge: true });
    } else {
      transaction.set(membershipRef, {
        id: `${clubId}:${playerId}`,
        clubId,
        playerId,
        playerName: metadata.playerName || '',
        status: 'Active',
        plan: product,
        joinedAt,
        expiresAt: expires.toISOString().slice(0, 10),
        paymentTransactionId: session.id,
        updatedAt: processedAt
      }, { merge: true });
    }
    return 'applied';
  });
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
  createMembershipCheckout,
  getPaymentServiceStatus,
  handleRevenueCatWebhook,
  handleStripeWebhook,
  recordMembershipPayment,
  requireFirebasePlayer
};
