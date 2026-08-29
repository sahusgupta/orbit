import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.TABLE_MANAGER_URL || 'http://127.0.0.1:5173';
const screenshotDirectory = process.env.ORBIT_SMOKE_SCREENSHOT_DIR;
const storageKey = 'table-manager-state-v1';

const now = new Date().toISOString();
const expiresAt = '2027-12-31';
const accountKey = 'smoke-license';
const accountStorageKey = `${storageKey}:${accountKey}`;
const authStorageKey = `${storageKey}:auth:${accountKey}`;

const seededState = {
  games: [
    {
      id: 'nlh-1-2',
      name: '1/2 NLH',
      maxSeats: 10,
      minInRoomForLikely: 4,
      minFlexibleForLikely: 2,
      minTotalForViable: 5
    }
  ],
  physicalTables: Array.from({ length: 6 }, (_, index) => ({
    id: `physical-table-${index + 1}`,
    label: `Table ${index + 1}`,
    maxSeats: 10,
    createdAt: now
  })),
  profiles: [
    {
      id: 'profile-alex',
      name: 'Alex Seat',
      birthday: '',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01',
      totalTimePlayedHours: 12,
      lastSessionTimePlayedHours: 3,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      preferredStakes: '1/2 NLH',
      typicalBuyInMin: 200,
      typicalBuyInMax: 500,
      willingnessToMove: true,
      typicalAvailability: '',
      usualCompanions: [],
      preferredTags: [],
      notes: ''
    },
    {
      id: 'profile-bailey',
      name: 'Bailey Button',
      birthday: '',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01',
      totalTimePlayedHours: 20,
      lastSessionTimePlayedHours: 4,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      preferredStakes: '1/2 NLH',
      typicalBuyInMin: 200,
      typicalBuyInMax: 500,
      willingnessToMove: true,
      typicalAvailability: '',
      usualCompanions: [],
      preferredTags: [],
      notes: ''
    },
    {
      id: 'profile-casey',
      name: 'Casey Call',
      birthday: '',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01',
      totalTimePlayedHours: 8,
      lastSessionTimePlayedHours: 2,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      preferredStakes: '1/2 NLH',
      typicalBuyInMin: 200,
      typicalBuyInMax: 500,
      willingnessToMove: true,
      typicalAvailability: '',
      usualCompanions: [],
      preferredTags: [],
      notes: ''
    },
    {
      id: 'profile-dana',
      name: 'Dana Door',
      birthday: '',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01',
      totalTimePlayedHours: 4,
      lastSessionTimePlayedHours: 1,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      preferredStakes: '1/2 NLH',
      typicalBuyInMin: 200,
      typicalBuyInMax: 500,
      willingnessToMove: true,
      typicalAvailability: '',
      usualCompanions: [],
      preferredTags: [],
      notes: ''
    },
    {
      id: 'profile-evan',
      name: 'Evan Entry',
      birthday: '',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01',
      totalTimePlayedHours: 2,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      preferredStakes: '1/2 NLH',
      typicalBuyInMin: 200,
      typicalBuyInMax: 500,
      willingnessToMove: true,
      typicalAvailability: '',
      usualCompanions: [],
      preferredTags: [],
      notes: ''
    }
  ],
  interests: [
    {
      id: 'interest-alex',
      profileId: 'profile-alex',
      playerName: 'Alex Seat',
      gameId: 'nlh-1-2',
      status: 'Arrived',
      timestamp: now,
      interestedAt: now,
      arrivedAt: now,
      notes: ''
    },
    {
      id: 'interest-bailey',
      profileId: 'profile-bailey',
      playerName: 'Bailey Button',
      gameId: 'nlh-1-2',
      status: 'Confirmed Coming',
      timestamp: now,
      interestedAt: now,
      confirmedAt: now,
      notes: ''
    },
    {
      id: 'interest-casey',
      profileId: 'profile-casey',
      playerName: 'Casey Call',
      gameId: 'nlh-1-2',
      status: 'Arrived',
      timestamp: now,
      interestedAt: now,
      arrivedAt: now,
      notes: ''
    },
    {
      id: 'interest-dana',
      profileId: 'profile-dana',
      playerName: 'Dana Door',
      gameId: 'nlh-1-2',
      status: 'Arrived',
      timestamp: now,
      interestedAt: now,
      arrivedAt: now,
      notes: ''
    }
  ],
  sessions: [
    {
      id: 'session-main',
      physicalTableId: 'physical-table-1',
      gameId: 'nlh-1-2',
      label: 'Table 1',
      status: 'Forming',
      seatsFilled: 0,
      maxSeats: 10,
      timeFeeBased: false,
      collectionMode: 'Drop',
      tags: [],
      startedAt: now
    }
  ],
  playerSessions: [],
  buyIns: [],
  dropLogs: [],
  playerLedger: [],
  tableEvents: [],
  history: [],
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
    collectionProfiles: [
      {
        gameId: 'nlh-1-2',
        collectionMode: 'Drop',
        hourlyFee: 0,
        estimatedDropPerSeatHour: 0
      }
    ],
    showPlayerGrid: true,
    showDashboardKpis: false,
    showRecentPlayers: true,
    pilotAccess: {
      authorized: true,
      authorizationCode: 'SMOKE',
      licenseId: accountKey,
      issuedTo: 'Smoke Card House',
      expiresAt,
      keyFileName: 'smoke.key'
    },
    clubAccount: {
      clubName: 'Smoke Card House',
      accountName: 'Smoke Account',
      contactName: 'QA',
      email: 'smoke@example.com',
      phone: '',
      address: ''
    },
    accountLogin: {
      username: 'smoke',
      passwordSalt: 'not-used-in-smoke',
      passwordHash: 'not-used-in-smoke',
      createdAt: now
    },
    staffAccounts: [],
    activeStaffId: undefined
  }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true });
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
page.on('dialog', async (dialog) => {
  throw new Error(`Unexpected dialog: ${dialog.message()}`);
});

