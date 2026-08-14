import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.ORBIT_PLAYER_WEB_URL || 'http://127.0.0.1:4175';
const outputDirectory = path.resolve(process.env.ORBIT_PLAYER_WEB_SCREENSHOTS || 'test-results/player-web/screenshots');

const viewports = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'wide-1920', width: 1920, height: 1080 }
];

const routes = [
  { name: 'home', path: '/' },
  { name: 'games', path: '/games' },
  { name: 'game-detail', path: '/games/1-2-nlh-north-loop-poker-club--Y2x1Yi1hbHBoYQBnYW1lLXJ1bm5pbmc' },
  { name: 'clubs', path: '/clubs' },
  { name: 'club-detail', path: '/clubs/north-loop-poker-club--Y2x1Yi1hbHBoYQBjbHViLWFscGhh' },
  { name: 'tournaments', path: '/tournaments' },
  { name: 'tournament-detail', path: '/tournaments/sunday-orbit-major-north-loop-poker-club--Y2x1Yi1hbHBoYQBldmVudC1vcGVu' },
  { name: 'privacy', path: '/privacy' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'my-orbit', path: '/me' },
  { name: 'my-clubs', path: '/me/clubs' },
  { name: 'my-games', path: '/me/games' },
  { name: 'my-tournaments', path: '/me/tournaments' },
  { name: 'my-profile', path: '/me/profile' },
  { name: '404', path: '/missing-orbit-route', expectedStatus: 404 }
];

mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const observations = [];
const metadataByRoute = new Map();

async function assertRoute(page, route, viewport) {
  const consoleErrors = [];
  const pageErrors = [];
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error) => pageErrors.push(error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
  await page.locator('main').waitFor({ state: 'visible' });
  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '',
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') || '',
    h1Count: document.querySelectorAll('h1').length,
    structuredDataCount: document.querySelectorAll('script[type="application/ld+json"]').length,
    imagesWithoutAlt: document.querySelectorAll('img:not([alt])').length,
    language: document.documentElement.lang,
    textLength: document.body.innerText.trim().length,
    nextError: Array.from(document.querySelectorAll('nextjs-portal')).some((portal) => {
      const text = portal.shadowRoot?.textContent || portal.textContent || '';
      return /Unhandled Runtime Error|Build Error|Application error/i.test(text);
    })
  }));
  const status = response?.status() ?? 0;
  const expectedStatus = route.expectedStatus ?? 200;
  const allowedConsoleErrors = consoleErrors.filter((message) => {
    if (message.includes('favicon.ico')) return false;
    return !(expectedStatus === 404 && message === 'Failed to load resource: the server responded with a status of 404 (Not Found)');
  });
  if (status !== expectedStatus) failures.push(`${viewport.name} ${route.path}: HTTP ${status}, expected ${expectedStatus}`);
  if (layout.textLength < 80) failures.push(`${viewport.name} ${route.path}: rendered too little content`);
  if (!layout.description) failures.push(`${viewport.name} ${route.path}: missing meta description`);
  if (!layout.canonical) failures.push(`${viewport.name} ${route.path}: missing canonical link`);
  if (!layout.ogImage) failures.push(`${viewport.name} ${route.path}: missing Open Graph image`);
  if (layout.h1Count !== 1) failures.push(`${viewport.name} ${route.path}: expected one h1, found ${layout.h1Count}`);
  if (layout.structuredDataCount < 1) failures.push(`${viewport.name} ${route.path}: missing structured data`);
  if (layout.imagesWithoutAlt > 0) failures.push(`${viewport.name} ${route.path}: ${layout.imagesWithoutAlt} image(s) lack alt attributes`);
  if (layout.language !== 'en') failures.push(`${viewport.name} ${route.path}: document language is ${layout.language || 'missing'}`);
  if (Math.max(layout.bodyWidth, layout.documentWidth) > layout.viewportWidth + 1) {
    failures.push(`${viewport.name} ${route.path}: horizontal overflow ${Math.max(layout.bodyWidth, layout.documentWidth)} > ${layout.viewportWidth}`);
  }
  if (layout.nextError) failures.push(`${viewport.name} ${route.path}: Next.js error overlay is present`);
  if (pageErrors.length) failures.push(`${viewport.name} ${route.path}: page errors: ${pageErrors.join(' | ')}`);
  if (allowedConsoleErrors.length) failures.push(`${viewport.name} ${route.path}: console errors: ${allowedConsoleErrors.join(' | ')}`);
  await page.screenshot({
    path: path.join(outputDirectory, `${viewport.name}--${route.name}.png`),
    fullPage: true
  });
  observations.push({ viewport: viewport.name, route: route.path, status, title: layout.title });
  if (viewport.name === 'mobile-375') metadataByRoute.set(route.path, { title: layout.title, description: layout.description });
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
}

