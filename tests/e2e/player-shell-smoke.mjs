import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// Actual PlayerApp shell and demo orchestration; connected/native service boundaries are explicit QA adapters.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'tests/e2e/player-match-qa');
const out = path.join(root, 'out/player-shell-qa');
const require = createRequire(import.meta.url), playerRequire = createRequire(path.join(root, 'player-app/package.json'));
await mkdir(out, { recursive: true });
const started = performance.now(), adapters = path.join(source, 'shellAdapters.tsx');
const presentation = path.join(source, 'presentationAdapters.tsx');
const bundle = await build({ entryPoints: [path.join(source, 'shellEntry.tsx')], outfile: path.join(out, 'app.js'), bundle: true, minify: true,
  platform: 'browser', target: 'es2022', jsx: 'automatic', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}', __DEV__: 'false', global: 'globalThis' },
  alias: { 'react-native': playerRequire.resolve('react-native-web'), react: path.dirname(require.resolve('react/package.json')),
    'react-dom': path.dirname(require.resolve('react-dom/package.json')), '@expo/vector-icons': presentation, 'expo-linear-gradient': presentation,
    'react-native-qrcode-svg': presentation, 'react-native-safe-area-context': adapters, 'expo-camera': adapters, 'expo-status-bar': adapters },
  plugins: [{ name: 'explicit-shell-qa-boundaries', setup(builder) {
    builder.onResolve({ filter: /\/(?:orbitSyncApi|playerPlatform|playerLocation|playerMatchRepository|playerStorage|usePlayerStorage|usePlayerIdentity|usePlayerLiveData|MapView)$/ }, (args) =>
      args.path.includes('/domain/') ? undefined : { path: adapters });
  } }] });
const normalizedInputs = Object.keys(bundle.metafile.inputs).map((input) => input.replaceAll('\\', '/'));
const forbidden = normalizedInputs.filter((input) => /firebaseClient|firebase-admin|node_modules\/firebase\/|playerHttpApi|playerStorageCore|expo-secure-store|expo-location|node_modules\/expo-camera\/|data\/firebase\/|application\/(?:usePlayerStorage|usePlayerIdentity|usePlayerLiveData)\.ts|app\/(?:playerPlatform|playerLocation)\.ts/.test(input));
if (forbidden.length) throw new Error(`Production service code reached the shell QA bundle: ${forbidden.join(', ')}`);
for (const required of ['src/PlayerApp.tsx', 'src/demo/useDemoPlayerSession.ts', 'src/demo/demoPlayerData.ts', 'src/application/usePlayerMatch.ts',
  'src/application/usePlayerLocation.ts', 'src/application/usePlayerClubs.ts', 'src/features/home/PlayerHomeScreen.tsx', 'src/features/match/OrbitMatchScreen.tsx',
  'src/features/discovery/DiscoveryGameDetails.tsx', 'src/features/settings/SettingsScreen.tsx', 'src/features/clubs/ClubRoutes.tsx',
  'src/features/clubs/MembershipPass.tsx', 'src/features/clubs/MembershipDetailsScreen.tsx']) {
  if (!normalizedInputs.some((input) => input.endsWith(required))) throw new Error(`Actual application module missing from QA bundle: ${required}`);
}
await writeFile(path.join(out, 'bundle-inputs.json'), JSON.stringify(normalizedInputs, null, 2));
const report = { status: 'running', runtime: 'Actual PlayerApp/demo hooks and UI in Chromium React Native Web; service/native surfaces use QA adapters',
  bundleMs: Math.round(performance.now() - started), schemes: [] };
