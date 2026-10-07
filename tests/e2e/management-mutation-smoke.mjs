import { _electron as electron, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { accountKey, testKey, createMutationState } from './fixtures/management-mutation-state.mjs';

const api = 'http://127.0.0.1:4185';
if (process.env.ORBIT_API_URL !== api || process.env.VITE_ENABLE_FIREBASE_SYNC !== 'false' || !process.env.TABLEMANAGER_USER_DATA_DIR?.includes('orbit-mutation-smoke-')) throw new Error('Isolated launcher required.');
const headers = { 'content-type': 'application/json', 'x-orbit-api-key': testKey };
const snapshot = async (suffix = 'snapshot') => {
  const response = await fetch(api + '/__smoke/' + suffix, { headers });
  if (!response.ok) throw new Error('Isolated API control failed.');
  return response.json();
};
const app = await electron.launch({ args: ['electron/main.cjs'], cwd: process.cwd(), env: { ...process.env }, timeout: 30_000 });
const errors = [];
let floor;
try {
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
  await floor.evaluate(({ state, accountKey }) => {
    localStorage.clear();
    const key = 'table-manager-state-v1:' + accountKey;
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('table-manager-state-v1:last-account', key);
    localStorage.setItem('table-manager-state-v1:auth:' + accountKey, JSON.stringify({ expiresAt: '2099-12-31' }));
  }, { state: createMutationState(), accountKey });
  await floor.reload();
  await floor.getByRole('button', { name: 'Current tables', exact: true }).click();
  const card = floor.locator('.active-game-card').filter({ hasText: 'Mutation table' });
  await card.getByTitle('Add player to an open seat').click();
  await floor.locator('.seat-picker-card').filter({ hasText: 'Synthetic Player' }).click();
  await expect(floor.locator('.seat-picker-modal')).toHaveCount(0);
  await expect(card.getByText('1/8', { exact: true })).toBeVisible();
  let saved = await snapshot();
  expect(saved.saves.some(item => item.status === 201)).toBe(true);
  expect(saved.record.state.sessions[0].seatsFilled).toBe(1);
  expect(saved.record.state.playerSessions[0].seatNumber).toBe(1);
  expect(saved.record.state.playerLedger.some(item => item.type === 'Check-In')).toBe(true);
  expect(saved.record.state.interests[0].status).toBe('Seated');
  await floor.getByRole('button', { name: 'Close Current Tables' }).click();
  await floor.getByRole('button', { name: /^Open Mutation table, 1 of 8 seats filled/ }).click();
  const table = floor;
  await expect(table.locator('.table-view-grid')).toBeVisible();
  table.on('pageerror', error => errors.push(error.message));
  await table.getByRole('button', { name: 'Open details for Synthetic Player at seat 1' }).click();
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

  const openAddControls = async () => {
    if (!await menu.isVisible()) await table.getByRole('button', { name: 'Open details for Synthetic Player at seat 1' }).click();
    if (!await menu.locator('.time-action-panel').isVisible()) await menu.getByRole('button', { name: /add time controls for Synthetic Player/ }).click();
  };
  await snapshot('conflict');
  await openAddControls();
  await menu.getByRole('button', { name: '+30 min', exact: true }).click();
  await expect(table.getByText(/club changed on another device/).first()).toBeVisible();
  saved = await snapshot();
  expect(saved.saves.at(-1).status).toBe(409);
  expect(saved.saves.at(-1).expectedRevision).toBe(saved.record.revision - 1);
  expect(saved.saves.at(-1).mutationId).toMatch(/^desktop:mutation-smoke:/);
  expect(saved.record.state.playerSessions[0].timePurchasedMinutes).toBe(75);
  await expect.poll(() => table.evaluate(key => JSON.parse(localStorage.getItem(key)).profiles[0].notes, 'table-manager-state-v1:' + accountKey)).toBe('server-N-plus-one');
  for (const status of [401, 403, 503]) {
    await snapshot('fail/' + status);
    await openAddControls();
    await menu.getByRole('button', { name: '+30 min', exact: true }).click();
    await expect(table.getByText(/server commit/).first()).toBeVisible();
    saved = await snapshot();
    expect(saved.saves.at(-1).status).toBe(status);
    expect(saved.record.state.playerSessions[0].timePurchasedMinutes).toBe(75);
  }
  // A retained operational record can still exhaust the budget. It must fail visibly
  // before IPC/API; no accounting or audit history may be deleted to make room.
  const saturated = saved.record.state;
  saturated.profiles[0].notes = '';
  saturated.profiles[0].notes = 'x'.repeat(1_999_900 - Buffer.byteLength(JSON.stringify(saturated), 'utf8'));
  saturated.usageEvents = []; // Fixture preparation, not product pruning.
  saturated.profiles[0].notes += 'x'.repeat(1_999_900 - Buffer.byteLength(JSON.stringify(saturated), 'utf8'));
  const response = await fetch(api + '/state', { method: 'POST', headers, body: JSON.stringify({ state: saturated, expectedRevision: saved.record.revision, mutationId: 'smoke-saturated' }) });
  expect(response.status).toBe(201);
  await table.evaluate(({ state, accountKey }) => localStorage.setItem('table-manager-state-v1:' + accountKey, JSON.stringify(state)), { state: saturated, accountKey });
  await table.reload();
  await table.getByRole('button', { name: 'Open details for Synthetic Player at seat 1' }).click();
  const before = (await snapshot()).saves.length;
  const logPath = path.join(process.env.TABLEMANAGER_USER_DATA_DIR, 'orbit-api.log');
  const ipcBefore = (await readFile(logPath, 'utf8')).split('state-ipc-save').length;
  console.log('Synthetic saturated payload contributions:', JSON.stringify(Object.fromEntries(Object.entries(saturated).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify({ [key]: value }), 'utf8') - 2]))));
  await table.locator('.poker-seat-menu').getByRole('button', { name: /add time controls for Synthetic Player/ }).click();
  await table.locator('.poker-seat-menu').getByRole('button', { name: '+30 min', exact: true }).click();
  await expect(table.locator('.poker-seat-menu').getByRole('status')).toContainText('2,000,000-byte save limit');
  expect((await snapshot()).saves).toHaveLength(before);
  const log = await readFile(logPath, 'utf8');
  expect(log.split('state-ipc-save')).toHaveLength(ipcBefore);
  console.log('Oversize workflow:', await table.locator('.poker-seat-menu').getByRole('status').textContent());
  for (const stage of ['desktop-build', 'state-ipc-save', 'state-api-request', 'state-api-result', 'preflight-rejected', 'state-reconciled']) expect(log).toContain(stage);
  expect(log).not.toContain(testKey);
  expect(log).not.toContain('Synthetic Player');
  expect(errors).toEqual([]);
  console.log('Management mutation smoke passed: renderer → real preload/IPC → Electron client → authenticated real API/CAS → saved receipts and final UI; conflicts, API failures, and payload rejection verified.');
} catch (error) {
  console.error('Isolated API results:', (await snapshot()).saves);
  const diagnostics = await readFile(path.join(process.env.TABLEMANAGER_USER_DATA_DIR, 'orbit-api.log'), 'utf8').catch(() => '');
  console.error('Isolated transport failures:', diagnostics.split('\n').filter(line => line.includes('sync-update-failed')).slice(-3).join('\n'));
  console.error('Isolated renderer diagnostic:', { url: floor?.url(), errors, alerts: await floor?.locator('[role=alert], .seat-picker-error').allTextContents(), body: await floor?.locator('body').innerText().then(text => text.slice(0, 1200)).catch(() => 'unavailable') });
  if (floor) { const screenshot = process.env.TABLEMANAGER_USER_DATA_DIR + '.png'; await floor.screenshot({ path: screenshot }); console.error('Synthetic screenshot: ' + screenshot); }
  throw error;
} finally { await app.close(); }