await Promise.all(viewports.map(async (viewport) => {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  for (const route of routes) await assertRoute(page, route, viewport);
  await context.close();
}));

const interactionContext = await browser.newContext({ viewport: { width: 430, height: 932 }, reducedMotion: 'reduce' });
const page = await interactionContext.newPage();

await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
const landing = page.locator('.player-landing');
if (!(await landing.isVisible())) failures.push('Interactive landing root is not visible.');
if (!(await page.locator('.player-landing__nav').isVisible())) failures.push('Landing navigation is not visible.');
for (const legacyShellSelector of ['.site-header', '.site-footer', '.ambient-flow']) {
  if (await page.locator(legacyShellSelector).count()) failures.push(`Landing mounted unnecessary application shell content: ${legacyShellSelector}`);
}
if (await page.getByRole('link', { name: 'Orbit Player home' }).first().getAttribute('href') !== '/') failures.push('Landing brand does not return home.');
const accessLinks = page.getByRole('link', { name: /Get Access/ });
if (await accessLinks.count() !== 3) failures.push('Landing does not expose all three access routes.');
for (const link of await accessLinks.all()) {
  const href = await link.getAttribute('href');
  if (href !== '/sign-in' && href !== '/sign-in?returnTo=%2Fgames') failures.push(`Landing access route is invalid: ${href}`);
}
const howItWorks = page.getByRole('link', { name: 'How It Works' });
if (await howItWorks.getAttribute('href') !== '#how-it-works') failures.push('How It Works is not connected to the feature experience.');
if (await page.getByRole('link', { name: 'Privacy', exact: true }).getAttribute('href') !== '/privacy') failures.push('Landing privacy route is invalid.');
if (await page.getByRole('link', { name: 'Terms', exact: true }).getAttribute('href') !== 'https://orbitapp-one.vercel.app/terms') failures.push('Landing terms route is invalid.');
if (await page.getByRole('link', { name: 'Orbit Core', exact: true }).getAttribute('href') !== 'https://orbitapp-one.vercel.app/') failures.push('Landing Orbit Core route is invalid.');

await page.goto(`${baseUrl}/games`, { waitUntil: 'networkidle' });
const filterRouteRequests = [];
const recordFilterRequest = (request) => {
  const url = new URL(request.url());
  if (url.pathname === '/games' && url.searchParams.has('q')) filterRouteRequests.push(request.url());
};
page.on('request', recordFilterRequest);
await page.getByRole('searchbox', { name: 'Search games or clubs' }).fill('PLO');
await page.waitForURL(/q=PLO/);
page.off('request', recordFilterRequest);
if (filterRouteRequests.length) failures.push(`Game search issued ${filterRouteRequests.length} route request(s) while typing.`);
const locationControlGap = await page.evaluate(() => {
  const status = document.querySelector('.location-control__status')?.getBoundingClientRect();
  const action = document.querySelector('.location-control .button')?.getBoundingClientRect();
  return status && action ? action.top - status.bottom : Number.POSITIVE_INFINITY;
});
if (locationControlGap > 40) failures.push(`Mobile location controls contain a ${Math.round(locationControlGap)}px dead gap.`);
if (await page.getByText('2/5 PLO').count() !== 1) failures.push('Game search did not isolate the PLO listing.');
await page.getByRole('combobox', { name: 'Status' }).click();
await page.getByRole('option', { name: 'Running now' }).click();
await page.waitForURL(/status=running/);
if (await page.getByText('No games match those filters').count() !== 1) failures.push('Combined game filters did not show the honest empty state.');

await page.goto(`${baseUrl}/clubs`, { waitUntil: 'networkidle' });
await page.getByLabel('City or area').fill('Dallas');
await page.getByRole('button', { name: 'Set area' }).click();
if (await page.getByText('Dallas', { exact: true }).count() === 0) failures.push('Manual location fallback did not retain the selected area.');

await page.goto(`${baseUrl}/tournaments`, { waitUntil: 'networkidle' });
await page.getByRole('combobox', { name: 'Registration' }).click();
await page.getByRole('option', { name: 'Registration open' }).click();
await page.waitForURL(/registration=open/);
if (await page.getByText('Sunday Orbit Major').count() !== 1) failures.push('Open tournament filtering did not retain the available event.');
if (await page.getByText('Deep Stack Classic').count() !== 0) failures.push('Open tournament filtering retained a closed event.');

