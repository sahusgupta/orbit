import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const workspaceRoot = process.cwd();
const port = 4176;
const target = `http://127.0.0.1:${port}`;
const nodeExecutable = process.execPath;
const outputDirectory = path.join(workspaceRoot, 'download-site', 'public', 'proof');
const outputPath = path.join(outputDirectory, 'orbit-core-empty-workspace.jpg');
const storageKey = 'table-manager-state-v1';
const accountKey = 'public-proof-redacted';
const accountStorageKey = `${storageKey}:${accountKey}`;
const authStorageKey = `${storageKey}:auth:${accountKey}`;
const expiresAt = '2030-12-31';

const emptyRedactedState = {
  games: [],
  profiles: [],
  tournaments: [],
  interests: [],
  sessions: [],
  playerSessions: [],
  buyIns: [],
  dropLogs: [],
  dealerAssignments: [],
  handCountLogs: [],
  timeFeeLogs: [],
  revenueTransactions: [],
  playerLedger: [],
  tableEvents: [],
  inAppNotifications: [],
  history: [],
  nightCloses: [],
  feedback: [],
  scriptTemplates: [],
  correctionLog: [],
  usageEvents: [],
  settings: {
    lowLight: false,
    defaultCollectionMode: 'Drop',
    defaultTableCap: 10,
    defaultHourlyFee: 0,
    defaultEstimatedDropPerSeatHour: 0,
    collectionProfiles: [],
    membershipPlans: [],
    showPlayerGrid: true,
    showDashboardKpis: false,
    showRecentPlayers: true,
    pilotAccess: {
      authorized: true,
      authorizationCode: 'REDACTED',
      licenseId: accountKey,
      issuedTo: 'Workspace identity redacted',
      expiresAt,
      keyFileName: 'redacted.key'
    },
    clubAccount: {
      clubName: 'Workspace identity redacted',
      accountName: '',
      contactName: '',
      email: 'redacted@example.invalid',
      phone: '',
      address: ''
    },
    accountLogin: {
      username: 'redacted@example.invalid',
      passwordSalt: 'not-used-for-public-proof',
      passwordHash: 'not-used-for-public-proof',
      createdAt: '2026-08-11T00:00:00.000Z'
    },
    staffAccounts: [],
    activeStaffId: undefined
  }
};

const vite = spawn(nodeExecutable, [
  'node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], {
  cwd: workspaceRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    VITE_E2E_FIXTURE_MODE: 'true',
    VITE_ENABLE_FIREBASE_SYNC: 'false',
    VITE_ORBIT_LOCAL_API_URL: 'http://127.0.0.1:9'
  }
});

let browser;
try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(target);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!ready) throw new Error('Isolated product-proof server did not become ready.');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(({ accountStorageKey, authStorageKey, emptyRedactedState, expiresAt, storageKey }) => {
    window.localStorage.clear();
    window.localStorage.setItem(accountStorageKey, JSON.stringify(emptyRedactedState));
    window.localStorage.setItem(`${storageKey}:last-account`, accountStorageKey);
    window.localStorage.setItem(authStorageKey, JSON.stringify({ expiresAt, savedAt: '2026-08-11T00:00:00.000Z' }));
  }, { accountStorageKey, authStorageKey, emptyRedactedState, expiresAt, storageKey });

  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.getByText('Current Tables').waitFor({ timeout: 15_000 });
  await page.locator('.minimal-dashboard').waitFor();
  const stateText = await page.locator('body').innerText();
  if (!stateText.includes('Workspace identity redacted')) throw new Error('Capture does not expose the redaction marker.');
  if (stateText.match(/Alex|Bailey|Casey|Dana|Evan|Smoke Card House/)) {
    throw new Error('Synthetic smoke-fixture records must never enter the public proof capture.');
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  await page.screenshot({ path: outputPath, type: 'jpeg', quality: 88, fullPage: false });
  console.log(`Current empty-state product proof captured from the isolated local build: ${outputPath}`);
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
