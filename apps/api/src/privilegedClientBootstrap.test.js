import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import firebaseAdminProvider from './services/firebaseAdmin.js';
import stripeClientProvider from './services/stripeClient.js';

const { createFirebaseAdminProvider } = firebaseAdminProvider;
const { createStripeClientProvider } = stripeClientProvider;
const serviceSources = [
  ['identityService.js', readFileSync(resolve('apps/api/src/identityService.js'), 'utf8')],
  ['licenseService.js', readFileSync(resolve('apps/api/src/licenseService.js'), 'utf8')],
  ['paymentService.js', readFileSync(resolve('apps/api/src/paymentService.js'), 'utf8')]
];

describe('API Firebase Admin bootstrap', () => {
  it('preserves JSON, base64, and opt-in credential-file precedence without reading real files', () => {
    const jsonAccount = { project_id: 'json-project' };
    const base64Account = { project_id: 'base64-project' };
    const fileAccount = { project_id: 'file-project' };
    const env = {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(jsonAccount),
      FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify(base64Account)).toString('base64'),
      GOOGLE_APPLICATION_CREDENTIALS: 'local-placeholder.json'
    };
    const readFile = vi.fn(() => JSON.stringify(fileAccount));
    const provider = createFirebaseAdminProvider({ env, readFileSync: readFile, loadAdminSdk: vi.fn() });

    expect(provider.readServiceAccount()).toEqual(jsonAccount);
    expect(provider.readServiceAccount({ allowCredentialsFile: true })).toEqual(jsonAccount);
    expect(readFile).not.toHaveBeenCalled();

    env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    expect(provider.readServiceAccount()).toEqual(base64Account);
    expect(provider.readServiceAccount({ allowCredentialsFile: true })).toEqual(base64Account);
    expect(readFile).not.toHaveBeenCalled();

    env.FIREBASE_SERVICE_ACCOUNT_BASE64 = '';
    expect(provider.readServiceAccount()).toBeNull();
    expect(provider.readServiceAccount({ allowCredentialsFile: true })).toEqual(fileAccount);
    expect(readFile).toHaveBeenCalledWith('local-placeholder.json', 'utf8');
  });

  it('reuses an existing Admin app before credential parsing and initializes at most once otherwise', () => {
    const existingApp = { name: 'existing' };
    const existingAdmin = {
      apps: [existingApp],
      app: vi.fn(() => existingApp),
      credential: { cert: vi.fn() },
      initializeApp: vi.fn()
    };
    const existingProvider = createFirebaseAdminProvider({
      env: { FIREBASE_SERVICE_ACCOUNT_JSON: '{not-parsed' },
      loadAdminSdk: () => existingAdmin,
      readFileSync: vi.fn()
    });

    expect(existingProvider.getAdminApp()).toBe(existingApp);
    expect(existingProvider.getAdminApp({ allowCredentialsFile: true })).toBe(existingApp);
    expect(existingAdmin.app).toHaveBeenCalledOnce();
    expect(existingAdmin.credential.cert).not.toHaveBeenCalled();
    expect(existingAdmin.initializeApp).not.toHaveBeenCalled();

    const initializedApp = { name: 'initialized' };
    const freshAdmin = {
      apps: [],
      app: vi.fn(),
      credential: { cert: vi.fn((account) => ({ account })) },
      initializeApp: vi.fn(() => initializedApp)
    };
    const freshProvider = createFirebaseAdminProvider({
      env: { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'local-project' }) },
      loadAdminSdk: () => freshAdmin,
      readFileSync: vi.fn()
    });

    expect(freshProvider.getAdminApp()).toBe(initializedApp);
    expect(freshProvider.getAdminApp()).toBe(initializedApp);
    expect(freshAdmin.credential.cert).toHaveBeenCalledOnce();
    expect(freshAdmin.initializeApp).toHaveBeenCalledOnce();
  });

  it('keeps credential-file parsing opt-in for license calls while all callers share one owner', () => {
    const sources = Object.fromEntries(serviceSources);
    expect(sources['identityService.js']).toContain("require('./services/firebaseAdmin')");
    expect(sources['paymentService.js']).toContain("require('./services/firebaseAdmin')");
    expect(sources['licenseService.js']).toContain("require('./services/firebaseAdmin')");
    expect(sources['licenseService.js']).toContain('getAdminApp({ allowCredentialsFile: true })');
    for (const [file, source] of serviceSources) {
      expect(source, file).not.toContain('function readServiceAccount(');
      expect(source, file).not.toContain('function getAdminApp(');
      expect(source, file).not.toContain("require('firebase-admin')");
    }
  });
});

describe('API Stripe construction', () => {
  it('throws the existing missing-key error, loads lazily, and caches one shared client', () => {
    /** @type {Record<string, string | undefined>} */
    const env = {};
    const loadStripe = vi.fn();
    const missingProvider = createStripeClientProvider({ env, loadStripe });

    expect(() => missingProvider.getStripe()).toThrow('STRIPE_SECRET_KEY is not configured.');
    expect(loadStripe).not.toHaveBeenCalled();

    const constructedKeys = [];
    function Stripe(key) {
      constructedKeys.push(key);
      this.kind = 'local-placeholder-client';
    }
    env.STRIPE_SECRET_KEY = 'local-placeholder-key';
    loadStripe.mockReturnValue({ Stripe });
    const first = missingProvider.getStripe();
    expect(missingProvider.getStripe()).toBe(first);
    expect(loadStripe).toHaveBeenCalledOnce();
    expect(constructedKeys).toEqual(['local-placeholder-key']);
  });

  it('routes identity and payment through the same lazy Stripe owner', () => {
    const sources = Object.fromEntries(serviceSources);
    for (const file of ['identityService.js', 'paymentService.js']) {
      expect(sources[file]).toContain("require('./services/stripeClient')");
      expect(sources[file]).not.toContain('function getStripe(');
      expect(sources[file]).not.toContain("require('stripe')");
      expect(sources[file]).not.toContain('new Stripe(');
    }
  });
});
