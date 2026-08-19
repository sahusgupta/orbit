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

  console.log('Management production-bundle smoke passed: profile add, table start, seating, responsive floor, and clean console.');
} finally {
  await browser.close();
}