await page.goto(`${baseUrl}/games/1-2-nlh-north-loop-poker-club--Y2x1Yi1hbHBoYQBnYW1lLXJ1bm5pbmc`, { waitUntil: 'networkidle' });
await page.getByRole('link', { name: "I'm here" }).click();
await page.waitForURL(/\/sign-in\?.*intent=waitlist/);
if (!page.url().includes('returnTo=')) failures.push('Logged-out game action lost its return destination.');

await page.goto(`${baseUrl}/me/profile`, { waitUntil: 'networkidle' });
const protectedSignIn = page.getByRole('link', { name: 'Sign in', exact: true });
if (await protectedSignIn.count() !== 1) failures.push('Protected profile route did not present one sign-in action.');
if (!(await protectedSignIn.getAttribute('href'))?.includes('%2Fme%2Fprofile')) failures.push('Protected profile route lost its return destination.');

await page.goto(`${baseUrl}/games`, { waitUntil: 'networkidle' });
await page.keyboard.press('Tab');
const focusedElement = await page.evaluate(() => ({
  tag: document.activeElement?.tagName || '',
  outlineStyle: getComputedStyle(document.activeElement || document.body).outlineStyle,
  outlineWidth: getComputedStyle(document.activeElement || document.body).outlineWidth
}));
if (!['A', 'BUTTON', 'INPUT', 'SELECT'].includes(focusedElement.tag)) failures.push('Keyboard Tab did not reach an interactive element.');
if (focusedElement.outlineStyle === 'none' || focusedElement.outlineWidth === '0px') failures.push('Keyboard focus indicator is not visibly styled.');

const sourceResponse = await fetch(`${baseUrl}/`);
const source = await sourceResponse.text();
if (!source.includes('The games are running.')) failures.push('Homepage hero content is absent from raw view-source HTML.');
if (!source.includes('Every game')) failures.push('Interactive feature content is absent from raw view-source HTML.');

const robotsText = await (await fetch(`${baseUrl}/robots.txt`)).text();
for (const crawler of ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
  if (!robotsText.includes(crawler)) failures.push(`robots.txt does not explicitly allow ${crawler}.`);
}
const sitemapText = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
for (const pathName of [
  '/privacy',
  '/games/1-2-nlh-north-loop-poker-club--Y2x1Yi1hbHBoYQBnYW1lLXJ1bm5pbmc',
  '/clubs/north-loop-poker-club--Y2x1Yi1hbHBoYQBjbHViLWFscGhh',
  '/tournaments/sunday-orbit-major-north-loop-poker-club--Y2x1Yi1hbHBoYQBldmVudC1vcGVu'
]) {
  if (!sitemapText.includes(pathName)) failures.push(`sitemap.xml does not include ${pathName}.`);
}
for (const llmsPath of ['/llms.txt', '/LLMS.txt']) {
  const response = await fetch(`${baseUrl}${llmsPath}`);
  if (!response.ok || !(await response.text()).includes('Orbit')) failures.push(`${llmsPath} is unavailable or incomplete.`);
}
for (const assetPath of ['/favicon.ico', '/orbit-logo.svg', '/orbit-table-rhythm.jpg']) {
  const response = await fetch(`${baseUrl}${assetPath}`);
  const bytes = await response.arrayBuffer();
  if (!response.ok || bytes.byteLength === 0) failures.push(`${assetPath} is unavailable.`);
}

const scriptSources = await page.locator('script[src]').evaluateAll((scripts) => scripts.map((script) => script.getAttribute('src')).filter(Boolean));
for (const scriptSource of scriptSources.slice(0, 8)) {
  const script = await (await fetch(new URL(scriptSource, baseUrl))).text();
  if (/sourceMappingURL=/i.test(script)) failures.push(`Production browser chunk exposes a source map: ${scriptSource}`);
}

if (metadataByRoute.size !== routes.length) failures.push(`Metadata audit covered ${metadataByRoute.size}/${routes.length} routes.`);
const uniqueTitles = new Set([...metadataByRoute.values()].map((entry) => entry.title));
const uniqueDescriptions = new Set([...metadataByRoute.values()].map((entry) => entry.description));
if (uniqueTitles.size !== routes.length) failures.push(`Expected ${routes.length} unique page titles, found ${uniqueTitles.size}.`);
if (uniqueDescriptions.size !== routes.length) failures.push(`Expected ${routes.length} unique meta descriptions, found ${uniqueDescriptions.size}.`);

await interactionContext.close();
await browser.close();

const report = {
  baseUrl,
  routeCount: routes.length,
  viewportCount: viewports.length,
  screenshotCount: routes.length * viewports.length,
  interactionChecks: 31,
  failures,
  observations
};
writeFileSync(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
