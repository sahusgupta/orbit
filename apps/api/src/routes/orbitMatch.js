const { asyncRoute } = require('../http/auth');
const { requireFirebasePlayer } = require('../paymentService');
const { requirePlayerAppCheck } = require('../appCheckService');
const { requireActivePlayerAccount } = require('../playerDeletionGuard');
const { createOrbitMatchHandlers } = require('../orbitMatchService');

function registerOrbitMatchRoutes(app, dependencies = {}) {
  const handlers = createOrbitMatchHandlers(dependencies);
  const guards = [requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount];
  app.get('/player/match', ...guards, asyncRoute(handlers.read));
  app.post('/player/match/operations', ...guards, asyncRoute(handlers.operate));
}

module.exports = { registerOrbitMatchRoutes };
