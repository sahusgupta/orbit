const cors = require('cors');
const express = require('express');
const { handleRevenueCatWebhook, handleStripeWebhook } = require('./paymentService');
const { asyncRoute, requireClientAuth } = require('./http/auth');
const { createLiveUpdates } = require('./http/liveUpdates');
const { assignRequestId, handleApiError } = require('./http/middleware');
const { registerClientRoutes } = require('./routes/client');
const { registerDashboardRoutes } = require('./routes/dashboard');
const { registerPlayerRoutes } = require('./routes/player');
const { registerHealthRoute, registerLegalRoutes } = require('./routes/system');

function createApp() {
  const app = express();
  const startedAt = new Date().toISOString();
  const liveUpdates = createLiveUpdates();

  app.use(cors());
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
  app.post('/webhooks/revenuecat', express.json({ limit: '256kb' }), asyncRoute(handleRevenueCatWebhook));
  app.use(express.json({ limit: '2mb' }));
  app.use(assignRequestId);

  registerHealthRoute(app, startedAt);
  registerPlayerRoutes(app);
  registerLegalRoutes(app);
  registerDashboardRoutes(app, liveUpdates, startedAt);

  app.use(requireClientAuth);
  registerClientRoutes(app, liveUpdates);
  app.use(handleApiError);

  return app;
}

module.exports = { createApp };
