import { chromium, _electron as electron, expect } from '@playwright/test';
import { accountKey, testKey, createMutationState } from './fixtures/management-mutation-state.mjs';

const api = 'http://127.0.0.1:4185';
const baseUrl = 'http://127.0.0.1:5173/';
const storageKey = 'table-manager-state-v1:' + accountKey;
const runtime = process.env.ORBIT_FOCUS_RUNTIME;
if (!['browser', 'electron'].includes(runtime) || process.env.ORBIT_API_URL !== api || process.env.VITE_ENABLE_FIREBASE_SYNC !== 'false' || !process.env.TABLEMANAGER_USER_DATA_DIR?.includes('orbit-focus-smoke-')) throw new Error('Isolated focus launcher required.');
const control = async (suffix = 'snapshot') => {
  const response = await fetch(api + '/__focus/' + suffix, { headers: { 'x-orbit-api-key': testKey } });
  if (!response.ok) throw new Error('Isolated API control failed.');
  return response.json();
};
const app = runtime === 'electron' ? await electron.launch({ args: ['electron/main.cjs'], cwd: process.cwd(), env: { ...process.env }, timeout: 30_000 }) : null;
const browser = app ? null : await chromium.launch({ headless: true });
const context = app ? app.context() : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const failures = [];
const errors = [];
let floor;

