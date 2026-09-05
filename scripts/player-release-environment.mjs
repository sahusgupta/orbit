import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const playerRoot = path.join(repositoryRoot, 'player-app');

const require = createRequire(import.meta.url);
const { validateProductionEnvironment } = require('../player-app/release-config.cjs');

const blockedParentEnvironmentKey = (key) =>
  key.startsWith('EXPO_PUBLIC_') ||
  key.startsWith('ORBIT_') ||
  /^(?:EAS_TOKEN|EXPO_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_CONFIG)$/i.test(key) ||
  /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CLIENT_EMAIL|SERVICE_ACCOUNT|CREDENTIAL|DATABASE_URL|FIREBASE_ADMIN|STRIPE|REVENUECAT|TWILIO|SMTP|SENDGRID)/i.test(key);

export function productionPlayerEnvironment(parentEnvironment = process.env) {
  const eas = JSON.parse(fs.readFileSync(path.join(playerRoot, 'eas.json'), 'utf8'));
  const production = eas.build?.production?.env;
  validateProductionEnvironment(production || {});
  const sanitizedParent = Object.fromEntries(
    Object.entries(parentEnvironment).filter(([key]) => !blockedParentEnvironmentKey(key))
  );
  return {
    ...sanitizedParent,
    ...production,
    CI: '1',
    EXPO_NO_DOTENV: '1',
    EXPO_NO_GIT_STATUS: '1'
  };
}

export function localPlayerBinary(packageName, relativeBinary) {
  const binary = path.join(playerRoot, 'node_modules', packageName, relativeBinary);
  if (!fs.existsSync(binary)) {
    throw new Error(`Missing locked Player tool ${packageName}; run npm ci --prefix player-app.`);
  }
  return binary;
}
