const express = require('express');
const { handleRevenueCatWebhook, handleStripeWebhook } = require('./paymentService');
const { asyncRoute } = require('./http/auth');
const { createLiveUpdates } = require('./http/liveUpdates');
const { assignRequestId, handleApiError } = require('./http/middleware');
const { applySecurityHeaders, createRateLimit, enforceCors, rejectUnexpectedFileUploads } = require('./http/security');
const { registerClientRoutes } = require('./routes/client');
const { registerDashboardRoutes } = require('./routes/dashboard');
const { registerPlayerRoutes } = require('./routes/player');
const { registerHealthRoute, registerLegalRoutes } = require('./routes/system');
const { getDatabaseStatus } = require('./database');

function createApp() {
  // Validate hosted persistence configuration during cold start. Production
  // must never silently fall back to an ephemeral or instance-local database.
  getDatabaseStatus();
  const app = express();
  const startedAt = new Date().toISOString();
  const liveUpdates = createLiveUpdates();
  const trustedProxy = String(process.env.ORBIT_TRUST_PROXY || '').trim();
  if (trustedProxy) app.set('trust proxy', trustedProxy === 'true' ? 1 : trustedProxy);

  app.use(assignRequestId);
  app.use(applySecurityHeaders);
  app.use(enforceCors);
  app.use(rejectUnexpectedFileUploads);
  app.use(createRateLimit({ name: 'api', maximum: 600, windowMs: 60_000 }));
  app.use('/dashboard/session', createRateLimit({ name: 'dashboard-session', maximum: 10, windowMs: 15 * 60_000 }));
  app.use('/player/auth', createRateLimit({ name: 'player-auth', maximum: 10, windowMs: 15 * 60_000 }));
  app.use('/player/identity', createRateLimit({ name: 'player-identity', maximum: 30, windowMs: 15 * 60_000 }));
  app.use('/player', createRateLimit({ name: 'player-mutation', maximum: 120, windowMs: 60_000 }));
  app.use('/webhooks', createRateLimit({ name: 'webhook', maximum: 300, windowMs: 60_000 }));
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
  app.post('/webhooks/revenuecat', express.json({ limit: '256kb' }), asyncRoute(handleRevenueCatWebhook));
  app.use(express.json({ limit: '2mb' }));

  registerHealthRoute(app, startedAt);
  registerPlayerRoutes(app);
  registerLegalRoutes(app);
  registerDashboardRoutes(app, liveUpdates, startedAt);

  registerClientRoutes(app, liveUpdates);
  app.use(handleApiError);

  return app;
}

module.exports = { createApp };
