import { _electron as electron, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const privateKeyPathCandidates = [
  path.join(repoRoot, '.pilot-license-private-key.pem'),
  path.join(repoRoot, 'pilot-keys', '.pilot-license-private-key.pem')
];
const privateKeyPath = privateKeyPathCandidates.find((candidate) => fs.existsSync(candidate));

function canonicalPayload(payload) {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .reduce((record, key) => {
        record[key] = payload[key];
        return record;
      }, {})
  );
}

function readDerInteger(buffer, offset) {
  if (buffer[offset] !== 0x02) throw new Error('Invalid DER ECDSA signature.');
  const length = buffer[offset + 1];
  return { value: buffer.subarray(offset + 2, offset + 2 + length), nextOffset: offset + 2 + length };
}

function leftPad32(buffer) {
  const normalized = buffer[0] === 0 ? buffer.subarray(1) : buffer;
  if (normalized.length > 32) throw new Error('Invalid P-256 signature integer length.');
  return Buffer.concat([Buffer.alloc(32 - normalized.length), normalized]);
}

function derToRawP256Signature(derSignature) {
  if (derSignature[0] !== 0x30) throw new Error('Invalid DER ECDSA signature.');
  const first = readDerInteger(derSignature, 2);
  const second = readDerInteger(derSignature, first.nextOffset);
  return Buffer.concat([leftPad32(first.value), leftPad32(second.value)]);
}

function createPilotKey(tempDir) {
  if (!privateKeyPath) {
    throw new Error(`Missing private key. Checked: ${privateKeyPathCandidates.join(', ')}`);
  }
  const payload = {
    authorizationCode: `TT-PILOT-STRESS-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
    expiresAt: '2026-08-01',
    issuedTo: `Stress Test Club ${Date.now()}`,
    issuedAt: new Date().toISOString(),
    licenseId: `lic_stress_${crypto.randomBytes(8).toString('hex')}`
  };
  const derSignature = crypto.sign('sha256', Buffer.from(canonicalPayload(payload)), fs.readFileSync(privateKeyPath, 'utf8'));
  const keyPath = path.join(tempDir, 'stress-pilot-key.json');
  fs.writeFileSync(
    keyPath,
    JSON.stringify(
      {
        version: 1,
        algorithm: 'ECDSA-P256-SHA256',
        payload,
        signature: derToRawP256Signature(derSignature).toString('base64')
      },
      null,
      2
    )
  );
  return keyPath;
}

function createAccess(issuedTo) {
  return {
    authorized: true,
    authorizationCode: `TT-PILOT-STRESS-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
    expiresAt: '2026-08-01',
    activatedAt: new Date().toISOString(),
    issuedTo,
    issuedAt: new Date().toISOString(),
    licenseId: `lic_stress_${crypto.randomBytes(8).toString('hex')}`
  };
}

async function clickPanel(page, title) {
  const button = page.getByTitle(`Open ${title}`);
  if (await button.count()) await button.click();
}

async function quickAdd(page, playerName, gameName, status = 'Arrived') {
  const form = page.locator('form.quick-form');
  await form.getByPlaceholder('Player name').fill(playerName);
  await form.locator('select').nth(0).selectOption({ label: gameName });
  await form.locator('select').nth(1).selectOption(status);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.waitlist-card').filter({ hasText: playerName })).toContainText(gameName);
}

async function pickStartPlayer(tableCard, playerName, selectedCount) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const checkbox = tableCard.locator('.player-pick-row').filter({ hasText: playerName }).locator('input[type="checkbox"]');
      await checkbox.check({ force: true, timeout: 5000 });
      await expect(tableCard.locator('.start-table-head')).toContainText(`${selectedCount}/`, { timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await tableCard.locator('.start-table-panel').waitFor({ timeout: 5000 });
    }
  }
}

async function startGame(page, gameName, playerNames) {
  await clickPanel(page, 'Forming Games');
  const gameCard = page.locator('.forming-card').filter({ hasText: gameName });
  await gameCard.getByRole('button', { name: 'Form' }).click();
  const tableCard = page.locator('.active-game-card').filter({ hasText: gameName });
  await expect(tableCard.locator('.start-table-panel')).toBeVisible();
  const selectedText = await tableCard.locator('.start-table-head').innerText();
  if (!selectedText.includes(`${playerNames.length}/`)) {
    for (const [index, playerName] of playerNames.entries()) {
      await pickStartPlayer(tableCard, playerName, index + 1);
    }
  }
  await tableCard.getByRole('button', { name: 'Start with selected' }).click();
  await expect(tableCard).toContainText('Running');
  await openTable(tableCard);
  for (const playerName of playerNames) {
    await expect(tableCard).toContainText(playerName);
  }
  return tableCard;
}

