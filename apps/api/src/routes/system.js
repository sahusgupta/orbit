const path = require('path');
const { getDatabaseStatus } = require('../database');
const { getFirebasePublisherStatus } = require('../firebasePublisher');
const { getIdentityServiceStatus } = require('../identityService');
const { getPaymentServiceStatus } = require('../paymentService');
const { requireOwnerApiKey } = require('../http/auth');

const publicDirectory = path.join(__dirname, '..', '..', 'public');

function publicCanonicalUrl(pathname) {
  const configured = String(process.env.ORBIT_PUBLIC_ORIGIN || '').trim();
  if (!configured) return '';
  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return '';
    }
    return new URL(pathname, parsed.origin).href;
  } catch {
    return '';
  }
}

function sendPublicAlias(response, fileName, canonicalPath) {
  response.set('x-robots-tag', 'noindex, follow');
  const canonical = publicCanonicalUrl(canonicalPath);
  if (canonical) response.set('link', `<${canonical}>; rel="canonical"`);
  response.sendFile(path.join(publicDirectory, fileName));
}

function registerHealthRoute(app, startedAt) {
  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      service: 'orbit-api',
      startedAt
    });
  });

  app.get('/health/details', requireOwnerApiKey, (_request, response) => {
    response.json({
      ok: true,
      service: 'orbit-api',
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
    sendPublicAlias(response, 'privacy.html', '/privacy.html');
  });

  app.get(['/terms', '/terms.html'], (_request, response) => {
    sendPublicAlias(response, 'terms.html', '/terms.html');
  });

  app.get(['/support', '/support.html'], (_request, response) => {
    sendPublicAlias(response, 'support.html', '/support.html');
  });

  app.get('/legal.css', (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'legal.css'));
  });

  app.get('/orbit-logo.svg', (_request, response) => {
    response.sendFile(path.join(publicDirectory, 'orbit-logo.svg'));
  });
}

module.exports = {
  publicCanonicalUrl,
  registerHealthRoute,
  registerLegalRoutes
};
