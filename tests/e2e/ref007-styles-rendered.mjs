import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const [mode = 'capture', baselineArgument = '.orbit/ref007-before', outputArgument = '.orbit/ref007-after'] = process.argv.slice(2);
if (!['capture', 'compare'].includes(mode)) {
  throw new Error('Usage: node tests/e2e/ref007-styles-rendered.mjs <capture|compare> [baseline-dir] [output-dir]');
}

const baseUrl = process.env.TABLE_MANAGER_URL || 'http://127.0.0.1:5173';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUrl)) {
  throw new Error(`REF-007 rendered comparison requires an isolated localhost URL, received ${baseUrl}`);
}

const storageKey = 'table-manager-state-v1';
const accountKey = 'ref007-visual-license';
const accountStorageKey = `${storageKey}:${accountKey}`;
const authStorageKey = `${storageKey}:auth:${accountKey}`;
const fixedNow = '2026-08-01T18:00:00.000Z';
const expiresAt = '2027-12-31';

const seededState = {
  games: [
    { id: 'nlh-1-2', name: '1/2 NLH', maxSeats: 10, minInRoomForLikely: 4, minFlexibleForLikely: 2, minTotalForViable: 5 },
    { id: 'plo-1-2', name: '1/2 PLO', maxSeats: 8, minInRoomForLikely: 4, minFlexibleForLikely: 2, minTotalForViable: 5 }
  ],
  profiles: [
    {
      id: 'profile-alex', name: 'Alex Seat', phone: '555-0101', birthday: '', membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01', totalTimePlayedHours: 12, lastSessionTimePlayedHours: 3,
      commonlyPlaysWithProfileIds: [], preferredGameId: 'nlh-1-2', preferredGameIds: ['nlh-1-2'],
      gamePlayCounts: { 'nlh-1-2': 4 }, mostPlayedGameId: 'nlh-1-2', preferredStakes: '1/2 NLH',
      typicalBuyInMin: 200, typicalBuyInMax: 500, willingnessToMove: true, typicalAvailability: 'Evenings',
      usualCompanions: [], preferredTags: ['Regular'], notes: 'Visual fixture'
    },
    {
      id: 'profile-bailey', name: 'Bailey Button', phone: '555-0102', birthday: '', membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01', totalTimePlayedHours: 20, lastSessionTimePlayedHours: 4,
      commonlyPlaysWithProfileIds: [], preferredGameId: 'nlh-1-2', preferredGameIds: ['nlh-1-2', 'plo-1-2'],
      gamePlayCounts: { 'nlh-1-2': 6, 'plo-1-2': 2 }, mostPlayedGameId: 'nlh-1-2', preferredStakes: '1/2 NLH',
      typicalBuyInMin: 300, typicalBuyInMax: 700, willingnessToMove: false, typicalAvailability: 'Weekends',
      usualCompanions: [], preferredTags: ['VIP'], notes: ''
    },
    {
      id: 'profile-casey', name: 'Casey Call', phone: '555-0103', birthday: '', membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01', totalTimePlayedHours: 8, lastSessionTimePlayedHours: 2,
      commonlyPlaysWithProfileIds: [], preferredGameId: 'plo-1-2', preferredGameIds: ['plo-1-2'],
      gamePlayCounts: { 'plo-1-2': 3 }, mostPlayedGameId: 'plo-1-2', preferredStakes: '1/2 PLO',
      typicalBuyInMin: 300, typicalBuyInMax: 800, willingnessToMove: true, typicalAvailability: 'Tonight',
      usualCompanions: [], preferredTags: [], notes: ''
    }
  ],
  interests: [
    { id: 'interest-alex', profileId: 'profile-alex', playerName: 'Alex Seat', gameId: 'nlh-1-2', status: 'Seated', timestamp: fixedNow, interestedAt: fixedNow, arrivedAt: fixedNow, seatedAt: fixedNow, notes: '' },
    { id: 'interest-bailey', profileId: 'profile-bailey', playerName: 'Bailey Button', gameId: 'nlh-1-2', status: 'Seated', timestamp: fixedNow, interestedAt: fixedNow, arrivedAt: fixedNow, seatedAt: fixedNow, notes: '' },
    { id: 'interest-casey', profileId: 'profile-casey', playerName: 'Casey Call', gameId: 'plo-1-2', status: 'Arrived', timestamp: fixedNow, interestedAt: fixedNow, arrivedAt: fixedNow, notes: '' }
  ],
  sessions: [
    { id: 'session-main', gameId: 'nlh-1-2', label: 'Main Table', status: 'Running', seatsFilled: 2, maxSeats: 10, timeFeeBased: false, collectionMode: 'Drop', tags: ['Featured'], startedAt: fixedNow }
  ],
  playerSessions: [
    { id: 'player-session-alex', profileId: 'profile-alex', playerName: 'Alex Seat', gameId: 'nlh-1-2', tableId: 'session-main', seatNumber: 1, seatedAt: fixedNow, initialBuyIn: 300, totalBuyIn: 300, timeFeeEnabled: false },
    { id: 'player-session-bailey', profileId: 'profile-bailey', playerName: 'Bailey Button', gameId: 'nlh-1-2', tableId: 'session-main', seatNumber: 6, seatedAt: fixedNow, initialBuyIn: 500, totalBuyIn: 500, timeFeeEnabled: false }
  ],
  buyIns: [
    { id: 'buyin-alex', profileId: 'profile-alex', playerName: 'Alex Seat', gameId: 'nlh-1-2', tableId: 'session-main', amount: 300, timestamp: fixedNow, note: 'Initial buy-in' },
    { id: 'buyin-bailey', profileId: 'profile-bailey', playerName: 'Bailey Button', gameId: 'nlh-1-2', tableId: 'session-main', amount: 500, timestamp: fixedNow, note: 'Initial buy-in' }
  ],
  dropLogs: [{ id: 'drop-main', tableId: 'session-main', gameId: 'nlh-1-2', amount: 42, timestamp: fixedNow }],
  dealerAssignments: [], handCountLogs: [], timeFeeLogs: [], revenueTransactions: [], playerLedger: [], tableEvents: [],
  inAppNotifications: [], history: [], nightCloses: [], feedback: [], scriptTemplates: [], correctionLog: [], usageEvents: [],
  settings: {
    lowLight: false, defaultCollectionMode: 'Drop', defaultTableCap: 10, defaultHourlyFee: 0,
    defaultEstimatedDropPerSeatHour: 0,
    collectionProfiles: [
      { gameId: 'nlh-1-2', collectionMode: 'Drop', hourlyFee: 0, estimatedDropPerSeatHour: 0 },
      { gameId: 'plo-1-2', collectionMode: 'Drop', hourlyFee: 0, estimatedDropPerSeatHour: 0 }
    ],
    showPlayerGrid: true, showDashboardKpis: true, showRecentPlayers: true,
    pilotAccess: { authorized: true, authorizationCode: 'REF007-VISUAL', licenseId: accountKey, issuedTo: 'Orbit Visual Fixture', expiresAt, keyFileName: 'local-fixture.key' },
    clubAccount: { clubName: 'Orbit Visual Room', accountName: 'Visual QA', contactName: 'QA', email: 'visual@example.test', phone: '', address: '' },
    accountLogin: { username: 'visual', passwordSalt: 'local-fixture', passwordHash: 'local-fixture', createdAt: fixedNow },
    staffAccounts: [], activeStaffId: undefined
  }
};

