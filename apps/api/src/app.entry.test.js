import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appEntrypoint = path.join(__dirname, 'app.js');
const deletionFinalizationEntrypoint = path.join(__dirname, 'operations', 'accountDeletionFinalization.js');
const logHashSecret = 'local-entrypoint-log-hash-secret-at-least-32-characters';

/** @param {Record<string, string | undefined>} [overrides] */
function hostedEnvironment(overrides = {}) {
  /** @type {Record<string, string | undefined>} */
  const environment = {
    ...process.env,
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'local-verification' }),
    NODE_ENV: 'production',
    ORBIT_FIRESTORE_MEMORY: 'false',
    VERCEL: '1',
    ...overrides
  };
  if (overrides.ORBIT_LOG_HASH_SECRET === undefined) delete environment.ORBIT_LOG_HASH_SECRET;
  return environment;
}

describe('Vercel API entrypoint', () => {
  it('exports the Express handler as the CommonJS module default in hosted mode', () => {
    const inspection = execFileSync(process.execPath, [
      '-e',
      `const app = require(process.argv[1]); const finalization = require(process.argv[2]); process.stdout.write(JSON.stringify({ handler: typeof app, factory: typeof app.createApp, trustProxy: app.get('trust proxy'), deletionFinalizer: typeof finalization.getAccountDeletionFinalizationScheduler() }));`,
      appEntrypoint,
      deletionFinalizationEntrypoint
    ], {
      encoding: 'utf8',
      env: hostedEnvironment({ ORBIT_LOG_HASH_SECRET: logHashSecret })
    });

    expect(JSON.parse(inspection)).toEqual({
      handler: 'function',
      factory: 'function',
      trustProxy: 1,
      deletionFinalizer: 'function'
    });
  }, 15_000);

  it('fails hosted startup when only the dashboard session secret is configured', () => {
    const dashboardSecret = 'dashboard-only-secret-that-must-not-sign-log-identifiers';
    const inspection = spawnSync(process.execPath, ['-e', 'require(process.argv[1]);', appEntrypoint], {
      encoding: 'utf8',
      env: hostedEnvironment({ ORBIT_DASHBOARD_SESSION_SECRET: dashboardSecret })
    });

    expect(inspection.status).not.toBe(0);
    expect(inspection.stderr).toContain('ORBIT_LOG_HASH_SECRET');
    expect(inspection.stderr).not.toContain(dashboardSecret);
  }, 15_000);
});
