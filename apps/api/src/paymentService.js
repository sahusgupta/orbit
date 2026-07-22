const admin = require('firebase-admin');
const Stripe = require('stripe');

let adminApp;
let stripeClient;

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  return null;
}

function getAdminApp() {
  if (adminApp) return adminApp;
  if (admin.apps.length) {
    adminApp = admin.app();
    return adminApp;
  }
  const serviceAccount = readServiceAccount();
  adminApp = admin.initializeApp(serviceAccount ? { credential: admin.credential.cert(serviceAccount) } : undefined);
  return adminApp;
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured.');
  stripeClient = stripeClient || new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function getPaymentServiceStatus() {
  return {
    checkoutConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.ORBIT_PAYMENT_SUCCESS_URL && process.env.ORBIT_PAYMENT_CANCEL_URL),
    webhookConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    dayPassCents: Number(process.env.ORBIT_DAY_PASS_PRICE_CENTS || 1000),
    monthlyMembershipCents: Number(process.env.ORBIT_MONTHLY_MEMBERSHIP_PRICE_CENTS || 3500)
  };
}

async function requireFirebasePlayer(request, response, next) {
  try {
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
  const { clubId, plan, playerName } = request.body || {};
  if (!clubId || !['day', 'monthly'].includes(plan)) {
    response.status(400).json({ ok: false, error: 'A valid club and membership plan are required.' });
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
  const amountCents = plan === 'day'
    ? Number(process.env.ORBIT_DAY_PASS_PRICE_CENTS || 1000)
    : Number(process.env.ORBIT_MONTHLY_MEMBERSHIP_PRICE_CENTS || 3500);
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: request.orbitPlayer.email,
    client_reference_id: request.orbitPlayer.uid,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: process.env.ORBIT_PAYMENT_CURRENCY || 'usd',
        unit_amount: amountCents,
        product_data: { name: `${club.name || 'Orbit Club'} ${plan === 'day' ? 'Day Pass' : 'Monthly Membership'}` }
      }
    }],
    metadata: {
      kind: 'club_membership',
      clubId,
      plan,
      playerId: request.orbitPlayer.uid,
      playerName: String(playerName || request.orbitPlayer.name || request.orbitPlayer.email || 'Player').slice(0, 120),
      playerEmail: String(request.orbitPlayer.email || '').slice(0, 200)
    },
    success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl
  });
  response.status(201).json({ ok: true, checkoutUrl: session.url, sessionId: session.id });
}

async function handleStripeWebhook(request, response) {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
    const event = getStripe().webhooks.constructEvent(request.body, request.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed' && event.data.object?.metadata?.kind === 'club_membership') {
      await recordMembershipPayment(event);
    }
    response.json({ received: true });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Webhook processing failed.' });
  }
}

async function recordMembershipPayment(event) {
  const session = event.data.object;
  const metadata = session.metadata || {};
  const clubId = metadata.clubId;
  const playerId = metadata.playerId || session.client_reference_id;
  if (!clubId || !playerId || session.payment_status !== 'paid') return;
  const occurredAt = new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const planDays = metadata.plan === 'day' ? 1 : 30;
  const joinedAt = occurredAt.slice(0, 10);
  const expires = new Date(`${joinedAt}T12:00:00Z`);
  expires.setUTCDate(expires.getUTCDate() + planDays);
  const database = admin.firestore(getAdminApp());
  const batch = database.batch();
  const transactionRef = database.doc(`clubs/${clubId}/transactions/${session.id}`);
  const membershipRef = database.doc(`clubs/${clubId}/memberships/${playerId}`);
  batch.set(transactionRef, {
    id: session.id,
    type: 'membership',
    amountCents: Number(session.amount_total || 0),
    currency: session.currency || 'usd',
    occurredAt,
    paymentStatus: 'paid',
    source: 'stripe',
    playerId,
    playerName: metadata.playerName || '',
    playerEmail: metadata.playerEmail || session.customer_details?.email || '',
    membershipPlan: metadata.plan || 'monthly',
    stripeEventId: event.id,
    stripePaymentIntentId: String(session.payment_intent || ''),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  batch.set(membershipRef, {
    id: `${clubId}:${playerId}`,
    clubId,
    playerId,
    playerName: metadata.playerName || '',
    status: 'Active',
    joinedAt,
    expiresAt: expires.toISOString().slice(0, 10),
    paymentTransactionId: session.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await batch.commit();
}

module.exports = {
  createMembershipCheckout,
  getPaymentServiceStatus,
  handleStripeWebhook,
  requireFirebasePlayer
};