const cases = [
  { name: 'floor-wide-light', hash: '#/floor', heading: 'Floor', viewport: { width: 1440, height: 900 }, lowLight: false },
  { name: 'floor-compact-dark', hash: '#/floor', heading: 'Floor', viewport: { width: 1024, height: 768 }, lowLight: true },
  { name: 'table-wide', hash: '#/table?sessionId=session-main', heading: 'Main Table', viewport: { width: 1440, height: 900 }, lowLight: true },
  { name: 'players-wide', hash: '#/profiles', heading: 'Players', viewport: { width: 1440, height: 900 }, lowLight: false },
  { name: 'games-compact', hash: '#/builder', heading: 'Games', viewport: { width: 1024, height: 768 }, lowLight: false },
  { name: 'tournaments-wide', hash: '#/tournaments', heading: 'Tournaments', viewport: { width: 1440, height: 900 }, lowLight: true },
  { name: 'reports-wide', hash: '#/summary', heading: 'Reports', viewport: { width: 1440, height: 900 }, lowLight: false },
  { name: 'settings-compact', hash: '#/customization', heading: 'Settings', viewport: { width: 1024, height: 768 }, lowLight: false }
];

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodeScreenshotPng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('Expected a PNG screenshot.');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bytesPerPixel = 0;
  const compressedChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
        throw new Error(`Unsupported screenshot PNG format: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`);
      }
      bytesPerPixel = colorType === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      compressedChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  const scanlines = inflateSync(Buffer.concat(compressedChunks));
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = scanlines[inputOffset];
    inputOffset += 1;
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const encoded = scanlines[inputOffset + column];
      const left = column >= bytesPerPixel ? pixels[rowOffset + column - bytesPerPixel] : 0;
      const above = row > 0 ? pixels[rowOffset + column - stride] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel ? pixels[rowOffset + column - stride - bytesPerPixel] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : filter === 4 ? paethPredictor(left, above, upperLeft)
                : undefined;
      if (predictor === undefined) throw new Error(`Unsupported PNG filter ${filter}.`);
      pixels[rowOffset + column] = (encoded + predictor) & 0xff;
    }
    inputOffset += stride;
  }

  return { width, height, bytesPerPixel, pixels };
}

