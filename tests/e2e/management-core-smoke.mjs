import { chromium } from '@playwright/test';

const baseUrl = process.env.TABLE_MANAGER_URL || 'http://127.0.0.1:5173';
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
    }
  ],
  sessions: [
    {
      id: 'session-main',
      gameId: 'nlh-1-2',
      label: 'Main Table',
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
  await page.locator('h1', { hasText: 'TableTalk' }).waitFor({ timeout: 15000 });

  const tableCard = page.locator('.active-game-card').filter({ hasText: 'Main Table' });
  await tableCard.locator('.start-table-panel').waitFor({ timeout: 10000 });
  assert(await tableCard.locator('.player-pick-row').count() >= 2, 'Start table picker did not show available players.');

  await tableCard.locator('.player-pick-row').filter({ hasText: 'Alex Seat' }).locator('input[type="checkbox"]').check();
  await tableCard.locator('.player-pick-row').filter({ hasText: 'Bailey Button' }).locator('input[type="checkbox"]').check();
  await tableCard.getByRole('button', { name: 'Start with selected' }).click();
  await tableCard.getByText('Main Table - Running - Drop').waitFor({ timeout: 10000 });
  await tableCard.getByText('Alex Seat').waitFor({ timeout: 10000 });
  await tableCard.getByText('Bailey Button').waitFor({ timeout: 10000 });

  await tableCard.getByTitle('Add player to an open seat').click();
  const quickSeat = tableCard.locator('.quick-seat-row');
  await quickSeat.locator('select').selectOption('profile:profile-casey');
  await quickSeat.getByRole('button', { name: 'Seat Player' }).click();
  await tableCard.getByText('Casey Call').waitFor({ timeout: 10000 });

  await page.getByRole('button', { name: 'Profiles' }).click();
  await page.locator('input.profile-form-name').fill('Smoke New Player');
  await page.locator('form.profile-form button.primary-button').click();
  await page.getByText('Smoke New Player profile added.').waitFor({ timeout: 10000 });
  await page.locator('.profile-card').filter({ hasText: 'Smoke New Player' }).waitFor({ timeout: 10000 });

  const finalState = await page.evaluate((accountStorageKey) => JSON.parse(window.localStorage.getItem(accountStorageKey) || '{}'), accountStorageKey);
  assert(finalState.sessions?.[0]?.status === 'Running', 'Seeded table did not remain running.');
  assert((finalState.playerSessions || []).filter((session) => !session.leftAt).length === 3, 'Expected three seated players after smoke flow.');
  assert((finalState.profiles || []).some((profile) => profile.name === 'Smoke New Player'), 'New player profile was not persisted.');

  console.log('Management core smoke passed: profile add, start table selection, and seating flows are functional.');
} finally {
  await browser.close();
}
