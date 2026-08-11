const crypto = require('crypto');
global.crypto = global.crypto || crypto.webcrypto;

const { createApp } = require('./app');
const { closeDatabase, drainPublicationOutbox } = require('./database');

const app = createApp();
const port = Number(process.env.API_PORT || 4629);
const host = process.env.API_HOST || '127.0.0.1';

const server = app.listen(port, host, () => {
  console.log(`Orbit API listening on http://${host}:${port}`);
});

const publicationTimer = setInterval(() => {
  void drainPublicationOutbox({ limit: 25 }).catch((error) => {
    console.warn('[publication-outbox] scheduled drain failed:', error instanceof Error ? error.message : 'Unknown error');
  });
}, 30_000);
publicationTimer.unref();

function shutdown() {
  clearInterval(publicationTimer);
  server.close(() => {
    void closeDatabase().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