function compareScreenshots(baseline, actual) {
  const before = decodeScreenshotPng(baseline);
  const after = decodeScreenshotPng(actual);
  if (before.width !== after.width || before.height !== after.height || before.bytesPerPixel !== after.bytesPerPixel) {
    return { changedPixels: Number.POSITIVE_INFINITY, maxChannelDelta: Number.POSITIVE_INFINITY };
  }

  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let offset = 0; offset < before.pixels.length; offset += before.bytesPerPixel) {
    let pixelChanged = false;
    for (let channel = 0; channel < before.bytesPerPixel; channel += 1) {
      const delta = Math.abs(before.pixels[offset + channel] - after.pixels[offset + channel]);
      if (delta) pixelChanged = true;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    if (pixelChanged) changedPixels += 1;
  }
  return { changedPixels, maxChannelDelta };
}

const baselineDirectory = path.resolve(baselineArgument);
const outputDirectory = path.resolve(mode === 'capture' ? baselineArgument : outputArgument);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const manifest = [];
const mismatches = [];

try {
  for (const visualCase of cases) {
    const page = await browser.newPage({ viewport: visualCase.viewport, colorScheme: visualCase.lowLight ? 'dark' : 'light', reducedMotion: 'reduce' });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(({ accountStorageKey, authStorageKey, storageKey, seededState, expiresAt, lowLight, runtimeNow }) => {
      const NativeDate = Date;
      globalThis.Date = class extends NativeDate {
        constructor(...arguments_) {
          super(...(arguments_.length ? arguments_ : [runtimeNow]));
        }

        static now() {
          return runtimeNow;
        }
      };
      const state = { ...seededState, settings: { ...seededState.settings, lowLight } };
      window.localStorage.clear();
      window.localStorage.setItem(accountStorageKey, JSON.stringify(state));
      window.localStorage.setItem(`${storageKey}:last-account`, accountStorageKey);
      window.localStorage.setItem(authStorageKey, JSON.stringify({ expiresAt, savedAt: '2026-08-01T18:00:00.000Z' }));
    }, { accountStorageKey, authStorageKey, storageKey, seededState, expiresAt, lowLight: visualCase.lowLight, runtimeNow: Date.parse('2026-08-07T18:00:00.000Z') });

    await page.goto(`${baseUrl}/${visualCase.hash}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.getByRole('heading', { name: visualCase.heading, exact: true }).waitFor({ timeout: 15000 });
    } catch (error) {
      const visibleText = await page.locator('body').innerText().catch(() => '<body unavailable>');
      throw new Error(`${visualCase.name} did not render ${visualCase.heading}. Page errors: ${pageErrors.join(' | ') || 'none'}. Visible text: ${visibleText}`, { cause: error });
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const outputPath = path.join(outputDirectory, `${visualCase.name}.png`);
    const screenshot = await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true });
    await writeFile(outputPath, screenshot);
    const sha256 = createHash('sha256').update(screenshot).digest('hex');
    manifest.push({ ...visualCase, bytes: screenshot.length, sha256 });

    if (mode === 'compare') {
      const baseline = await readFile(path.join(baselineDirectory, `${visualCase.name}.png`));
      const difference = compareScreenshots(baseline, screenshot);
      if (difference.changedPixels > 100 || difference.maxChannelDelta > 3) {
        mismatches.push(`${visualCase.name} (${difference.changedPixels} pixels, max channel delta ${difference.maxChannelDelta})`);
      }
    }

    await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (mismatches.length) {
  throw new Error(`REF-007 rendered comparison changed: ${mismatches.join(', ')}`);
}

console.log(mode === 'capture'
  ? `Captured ${cases.length} REF-007 rendered baselines in ${outputDirectory}.`
  : `REF-007 rendered comparison passed for ${cases.length} route/viewport cases.`);