// Only synthetic fixtures run here. Diagnostics contain element metadata, never values.
await context.addInitScript(() => {
  const describe = element => element instanceof Element ? {
    tag: element.tagName, id: element.id, role: element.getAttribute('role'), class: element.getAttribute('class') || '',
    workspace: Boolean(element.closest('.floor-workspace-popup')),
    picker: Boolean(element.closest('.seat-picker-modal')),
    playerMenu: Boolean(element.closest('.poker-seat-menu')),
    radixDialog: Boolean(element.closest('[role="dialog"][data-state]'))
  } : null;
  window.__orbitFocusTrace = [];
  window.__orbitClockTicks = 0;
  const record = (event, target) => {
    window.__orbitFocusTrace.push({ event, target: describe(target), active: describe(document.activeElement) });
    if (window.__orbitFocusTrace.length > 100) window.__orbitFocusTrace.shift();
  };
  for (const name of ['pointerdown', 'click', 'focus', 'focusin', 'focusout', 'keydown', 'input', 'change']) document.addEventListener(name, event => record(name, event.target), true);
  document.addEventListener('click', event => requestAnimationFrame(() => record('animation-frame', event.target)), true);
  const setInterval = window.setInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => setInterval(() => {
    callback(...args);
    if (delay === 1000) {
      window.__orbitClockTicks += 1;
      requestAnimationFrame(() => record('one-second-tick', document.activeElement));
    }
  }, delay);
});
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  // The browser's optional local bridge has no credentials. Only the isolated
  // fixture API receives this public synthetic key; production is blocked.
  if (url.origin === api && runtime === 'browser') return route.continue({ headers: { ...route.request().headers(), 'x-orbit-api-key': testKey } });
  return [new URL(baseUrl).origin, api].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort('blockedbyclient');
});
const scenario = async (name, callback) => {
  try { await callback(); console.log('PASS ' + runtime + ': ' + name); }
  catch (error) {
    failures.push(name + ': ' + error.message);
    console.error('FAIL ' + runtime + ': ' + name + ': ' + error.message);
    console.error('Focus sequence:', JSON.stringify(await floor.evaluate(() => window.__orbitFocusTrace.slice(-12))));
  }
};
const assertFocused = async (input, label) => {
  expect(await input.evaluate(element => element === document.activeElement), label + ' must own document.activeElement').toBe(true);
};
const typeAndRetain = async (input, prefix, suffix, label, { poll = false, unrelated = false } = {}) => {
  await expect(input).toBeVisible({ timeout: 3000 });
  const node = await input.elementHandle();
  const ticks = await floor.evaluate(() => window.__orbitClockTicks);
  await input.click({ timeout: 3000 });
  await assertFocused(input, label + ' after pointer click');
  await floor.keyboard.press('ControlOrMeta+A');
  await floor.keyboard.press('Backspace');
  await floor.keyboard.type(prefix);
  await expect(input).toHaveValue(prefix);
  await floor.waitForFunction(before => window.__orbitClockTicks > before, ticks);
  await floor.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await assertFocused(input, label + ' after one-second clock render');
  expect(await node.evaluate(element => element.isConnected), label + ' DOM node must remain connected').toBe(true);
  expect(await input.evaluate((element, original) => element === original, node), label + ' DOM identity must survive clock render').toBe(true);
  if (poll) {
    const before = (await control()).reads;
    await expect.poll(async () => (await control()).reads, { timeout: 10_000 }).toBeGreaterThan(before);
    await assertFocused(input, label + ' after authoritative no-op poll');
    expect(await input.evaluate((element, original) => element === original, node), label + ' DOM identity must survive no-op poll').toBe(true);
  }
  if (unrelated) {
    const update = await control('unrelated');
    const note = update.record.state.profiles[0].notes;
    await floor.waitForFunction(({ key, note }) => JSON.parse(localStorage.getItem(key)).profiles[0].notes === note, { key: storageKey, note }, { timeout: 10_000 });
    await assertFocused(input, label + ' after unrelated parent state update');
    expect(await input.evaluate((element, original) => element === original, node), label + ' DOM identity must survive parent state update').toBe(true);
  }
  await floor.keyboard.type(suffix);
  await expect(input).toHaveValue(prefix + suffix);
  await assertFocused(input, label + ' after continued typing');
  await node.dispose();
};
const tabInside = async (surface, count = 10) => {
  for (const key of ['Tab', 'Shift+Tab']) for (let index = 0; index < count; index += 1) {
    await floor.keyboard.press(key);
    expect(await surface.evaluate(element => element.contains(document.activeElement)), key + ' must remain in the topmost dialog').toBe(true);
  }
};
const openDetails = async scope => {
  await scope.getByRole('button', { name: 'Open details for Synthetic Player at seat 1' }).click({ timeout: 3000 });
  await expect(scope.locator('.poker-seat-menu')).toBeVisible({ timeout: 3000 });
};
const openAdmin = async card => {
  const details = card.locator('.table-admin-details');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click({ timeout: 3000 });
};
const openQuickAddCommand = async (pointerSelection = false) => {
  await floor.keyboard.press('ControlOrMeta+k');
  const commandInput = floor.getByRole('combobox');
  await typeAndRetain(commandInput, 'Add player interest', '', 'Command palette search');
  if (pointerSelection) await floor.getByRole('option', { name: 'Add player interest', exact: true }).click({ timeout: 3000 });
  else await floor.keyboard.press('Enter');
  await expect(floor.getByRole('dialog', { name: 'Quick Add player', exact: true })).toBeVisible();
};
const timeInputs = async (scope, label) => {
  await openDetails(scope);
  const menu = scope.locator('.poker-seat-menu');
  await menu.getByRole('button', { name: /add time controls for Synthetic Player/ }).click();
  await typeAndRetain(menu.getByLabel('Custom minutes', { exact: true }), '45', '6', label + ' Add Time', { poll: true, unrelated: true });
  await menu.getByRole('button', { name: /deduct time controls for Synthetic Player/ }).click();
  await typeAndRetain(menu.getByLabel('Correction reason'), 'Synthetic correction', ' edited', label + ' Deduct Time', { poll: true, unrelated: true });
  await typeAndRetain(menu.getByLabel('Custom minutes', { exact: true }), '15', '0', label + ' custom Deduct Time');
  await floor.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await assertFocused(scope.getByRole('button', { name: 'Open details for Synthetic Player at seat 1', exact: true }), label + ' stable player trigger after Escape');
};

