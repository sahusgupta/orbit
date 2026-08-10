import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const serviceSources = [
  ['identityService.js', readFileSync(resolve('apps/api/src/identityService.js'), 'utf8')],
  ['licenseService.js', readFileSync(resolve('apps/api/src/licenseService.js'), 'utf8')],
  ['paymentService.js', readFileSync(resolve('apps/api/src/paymentService.js'), 'utf8')]
];

function extractFunctionSource(source, file, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in ${file}.`);
  const parametersStart = source.indexOf('(', start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf('{', parametersEnd);
  let bodyDepth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') bodyDepth += 1;
    if (source[index] === '}') bodyDepth -= 1;
    if (bodyDepth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in ${file}.`);
}

function loadFunction(source, file, name, globals) {
  const names = Object.keys(globals);
  const factory = Function(...names, `${extractFunctionSource(source, file, name)}; return ${name};`);
  return factory(...names.map((key) => globals[key]));
}

describe('unchanged API Firebase Admin bootstrap', () => {
  it('prefers JSON over base64 everywhere and keeps the license-only explicit credential-file fallback', () => {
    const jsonAccount = { project_id: 'json-project' };
    const base64Account = { project_id: 'base64-project' };
    const fileAccount = { project_id: 'file-project' };
    const env = {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(jsonAccount),
      FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify(base64Account)).toString('base64'),
      GOOGLE_APPLICATION_CREDENTIALS: 'local-placeholder.json'
    };

    for (const [file, source] of serviceSources) {
      const fs = { readFileSync: vi.fn(() => JSON.stringify(fileAccount)) };
      const readServiceAccount = loadFunction(source, file, 'readServiceAccount', {
        Buffer,
        fs,
        process: { env }
      });
      expect(readServiceAccount(), file).toEqual(jsonAccount);
      expect(fs.readFileSync, file).not.toHaveBeenCalled();
    }

    const base64Only = {
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      FIREBASE_SERVICE_ACCOUNT_BASE64: env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      GOOGLE_APPLICATION_CREDENTIALS: env.GOOGLE_APPLICATION_CREDENTIALS
    };
    for (const [file, source] of serviceSources) {
      const fs = { readFileSync: vi.fn(() => JSON.stringify(fileAccount)) };
      const readServiceAccount = loadFunction(source, file, 'readServiceAccount', {
        Buffer,
        fs,
        process: { env: base64Only }
      });
      expect(readServiceAccount(), file).toEqual(base64Account);
      expect(fs.readFileSync, file).not.toHaveBeenCalled();
    }

    const fileOnly = {
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      FIREBASE_SERVICE_ACCOUNT_BASE64: '',
      GOOGLE_APPLICATION_CREDENTIALS: env.GOOGLE_APPLICATION_CREDENTIALS
    };
    for (const [file, source] of serviceSources) {
      const fs = { readFileSync: vi.fn(() => JSON.stringify(fileAccount)) };
      const readServiceAccount = loadFunction(source, file, 'readServiceAccount', {
        Buffer,
        fs,
        process: { env: fileOnly }
      });
      expect(readServiceAccount(), file).toEqual(file === 'licenseService.js' ? fileAccount : null);
      expect(fs.readFileSync, file).toHaveBeenCalledTimes(file === 'licenseService.js' ? 1 : 0);
    }
  });

  it('reuses an existing Admin app before credentials and initializes at most once otherwise', () => {
    for (const [file, source] of serviceSources) {
      const existingApp = { name: `${file}-existing` };
      const app = vi.fn(() => existingApp);
      const initializeApp = vi.fn(() => ({ name: `${file}-initialized` }));
      const cert = vi.fn((account) => ({ account }));
      const readServiceAccount = vi.fn(() => ({ project_id: 'local-project' }));
      const admin = { apps: [existingApp], app, initializeApp, credential: { cert } };
      const globals = file === 'identityService.js'
        ? { adminApp: undefined, getAdminSdk: () => admin, readServiceAccount }
        : { admin, adminApp: undefined, readServiceAccount };
      const getAdminApp = loadFunction(source, file, 'getAdminApp', globals);

      expect(getAdminApp(), file).toBe(existingApp);
      expect(getAdminApp(), file).toBe(existingApp);
      expect(app, file).toHaveBeenCalledOnce();
      expect(readServiceAccount, file).not.toHaveBeenCalled();
      expect(initializeApp, file).not.toHaveBeenCalled();

      admin.apps = [];
      const initializingRead = vi.fn(() => ({ project_id: 'local-project' }));
      const initializingGlobals = file === 'identityService.js'
        ? { adminApp: undefined, getAdminSdk: () => admin, readServiceAccount: initializingRead }
        : { admin, adminApp: undefined, readServiceAccount: initializingRead };
      const initializeFreshApp = loadFunction(source, file, 'getAdminApp', initializingGlobals);
      const first = initializeFreshApp();
      expect(initializeFreshApp(), file).toBe(first);
      expect(initializingRead, file).toHaveBeenCalledOnce();
      expect(cert, file).toHaveBeenCalledOnce();
      expect(initializeApp, file).toHaveBeenCalledOnce();
    }
  });
});

describe('unchanged API Stripe construction', () => {
  it('throws the existing missing-key error and caches one client per service module', () => {
    for (const [file, source] of serviceSources.filter(([name]) => name !== 'licenseService.js')) {
      const constructedKeys = [];
      function Stripe(key) {
        constructedKeys.push(key);
        this.kind = file;
      }
      const globals = file === 'identityService.js'
        ? { process: { env: {} }, stripeClient: undefined, getStripeConstructor: () => Stripe }
        : { process: { env: {} }, stripeClient: undefined, Stripe };
      const getStripeWithoutKey = loadFunction(source, file, 'getStripe', globals);
      expect(() => getStripeWithoutKey(), file).toThrow('STRIPE_SECRET_KEY is not configured.');
      expect(constructedKeys, file).toEqual([]);

      globals.process.env.STRIPE_SECRET_KEY = 'local-placeholder-key';
      const getStripe = loadFunction(source, file, 'getStripe', globals);
      const first = getStripe();
      expect(getStripe(), file).toBe(first);
      expect(constructedKeys, file).toEqual(['local-placeholder-key']);
    }
  });
});