async function openTable(tableCard) {
  const showTable = tableCard.locator('.table-collapsed-note').getByRole('button', { name: 'Show table' });
  if (await showTable.count()) await showTable.click();
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tablemanager-stress-'));
  const userDataDir = path.join(tempDir, 'user-data');
  const keyPath = createPilotKey(tempDir);
  const errors = [];
  let app;

  try {
    const launchEnv = {
      ...process.env,
      ELECTRON_DEV: 'false',
      TABLEMANAGER_USER_DATA_DIR: userDataDir
    };
    delete launchEnv.ELECTRON_RUN_AS_NODE;

    app = await electron.launch({
      args: [repoRoot],
      env: launchEnv
    });

    let page = await app.firstWindow();
    const attachErrorListeners = (targetPage) => {
      targetPage.on('pageerror', (error) => errors.push(error.message));
      targetPage.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      targetPage.on('requestfailed', (request) => {
        const failure = request.failure();
        if (failure?.errorText?.includes('ERR_FILE_NOT_FOUND')) {
          errors.push(`${failure.errorText}: ${request.url()}`);
        }
      });
    };
    attachErrorListeners(page);

    await expect(page.getByText('Pilot access')).toBeVisible({ timeout: 15000 });
    await page.locator('input[type="file"]').first().setInputFiles(keyPath);
    await expect(page.getByText('Valid through 2026-08-01')).toBeVisible();

    await page.getByPlaceholder('Club name').fill('Stress Room');
    await page.getByPlaceholder('Account name').fill('Stress Release Account');
    await page.getByPlaceholder('Primary contact').fill('Release Tester');
    await page.getByPlaceholder('Email').fill('stress@example.com');
    await page.getByPlaceholder('Phone').fill('555-0100');
    await page.getByPlaceholder('Club address').fill('123 Release Ave');
    await page.getByPlaceholder('Create login username').fill('floorboss');
    await page.getByPlaceholder('Create password').fill('stresspass1');
    await page.getByPlaceholder('Confirm password').fill('stresspass1');
    await page.getByPlaceholder('Games offered, one per line').fill('1/2 NLH\n1/2 PLO\n2/5 NLH');
    await page.getByPlaceholder('Hourly fee').fill('12');
    await page.getByPlaceholder('Drop estimate per occupied seat-hour').fill('7');
    await page.getByRole('button', { name: 'Unlock Dashboard' }).click();

    await expect(page.getByRole('heading', { name: 'Current Tables' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Unknown')).toHaveCount(0);

    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('heading', { name: 'Table Defaults' })).toBeVisible();
    const ploProfile = page.locator('.collection-profile-row').filter({ hasText: '1/2 PLO collection profile' });
    await ploProfile.getByRole('button', { name: 'Time' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Current Tables' })).toBeVisible();

    await clickPanel(page, 'Quick Add');
    await quickAdd(page, 'Alex Time', '1/2 PLO');
    await quickAdd(page, 'Brooke Time', '1/2 PLO');
    await quickAdd(page, 'Casey Drop', '1/2 NLH');
    await quickAdd(page, 'Drew Drop', '1/2 NLH');
    await expect(page.getByText('Unknown')).toHaveCount(0);

    const dropTable = await startGame(page, '1/2 NLH', ['Casey Drop', 'Drew Drop']);
    await expect(dropTable).toContainText('Drop');
    await dropTable.locator('summary', { hasText: 'Table admin' }).click();
    await dropTable.getByPlaceholder('Amount removed').fill('42');
    await dropTable.getByPlaceholder('Down, dealer, or note').fill('stress drop');
    await dropTable.getByRole('button', { name: 'Record Drop' }).click();
    await expect(dropTable).toContainText('Recorded drop: $42');
    await dropTable.locator('details.table-admin-details').evaluate((details) => {
      details.open = true;
    });
    await dropTable.locator('.table-mode-control').getByRole('button', { name: 'Time fees', exact: true }).click();
    await expect(dropTable).toContainText('Time fees');
    await expect(dropTable.locator('.poker-seat-card').filter({ hasText: 'Casey Drop' }).first()).toContainText('Time');
    await expect(dropTable.locator('.poker-seat-card').filter({ hasText: 'Casey Drop' }).first()).toContainText('0:00');

    const timeTable = await startGame(page, '1/2 PLO', ['Alex Time', 'Brooke Time']);
    await expect(timeTable).toContainText('Time fees');
    await timeTable.locator('.poker-seat-card').filter({ hasText: 'Alex Time' }).first().click();
    await timeTable.getByRole('button', { name: '+30' }).click();
    await expect(timeTable.locator('.poker-seat-card').filter({ hasText: 'Alex Time' }).first()).toContainText(/29:|30:/, { timeout: 5000 });

    await page.getByTitle('Open Table Overview').click();
    await page.locator('.table-overview-content select').selectOption({ label: 'Main Table - 1/2 PLO' });
    await expect(page.locator('.overview-player-row').filter({ hasText: 'Alex Time' })).toContainText(/29:|30:/);
    await page.locator('.table-overview-content select').selectOption({ label: 'Main Table - 1/2 NLH' });
    await expect(page.locator('.overview-player-row').filter({ hasText: 'Casey Drop' })).toContainText('0:00');

    await page.getByRole('button', { name: 'Profiles' }).click();
    await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible();
    await page.getByPlaceholder('Import CSV: name, preferred game, birthday, membership start, membership expiration, companions separated by |').fill(
      'Imported NLH,NLH 1/2,1990-01-01,2026-01-01,2027-01-01\nImported PLO,1/2 PLO,1991-02-02,2026-01-01,2027-01-01'
    );
    await page.getByRole('button', { name: 'Import Pasted People' }).click();
    await expect(page.locator('.profile-card').filter({ hasText: 'Imported NLH' })).toContainText('1/2 NLH');
    await expect(page.locator('.profile-card').filter({ hasText: 'Imported PLO' })).toContainText('1/2 PLO');
    await expect(page.getByText('Unknown')).toHaveCount(0);

    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Summary' }).click();
    await expect(page.getByText('Recorded Drop')).toBeVisible();
    await expect(page.getByText('$42').first()).toBeVisible();
    await expect(page.getByText('Time Fees Est.')).toBeVisible();
    await expect(page.getByText(/1\/2 PLO: \$\d+ time/)).toBeVisible();

    await app.close();
    app = await electron.launch({
      args: [repoRoot],
      env: launchEnv
    });
    page = await app.firstWindow();
    attachErrorListeners(page);
    await expect(page.getByRole('heading', { name: 'Current Tables' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Pilot access')).toHaveCount(0);
    const reloadedDropTable = page.locator('.active-game-card').filter({ hasText: '1/2 NLH' });
    const reloadedTimeTable = page.locator('.active-game-card').filter({ hasText: '1/2 PLO' });
    await expect(reloadedDropTable).toContainText('2/10');
    await expect(reloadedDropTable).toContainText('Time fees');
    await expect(reloadedTimeTable).toContainText('2/10');
    await expect(reloadedTimeTable).toContainText('Time fees');
    await expect(page.getByText('Unknown')).toHaveCount(0);

    const samePlayerName = 'Shared Player';
    const accessA = createAccess('Separate Club A');
    const accessB = createAccess('Separate Club B');
    const accountIsolation = await page.evaluate(
      async ({ accessA, accessB, samePlayerName }) => {
        const desktop = window.tableManagerDesktop;
        const makeState = (access, clubName, note) => ({
          games: [{ id: 'one-two-nlh', name: '1/2 NLH', maxSeats: 10, minInRoomForLikely: 3, minFlexibleForLikely: 2, minTotalForViable: 6 }],
          profiles: [{
            id: `profile-${clubName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: samePlayerName,
            birthday: '',
            membershipStartDate: '2026-01-01',
            membershipExpirationDate: '2027-01-01',
            totalTimePlayedHours: note === 'club-a-log' ? 1.25 : 3.5,
            lastSessionTimePlayedHours: note === 'club-a-log' ? 1.25 : 3.5,
            commonlyPlaysWithProfileIds: [],
            preferredGameId: 'one-two-nlh',
            preferredGameIds: ['one-two-nlh'],
            preferredStakes: '1/2 NLH',
            typicalBuyInMin: 0,
            typicalBuyInMax: 0,
            willingnessToMove: true,
            typicalAvailability: '',
            usualCompanions: [],
            preferredTags: [],
            notes: note
          }],
          interests: [],
          sessions: [],
          playerSessions: [{
            id: `${note}-session`,
            playerName: samePlayerName,
            profileId: `profile-${clubName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            gameId: 'one-two-nlh',
            tableId: `${note}-table`,
            seatedAt: '2026-05-20T01:00:00.000Z',
            leftAt: note === 'club-a-log' ? '2026-05-20T02:15:00.000Z' : undefined,
            timePurchasedMinutes: note === 'club-a-log' ? 0 : 30,
            timeRemainingMinutes: note === 'club-a-log' ? 0 : 30,
            lastTimeTickAt: '2026-05-20T01:00:00.000Z',
            timeFeeEnabled: note !== 'club-a-log',
            manualEdits: {}
          }],
          buyIns: [],
          dropLogs: [],
          playerLedger: [{
            id: `${note}-ledger`,
            type: 'Check-In',
            playerName: samePlayerName,
            profileId: `profile-${clubName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            tableId: `${note}-table`,
            gameId: 'one-two-nlh',
            timestamp: '2026-05-20T01:00:00.000Z',
            note
          }],
          tableEvents: [],
          history: [],
          feedback: [],
          scriptTemplates: [],
          correctionLog: [],
          usageEvents: [],
          settings: {
            lowLight: false,
            defaultCollectionMode: note === 'club-a-log' ? 'Drop' : 'Time',
            defaultHourlyFee: note === 'club-a-log' ? 0 : 12,
            defaultEstimatedDropPerSeatHour: note === 'club-a-log' ? 7 : 0,
            collectionProfiles: [{ gameId: 'one-two-nlh', collectionMode: note === 'club-a-log' ? 'Drop' : 'Time', hourlyFee: 12, estimatedDropPerSeatHour: 7 }],
            showPlayerGrid: true,
            showDashboardKpis: false,
            showRecentPlayers: true,
            pilotAccess: access,
            clubAccount: {
              clubName,
              accountName: `${clubName} Account`,
              contactName: 'Release Tester',
              email: `${clubName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.com`,
              phone: '',
              address: ''
            },
            staffAccounts: []
          }
        });

        await desktop.saveState(makeState(accessA, 'Separate Club A', 'club-a-log'));
        await desktop.saveState(makeState(accessB, 'Separate Club B', 'club-b-log'));
        const recordA = await desktop.loadStateForAccount(accessA);
        const recordB = await desktop.loadStateForAccount(accessB);
        return {
          aClub: recordA.state.settings.clubAccount.clubName,
          bClub: recordB.state.settings.clubAccount.clubName,
          aNotes: recordA.state.playerLedger.map((entry) => entry.note),
          bNotes: recordB.state.playerLedger.map((entry) => entry.note),
          aSessionIds: recordA.state.playerSessions.map((session) => session.id),
          bSessionIds: recordB.state.playerSessions.map((session) => session.id),
          aProfileHours: recordA.state.profiles[0].totalTimePlayedHours,
          bProfileHours: recordB.state.profiles[0].totalTimePlayedHours
        };
      },
      { accessA, accessB, samePlayerName }
    );
    expect(accountIsolation.aClub).toBe('Separate Club A');
    expect(accountIsolation.bClub).toBe('Separate Club B');
    expect(accountIsolation.aNotes).toEqual(['club-a-log']);
    expect(accountIsolation.bNotes).toEqual(['club-b-log']);
    expect(accountIsolation.aSessionIds).toEqual(['club-a-log-session']);
    expect(accountIsolation.bSessionIds).toEqual(['club-b-log-session']);
    expect(accountIsolation.aProfileHours).toBe(1.25);
    expect(accountIsolation.bProfileHours).toBe(3.5);

    await page.waitForTimeout(1000);
    if (errors.length) {
      throw new Error(`Renderer errors during stress run:\n${errors.join('\n')}`);
    }
  } finally {
    if (app) await app.close();
  }

  console.log(`Electron stress test passed with isolated user data: ${userDataDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