const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit actual shell engineering QA</title><style>html,body,#root{margin:0;height:100%;background:#060c1a;font-family:system-ui}#root{display:flex;flex-direction:column;overflow:hidden}*{box-sizing:border-box}@media(prefers-color-scheme:light){html,body,#root{background:#f4f7fc}}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); }
  else if (pathname === '/app.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(await readFile(path.join(out, 'app.js'))); }
  else { response.writeHead(pathname === '/favicon.ico' ? 204 : 404); response.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser, currentPage, currentResult;
try {
  browser = await chromium.launch({ headless: true });
  for (const scheme of ['light', 'dark']) {
    const result = { scheme, checks: [], screenshots: [], paintFindings: [], pageErrors: [], outbound: [], warnings: [], firstInteractiveMs: 0 };
    currentResult = result; report.schemes.push(result);
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: scheme, reducedMotion: 'reduce', isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' && url.port === new URL(baseUrl).port) await route.continue();
      else { result.outbound.push(url.origin); await route.abort('blockedbyclient'); }
    });
    const page = await context.newPage(); currentPage = page; page.setDefaultTimeout(7000);
    page.on('pageerror', (error) => result.pageErrors.push(error.message));
    page.on('console', (event) => { if (event.type() === 'warning') result.warnings.push(event.text()); });
    const audit = () => page.evaluate(() => window.__ORBIT_SHELL_QA__.audit());
    const shot = async (name) => { const file = `${scheme}-${name}.png`; await page.screenshot({ path: path.join(out, file), fullPage: true, animations: 'disabled' }); result.screenshots.push(file);
      const findings = await page.evaluate(() => window.__ORBIT_SHELL_QA__.contrastFailures()); if (findings.length) result.paintFindings.push({ surface: name, findings }); expect(findings).toEqual([]); };
    const button = (name) => page.getByRole('button', { name, exact: true });
    const tab = (name) => page.getByRole('tab', { name, exact: true });
    const check = async (name, run) => { const at = performance.now(); await run(); result.checks.push({ name, status: 'pass', elapsedMs: Math.round(performance.now() - at) }); console.log(`PASS ${scheme} ${name}`); };
    const demoReady = async () => { await expect(page.getByLabel('Demo account', { exact: true })).toBeVisible(); await expect(button('Find games')).toBeVisible(); };
    const enterDemo = async () => { await button('Try demo account').first().click(); await demoReady(); };
    const closeNotification = async () => { const dismiss = button('Dismiss notification'); if (await dismiss.count()) await dismiss.click(); };
    const openOptions = async () => { await tab('Profile').click(); await expect(button('Exit demo')).toBeVisible(); };
    await check('welcome offers account/demo choices and profile fields use the viewport with bottom actions', async () => {
      await page.goto(baseUrl); await expect(page.getByRole('heading', { name: 'Find your next game' })).toBeVisible();
      await expect(button('Create account')).toBeVisible(); await expect(button('Try demo account')).toBeVisible();
      await shot('welcome-360'); await button('Create account').click();
      const field = page.getByRole('textbox', { name: 'Name', exact: true }); await expect(field).toBeVisible();
      const geometry = await field.evaluate((element) => { const rect = element.getBoundingClientRect(); return { center: (rect.top + rect.bottom) / 2, viewport: innerHeight }; });
      expect(geometry.center / geometry.viewport).toBeGreaterThan(0.35); expect(geometry.center / geometry.viewport).toBeLessThan(0.65);
      const actions = await button('Continue').boundingBox(); expect(actions.y + actions.height).toBeGreaterThan(640);
      result.onboardingGeometry = { field: geometry, actions }; await shot('onboarding-field-centered');
      await field.fill('QA Player'); await button('Continue').click(); await page.getByRole('textbox', { name: 'Email', exact: true }).fill('shell-qa@example.test');
      await button('Continue').click(); await expect(page.getByRole('textbox', { name: 'Phone Number', exact: true })).toBeVisible();
      await button('Continue').click(); await expect(page.getByRole('textbox', { name: 'Home Area', exact: true })).toBeVisible();
      await page.setViewportSize({ width: 320, height: 740 });
      const declaration = page.getByRole('checkbox', { name: 'I confirm that I am 18 or older', exact: true }); await declaration.click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await shot('onboarding-checkbox-320');
      await button('Continue to account').click(); await expect(page.getByRole('textbox', { name: 'Account email address', exact: true })).toHaveValue('shell-qa@example.test');
      await expect(page.getByLabel('Account password or passphrase', { exact: true })).toHaveAttribute('type', 'password'); await shot('onboarding-account-320');
      expect((await audit()).forbiddenCalls).toEqual([]); expect(result.outbound).toEqual([]); await page.setViewportSize({ width: 360, height: 740 });
    });
    await check('actual onboarding opens populated demo and unmounts all connected adapters', async () => {
      const at = performance.now(); await page.goto(baseUrl); await expect(page.getByRole('heading', { name: 'Find your next game' })).toBeVisible();
      result.firstInteractiveMs = Math.round(performance.now() - at); await enterDemo(); await closeNotification();
      await expect.poll(async () => (await audit()).mountedConnected).toBe(0);
      expect((await audit()).forbiddenCalls).toEqual([]); expect((await audit()).storageCalls).toEqual([]);
      await shot('home-360');
      await tab('Events').click(); await expect(page.getByText('Demo Holdem Freeroll', { exact: true })).toBeVisible();
      await expect(button('Request for Demo Holdem Freeroll')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('heading', { name: 'Published structure', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Published rules', exact: true })).toHaveCount(0);
      await expect(button('Express interest')).toHaveCount(0); await shot('events-initial-collapsed');
      await tab('Games').click(); await demoReady();
    });
    await check('actual Match saves, revisits details, preserves Saved mode on back and blocks demo requests', async () => {
      const before = await audit(); await button('Find games').click(); await expect(page.getByRole('heading', { name: 'Orbit Match' })).toBeVisible();
      await expect(button('Game info')).toHaveAttribute('aria-expanded', 'false');
      await expect(button('Game info').locator('..').getByText('Running tables', { exact: true })).toHaveCount(0);
      await shot('match-collapsed-initial');
      result.matchGeometry = {
        card: await page.getByRole('button', { name: /^Open / }).first().boundingBox(),
        navigation: await page.getByRole('tablist', { name: 'Primary navigation', exact: true }).boundingBox()
      };
      expect(result.matchGeometry.card.width).toBeGreaterThan(320); expect(result.matchGeometry.navigation.x).toBeGreaterThan(70);
      expect(result.matchGeometry.card.y).toBeLessThan(70);
      await page.getByRole('button', { name: /^Save / }).first().click(); await expect(tab('Saved games, 1')).toBeVisible(); await tab('Saved games, 1').click();
      await page.getByRole('button', { name: /^Details for saved / }).click(); await expect(button('Back to Matches')).toBeVisible();
      const notice = page.getByText('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.');
      await expect(page.getByRole('heading', { name: 'Game structure', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'House rules', exact: true })).toHaveCount(0);
      await expect(button('Continue to request')).toHaveCount(0);
      await expect(notice).toHaveCount(0); await shot('cash-details-collapsed');
      await button('Structure').click(); await expect(page.getByRole('heading', { name: 'Game structure', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'House rules', exact: true })).toHaveCount(0);
      await button('Rules').click(); await expect(page.getByRole('heading', { name: 'House rules', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Game structure', exact: true })).toHaveCount(0);
      await button('Rules').click(); await expect(page.getByRole('heading', { name: 'House rules', exact: true })).toHaveCount(0);
      const beforeRequestOptions = await audit();
      await button('Seat request options').click(); await expect(page.getByRole('heading', { name: 'Seat request', exact: true })).toBeVisible();
      await expect(notice).toHaveCount(0); await expect(page.getByText('Tell club I am here', { exact: true })).toHaveCount(0);
      expect((await audit()).forbiddenCalls).toEqual(beforeRequestOptions.forbiddenCalls);
      expect((await audit()).storageCalls).toEqual(beforeRequestOptions.storageCalls); expect(result.outbound).toEqual([]);
      const action = page.getByRole('button', { name: /^(Continue to request|Send interest|See access options|Renew access|Await venue activation)$/ }).first(); await action.click();
      await expect(page.getByText('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.')).toBeVisible();
      await button('Back to Matches').click(); await expect(tab('Saved games, 1')).toHaveAttribute('aria-selected', 'true');
      await tab('Discover games').click();
      await page.getByRole('button', { name: /^Cancel request for / }).first().click();
      const cancellationNotice = page.getByText('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.');
      await expect(cancellationNotice).toBeVisible();
      const feedback = await cancellationNotice.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight, inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight };
      });
      result.requestFeedback = feedback;
      await shot('scrolled-request-feedback');
      expect(feedback.inViewport).toBe(true);
      await button('Dismiss demo notice').click();
      await tab('Saved games, 1').click();
      expect((await audit()).storageCalls).toEqual(before.storageCalls); expect((await audit()).connectedMounts).toEqual(before.connectedMounts); expect((await audit()).forbiddenCalls).toEqual([]);
      await shot('saved-back-mode');
    });
    await check('membership wallet and published club passes fit 320/360/390px with reachable stacked cards and isolated actions', async () => {
      const before = await audit();
      const memberships = [
        { clubName: 'Demo River Card House', id: 'demo-austin-membership' },
        { clubName: 'Demo Lakeside Poker Club', id: 'demo-chicago-membership' }
      ];
      result.membershipGeometry = [];
      await tab('Clubs').click();
      for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 740 });
        await expect(page.getByText('Your wallet', { exact: true })).toBeVisible();
        await expect(page.getByText('Demo membership only. Venue check-in is unavailable in the demo account.')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await shot(`membership-wallet-${width}`);
        for (const membership of memberships) {
          const pass = button(`${membership.clubName}, Active`);
          await expect(pass).toBeVisible();
          const geometry = await pass.evaluate((element) => {
            const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2;
            let run = 0, longest = 0, activationY = 0;
            for (let y = Math.ceil(Math.max(0, rect.top)); y < Math.min(innerHeight, rect.bottom); y += 1) {
              const hit = document.elementFromPoint(x, y);
              run = hit && element.contains(hit) ? run + 1 : 0;
              if (run > longest) { longest = run; activationY = y - run / 2 - rect.top; }
            }
            const gradients = [...element.querySelectorAll('*')].map((child) => getComputedStyle(child).backgroundImage).filter((value) => value.includes('linear-gradient'));
            return { left: rect.left, right: rect.right, width: rect.width, visibleTouchStrip: longest, activationY, gradients };
          });
          result.membershipGeometry.push({ viewportWidth: width, club: membership.clubName, ...geometry });
          expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(width);
          expect(geometry.visibleTouchStrip).toBeGreaterThanOrEqual(44); expect(geometry.gradients).toHaveLength(1);
          await pass.click({ position: { x: geometry.width / 2, y: geometry.activationY } });
          await expect(page.getByText('Club pass', { exact: true })).toBeVisible();
          await expect(page.getByText(membership.clubName, { exact: true }).first()).toBeVisible();
          await expect(page.getByText(membership.id, { exact: true }).first()).toBeVisible();
          await expect(page.getByText(memberships.find((other) => other !== membership).id, { exact: true })).toHaveCount(0);
          await expect(page.getByText('Demo monthly access', { exact: true })).toBeVisible();
          await expect(page.getByText(/Rake back|Priority seating|Comp drinks|Reserved table access|Monthly event entry|ORB-2048-731|MR-1186-042/)).toHaveCount(0);
          await expect(page.getByText('Demo membership only. Venue check-in is unavailable in the demo account.')).toBeVisible();
          await expect(button('Generate membership check-in code')).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await shot(`club-pass-${membership.id}-${width}`);
          await button('Extend membership').scrollIntoViewIfNeeded();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (width === 360 && membership === memberships[0]) {
            await shot('membership-extension');
            await button('Extend membership').click();
            await expect(page.getByText('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.')).toBeVisible();
            await button('Dismiss demo notice').click();
          }
          await button('Back to memberships').click();
          await expect(page.getByText('Your wallet', { exact: true })).toBeVisible();
          await expect(pass).toBeVisible();
        }
      }
      await page.setViewportSize({ width: 360, height: 740 });
      const after = await audit();
      expect(after.forbiddenCalls).toEqual(before.forbiddenCalls); expect(after.storageCalls).toEqual(before.storageCalls);
      expect(after.connectedMounts).toEqual(before.connectedMounts); expect(result.outbound).toEqual([]);
    });
    await check('actual demo Profile/events/map stay isolated and reset restores catalog and saved state', async () => {
      await tab('Profile').click(); await expect(page.getByText('This sample profile stays in memory. Exit demo to return to your saved account.')).toBeVisible(); await shot('profile');
      await tab('Events').click(); await expect(page.getByText('Demo Holdem Freeroll', { exact: true })).toBeVisible();
      const eventName = 'Demo Omaha Evening', eventRequest = button(`Request for ${eventName}`);
      await expect(eventRequest).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('heading', { name: 'Published structure', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Published rules', exact: true })).toHaveCount(0);
      await expect(button('Express interest')).toHaveCount(0); await shot('events-collapsed');
      const beforeEventDetails = await audit();
      await button(`Structure for ${eventName}`).click(); await expect(page.getByRole('heading', { name: 'Published structure', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Published rules', exact: true })).toHaveCount(0);
      await button(`Rules for ${eventName}`).click(); await expect(page.getByRole('heading', { name: 'Published rules', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Published structure', exact: true })).toHaveCount(0);
      await button(`Rules for ${eventName}`).click(); await expect(page.getByRole('heading', { name: 'Published rules', exact: true })).toHaveCount(0);
      await eventRequest.click(); await expect(page.getByText('Expressing interest is nonbinding.', { exact: false })).toBeVisible();
      await expect(page.getByText('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.')).toHaveCount(0);
      expect((await audit()).forbiddenCalls).toEqual(beforeEventDetails.forbiddenCalls);
      expect((await audit()).storageCalls).toEqual(beforeEventDetails.storageCalls); expect(result.outbound).toEqual([]);
      await button('Express interest').click(); await expect(page.getByText('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.')).toBeVisible();
      await button('Dismiss demo notice').click(); await shot('events');
      await tab('Map').click(); await expect(page.getByText('Map canvas adapter · no tiles or OS handoff')).toBeVisible(); await shot('map-adapter');
      await page.getByRole('button', { name: /^Directions to Demo / }).first().click(); await expect(page.getByText('These venues and games are fictional. Use a real account for venue requests, check-in, and directions.')).toBeVisible();
      await button('Dismiss demo notice').click();
      await openOptions(); await button('Reset demo games').click(); await demoReady(); await button('Find games').click(); await expect(tab('Saved games, 0')).toBeVisible();
      expect((await audit()).forbiddenCalls).toEqual([]); expect((await audit()).storageCalls).toEqual([]);
    });
    await check('demo exit restores onboarding; reentry is fresh; whole shell fits larger viewport and text stress', async () => {
      await openOptions(); await button('Exit demo').click(); await expect(page.getByRole('heading', { name: 'Find your next game' })).toBeVisible();
      await enterDemo(); await button('Find games').click(); await expect(tab('Saved games, 0')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 }); await tab('Profile').click(); await button('Match preferences').click();
      await page.evaluate(() => { for (const element of document.querySelectorAll('[dir="auto"], input')) { const style = getComputedStyle(element); element.style.fontSize = `${parseFloat(style.fontSize) * 2}px`; if (style.lineHeight !== 'normal') element.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`; } });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const clippedText = await page.evaluate(() => [...document.querySelectorAll('[dir="auto"]')].filter((element) => element.getClientRects().length
        && !element.closest('[aria-hidden="true"]') && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent));
      expect(clippedText).toEqual([]); await shot('whole-shell-text-200pct');
    });
    await check('a preserved connected QA profile survives demo entry and exit without live authentication', async () => {
      await page.goto(`${baseUrl}/?entry=profile`); await expect(page.getByText('Published venue data is unavailable')).toBeVisible();
      await tab('Profile').click(); await expect(page.getByText('Local QA Profile', { exact: true })).toBeVisible(); await enterDemo();
      const before = await audit(); await tab('Profile').click(); await expect(page.getByText('Demo Player', { exact: true })).toBeVisible();
      await openOptions(); await button('Exit demo').click(); await tab('Profile').click(); await expect(page.getByText('Local QA Profile', { exact: true })).toBeVisible();
      expect((await audit()).forbiddenCalls).toEqual([]); expect((await audit()).connectedMounts.storage).toBe(before.connectedMounts.storage + 1);
      await shot('restored-qa-profile');
    });
    expect(result.pageErrors).toEqual([]); expect(result.outbound).toEqual([]); result.audit = await audit();
    await context.close(); currentPage = undefined;
  }
  report.status = 'pass';
} catch (failure) {
  report.status = 'fail'; report.failure = failure.stack ?? failure.message; process.exitCode = 1; console.error(report.failure);
  if (currentPage) { await currentPage.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); await writeFile(path.join(out, 'failure.html'), await currentPage.content()); }
} finally {
  report.totalMs = Math.round(performance.now() - started); await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await new Promise((resolve) => server.close(resolve)); console.log(`Results: ${path.relative(root, path.join(out, 'results.json'))}`);
}
