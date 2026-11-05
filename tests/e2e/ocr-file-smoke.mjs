import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixtureMain = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'ocr-file-main.cjs');
const userData = await mkdtemp(path.join(tmpdir(), 'orbit-ocr-file-smoke-'));
const isolatedEnvironment = { ...process.env, ORBIT_OCR_SMOKE_USER_DATA_DIR: userData };
delete isolatedEnvironment.ELECTRON_RUN_AS_NODE;
let electronApp;

try {
  electronApp = await electron.launch({ args: [fixtureMain], env: isolatedEnvironment });
  const actualUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(actualUserData) !== path.resolve(userData)) throw new Error('OCR fixture did not adopt its isolated profile.');
  const page = await electronApp.firstWindow();
  await page.waitForFunction(
    () => ['passed', 'failed'].includes(document.body.dataset.status || ''),
    undefined,
    { timeout: 60_000 }
  );
  const outcome = await page.evaluate(() => ({
    detail: document.body.dataset.detail || '',
    status: document.body.dataset.status || ''
  }));
  if (outcome.status !== 'passed') {
    throw new Error(`Electron file-URL OCR smoke failed: ${outcome.detail || 'unknown failure'}`);
  }
  const blockedRequests = await electronApp.evaluate(() => globalThis.__orbitBlockedOcrRequests || 0);
  if (blockedRequests !== 0) {
    throw new Error(`Electron file-URL OCR attempted ${blockedRequests} external network request(s).`);
  }
  console.log('Electron file-URL OCR smoke passed: worker, core, and language assets loaded locally with external networking blocked.');
} finally {
  if (electronApp) await electronApp.close();
  const resolved = path.resolve(userData);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('orbit-ocr-file-smoke-')) {
    throw new Error('Unexpected OCR fixture profile directory.');
  }
  await rm(resolved, { recursive: true, force: true });
}