try {
  if (app) {
    await expect.poll(() => app.windows().some(page => page.url().startsWith(baseUrl)), { timeout: 30_000 }).toBe(true);
    floor = app.windows().find(page => page.url().startsWith(baseUrl));
  } else floor = await context.newPage();
  floor.on('pageerror', error => errors.push(error.message));
  await floor.goto(baseUrl);
  await floor.evaluate(({ state, accountKey }) => {
    localStorage.clear();
    const key = 'table-manager-state-v1:' + accountKey;
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('table-manager-state-v1:last-account', key);
    localStorage.setItem('table-manager-state-v1:auth:' + accountKey, JSON.stringify({ expiresAt: '2099-12-31' }));
  }, { state: createMutationState(), accountKey });
  await floor.reload();
  await expect.poll(async () => (await control()).reads, { timeout: 10_000 }).toBeGreaterThan(0);
  await floor.getByRole('button', { name: 'Current tables', exact: true }).click();
  const workspace = floor.getByRole('dialog', { name: 'Current tables', exact: true });
  const card = workspace.locator('.active-game-card').filter({ hasText: 'Mutation table' });
  const opener = card.getByTitle('Add player to an open seat');
  const openerNode = await opener.elementHandle();
  await opener.click();
  const picker = floor.locator('.seat-picker-modal');
  await scenario('Current Tables seat picker search and modal stack', async () => {
    const search = picker.getByPlaceholder('Type player name and press Enter');
    await assertFocused(search, 'Seat picker search on opening');
    await typeAndRetain(search, 'Alice', ' QA', 'Seat picker search', { poll: true, unrelated: true });
    await expect(picker.locator('.seat-picker-card').filter({ hasText: 'Alice' })).toBeVisible();
    await expect(picker.locator('.seat-picker-card').filter({ hasText: 'Synthetic Player' })).toHaveCount(0);
    await typeAndRetain(picker.getByLabel('Seat #'), '1', '', 'Seat picker seat number');
    await typeAndRetain(picker.getByLabel('Initial buy-in'), '20', '0', 'Seat picker initial buy-in');
    await typeAndRetain(picker.getByLabel('Time bought'), '6', '0', 'Seat picker time bought');
    await openerNode.evaluate(element => element.focus());
    expect(await picker.evaluate(element => element.contains(document.activeElement)), 'Underlying workspace must not capture topmost dialog focus').toBe(true);
    await tabInside(picker);
    await floor.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(workspace).toBeVisible();
    await assertFocused(opener, 'Seat picker opener after Escape');
  });
  if (await picker.count()) await picker.getByTitle('Close player picker').click();
  await scenario('Seat picker pointer close restores Add Player focus', async () => {
    await opener.click();
    await picker.getByTitle('Close player picker').click();
    await expect(picker).toHaveCount(0);
    await assertFocused(opener, 'Seat picker opener after pointer close');
  });
  if (await picker.count()) await picker.getByTitle('Close player picker').click();
  await opener.click();
  await picker.locator('.seat-picker-card').filter({ hasText: 'Synthetic Player' }).click();
  await expect(picker).toHaveCount(0);
  await expect(card.getByText('1/8', { exact: true })).toBeVisible();
  await scenario('Successful seat save restores Add Player focus', async () => { await assertFocused(opener, 'Seat picker opener after successful save'); });
  await scenario('Current Tables embedded Add Time and Deduct Time', async () => {
    await timeInputs(card, 'Embedded table');
    await expect(workspace).toBeVisible();
    expect(await floor.evaluate(() => location.hash)).not.toContain('table?');
    if (app) expect(app.windows().filter(page => page.url().startsWith(baseUrl))).toHaveLength(1);
  });
  await scenario('Current Tables dealer, hand count, and notes', async () => {
    await openAdmin(card);
    await typeAndRetain(card.getByPlaceholder('Dealer name'), 'Synthetic Dealer', ' Two', 'Dealer draft');
    await typeAndRetain(card.getByLabel('Hands since last count'), '15', '0', 'Hand count');
    await typeAndRetain(card.getByLabel('Break note'), 'Synthetic note', ' edited', 'Break note');
  });
  await scenario('Current Tables cash-out text fields and modal stack', async () => {
    await openDetails(card);
    const trigger = card.getByRole('button', { name: 'Open details for Synthetic Player at seat 1' });
    await card.locator('.poker-seat-menu').getByRole('button', { name: 'Cash out and leave table', exact: true }).click();
    const cashOut = floor.locator('.cash-out-modal');
    await assertFocused(cashOut.getByLabel('Cash-out amount (optional)'), 'Embedded cash-out amount on opening');
    await typeAndRetain(cashOut.getByLabel('Cash-out amount (optional)'), '12', '5', 'Embedded cash-out amount', { poll: true });
    await typeAndRetain(cashOut.getByLabel('Note', { exact: true }), 'Synthetic cash-out', ' edited', 'Embedded cash-out note');
    await tabInside(cashOut);
    await floor.keyboard.press('Escape');
    await expect(cashOut).toHaveCount(0);
    await expect(workspace).toBeVisible();
    await assertFocused(trigger, 'Cash-out stable player trigger after Escape');
  });
  if (await floor.locator('.cash-out-modal').count()) await floor.locator('.cash-out-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await scenario('Current Tables ledger topmost keyboard focus', async () => {
    const ledgerOpener = card.getByRole('button', { name: 'Ledger', exact: true });
    await ledgerOpener.click();
    const ledger = floor.locator('.cash-ledger-modal');
    await expect(ledger).toBeVisible();
    await ledger.getByRole('button').click({ trial: true, timeout: 3000 });
    expect(await ledger.evaluate(element => element.contains(document.activeElement)), 'Ledger must own focus on opening').toBe(true);
    await tabInside(ledger, 3);
    await floor.keyboard.press('Escape');
    await expect(ledger).toHaveCount(0);
    await expect(workspace).toBeVisible();
    await assertFocused(ledgerOpener, 'Ledger opener after Escape');
  });
  if (await floor.locator('.cash-ledger-modal').count()) await floor.locator('.cash-ledger-modal').getByRole('button').click();
  await scenario('Quick Add opened by command palette from Current Tables', async () => {
    const workspaceNode = await workspace.elementHandle();
    await openQuickAddCommand(true);
    const quickAdd = floor.getByRole('dialog', { name: 'Quick Add player', exact: true });
    expect(await workspaceNode.evaluate(element => element.isConnected && element.getAttribute('data-state') === 'open'), 'Current Tables must remain open beneath Quick Add').toBe(true);
    await typeAndRetain(quickAdd.getByPlaceholder('Player name', { exact: true }), 'Synthetic Quick', ' Add', 'Quick Add name');
    await typeAndRetain(quickAdd.getByPlaceholder('Notes', { exact: true }), 'Synthetic Quick note', ' edited', 'Quick Add notes');
    await typeAndRetain(quickAdd.getByPlaceholder('Search first or last name'), 'Synthetic', ' Player', 'Quick Add check-in search');
    await tabInside(quickAdd);
    await floor.keyboard.press('Escape');
    await expect(quickAdd).toHaveCount(0);
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate(element => element.contains(document.activeElement)), 'Closing Quick Add must restore Current Tables focus').toBe(true);
    await workspaceNode.dispose();
  });
  // Reload the same persisted fixture to keep control cases independent of a
  // preceding modal failure. No input is injected and no state is altered here.
  await floor.goto(baseUrl + '#/floor');
  await floor.reload();
  await floor.getByRole('button', { name: /^Open Mutation table, 1 of 8 seats filled/ }).click();
  await expect(floor.locator('.table-view-grid')).toBeVisible();
  await scenario('Dedicated Table View Add Time and Deduct Time control', async () => { await timeInputs(floor, 'Dedicated table'); });
  await scenario('Dedicated cash-out amount, note, and modal keyboard focus', async () => {
    await openDetails(floor);
    await floor.locator('.poker-seat-menu').getByRole('button', { name: 'Cash out and leave table', exact: true }).click();
    const cashOut = floor.locator('.cash-out-modal');
    await typeAndRetain(cashOut.getByLabel('Cash-out amount (optional)'), '12', '5', 'Cash-out amount');
    await typeAndRetain(cashOut.getByLabel('Note', { exact: true }), 'Synthetic cash-out', ' edited', 'Cash-out note');
    await tabInside(cashOut);
    await floor.keyboard.press('Escape');
    await expect(cashOut).toHaveCount(0);
  });
  await floor.goto(baseUrl + '#/floor');
  await floor.reload();
  await floor.getByRole('button', { name: 'Current tables', exact: true }).click();
  await scenario('Current Tables drop amount and note', async () => {
    await openAdmin(card);
    await card.locator('.table-mode-control').getByText('Drop', { exact: true }).click({ timeout: 3000 });
    await typeAndRetain(card.getByLabel('Table drop', { exact: true }), '12', '5', 'Drop amount');
    await typeAndRetain(card.getByLabel('Drop note', { exact: true }), 'Synthetic drop', ' edited', 'Drop note');
  });
  await floor.getByRole('button', { name: 'Close Current Tables', exact: true }).click();
  await scenario('Activity, Quick Add, and command palette keep the correct topmost focus', async () => {
    await floor.getByRole('button', { name: /^Activity, \d+ recent event/ }).click();
    const activity = floor.getByRole('dialog', { name: 'Activity', exact: true });
    const activityNode = await activity.elementHandle();
    await assertFocused(activity.getByLabel('Filter activity by table'), 'Activity filter on opening');
    await openQuickAddCommand();
    const quickAdd = floor.getByRole('dialog', { name: 'Quick Add player', exact: true });
    const name = quickAdd.getByPlaceholder('Player name', { exact: true });
    await typeAndRetain(name, 'Synthetic Activity', ' Add', 'Activity Quick Add name', { poll: true, unrelated: true });
    expect(await activityNode.evaluate(element => element.isConnected), 'Activity must remain mounted beneath Quick Add').toBe(true);
    const draftNode = await name.elementHandle();
    const selection = await name.evaluate(element => [element.selectionStart, element.selectionEnd, element.selectionDirection]);
    await floor.keyboard.press('ControlOrMeta+k');
    await typeAndRetain(floor.getByRole('combobox'), 'Synthetic', ' command', 'Command search above Quick Add');
    await floor.keyboard.press('Escape');
    await expect(floor.getByRole('dialog', { name: 'Command palette', exact: true })).toHaveCount(0);
    await expect(quickAdd).toBeVisible();
    await assertFocused(name, 'Escape from command palette returns to the Quick Add draft');
    expect(await name.evaluate((element, original) => element === original, draftNode), 'Command palette must not remount the Quick Add draft').toBe(true);
    expect(await name.evaluate(element => [element.selectionStart, element.selectionEnd, element.selectionDirection]), 'Command palette must restore the prior draft caret/selection').toEqual(selection);
    await expect(name).toHaveValue('Synthetic Activity Add');
    await floor.keyboard.type(' retained');
    await expect(name).toHaveValue('Synthetic Activity Add retained');
    await openQuickAddCommand(true);
    await expect(name).toHaveValue('Synthetic Activity Add retained');
    expect(await name.evaluate((element, original) => element === original, draftNode), 'Selecting Add player interest again must retain the existing Quick Add draft node').toBe(true);
    expect(await activityNode.evaluate(element => element.isConnected), 'Repeated Quick Add command must retain the original Activity return target').toBe(true);
    await tabInside(quickAdd);
    await floor.mouse.click(20, 200);
    await expect(quickAdd).toHaveCount(0);
    await expect(activity).toBeVisible();
    expect(await activityNode.evaluate(element => element.isConnected && element.contains(document.activeElement)), 'Outside dismissal after repeated Quick Add selection must restore the original Activity focus').toBe(true);
    await floor.keyboard.press('Escape');
    await expect(activity).toHaveCount(0);
    await draftNode.dispose();
    await activityNode.dispose();
  });
  await scenario('Repeated standalone Quick Add command restores the stable Floor control', async () => {
    await floor.goto(baseUrl + '#/floor');
    await floor.reload();
    await expect(floor.getByRole('dialog')).toHaveCount(0);
    await floor.getByRole('heading', { name: 'Floor', exact: true }).click();
    expect(await floor.evaluate(() => document.activeElement === document.body), 'Standalone command starts from the Floor surface without an editable opener').toBe(true);
    const trigger = floor.locator('.floor-topbar').getByRole('button', { name: 'Add player', exact: true });
    const triggerNode = await trigger.elementHandle();
    await openQuickAddCommand();
    const quickAdd = floor.getByRole('dialog', { name: 'Quick Add player', exact: true });
    const name = quickAdd.getByPlaceholder('Player name', { exact: true });
    const draftNode = await name.elementHandle();
    await typeAndRetain(name, 'Synthetic standalone', ' repeat', 'Standalone repeated command draft');
    await openQuickAddCommand(true);
    expect(await name.evaluate((element, original) => element === original, draftNode), 'Repeated standalone command must retain the Quick Add draft node').toBe(true);
    await expect(name).toHaveValue('Synthetic standalone repeat');
    await quickAdd.locator('.quick-add-drawer-close').click();
    await expect(quickAdd).toHaveCount(0);
    expect(await triggerNode.evaluate(element => element.isConnected && element === document.activeElement), 'Closing repeated standalone Quick Add must restore the stable Floor Add player control').toBe(true);
    await draftNode.dispose();
    await triggerNode.dispose();
  });
  await floor.goto(baseUrl + '#/floor');
  await floor.reload();
  await floor.getByRole('button', { name: 'Current tables', exact: true }).click();
  await scenario('Successful cash-out restores the same newly available seat marker', async () => {
    await openDetails(card);
    const marker = card.locator('.poker-position-marker').filter({ hasText: /^1$/ });
    const markerNode = await marker.elementHandle();
    await card.locator('.poker-seat-menu').getByRole('button', { name: 'Cash out and leave table', exact: true }).click();
    const cashOut = floor.locator('.cash-out-modal');
    await typeAndRetain(cashOut.getByLabel('Cash-out amount (optional)'), '12', '5', 'Successful cash-out amount');
    await cashOut.getByRole('button', { name: 'Close player session', exact: true }).click();
    await expect(cashOut).toHaveCount(0);
    await expect(card.getByText('0/8', { exact: true })).toBeVisible();
    await expect(marker).toBeEnabled();
    expect(await marker.evaluate((element, original) => element === original && element === document.activeElement, markerNode), 'Successful cash-out must focus the same now-empty seat marker').toBe(true);
    expect((await control()).record.state.playerSessions[0].leftAt).toBeTruthy();
    await markerNode.dispose();
  });
  expect(errors, 'Renderer must not emit uncaught errors').toEqual([]);
  if (failures.length) throw new Error('Focus regression smoke failed:\n' + failures.join('\n'));
  console.log('Management focus smoke passed (' + runtime + '): actual pointer/keyboard input, clock and no-op/changed polls, stable DOM identity, and topmost modal keyboard ownership.');
} finally { if (app) await app.close(); if (browser) await browser.close(); }
