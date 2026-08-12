import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appEntrypoint = path.join(__dirname, 'app.js');

describe('Vercel API entrypoint', () => {
  it('exports the Express handler as the CommonJS module default in hosted mode', () => {
    const inspection = execFileSync(process.execPath, [
      '-e',
      `const app = require(process.argv[1]); process.stdout.write(JSON.stringify({ handler: typeof app, factory: typeof app.createApp }));`,
      appEntrypoint
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'local-verification' }),
        NODE_ENV: 'production',
        ORBIT_FIRESTORE_MEMORY: 'false',
        VERCEL: '1'
      }
    });

    expect(JSON.parse(inspection)).toEqual({ handler: 'function', factory: 'function' });
  }, 15_000);
});
