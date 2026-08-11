const path = require('path');
const { getDatabaseStatus } = require('../database');
const { getFirebasePublisherStatus } = require('../firebasePublisher');
const { getIdentityServiceStatus } = require('../identityService');
const { getPaymentServiceStatus } = require('../paymentService');

const publicDirectory = path.join(__dirname, '..', '..', 'public');

function registerHealthRoute(app, startedAt) {
  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      service: 'orbit-api',
      environment: process.env.NODE_ENV || 'development',
      database: getDatabaseStatus(),
      firebase: getFirebasePublisherStatus(),
      payments: getPaymentServiceStatus(),
      identity: getIdentityServiceStatus(),
      startedAt
    });
  });
}

function registerLegalRoutes(app) {
  app.get(['/privacy', '/privacy.html'], (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'privacy.html'));
  });

  app.get(['/terms', '/terms.html'], (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'terms.html'));
  });

  app.get(['/support', '/support.html'], (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'support.html'));
  });

  app.get('/legal.css', (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'legal.css'));
  });

  app.get('/orbit-logo.svg', (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'orbit-logo.svg'));
  });
}

module.exports = {
  registerHealthRoute,
  registerLegalRoutes
};
