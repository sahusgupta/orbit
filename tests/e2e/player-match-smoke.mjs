import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';

// Standalone engineering harness. Never start the normal API, Expo or production PlayerApp here.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputRoot = path.join(root, 'out/player-match-qa');
const schemeArgument = process.argv.slice(2).find((argument) => argument.startsWith('--scheme='));
const scheme = schemeArgument?.slice('--scheme='.length);
if (scheme !== undefined && scheme !== 'light' && scheme !== 'dark') throw new Error('QA scheme must be light or dark.');
if (!scheme) {
  await mkdir(outputRoot, { recursive: true });
  const results = [];
  for (const value of ['light', 'dark']) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), `--scheme=${value}`], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    const result = JSON.parse(await readFile(path.join(outputRoot, value, 'results.json'), 'utf8'));
    results.push(result); if (code !== 0) process.exitCode = 1;
  }
  await writeFile(path.join(outputRoot, 'results.json'), JSON.stringify({ status: process.exitCode ? 'fail' : 'pass', schemes: results }, null, 2));
  process.exit(process.exitCode ?? 0);
}
const out = path.join(outputRoot, scheme);
const source = path.join(root, 'tests/e2e/player-match-qa');
const require = createRequire(import.meta.url);
const playerRequire = createRequire(path.join(root, 'player-app/package.json'));
const { createOrbitMatchService } = require('../../apps/api/src/orbitMatchService.js');
const { createMatchState, applyMatchOperation } = require('../../apps/api/src/shared/orbitMatchState.cjs');
const started = performance.now();
const report = { status: 'running', scheme, runtime: 'Chromium + real React Native Web; no physical native device', checks: [], screenshots: [], pageErrors: [], blockedRequests: [], warnings: [], timings: {} };
await mkdir(out, { recursive: true });
const presentation = path.join(source, 'presentationAdapters.tsx');
const bundle = await build({ entryPoints: [path.join(source, 'entry.tsx')], outfile: path.join(out, 'app.js'), bundle: true, minify: true,
  platform: 'browser', target: 'es2022', jsx: 'automatic', metafile: true, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  alias: { 'react-native': playerRequire.resolve('react-native-web'), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    '@expo/vector-icons': presentation, 'expo-linear-gradient': presentation, 'react-native-qrcode-svg': presentation },
  plugins: [{ name: 'explicit-local-qa-transport', setup(builder) { builder.onResolve({ filter: /\/orbitSyncApi$/ }, () => ({ path: path.join(source, 'localTransport.ts') })); } }] });
