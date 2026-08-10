const fs = require('fs');

/**
 * @typedef {object} FirebaseAdminProviderOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {() => unknown} [loadAdminSdk]
 * @property {(path: string, encoding: string) => string} [readFileSync]
 */

/** @param {FirebaseAdminProviderOptions} [options] */
function createFirebaseAdminProvider(options = {}) {
  const {
    env = process.env,
    loadAdminSdk = () => require('firebase-admin'),
    readFileSync = fs.readFileSync
  } = options;
  /** @type {import('firebase-admin').app.App | undefined} */
  let adminApp;
  /** @type {unknown} */
  let adminSdk;

  function getAdminSdk() {
    adminSdk = adminSdk || loadAdminSdk();
    return /** @type {typeof import('firebase-admin')} */ (adminSdk);
  }

  function readServiceAccount({ allowCredentialsFile = false } = {}) {
    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      return JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
    }
    if (allowCredentialsFile && env.GOOGLE_APPLICATION_CREDENTIALS) {
      return JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    }
    return null;
  }

  function getAdminApp({ allowCredentialsFile = false } = {}) {
    const admin = getAdminSdk();
    if (adminApp) return adminApp;
    if (admin.apps.length) {
      adminApp = admin.app();
      return adminApp;
    }
    const serviceAccount = readServiceAccount({ allowCredentialsFile });
    adminApp = admin.initializeApp(serviceAccount ? { credential: admin.credential.cert(serviceAccount) } : undefined);
    return adminApp;
  }

  return { getAdminApp, getAdminSdk, readServiceAccount };
}

const firebaseAdminProvider = createFirebaseAdminProvider();

module.exports = {
  createFirebaseAdminProvider,
  getAdminApp: firebaseAdminProvider.getAdminApp,
  getAdminSdk: firebaseAdminProvider.getAdminSdk,
  readServiceAccount: firebaseAdminProvider.readServiceAccount
};
