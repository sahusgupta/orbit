const express = require('express');
const { handleRevenueCatWebhook, handleStripeWebhook } = require('./paymentService');
const { asyncRoute } = require('./http/auth');
const { createLiveUpdates } = require('./http/liveUpdates');
const { assignRequestId, handleApiError } = require('./http/middleware');
const { applySecurityHeaders, createRateLimit, enforceCors, rejectUnexpectedFileUploads } = require('./http/security');
const { recordRequestTiming, responseCompression } = require('./http/performance');
const { registerClientRoutes } = require('./routes/client');
const { registerDashboardRoutes } = require('./routes/dashboard');
const { registerPlayerRoutes } = require('./routes/player');
const { registerSelfCheckInRoutes } = require('./routes/selfCheckIn');
const { registerHealthRoute, registerLegalRoutes } = require('./routes/system');
const { getDatabaseStatus } = require('./database');

function applySelfCheckInPrivacyHeaders(_request, response, next) {
  response.set('cache-control', 'private, no-store, max-age=0');
  response.set('pragma', 'no-cache');
  response.set('x-robots-tag', 'noindex, nofollow');
  next();
}

function createApp() {
  // Validate the server-only authoritative Firestore configuration during cold
  // start. Hosted production must never fall back to an in-memory test store.
  getDatabaseStatus();
  const app = express();
  const startedAt = new Date().toISOString();
  const liveUpdates = createLiveUpdates();
  // Vercel terminates HTTPS at its edge and overwrites the forwarding headers
  // before invoking this Express handler. Trust that single platform hop so
  // request.secure reflects the browser's HTTPS origin during CORS checks.
  const trustedProxy = String(process.env.ORBIT_TRUST_PROXY || (process.env.VERCEL === '1' ? 'true' : '')).trim();
  if (trustedProxy) app.set('trust proxy', trustedProxy === 'true' ? 1 : trustedProxy);

  app.use(assignRequestId);
  app.use(recordRequestTiming);
  app.use(responseCompression);
  app.use([
    '/check-in',
    '/self-check-in.css',
    '/self-check-in.js',
    '/player/check-in',
    '/management/self-check-in'
  ], applySelfCheckInPrivacyHeaders);
  app.use(applySecurityHeaders);
  app.use(enforceCors);
  app.use(rejectUnexpectedFileUploads);
  app.use(createRateLimit({ name: 'api', maximum: 600, windowMs: 60_000 }));
  app.use('/dashboard/session', createRateLimit({ name: 'dashboard-session', maximum: 10, windowMs: 15 * 60_000 }));
  app.use('/dashboard/licenses', createRateLimit({ name: 'license-admin', maximum: 30, windowMs: 15 * 60_000 }));
  app.use('/dashboard/management-accounts', createRateLimit({ name: 'management-account-admin', maximum: 30, windowMs: 15 * 60_000 }));
  app.use('/management/recovery', createRateLimit({ name: 'management-account-recovery', maximum: 10, windowMs: 15 * 60_000 }));
  app.use('/player/auth', createRateLimit({ name: 'player-auth', maximum: 10, windowMs: 15 * 60_000 }));
  app.use('/player/identity', createRateLimit({ name: 'player-identity', maximum: 30, windowMs: 15 * 60_000 }));
  app.use('/player', createRateLimit({ name: 'player-mutation', maximum: 120, windowMs: 60_000 }));
  app.use('/player/check-in/lookup', createRateLimit({ name: 'self-check-in-lookup', identity: 'address', maximum: 120, windowMs: 10 * 60_000 }));
  app.use('/player/check-in/seat', createRateLimit({ name: 'self-check-in-seat', identity: 'address', maximum: 120, windowMs: 10 * 60_000 }));
  app.use('/management/self-check-in', createRateLimit({ name: 'self-check-in-issuer', maximum: 10, windowMs: 15 * 60_000 }));
  app.use('/webhooks', createRateLimit({ name: 'webhook', maximum: 300, windowMs: 60_000 }));
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
  app.post('/webhooks/revenuecat', express.json({ limit: '256kb' }), asyncRoute(handleRevenueCatWebhook));
  app.use(express.json({ limit: '2mb' }));

  registerHealthRoute(app, startedAt);
  registerSelfCheckInRoutes(app);
  registerPlayerRoutes(app);
  registerLegalRoutes(app);
  registerDashboardRoutes(app, liveUpdates, startedAt);

  registerClientRoutes(app, liveUpdates);
  app.use(handleApiError);

  return app;
}

// Vercel's Express adapter requires the detected entry module itself to export
// the request handler. Keep the factory attached for isolated tests and other
// callers that need a fresh application instance.
const app = createApp();
app.createApp = createApp;

module.exports = app;
