import { _electron as electron } from '@playwright/test';
import path from 'node:path';

const fixtureMain = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'ocr-file-main.cjs');
const isolatedEnvironment = { ...process.env };
delete isolatedEnvironment.ELECTRON_RUN_AS_NODE;

const electronApp = await electron.launch({
  args: [fixtureMain],
  env: isolatedEnvironment
});

try {
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
  await electronApp.close();
}
