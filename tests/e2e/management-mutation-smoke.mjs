import { _electron as electron, expect } from '@playwright/test';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { accountKey, testKey, testKeyFor, createMutationState } from './fixtures/management-mutation-state.mjs';

const api = 'http://127.0.0.1:4185';
if (process.env.ORBIT_API_URL !== api || process.env.VITE_ENABLE_FIREBASE_SYNC !== 'false' || !process.env.TABLEMANAGER_USER_DATA_DIR?.includes('orbit-mutation-smoke-')) throw new Error('Isolated launcher required.');
let activeVenue = accountKey;
let activeUserData = process.env.TABLEMANAGER_USER_DATA_DIR;
const snapshot = async (suffix = 'snapshot') => {
  const response = await fetch(api + '/__smoke/' + suffix, { headers: { 'content-type': 'application/json', 'x-orbit-api-key': testKeyFor(activeVenue) } });
  if (!response.ok) throw new Error('Isolated API control failed.');
  return response.json();
};
let app;
const closeApp = async () => { const closing = app; app = undefined; if (closing) await closing.close(); };
const errors = [];
let floor;
const boot = async (venue, userData, seed = true) => {
  activeVenue = venue;
  activeUserData = userData;
  app = await electron.launch({ args: ['electron/main.cjs'], cwd: process.cwd(), env: { ...process.env,
    ORBIT_CLIENT_API_KEY: testKeyFor(venue), ORBIT_CLIENT_ACCOUNT_KEY: venue, TABLEMANAGER_USER_DATA_DIR: userData }, timeout: 30_000 });
  await expect.poll(() => app.windows().some(page => page.url().startsWith('http://127.0.0.1:5173/')), { timeout: 30_000 }).toBe(true);
  floor = app.windows().find(page => page.url().startsWith('http://127.0.0.1:5173/'));
  if (!floor) throw new Error('Management renderer window unavailable.');
  floor.on('pageerror', error => errors.push(error.message));
  const build = await floor.evaluate(() => window.tableManagerDesktop.getUpdateStatus());
  expect(build.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  expect(build.sourceSha).toMatch(/^(development|[0-9a-f]{40})$/i);
  await floor.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  if (seed) await floor.evaluate(({ state, accountKey }) => {
    localStorage.clear();
    const key = 'table-manager-state-v1:' + accountKey;
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('table-manager-state-v1:last-account', key);
    localStorage.setItem('table-manager-state-v1:auth:' + accountKey, JSON.stringify({ expiresAt: '2099-12-31' }));
  }, { state: createMutationState(venue), accountKey: venue });
  if (seed) {
    await floor.reload();
    const canonical = (await snapshot()).record;
    expect(canonical.revision).toBe(1);
    const createdAt = canonical.state.settings.accountLogin.createdAt;
    expect(typeof createdAt).toBe('string');
    expect(createdAt.length).toBeGreaterThan(0);
    const notesLength = venue === accountKey ? 710_000 : 0;
    const adoptionStarted = Date.now();
    await expect.poll(async () => {
      const browser = await floor.evaluate(key => {
        const raw = localStorage.getItem('table-manager-state-v1:' + key);
        if (!raw) return null;
        const state = JSON.parse(raw);
        return { createdAt: state.settings?.accountLogin?.createdAt, notesLength: state.profiles?.[0]?.notes?.length };
      }, venue);
      let cache;
      try { cache = JSON.parse(await readFile(path.join(userData, 'tablemanager-cache.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      if (cache.format !== 'orbit-local-cache-v1') throw new Error('Unexpected isolated native cache format.');
      const account = cache.accounts[venue];
      return browser?.createdAt === createdAt && browser.notesLength === notesLength
        && account?.revision === 1 && !Object.hasOwn(account, 'pendingSave');
    }, { timeout: 30_000 }).toBe(true);
    console.log('Canonical startup adopted:', { venue, elapsedMs: Date.now() - adoptionStarted, revision: 1, notesLength });
  }
};
const pendingRecord = async () => JSON.parse(await readFile(path.join(activeUserData, 'tablemanager-cache.json'), 'utf8')).accounts[activeVenue]?.pendingSave ?? null;
const openTable = async () => {
  if (!await floor.locator('.table-view-grid').isVisible()) await floor.getByRole('button', { name: /^Open Mutation table, 1 of 8 seats filled/ }).click();
  await expect(floor.locator('.table-view-grid')).toBeVisible();
  await floor.getByRole('button', { name: 'Open details for Synthetic Player at seat 1' }).click();
};
const seat = async () => {
  await floor.getByRole('button', { name: 'Current tables', exact: true }).click();
  const card = floor.locator('.active-game-card').filter({ hasText: 'Mutation table' });
  await card.getByTitle('Add player to an open seat').click();
  await floor.locator('.seat-picker-card').filter({ hasText: 'Synthetic Player' }).click();
  await expect(floor.locator('.seat-picker-modal')).toHaveCount(0);
  await expect(card.getByText('1/8', { exact: true })).toBeVisible();
  await floor.getByRole('button', { name: 'Close Current Tables' }).click();
};
try {
  await boot(accountKey, activeUserData);
  await seat();
  let saved = await snapshot();
  expect(saved.saves.some(item => item.status === 201)).toBe(true);
  expect(saved.saves.filter(item => item.status === 201).every(item => item.protocol === 'checkpoint-v1' && item.payloadBytes > 2_000_000)).toBe(true);
  expect(saved.record.state.profiles[0].notes).toHaveLength(710_000);
  expect(saved.record.state.sessions[0].seatsFilled).toBe(1);
  expect(saved.record.state.playerSessions[0].seatNumber).toBe(1);
  expect(saved.record.state.playerLedger.some(item => item.type === 'Check-In')).toBe(true);
  expect(saved.record.state.interests[0].status).toBe('Seated');
  await openTable();
  const table = floor;
  table.on('pageerror', error => errors.push(error.message));
  const menu = table.locator('.poker-seat-card.open .poker-seat-menu');
  const add = async (minutes, custom = false) => {
    await menu.getByRole('button', { name: /add time controls for Synthetic Player/ }).click();
    if (custom) {
      await menu.getByLabel('Custom minutes', { exact: true }).fill(String(minutes));
      await menu.getByRole('button', { name: 'Add custom time' }).click();
    } else await menu.getByRole('button', { name: '+' + minutes + ' min', exact: true }).click();
    await expect(menu.getByRole('status')).toContainText(minutes + ' minutes added.');
    await expect(menu.locator('.time-action-panel')).toHaveCount(0);
  };
  await add(30);
  await expect(table.locator('.poker-seat-time')).toContainText(/29:|30:00/);
  await add(60);
  await expect(table.locator('.poker-seat-time')).toContainText(/1:29:|1:30:00/);
  await add(15, true);
  await expect(table.locator('.poker-seat-time')).toContainText(/1:44:|1:45:00/);
  await menu.getByRole('button', { name: /deduct time controls for Synthetic Player/ }).click();
  await menu.getByLabel('Correction reason').fill('Synthetic correction');
  await menu.getByRole('button', { name: '-30 min', exact: true }).click();
  await expect(menu.getByRole('status')).toContainText('30 minutes deducted.');
  await expect(table.locator('.poker-seat-time')).toContainText(/1:14:|1:15:00/);
  saved = await snapshot();
  expect(saved.record.state.playerSessions[0].timePurchasedMinutes).toBe(75);
  expect(saved.record.state.timeFeeLogs.map(log => log.minutes)).toEqual([30, 60, 15, -30]);
  expect(saved.record.state.tableEvents.filter(event => event.reason === 'time added')).toHaveLength(3);
  expect(saved.record.state.correctionLog).toHaveLength(1);
  expect(saved.saves.filter(item => item.status === 201).length).toBeGreaterThanOrEqual(5);

  // Interrupt a large snapshot after two chunks, terminate the real Electron
  // process, then resume from its encrypted local operation without reseeding.
  await snapshot('hold-chunks');
  await menu.getByRole('button', { name: /add time controls for Synthetic Player/ }).click();
  await menu.getByRole('button', { name: '+30 min', exact: true }).click();
  await expect.poll(pendingRecord).toMatchObject({ transport: 'checkpoint-v1' });
  const interrupted = await pendingRecord();
  expect((await snapshot()).record.state.playerSessions[0].timePurchasedMinutes).toBe(75);
  await closeApp();
  await boot(accountKey, activeUserData, false);
  expect(await pendingRecord()).toMatchObject({ mutationId: interrupted.mutationId, sha256: interrupted.sha256 });
  await snapshot('resume');
  await expect.poll(async () => (await snapshot()).record.state.playerSessions[0].timePurchasedMinutes, { timeout: 40_000 }).toBe(105);
  await expect.poll(pendingRecord, { timeout: 40_000 }).toBeNull();
  saved = await snapshot();
  expect(saved.record.state.timeFeeLogs.map(log => log.minutes)).toEqual([30, 60, 15, -30, 30]);
  expect(saved.record.state.profiles[0].notes).toHaveLength(710_000);
  expect(saved.saves.filter(item => item.status === 201)).toHaveLength(6);
  await closeApp();

  // Each permanent rejection has its own account and local recovery directory.
  // Retain the pending operation and its provisional state in that directory.
  for (const scenario of ['401', '403', '503', 'conflict']) {
    const venue = `${accountKey}-${scenario}`;
    const directory = await mkdtemp(path.join(process.env.TABLEMANAGER_USER_DATA_DIR, `${scenario}-`));
    await boot(venue, directory);
    await seat();
    await openTable();
    const scenarioMenu = floor.locator('.poker-seat-card.open .poker-seat-menu');
    if (scenario === 'conflict') await snapshot('conflict');
    else await snapshot('fail/' + scenario);
    await scenarioMenu.getByRole('button', { name: /add time controls for Synthetic Player/ }).click();
    await scenarioMenu.getByRole('button', { name: '+30 min', exact: true }).click();
    await expect.poll(pendingRecord).toMatchObject({ transport: 'checkpoint-v1' });
    const status = scenario === 'conflict' ? 409 : Number(scenario);
    await expect.poll(async () => (await snapshot()).saves.at(-1)?.status).toBe(status);
    const retained = await pendingRecord();
    expect((await snapshot()).record.state.playerSessions[0].timePurchasedMinutes).toBe(0);
    if (scenario === '503') {
      await snapshot('resume');
      await expect.poll(async () => (await snapshot()).record.state.playerSessions[0].timePurchasedMinutes, { timeout: 15_000 }).toBe(30);
      await expect.poll(pendingRecord).toBeNull();
      expect((await snapshot()).record.state.timeFeeLogs).toHaveLength(1);
    } else {
      await closeApp();
      expect(await pendingRecord()).toMatchObject({ mutationId: retained.mutationId, sha256: retained.sha256 });
    }
    await closeApp();
  }
  const log = await readFile(path.join(process.env.TABLEMANAGER_USER_DATA_DIR, 'orbit-api.log'), 'utf8');
  for (const stage of ['desktop-build', 'state-ipc-save', 'state-api-result']) expect(log).toContain(stage);
  expect(log).not.toContain(testKey);
  expect(log).not.toContain('Synthetic Player');
  expect(errors).toEqual([]);
  console.log('Management mutation smoke passed: >2MB check-in/time/accounting via real IPC/checkpoint API, interrupted transfer/restart recovery, separate-tenant auth/conflict retention, and transient retry with one accounting effect.');
} catch (error) {
  const failedSnapshot = await snapshot();
  console.error('Isolated API results:', failedSnapshot.saves);
  console.error('Isolated read/save chronology:', failedSnapshot.chronology);
  const diagnostics = await readFile(path.join(process.env.TABLEMANAGER_USER_DATA_DIR, 'orbit-api.log'), 'utf8').catch(() => '');
  console.error('Isolated transport failures:', diagnostics.split('\n').filter(line => line.includes('sync-update-failed')).slice(-3).join('\n'));
  console.error('Isolated renderer diagnostic:', { url: floor?.url(), errors, alerts: await floor?.locator('[role=alert], .seat-picker-error').allTextContents().catch(() => []), body: await floor?.locator('body').innerText().then(text => text.slice(0, 1200)).catch(() => 'unavailable') });
  if (floor && !floor.isClosed()) { const screenshot = process.env.TABLEMANAGER_USER_DATA_DIR + '.png'; await floor.screenshot({ path: screenshot }); console.error('Synthetic screenshot: ' + screenshot); }
  throw error;
} finally { await closeApp(); }