try {
  await page.addInitScript(({ accountStorageKey, authStorageKey, storageKey, seededState, expiresAt }) => {
    window.localStorage.clear();
    window.localStorage.setItem(accountStorageKey, JSON.stringify(seededState));
    window.localStorage.setItem(`${storageKey}:last-account`, accountStorageKey);
    window.localStorage.setItem(authStorageKey, JSON.stringify({ expiresAt, savedAt: new Date().toISOString() }));
  }, { accountStorageKey, authStorageKey, storageKey, seededState, expiresAt });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const currentTablesDockButton = page.getByRole('button', { name: 'Current tables', exact: true });
  await currentTablesDockButton.waitFor({ timeout: 15000 });
  await currentTablesDockButton.click();
  const currentTablesDialog = page.getByRole('dialog', { name: 'Current tables' });
  await currentTablesDialog.waitFor();
  const workspaceDialogLayout = await currentTablesDialog.evaluate((dialog) => {
    const backdrop = document.querySelector('.floor-workspace-backdrop');
    const dialogRect = dialog.getBoundingClientRect();
    const dialogStyle = window.getComputedStyle(dialog);
    const backdropStyle = backdrop ? window.getComputedStyle(backdrop) : null;
    const centerTarget = document.elementFromPoint(
      dialogRect.left + dialogRect.width / 2,
      dialogRect.top + dialogRect.height / 2
    );
    return {
      backdropZIndex: Number(backdropStyle?.zIndex ?? 0),
      centerIsDialog: Boolean(centerTarget && (centerTarget === dialog || dialog.contains(centerTarget))),
      dialogZIndex: Number(dialogStyle.zIndex),
      height: dialogRect.height,
      inViewport: dialogRect.left >= 0 && dialogRect.top >= 0 && dialogRect.right <= window.innerWidth && dialogRect.bottom <= window.innerHeight,
      position: dialogStyle.position,
      width: dialogRect.width
    };
  });
  assert(workspaceDialogLayout.position === 'fixed', 'Current Tables dialog should be fixed above the room.');
  assert(workspaceDialogLayout.width > 0 && workspaceDialogLayout.height > 0, 'Current Tables dialog should have visible bounds.');
  assert(workspaceDialogLayout.inViewport, 'Current Tables dialog should remain inside the viewport.');
  assert(workspaceDialogLayout.dialogZIndex > workspaceDialogLayout.backdropZIndex, 'Current Tables dialog should be above its backdrop.');
  assert(workspaceDialogLayout.centerIsDialog, 'Current Tables dialog should be the topmost content at its center.');

  const tableCard = page.locator('.active-game-card').filter({ hasText: 'Table 1' });
  await tableCard.getByRole('button', { name: 'Start Table' }).click();
  await tableCard.getByText('Table 1 - Running - Drop').waitFor({ timeout: 10000 });

  await tableCard.getByTitle('Add player to an open seat').click();
  let seatPicker = page.locator('.seat-picker-modal');
  await seatPicker.getByRole('button', { name: /Alex Seat/ }).click();
  await tableCard.getByText('1/10', { exact: true }).waitFor({ timeout: 10000 });

  await tableCard.getByTitle('Add player to an open seat').click();
  seatPicker = page.locator('.seat-picker-modal');
  await seatPicker.getByRole('button', { name: /Bailey Button/ }).click();
  await tableCard.getByText('2/10', { exact: true }).waitFor({ timeout: 10000 });

  await tableCard.getByTitle('Add player to an open seat').click();
  seatPicker = page.locator('.seat-picker-modal');
  await seatPicker.getByRole('button', { name: /Casey Call/ }).click();
  await tableCard.getByText('3/10', { exact: true }).waitFor({ timeout: 10000 });

  await tableCard.getByTitle('Add player to an open seat').click();
  seatPicker = page.locator('.seat-picker-modal');
  await seatPicker.getByRole('button', { name: /Evan Entry/ }).click();
  await tableCard.getByText('4/10', { exact: true }).waitFor({ timeout: 10000 });

  await tableCard.getByTitle('Add player to an open seat').click();
  seatPicker = page.locator('.seat-picker-modal');
  assert(await seatPicker.locator('.seat-picker-card').count() >= 1, 'Seat picker should show available player cards.');
  assert(await tableCard.locator('.quick-seat-row').count() === 0, 'Legacy quick-seat dropdown row should not render.');
  await seatPicker.getByTitle('Close player picker').click();
  await page.getByRole('button', { name: 'Close Current Tables' }).click();
  assert(await page.locator('.floor-map-table').count() === 6, 'Floor map should retain all six permanent tables.');
  assert(await page.locator('.floor-map-table.is-empty').count() === 5, 'Five permanent tables should remain visible and empty.');

  const activeTableIdentity = page.getByRole('button', { name: /^Open Table 1, 4 of 10 seats filled/ });
  const tableStateBeforeMenu = await page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) || '{}');
    return {
      physicalTableIds: (state.physicalTables || []).map((table) => table.id),
      playerSessionIds: (state.playerSessions || []).map((session) => `${session.id}:${session.leftAt || ''}`),
      sessions: (state.sessions || []).map((session) => `${session.id}:${session.status}:${session.seatsFilled}`)
    };
  }, accountStorageKey);
  await activeTableIdentity.click({ button: 'right' });
  const tableContextMenu = page.getByRole('menu', { name: 'Table 1 table actions' });
  await tableContextMenu.waitFor();
  const tableContextItems = tableContextMenu.getByRole('menuitem');
  assert(await tableContextItems.count() === 3, 'Table context menu should contain exactly three actions.');
  assert(JSON.stringify((await tableContextItems.allTextContents()).map((label) => label.trim())) === JSON.stringify([
    'Clear table',
    'Delete table',
    'Merge table'
  ]), 'Table context menu should offer Clear, Delete, and Merge in order.');
  assert(await tableContextMenu.getByRole('menuitem', { name: 'Merge table' }).isDisabled(), 'Merge should remain visible but disabled without a compatible target.');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Clear table');
  await page.keyboard.press('ArrowDown');
  assert(await tableContextMenu.getByRole('menuitem', { name: 'Delete table' }).evaluate((item) => item === document.activeElement), 'ArrowDown should focus Delete table.');
  await page.keyboard.press('ArrowDown');
  assert(await tableContextMenu.getByRole('menuitem', { name: 'Clear table' }).evaluate((item) => item === document.activeElement), 'Arrow navigation should skip the disabled Merge action and wrap to Clear table.');
  await page.keyboard.press('Escape');
  await tableContextMenu.waitFor({ state: 'detached' });
  const activeFloorTable = page.locator('.floor-map-table').filter({ has: activeTableIdentity });
  assert(await activeFloorTable.evaluate((table) => table === document.activeElement || table.contains(document.activeElement)), 'Escape should return focus to the table that opened the menu.');
  const tableStateAfterMenu = await page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) || '{}');
    return {
      physicalTableIds: (state.physicalTables || []).map((table) => table.id),
      playerSessionIds: (state.playerSessions || []).map((session) => `${session.id}:${session.leftAt || ''}`),
      sessions: (state.sessions || []).map((session) => `${session.id}:${session.status}:${session.seatsFilled}`)
    };
  }, accountStorageKey);
  assert(JSON.stringify(tableStateAfterMenu) === JSON.stringify(tableStateBeforeMenu), 'Inspecting table actions must not mutate, clear, merge, or delete table data.');

  const classicFloorButton = page.getByRole('button', { name: 'Classic floor view' });
  const graphicFloorButton = page.getByRole('button', { name: 'Graphic floor view' });
  await classicFloorButton.click();
  const classicOverview = page.locator('.floor-classic-overview');
  await classicOverview.waitFor();
  assert(await classicFloorButton.getAttribute('aria-pressed') === 'true', 'Classic view toggle should report its selected state.');
  const classicTable = classicOverview.locator('.floor-classic-table[data-session-id="session-main"]');
  assert(await classicTable.count() === 1, 'Classic view should show the running seeded table.');
  assert(await classicTable.getByRole('heading', { name: 'Table 1' }).count() === 1, 'Classic view should identify Table 1.');
  assert(await classicTable.getByText('1/2 NLH', { exact: true }).count() === 1, 'Classic view should show the configured game.');
  assert(await classicTable.getByText('4/10', { exact: true }).count() === 1, 'Classic view should show the seated-player count.');
  assert(await classicTable.locator('.floor-classic-player').count() === 4, 'Classic view should show all four seated players.');
  const classicPlayerText = await classicTable.locator('.floor-classic-player-list').innerText();
  for (const playerName of ['Alex Seat', 'Bailey Button', 'Casey Call', 'Evan Entry']) {
    assert(classicPlayerText.includes(playerName), `Classic view should include ${playerName}.`);
  }
  await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key) || '{}').settings?.showPlayerGrid === false, accountStorageKey);
  await graphicFloorButton.click();
  await page.locator('.floor-room-map').waitFor();
  assert(await graphicFloorButton.getAttribute('aria-pressed') === 'true', 'Graphic view toggle should report its restored selected state.');
  await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key) || '{}').settings?.showPlayerGrid === true, accountStorageKey);

  await activeTableIdentity.click();
  let tableViewGrid = page.locator('.table-view-grid');
  await tableViewGrid.waitFor();
  await page.getByRole('button', { name: 'Table display settings' }).click();
  let tableSettingsDialog = page.getByRole('dialog', { name: 'Display settings' });
  await tableSettingsDialog.waitFor();
  await tableSettingsDialog.getByRole('button', { name: 'Green room', exact: true }).click();
  await tableSettingsDialog.getByRole('button', { name: 'Round', exact: true }).click();
  await tableSettingsDialog.getByRole('button', { name: 'Close table display settings' }).click();
  await page.waitForFunction(() => {
    const grid = document.querySelector('.table-view-grid');
    return grid?.classList.contains('table-theme-green') && grid.classList.contains('table-format-round');
  });
  const savedTableDisplay = await page.evaluate(() => JSON.parse(window.localStorage.getItem('orbit-table-display-v1:physical-table-1') || '{}'));
  assert(savedTableDisplay.theme === 'green' && savedTableDisplay.format === 'round', 'Table theme and format should persist for the physical table.');
  await page.locator('button[aria-label="Back to floor"]').click();
  await page.locator('.floor-room-map').waitFor();
  await activeTableIdentity.click();
  tableViewGrid = page.locator('.table-view-grid');
  await tableViewGrid.waitFor();
  assert(await tableViewGrid.evaluate((grid) => grid.classList.contains('table-theme-green') && grid.classList.contains('table-format-round')), 'Table presentation should survive leaving and reopening the table view.');

  await page.getByRole('button', { name: 'Open details for Alex Seat at seat 1' }).click();
  const playerMenu = page.locator('.poker-seat-card.open .poker-seat-menu');
  await playerMenu.waitFor();
  const playerActionWorkspace = playerMenu.locator('.poker-seat-menu-workspace');
  const workspaceBeforeAction = await playerActionWorkspace.evaluate((workspace) => {
    const bounds = workspace.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  });
  await playerMenu.getByRole('button', { name: 'Show buy-in form for Alex Seat' }).click();
  await playerMenu.locator('.buyin-action-panel').waitFor();
  const workspaceAfterAction = await playerActionWorkspace.evaluate((workspace) => {
    const bounds = workspace.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  });
  assert(workspaceBeforeAction.height >= 219 && workspaceBeforeAction.height <= 261, 'Player action workspace should use the fixed 220-260px presentation range.');
  assert(Math.abs(workspaceAfterAction.height - workspaceBeforeAction.height) <= 1, 'Opening the buy-in form must not expand the player action workspace.');
  assert(Math.abs(workspaceAfterAction.width - workspaceBeforeAction.width) <= 1, 'Opening the buy-in form must not widen the player action workspace.');
  await playerMenu.getByRole('button', { name: 'Close player details' }).click();

  await page.getByRole('button', { name: 'Table display settings' }).click();
  tableSettingsDialog = page.getByRole('dialog', { name: 'Display settings' });
  await tableSettingsDialog.getByRole('button', { name: 'Midnight', exact: true }).click();
  await tableSettingsDialog.getByRole('button', { name: 'Oval', exact: true }).click();
  await tableSettingsDialog.getByRole('button', { name: 'Close table display settings' }).click();
  await page.locator('button[aria-label="Back to floor"]').click();
  await page.locator('.floor-room-map').waitFor();
  assert(await graphicFloorButton.getAttribute('aria-pressed') === 'true', 'Smoke flow should return to the Graphic floor view.');

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1180, height: 800 },
    { width: 900, height: 760 },
    { width: 680, height: 760 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const layout = await page.locator('.floor-view-shell').evaluate((shell) => {
      const stage = shell.querySelector('.floor-room-workspace');
      const map = stage?.querySelector('.floor-room-map');
      const mapViewport = stage?.querySelector('.floor-room-map-viewport');
      const dock = stage?.querySelector('.floor-workspace-dock');
      const shellRect = shell.getBoundingClientRect();
      const stageRect = stage?.getBoundingClientRect();
      const mapRect = map?.getBoundingClientRect();
      const viewportRect = mapViewport?.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      return {
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        dockInsideStage: Boolean(stageRect && dockRect && dockRect.left >= stageRect.left && dockRect.right <= stageRect.right && dockRect.bottom <= stageRect.bottom),
        dockOverMap: Boolean(mapRect && dockRect && dockRect.top < mapRect.bottom && dockRect.bottom <= mapRect.bottom),
        mapFillsStage: Boolean(stageRect && mapRect && Math.abs(stageRect.width - mapRect.width) <= 1 && Math.abs(stageRect.height - mapRect.height) <= 1),
        stageFillsShell: Boolean(stageRect && stageRect.bottom >= shellRect.bottom - 1),
        viewportFillsMap: Boolean(mapRect && viewportRect && viewportRect.bottom >= mapRect.bottom - 1),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      };
    });
    assert(layout.documentWidth <= layout.viewportWidth, `Management shell overflowed horizontally at ${viewport.width}px.`);
    assert(layout.documentHeight <= layout.viewportHeight + 1, `Management shell overflowed vertically at ${viewport.width}px.`);
    assert(layout.mapFillsStage && layout.viewportFillsMap, `Room map did not fill its workspace at ${viewport.width}px.`);
    assert(layout.dockInsideStage && layout.dockOverMap, `Floor dock was not overlaid within the room at ${viewport.width}px.`);
    assert(layout.stageFillsShell, `Room workspace did not consume the remaining Floor container at ${viewport.width}px.`);
    if (screenshotDirectory && (viewport.width === 1440 || viewport.width === 1180)) {
      await page.screenshot({ fullPage: true, path: path.join(screenshotDirectory, `floor-${viewport.width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('button', { name: 'Players', exact: true }).click();
  const addPlayerButton = page.locator('button.player-tool-icon[aria-label="Add player"]');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 760 },
    { width: 680, height: 760 },
    { width: 390, height: 700 }
  ]) {
    await page.setViewportSize(viewport);
    await addPlayerButton.click();
    const responsiveDialog = page.getByRole('dialog', { name: 'Add member' });
    const importer = responsiveDialog.locator('.player-popup-import');
    const submitButton = responsiveDialog.getByRole('button', { name: 'Add active member' });
    await importer.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
    const importerLayout = await responsiveDialog.evaluate((dialog) => {
      const importerElement = dialog.querySelector('.player-popup-import');
      const dialogRect = dialog.getBoundingClientRect();
      const importerRect = importerElement?.getBoundingClientRect();
      return {
        dialogTop: dialogRect.top,
        dialogBottom: dialogRect.bottom,
        importerTop: importerRect?.top,
        importerBottom: importerRect?.bottom,
        reachable: Boolean(importerRect && importerRect.top >= dialogRect.top - 1 && importerRect.bottom <= dialogRect.bottom + 1)
      };
    });
    await submitButton.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
    const dialogLayout = await responsiveDialog.evaluate((dialog) => {
      const form = dialog.querySelector('.player-popup-form');
      const actions = dialog.querySelector('.player-popup-actions');
      const dialogRect = dialog.getBoundingClientRect();
      const actionsRect = actions?.getBoundingClientRect();
      return {
        dialogInViewport: dialogRect.top >= 0 && dialogRect.bottom <= window.innerHeight,
        formScrollable: Boolean(form && form.scrollHeight > form.clientHeight && getComputedStyle(form).overflowY === 'auto'),
        actionsReachable: Boolean(actionsRect && actionsRect.top >= dialogRect.top - 1 && actionsRect.bottom <= dialogRect.bottom + 1)
      };
    });
    assert(dialogLayout.dialogInViewport, `Add member dialog escaped the ${viewport.width}x${viewport.height} viewport.`);
    assert(importerLayout.reachable, `Player importer was unreachable at ${viewport.width}x${viewport.height}: ${JSON.stringify(importerLayout)}.`);
    assert(dialogLayout.actionsReachable, `Add member actions were unreachable at ${viewport.width}x${viewport.height}.`);
    if (viewport.height < 900) {
      assert(dialogLayout.formScrollable, `Add member form did not scroll at ${viewport.width}x${viewport.height}.`);
    }
    await responsiveDialog.getByRole('button', { name: 'Close player form' }).click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await addPlayerButton.focus();
  await page.keyboard.press('Enter');
  const addPlayerDialog = page.getByRole('dialog', { name: 'Add member' });
  await addPlayerDialog.getByRole('textbox', { name: 'Player name' }).fill('Smoke New Player');
  await addPlayerDialog.getByRole('button', { name: 'Add active member' }).click();
  await page.locator('.profile-card').filter({ hasText: 'Smoke New Player' }).waitFor({ timeout: 10000 });

  const finalState = await page.evaluate((accountStorageKey) => JSON.parse(window.localStorage.getItem(accountStorageKey) || '{}'), accountStorageKey);
  assert(finalState.sessions?.[0]?.status === 'Running', 'Seeded table did not remain running.');
  assert(finalState.sessions?.[0]?.physicalTableId === 'physical-table-1', 'Seeded game did not remain assigned to Table 1.');
  assert(finalState.physicalTables?.length === 6, 'Permanent physical tables were not preserved.');
  const activePlayerSessions = (finalState.playerSessions || []).filter((session) => !session.leftAt);
  assert(activePlayerSessions.length === 4, 'Expected four seated players after smoke flow.');
  assert(finalState.sessions?.[0]?.seatsFilled === activePlayerSessions.length, 'Expected table count to match active seated players.');
  assert(activePlayerSessions.some((session) => session.playerName === 'Evan Entry' && session.seatNumber > 0), 'Expected database player to be assigned an open seat.');
  assert((finalState.interests || []).some((interest) => interest.playerName === 'Evan Entry' && interest.status === 'Seated'), 'Expected non-checked-in player to be checked in and seated.');
  assert((finalState.profiles || []).some((profile) => profile.name === 'Smoke New Player'), 'New player profile was not persisted.');

  if (pageErrors.length || consoleErrors.length || failedRequests.length) {
    throw new Error(JSON.stringify({ pageErrors, consoleErrors, failedRequests }, null, 2));
  }

  console.log('Management production-bundle smoke passed: profile add, table start, seating, floor views/actions, table presentation, stable player actions, responsive floor, and clean console.');
} finally {
  await browser.close();
}
