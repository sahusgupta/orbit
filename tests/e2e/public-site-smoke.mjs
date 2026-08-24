import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.ORBIT_PUBLIC_URL || 'http://127.0.0.1:4174';
const expectedOrigin = process.env.ORBIT_PUBLIC_EXPECTED_ORIGIN || baseUrl;
const screenshotDir = path.join(os.tmpdir(), 'orbit-public-site-smoke');
const pages = ['/', '/product.html', '/faq.html', '/support.html', '/privacy.html', '/terms.html', '/404.html', '/500.html'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const expectedInstallerUrl = 'https://github.com/sahusgupta/orbit/releases/download/v0.1.71/Orbit-0.1.71-x64.exe';

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));

try {
  fs.mkdirSync(screenshotDir, { recursive: true });
  for (const route of pages) {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    if (!response?.ok()) throw new Error(`${route} returned ${response?.status() || 'no status'}.`);
    if (await page.locator('h1').count() !== 1) throw new Error(`${route} must render exactly one H1.`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    if (!canonical?.startsWith(expectedOrigin)) throw new Error(`${route} did not use the configured canonical origin.`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error(`${route} has horizontal viewport overflow at 1440px.`);
  }

  await page.goto(`${baseUrl}/faq.html`, { waitUntil: 'networkidle' });
  const firstDisclosure = page.locator('.faq-disclosure').first();
  const firstSummary = firstDisclosure.locator('summary');
  await firstSummary.focus();
  await page.keyboard.press('Enter');
  if (!await firstDisclosure.evaluate((element) => element.open)) throw new Error('FAQ disclosure did not open from the keyboard.');
  await page.screenshot({ path: path.join(screenshotDir, 'faq-desktop.png'), fullPage: true });

  await page.goto(`${baseUrl}/product.html`, { waitUntil: 'networkidle' });
  if (!await page.locator('.product-proof img').evaluate((image) => image.complete && image.naturalWidth > 0)) {
    throw new Error('Current redacted product capture did not load.');
  }
  await page.screenshot({ path: path.join(screenshotDir, 'product-desktop.png'), fullPage: true });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (await page.locator('#version').innerText() !== '0.1.71') {
    throw new Error('The same-origin release manifest did not render version 0.1.71.');
  }
  if (await page.locator('#updated').innerText() !== 'Verified stable release') {
    throw new Error('The same-origin release manifest did not render its verified stable state.');
  }
  const installerLink = page.locator('#installer-link');
  if (await installerLink.innerText() !== 'Download for Windows'
      || await installerLink.getAttribute('href') !== expectedInstallerUrl) {
    throw new Error('The release CTA did not render the immutable 0.1.71 installer URL.');
  }
  await page.screenshot({ path: path.join(screenshotDir, 'home-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of pages) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (mobileOverflow) throw new Error(`${route} has horizontal viewport overflow at 390px.`);
  }
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(screenshotDir, 'home-mobile.png'), fullPage: true });

  if (pageErrors.length || consoleErrors.length || failedRequests.length) {
    throw new Error(JSON.stringify({ pageErrors, consoleErrors, failedRequests }, null, 2));
  }
  console.log(`Public site smoke passed: ${pages.length} pages, desktop/mobile layout, clean console. Screenshots: ${screenshotDir}`);
} finally {
  await browser.close();
}