const forbidden = Object.keys(bundle.metafile.inputs).filter((file) => /firebaseClient|firebase-admin|node_modules\/firebase\/|playerHttpApi|playerStorageCore/.test(file.replaceAll('\\', '/')));
if (forbidden.length) throw new Error(`Production ports reached the QA client bundle: ${forbidden.join(', ')}`);
await build({ entryPoints: [path.join(source, 'fixtures.ts')], outfile: path.join(out, 'fixtures.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createQaInventory, applyWaitlistRequest, qaUid, summarizeRetainedMatchHistory } = await import(pathToFileURL(path.join(out, 'fixtures.mjs')).href);
report.timings.bundleMs = Math.round(performance.now() - started);
let inventory = createQaInventory();
let mutationFailures = false, fetchFailures = false, waitlistFailures = false;
let waitlistRequests = [];
const documents = new Map();
let transactionTail = Promise.resolve();
const database = { runTransaction(operation) {
  const execute = async () => {
    const working = new Map([...documents].map(([key, value]) => [key, structuredClone(value)]));
    const result = await operation({
      async getDocument(key) { return structuredClone(working.get(key) ?? null); },
      setDocument(key, value) { working.set(key, structuredClone(value)); },
      createDocument(key, value) { if (working.has(key)) throw new Error('Duplicate QA document'); working.set(key, structuredClone(value)); }
    });
    documents.clear(); for (const [key, value] of working) documents.set(key, value);
    await writeFile(path.join(out, 'synthetic-server-state.json'), JSON.stringify([...documents], null, 2));
    return result;
  };
  const next = transactionTail.then(execute); transactionTail = next.catch(() => undefined); return next;
} };
const service = createOrbitMatchService({ database });
const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit Match local engineering QA</title><style>html,body,#root{margin:0;height:100%;background:#060c1a;color:#f4f7ff;font-family:system-ui}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const server = createServer(async (request, response) => {
  const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  try {
    if (pathname === '/' || pathname === '/index.html') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return; }
    if (pathname === '/app.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(await readFile(path.join(out, 'app.js'))); return; }
    if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (!pathname.startsWith('/qa/') || request.headers['x-local-qa-actor'] !== qaUid) { send(403, { error: 'Only the explicit local QA actor is accepted.' }); return; }
    let bytes = 0, body = '';
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 32 * 1024) throw Object.assign(new Error('QA request exceeds bound'), { status: 413 }); body += chunk; }
    const value = body ? JSON.parse(body) : {};
    if (pathname === '/qa/control') {
      if (value.reset) { await transactionTail; documents.clear(); inventory = createQaInventory(); waitlistRequests = []; mutationFailures = false; fetchFailures = false; waitlistFailures = false; }
      if (typeof value.mutationFailures === 'boolean') mutationFailures = value.mutationFailures;
      if (typeof value.fetchFailures === 'boolean') fetchFailures = value.fetchFailures;
      if (typeof value.waitlistFailures === 'boolean') waitlistFailures = value.waitlistFailures;
      if (value.remotePreferences) await service.operate(qaUid, { mutationId: `qa_remote_${crypto.randomUUID().replaceAll('-', '')}`, type: 'preferences',
        basePreferencesRevision: (await service.read(qaUid)).preferencesRevision, preferences: value.remotePreferences });
      if (value.seedSaved) {
        let state = createMatchState();
        for (const club of inventory.clubs) state = applyMatchOperation(state, { mutationId: `qa_seed_${club.club.id.padEnd(24, '_')}`, type: 'decide',
          ref: { clubId: club.club.id, gameId: club.games[0].id, kind: 'cash' }, summary: { venueName: club.club.name, gameName: club.games[0].name }, decision: 'saved' }, Date.now());
        documents.set(`players/${qaUid}/orbitMatch/state`, state);
      }
      if (value.removeVenue) inventory.clubs = inventory.clubs.filter((club) => club.club.id !== value.removeVenue);
      if (value.updateGame) {
        const update = value.updateGame;
        const club = inventory.clubs.find((item) => item.club.id === update.clubId);
        const game = club?.games.find((item) => item.id === update.gameId);
        if (!game || (update.availableSeats !== undefined && (!Number.isInteger(update.availableSeats) || update.availableSeats < 0 || update.availableSeats > 9))
          || (update.waitlistCount !== undefined && (!Number.isInteger(update.waitlistCount) || update.waitlistCount < 0 || update.waitlistCount > 10000))) throw Object.assign(new Error('Invalid bounded QA game update'), { status: 400 });
        if (update.ended) { game.openTables = []; game.availableSeats = 0; }
        else if (update.availableSeats !== undefined) { game.openTables[0].availableSeats = update.availableSeats; game.openTables[0].seatsFilled = 9 - update.availableSeats; game.availableSeats = update.availableSeats; }
        if (update.waitlistCount !== undefined) game.waitlistCount = update.waitlistCount;
        game.updatedAt = new Date().toISOString();
      }
      send(200, { ok: true }); return;
    }
    if (pathname === '/qa/inventory') { if (fetchFailures) throw Object.assign(new Error('QA connection unavailable'), { status: 503 }); send(200, inventory); return; }
    if (pathname === '/qa/inspection') { send(200, { state: await service.read(qaUid), waitlistRequests }); return; }
    if (pathname === '/qa/state') { if (fetchFailures) throw Object.assign(new Error('QA connection unavailable'), { status: 503 }); send(200, { state: await service.read(qaUid) }); return; }
    if (pathname === '/qa/operation') { if (mutationFailures) throw Object.assign(new Error('QA changes waiting for connection'), { status: 503 }); send(200, { state: await service.operate(qaUid, value) }); return; }
    if (pathname === '/qa/waitlist') {
      if (value.player?.id !== qaUid || !inventory.clubs.some((club) => club.club.id === value.clubId && club.games.some((game) => game.id === value.gameId))) throw Object.assign(new Error('Invalid synthetic seat request'), { status: 400 });
      waitlistRequests.push(value);
      if (waitlistFailures) { send(200, { ok: false, error: 'QA room rejected the request' }); return; }
      const club = inventory.clubs.find((club) => club.club.id === value.clubId);
      const snapshot = applyWaitlistRequest(club, value); inventory.clubs = inventory.clubs.map((item) => item.club.id === snapshot.club.id ? snapshot : item);
      send(200, { ok: true, snapshot }); return;
    }
    send(404, { error: 'Unknown QA route' });
  } catch (failure) { send(failure.status ?? 500, { error: failure.message }); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const requestQa = async (route, value) => {
  const response = await fetch(`${baseUrl}/qa/${route}`, { headers: { 'x-local-qa-actor': qaUid, 'content-type': 'application/json' },
    ...(value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) }) });
  if (!response.ok) throw new Error(`QA control failed: ${response.status}`); return response.json();
};
let browser, qaPage;
const check = async (name, action) => { const at = performance.now(); await action(); report.checks.push({ name, status: 'pass', elapsedMs: Math.round(performance.now() - at) }); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || (url.hostname === '127.0.0.1' && url.port === new URL(baseUrl).port)) await route.continue();
    else { report.blockedRequests.push(url.origin); await route.abort('blockedbyclient'); }
  });
  const page = await context.newPage();
  qaPage = page;
  page.setDefaultTimeout(7000);
  const touchSession = await context.newCDPSession(page);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('console', (event) => { if (event.type() === 'warning') report.warnings.push(event.text()); });
  const shot = async (name) => { const file = `${name}.png`; await page.screenshot({ path: path.join(out, file), fullPage: true, animations: 'disabled' }); report.screenshots.push(file); };
  const contrast = async () => expect(await page.evaluate(() => window.__ORBIT_MATCH_QA__.contrastFailures())).toEqual([]);
  const state = () => page.evaluate(() => window.__ORBIT_MATCH_QA__.snapshot());
  const decisions = async () => (await state()).state.decisions;
  const ready = async () => { await expect(page.getByRole('heading', { name: 'Orbit Match' })).toBeVisible(); await expect(page.getByRole('button', { name: /^Save / }).first()).toBeEnabled(); };
  const reset = async () => { await requestQa('control', { reset: true }); await page.goto(baseUrl); await page.evaluate(() => localStorage.clear()); await page.reload(); await ready(); };
  const swipe = async (dx, dy = 0) => {
    const card = page.getByRole('button', { name: /^Open / }).first().locator('..'); const box = await card.boundingBox(); if (!box) throw new Error('Match card not visible');
    const x = box.x + box.width / 2, y = box.y + 160;
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 12, y: y + dy * step / 12 }] });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const navigationAt = performance.now(); await page.goto(baseUrl); await ready(); await expect(page.locator('html')).toHaveAttribute('data-player-scheme', scheme); report.timings.firstInteractiveMs = Math.round(performance.now() - navigationAt);
  await check('published long names, monogram fallback, touch targets and narrow layout', async () => {
    await expect(page.getByText('Published games. Set preferences anytime.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Personalize Match', exact: true })).toHaveCount(0);
    const info = page.getByRole('button', { name: 'Game info', exact: true }), infoPanel = info.locator('..');
    await expect(info).toHaveAttribute('aria-expanded', 'false');
    await expect(infoPanel.getByText('Running tables', { exact: true })).toHaveCount(0);
    await expect(infoPanel.getByText('Waiting', { exact: true })).toHaveCount(0); await shot('match-collapsed-initial');
    await info.click(); await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(infoPanel.getByText('Running tables', { exact: true })).toBeVisible();
    await expect(infoPanel.getByText('Waiting', { exact: true })).toBeVisible();
    expect((await requestQa('inspection')).waitlistRequests).toHaveLength(0); await shot('match-info-open');
    await info.click(); await expect(info).toHaveAttribute('aria-expanded', 'false');
    await expect(infoPanel.getByText('Running tables', { exact: true })).toHaveCount(0);
    await expect(infoPanel.getByText('Waiting', { exact: true })).toHaveCount(0); await shot('match-info-closed');
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: width === 360 ? 740 : 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const name of [/^Pass /, /^Save /, 'View details']) {
        const box = await page.getByRole('button', { name }).first().boundingBox(); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await shot(`discover-${width}`);
    }
    await contrast();
  });
  await check('short and vertical gestures retain the same game', async () => {
    const before = await decisions(); await swipe(36, 0); await swipe(10, 90); expect(await decisions()).toEqual(before);
  });
  await check('left swipe passes once and Undo restores the game', async () => {
    await swipe(-110); await expect.poll(async () => (await decisions()).length).toBe(1); expect((await decisions())[0].decision).toBe('passed');
    await page.getByRole('button', { name: 'Undo last swipe' }).click(); await expect.poll(async () => (await decisions()).length).toBe(0);
  });
  await check('right swipe saves once, persistent Saved details need explicit request confirmation', async () => {
    await swipe(110); await expect.poll(async () => (await decisions()).filter((item) => item.decision === 'saved').length).toBe(1);
    await page.reload(); await ready(); await page.getByRole('tab', { name: 'Saved games, 1' }).click();
    await page.getByRole('button', { name: /^Details for saved / }).click(); await expect(page.getByRole('button', { name: 'Seat request options', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Game structure', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'House rules', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue to request', exact: true })).toHaveCount(0);
    await shot('saved-game-details');
    await contrast();
    expect((await requestQa('inspection')).waitlistRequests).toHaveLength(0);
    await page.getByRole('button', { name: 'Seat request options', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Seat request', exact: true })).toBeVisible();
    await expect(page.getByText('Tell club I am here', { exact: true })).toHaveCount(0);
    expect((await requestQa('inspection')).waitlistRequests).toHaveLength(0);
    await page.getByRole('button', { name: 'Continue to request', exact: true }).click(); await expect(page.getByText('Tell club I am here', { exact: true })).toBeVisible();
    expect((await requestQa('inspection')).waitlistRequests).toHaveLength(0); await shot('explicit-seat-confirmation');
    await page.getByRole('button', { name: /Tell club I am here/ }).click(); await expect.poll(async () => (await requestQa('inspection')).waitlistRequests.length).toBe(1);
    await expect.poll(async () => (await requestQa('inspection')).state.events.some((event) => event.kind === 'waitlist-success' && event.saveMutationId)).toBeTruthy();
  });
  await check('button parity, duplicate protection and saved removal', async () => {
    await reset(); await page.getByRole('button', { name: /^Save / }).first().dblclick(); await expect.poll(async () => (await decisions()).length).toBe(1);
    await page.getByRole('tab', { name: 'Saved games, 1' }).click(); await page.getByRole('button', { name: /^Remove saved / }).click(); await expect.poll(async () => (await decisions()).length).toBe(0);
    await page.getByRole('tab', { name: 'Discover games' }).click(); await page.getByRole('button', { name: /^Pass / }).first().click(); await expect.poll(async () => (await decisions()).length).toBe(1);
  });
  await check('explicit seat request rejection rolls back and records no conversion', async () => {
    await reset(); await page.getByRole('button', { name: /^Save / }).first().click(); await expect.poll(async () => (await decisions()).length).toBe(1);
    await page.getByRole('tab', { name: 'Saved games, 1' }).click(); await page.getByRole('button', { name: /^Details for saved / }).click();
    await requestQa('control', { waitlistFailures: true }); await page.getByRole('button', { name: 'Seat request options', exact: true }).click();
    expect((await requestQa('inspection')).waitlistRequests).toHaveLength(0);
    await page.getByRole('button', { name: 'Continue to request', exact: true }).click();
    expect((await requestQa('inspection')).waitlistRequests).toHaveLength(0);
    await page.getByRole('button', { name: /Tell club I am here/ }).click(); await expect(page.getByText('Seat request was not sent. QA room rejected the request').last()).toBeVisible();
    const result = await requestQa('inspection'); expect(result.waitlistRequests).toHaveLength(1); expect(result.state.events.some((event) => event.kind === 'waitlist-success')).toBe(false);
    expect((await requestQa('inventory')).clubs[0].waitlists).toHaveLength(0); await shot('rejected-seat-request');
  });
  await check('remote preferences preserve unsaved edits and require explicit reload', async () => {
    await reset(); await page.getByRole('button', { name: 'Profile Match preferences' }).click(); await page.getByRole('button', { name: 'Match games preferences' }).click();
    await page.getByRole('button', { name: 'Pot Limit Omaha', exact: true }).click();
    const preferences = { ...(await state()).state.preferences, variants: ['nlh'] }; await requestQa('control', { remotePreferences: preferences });
    await expect(page.getByText('Current preferences changed. Your edits remain here. Reload the current preferences before saving.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pot Limit Omaha', exact: true })).toHaveCSS('background-color', scheme === 'dark' ? 'rgb(24, 39, 70)' : 'rgb(231, 237, 255)');
    await expect(page.getByRole('button', { name: 'Save Match preferences' })).toBeDisabled();
    await page.getByRole('button', { name: 'Reload current Match preferences' }).click();
    await expect(page.getByRole('button', { name: 'No Limit Holdem', exact: true })).toHaveCSS('background-color', scheme === 'dark' ? 'rgb(24, 39, 70)' : 'rgb(231, 237, 255)');
    await page.getByRole('button', { name: 'Save Match preferences' }).click(); await expect(page.getByRole('tab', { name: 'Discover games' })).toHaveAttribute('aria-selected', 'true');
  });
  await check('failed local journal preference save keeps editable draft', async () => {
    await page.getByRole('button', { name: 'Profile Match preferences' }).click(); await page.getByRole('button', { name: 'Match games preferences' }).click();
    await page.getByRole('button', { name: 'Pot Limit Omaha', exact: true }).click(); await page.evaluate(() => window.__ORBIT_MATCH_QA__.journalFailure(true));
    await page.getByRole('button', { name: 'Save Match preferences' }).click(); await expect(page.getByText('Preferences could not be saved. Your edits are still here.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pot Limit Omaha', exact: true })).toHaveCSS('background-color', scheme === 'dark' ? 'rgb(24, 39, 70)' : 'rgb(231, 237, 255)');
    await page.evaluate(() => window.__ORBIT_MATCH_QA__.journalFailure(false)); await page.getByRole('button', { name: 'Save Match preferences' }).click();
    await expect(page.getByRole('tab', { name: 'Discover games' })).toHaveAttribute('aria-selected', 'true');
  });
  await check('pending remote write survives refresh and reconnects exactly once', async () => {
    await reset(); await requestQa('control', { mutationFailures: true }); await page.getByRole('button', { name: /^Save / }).first().click();
    await expect.poll(async () => (await state()).pending).toBe(true); await expect(page.getByText('QA changes waiting for connection')).toBeVisible();
    await page.reload(); await ready(); await expect.poll(async () => (await decisions()).length).toBe(1); expect((await state()).pending).toBe(true);
    await requestQa('control', { mutationFailures: false }); await page.getByRole('button', { name: 'Retry Match' }).click();
    await expect.poll(async () => (await state()).pending).toBe(false); expect((await requestQa('inspection')).state.decisions).toHaveLength(1);
  });
  await check('offline catalog keeps saved rows and disables stale operational details', async () => {
    await reset(); await page.getByRole('button', { name: /^Save / }).first().click(); await expect.poll(async () => (await decisions()).length).toBe(1);
    await requestQa('control', { fetchFailures: true }); await page.evaluate(() => window.__ORBIT_MATCH_QA__.refreshInventory());
    await expect(page.getByText('Last loaded games. Refresh before saving or passing.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save / }).first()).toBeDisabled();
    await page.getByRole('tab', { name: 'Saved games, 1' }).click(); await expect(page.getByRole('button', { name: /^Details for saved / })).toBeDisabled();
    await shot('offline-saved'); await requestQa('control', { fetchFailures: false }); await page.evaluate(() => window.__ORBIT_MATCH_QA__.refreshInventory());
    await expect(page.getByRole('button', { name: /^Details for saved / })).toBeEnabled();
  });
  await check('published availability updates saved details, then ended game remains read-only', async () => {
    await reset(); await page.getByRole('button', { name: /^Save / }).first().click(); await expect.poll(async () => (await decisions()).length).toBe(1);
    await page.getByRole('tab', { name: 'Saved games, 1' }).click();
    const ref = (await decisions())[0].ref;
    await requestQa('control', { updateGame: { ...ref, availableSeats: 1, waitlistCount: 7 } }); await page.evaluate(() => window.__ORBIT_MATCH_QA__.refreshInventory());
    await expect(page.getByText('1 seat open · 7 waiting')).toBeVisible(); await page.getByRole('button', { name: /^Details for saved / }).click();
    await expect(page.getByText('1 seat open · 7 waiting')).toBeVisible(); await shot('updated-availability'); await contrast();
    await requestQa('control', { updateGame: { ...ref, ended: true } }); await page.evaluate(() => window.__ORBIT_MATCH_QA__.refreshInventory());
    await expect(page.getByText('This listing is no longer available')).toBeVisible(); await expect(page.getByRole('button', { name: 'Request a seat', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Seat request options', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue to request', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to Matches' }).click(); await expect(page.getByRole('tab', { name: 'Saved games, 1' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('This game has no active published table or upcoming event.')).toBeVisible(); await expect(page.getByRole('button', { name: /^Details for saved / })).toBeDisabled();
    expect((await decisions()).length).toBe(1); await shot('ended-saved');
  });
  await check('saved list renders twenty, adds four, retains missing venue with disabled details', async () => {
    await reset(); await requestQa('control', { seedSaved: true, removeVenue: 'qa-venue-23' }); await page.evaluate(() => window.__ORBIT_MATCH_QA__.refreshInventory());
    await expect(page.getByRole('tab', { name: 'Saved games, 24' })).toBeVisible(); await page.getByRole('tab', { name: 'Saved games, 24' }).click();
    await expect(page.getByRole('button', { name: /^Details for saved / })).toHaveCount(20); await page.getByRole('button', { name: 'Show more saved games' }).click();
    await expect(page.getByRole('button', { name: /^Details for saved / })).toHaveCount(24);
    await expect(page.getByText('This game is no longer in the published catalog.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Details for saved 24/25 No Limit Holdem' })).toBeDisabled(); await shot('saved-expanded');
  });
  await check('keyboard button access, animation-enabled swipes, and 200 percent web text stress', async () => {
    await reset(); await page.emulateMedia({ reducedMotion: 'no-preference' }); await swipe(110); await expect.poll(async () => (await decisions()).length).toBe(1);
    await expect(page.getByRole('button', { name: 'Undo last swipe' })).toBeEnabled(); await page.getByRole('button', { name: 'Undo last swipe' }).focus(); await page.keyboard.press('Enter'); await expect.poll(async () => (await decisions()).length).toBe(0);
    await page.getByRole('button', { name: 'Profile Match preferences' }).click(); await page.getByRole('button', { name: 'Match venues preferences' }).click();
    await page.getByRole('textbox', { name: 'Search Match venues' }).fill('Riverside');
    await page.evaluate(() => { for (const element of document.querySelectorAll('[dir="auto"], input')) { const style = getComputedStyle(element); element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`; if (style.lineHeight !== 'normal') element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`; } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const clippedControls = await page.evaluate(() => [...document.querySelectorAll('button')].filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.getAttribute('aria-label')));
    expect(clippedControls).toEqual([]); await shot('preferences-text-stress-200pct');
    await contrast();
  });
  await check('live OS color-scheme changes update the mounted screen without losing saved data', async () => {
    await reset(); await page.getByRole('button', { name: /^Save / }).first().click(); await expect.poll(async () => (await decisions()).length).toBe(1);
    await expect.poll(async () => { const current = await state(); return current.pending || current.working; }).toBe(false);
    const before = await decisions(); const opposite = scheme === 'light' ? 'dark' : 'light';
    await page.emulateMedia({ colorScheme: opposite }); await expect(page.locator('html')).toHaveAttribute('data-player-scheme', opposite); await contrast();
    expect(await decisions()).toEqual(before); await shot(`system-switch-${opposite}`);
    await page.emulateMedia({ colorScheme: scheme }); await expect(page.locator('html')).toHaveAttribute('data-player-scheme', scheme); await contrast();
  });
  expect(report.pageErrors).toEqual([]); expect(report.blockedRequests).toEqual([]);
  report.timings.navigation = await page.evaluate(() => { const item = performance.getEntriesByType('navigation')[0]; return { domContentLoadedMs: Math.round(item.domContentLoadedEventEnd), loadMs: Math.round(item.loadEventEnd) }; });
  report.timings.finalDomElements = await page.locator('*').count();
  report.retainedHistory = {
    scope: 'Final scenario retained server history only; QA resets mean this is not an aggregate of all checks.',
    summary: summarizeRetainedMatchHistory((await requestQa('inspection')).state)
  };
  report.status = 'pass';
} catch (failure) {
  if (qaPage) { await qaPage.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); await writeFile(path.join(out, 'failure.html'), await qaPage.content()); }
  report.status = 'fail'; report.failure = failure.stack ?? failure.message; console.error(report.failure); process.exitCode = 1;
} finally {
  report.timings.totalMs = Math.round(performance.now() - started);
  await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await new Promise((resolve) => server.close(resolve));
  console.log(`Results: ${path.relative(root, path.join(out, 'results.json'))}`);
}
