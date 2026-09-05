const { asyncRoute, requireClientAuth } = require('../http/auth');
const { requireFirebasePlayer } = require('../paymentService');
const { requirePlayerAppCheck } = require('../appCheckService');
const { requireActivePlayerAccount } = require('../playerDeletionGuard');
const { requireVerifiedPlayerAge } = require('../identityService');
const {
  createMembershipQrHandlers,
  requireMembershipQrRedeemer
} = require('../membershipQrService');

function registerMembershipQrRoutes(app, dependencies = {}) {
  const handlers = createMembershipQrHandlers(dependencies);
  app.post(
    '/player/membership-qr',
    requirePlayerAppCheck,
    requireFirebasePlayer,
    requireActivePlayerAccount,
    requireVerifiedPlayerAge,
    asyncRoute(handlers.issue)
  );
  app.post(
    '/management/membership-qr/redeem',
    requireClientAuth,
    requireMembershipQrRedeemer,
    asyncRoute(handlers.redeem)
  );
}

module.exports = { registerMembershipQrRoutes };
