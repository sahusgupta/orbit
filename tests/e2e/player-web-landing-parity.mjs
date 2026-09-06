import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireFromPlayerWeb = createRequire(new URL('../../player-web/package.json', import.meta.url));
const sharp = requireFromPlayerWeb('sharp');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const referenceUrl = process.env.ORBIT_REFERENCE_URL || 'http://127.0.0.1:4174';
const targetUrl = process.env.ORBIT_PLAYER_WEB_URL || 'http://127.0.0.1:4175';
const outputDirectory = path.resolve(process.env.ORBIT_LANDING_PARITY_OUTPUT || path.join(repositoryRoot, 'test-results/player-web/landing-parity'));
const failures = [];
const observations = [];

const viewports = [
  { name: 'mobile', width: 390, height: 844, checkpoints: ['hero', 'discover', 'queue', 'cta'] },
  { name: 'desktop', width: 1440, height: 900, checkpoints: ['hero', 'discover', 'join', 'queue', 'reserve', 'cta'] }
];

mkdirSync(outputDirectory, { recursive: true });

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function waitForStableLanding(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.locator('svg animate, svg animateMotion').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.waitForTimeout(1900);
}

async function getLandingMetrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.player-landing') || document.querySelector('#root > div');
    const sections = root ? [...root.querySelectorAll(':scope > section')] : [];
    const experience = document.querySelector('#how-it-works') || [...document.querySelectorAll('div')].find((element) => element.style.height === '500vh');
    const nav = root?.querySelector(':scope > header');
    const footer = root?.querySelector(':scope > footer');
    if (!root || sections.length < 2 || !experience || !nav || !footer) throw new Error('Landing landmarks are incomplete.');
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    return {
      text: root.innerText.replace(/\s+/g, ' ').trim(),
      pageHeight: document.documentElement.scrollHeight,
      hero: rect(sections[0]),
      experience: rect(experience),
      cta: rect(sections.at(-1)),
      nav: rect(nav),
      footer: rect(footer)
    };
  });
}

async function scrollToCheckpoint(page, checkpoint) {
  await page.evaluate((name) => {
    const experience = document.querySelector('#how-it-works') || [...document.querySelectorAll('div')].find((element) => element.style.height === '500vh');
    const root = document.querySelector('.player-landing') || document.querySelector('#root > div');
    const cta = root?.querySelector(':scope > section:last-of-type');
    if (!experience || !cta) throw new Error('Landing scroll landmarks are incomplete.');
    const experienceTop = experience.getBoundingClientRect().top + window.scrollY;
    const ctaTop = cta.getBoundingClientRect().top + window.scrollY;
    const offsets = { hero: 0, discover: 0.12, join: 1.12, queue: 2.12, reserve: 3.12 };
    const top = name === 'hero' ? 0 : name === 'cta' ? ctaTop : experienceTop + (offsets[name] || 0) * window.innerHeight;
    window.scrollTo(0, Math.round(top));
  }, checkpoint);
  await page.waitForTimeout(650);
}

async function normalizeTargetAccent(page) {
  await page.evaluate(() => {
    const parseOpacity = (token) => {
      const match = token.match(/\/(\d+)$/);
      return match ? Number(match[1]) / 100 : 1;
    };
    for (const element of document.querySelectorAll('*')) {
      const tokens = typeof element.className === 'string' ? element.className.split(/\s+/) : [];
      for (const token of tokens) {
        if (!token.includes('[#191970]')) continue;
        const alpha = parseOpacity(token);
        const color = alpha === 1 ? '#C24B1A' : `rgb(194 75 26 / ${alpha})`;
        if (token.includes('bg-[#191970]')) element.style.setProperty('background-color', color, 'important');
        if (token.includes('text-[#191970]')) element.style.setProperty('color', color, 'important');
        if (token.includes('border-[#191970]')) element.style.setProperty('border-color', color, 'important');
        element.classList.remove(token);
      }
      for (const property of ['fill', 'stroke']) {
        if (element.getAttribute(property)?.toUpperCase() === '#191970') element.setAttribute(property, '#C24B1A');
      }
      const inlineBackground = element.style.backgroundColor.replaceAll(' ', '');
      if (inlineBackground === 'rgb(25,25,112)' || inlineBackground === '#191970') {
        element.style.setProperty('background-color', '#C24B1A', 'important');
      }
    }
  });
}

async function normalizeAllowedTypography(page) {
  await page.evaluate(() => {
    const root = document.querySelector('.player-landing') || document.querySelector('#root > div');
    for (const element of root?.querySelectorAll('h1, h2, h3, p, span, a, button, strong') || []) {
      element.style.setProperty('color', 'transparent', 'important');
      element.style.setProperty('text-shadow', 'none', 'important');
    }
  });
}

async function screenshotLanding(page, kind, viewport, checkpoint) {
  if (kind === 'target') await normalizeTargetAccent(page);
  await normalizeAllowedTypography(page);
  if (kind === 'target') await page.waitForTimeout(260);
  const logoMasks = kind === 'target'
    ? [page.locator('.player-landing__nav img'), page.locator('.player-landing__footer img')]
    : [page.locator('#root > div > header svg'), page.locator('#root > div > footer svg')];
  const file = path.join(outputDirectory, `${viewport.name}-${checkpoint}-${kind}.png`);
  const bytes = await page.screenshot({ path: file, mask: logoMasks, maskColor: '#ff00ff' });
  return { bytes, file };
}

async function compareScreenshots(reference, target, label) {
  const referenceImage = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const targetImage = await sharp(target).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = referenceImage.info;
  if (targetImage.info.width !== width || targetImage.info.height !== height || targetImage.info.channels !== channels) {
    failures.push(`${label}: screenshot dimensions differ.`);
    return { changedPixelRatio: 1, meanChannelDelta: 255 };
  }
  const diff = Buffer.alloc(referenceImage.data.length);
  let changedPixels = 0;
  let channelDelta = 0;
  for (let index = 0; index < referenceImage.data.length; index += channels) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(referenceImage.data[index + channel] - targetImage.data[index + channel]);
      pixelDelta = Math.max(pixelDelta, delta);
      channelDelta += delta;
      diff[index + channel] = delta;
    }
    diff[index + 3] = 255;
    if (pixelDelta > 18) changedPixels += 1;
  }
  const pixels = width * height;
  const changedPixelRatio = changedPixels / pixels;
  const meanChannelDelta = channelDelta / (pixels * 3);
  await sharp(diff, { raw: { width, height, channels } }).png().toFile(path.join(outputDirectory, `${label}-diff.png`));
  assert(changedPixelRatio <= 0.012, `${label}: ${(changedPixelRatio * 100).toFixed(3)}% of pixels differ beyond tolerance.`);
  assert(meanChannelDelta <= 1.2, `${label}: mean channel delta ${meanChannelDelta.toFixed(3)} exceeds tolerance.`);
  return { changedPixelRatio, meanChannelDelta };
}

function compareBox(reference, target, label) {
  for (const property of ['x', 'y', 'width', 'height']) {
    const delta = Math.abs(reference[property] - target[property]);
    assert(delta <= 1.1, `${label}.${property}: ${target[property]} differs from reference ${reference[property]} by ${delta.toFixed(2)}px.`);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    const referencePage = await context.newPage();
    const targetPage = await context.newPage();
    await Promise.all([referencePage.goto(referenceUrl), targetPage.goto(targetUrl)]);
    await Promise.all([waitForStableLanding(referencePage), waitForStableLanding(targetPage)]);

    const [referenceMetrics, targetMetrics] = await Promise.all([getLandingMetrics(referencePage), getLandingMetrics(targetPage)]);
    assert(referenceMetrics.text === targetMetrics.text, `${viewport.name}: rendered landing text differs from the supplied reference.`);
    assert(Math.abs(referenceMetrics.pageHeight - targetMetrics.pageHeight) <= 1, `${viewport.name}: full page height differs by ${Math.abs(referenceMetrics.pageHeight - targetMetrics.pageHeight)}px.`);
    for (const landmark of ['hero', 'experience', 'cta', 'nav', 'footer']) compareBox(referenceMetrics[landmark], targetMetrics[landmark], `${viewport.name}.${landmark}`);

    for (const checkpoint of viewport.checkpoints) {
      await Promise.all([scrollToCheckpoint(referencePage, checkpoint), scrollToCheckpoint(targetPage, checkpoint)]);
      const [referenceShot, targetShot] = await Promise.all([
        screenshotLanding(referencePage, 'reference', viewport, checkpoint),
        screenshotLanding(targetPage, 'target', viewport, checkpoint)
      ]);
      const visual = await compareScreenshots(referenceShot.bytes, targetShot.bytes, `${viewport.name}-${checkpoint}`);
      observations.push({ viewport: viewport.name, checkpoint, ...visual });
    }
    await context.close();
  }

  const contractContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await contractContext.newPage();
  const response = await page.goto(targetUrl, { waitUntil: 'networkidle' });
  assert(response?.status() === 200, `Target landing returned HTTP ${response?.status() || 0}.`);
  const routeContract = await page.evaluate(() => ({
    home: document.querySelector('.player-landing__nav a[aria-label="Orbit Player home"]')?.getAttribute('href'),
    games: [...document.querySelectorAll('.player-landing a')].find((link) => link.textContent?.trim() === 'Browse published games')?.getAttribute('href'),
    memberships: [...document.querySelectorAll('.player-landing a')].find((link) => link.textContent?.trim() === 'Manage memberships')?.getAttribute('href'),
    myOrbit: [...document.querySelectorAll('.player-landing a')].find((link) => link.textContent?.trim() === 'Open My Orbit')?.getAttribute('href'),
    pokerCards: document.querySelectorAll('.player-poker-card').length,
    privacy: [...document.querySelectorAll('.player-landing__footer a')].find((link) => link.textContent?.trim() === 'Privacy')?.getAttribute('href'),
    terms: [...document.querySelectorAll('.player-landing__footer a')].find((link) => link.textContent?.trim() === 'Terms')?.getAttribute('href'),
    core: [...document.querySelectorAll('.player-landing__footer a')].find((link) => link.textContent?.trim() === 'Orbit Core')?.getAttribute('href'),
    logoSources: [...document.querySelectorAll('.player-landing img')].map((image) => image.getAttribute('src'))
  }));
  assert(routeContract.home === '/', 'Landing brand is not wired to home.');
  assert(routeContract.games === '/games', 'Landing published-game action is not wired to discovery.');
  assert(routeContract.memberships === '/me/clubs', 'Landing membership action is not wired to My Clubs.');
  assert(routeContract.myOrbit === '/me', 'Landing My Orbit action is not wired to the player hub.');
  assert(routeContract.pokerCards === 3, 'Landing does not render the adapted three-card poker hand.');
  assert(routeContract.privacy === '/privacy', 'Landing privacy link is not wired to the privacy route.');
  assert(routeContract.terms === 'https://orbitapp-one.vercel.app/terms', 'Landing terms link is not wired to the published terms route.');
  assert(routeContract.core === 'https://orbitapp-one.vercel.app/', 'Landing Orbit Core link is not wired to the public Orbit site.');
  assert(routeContract.logoSources.length === 2 && routeContract.logoSources.every((source) => source?.includes('orbit-logo.svg')), 'Landing does not use the canonical Orbit logo in both brand positions.');

  const source = readFileSync(path.join(repositoryRoot, 'player-web/src/components/home/player-landing.tsx'), 'utf8');
  assert(!/#C24B1A|#CD5220/i.test(source), 'The supplied orange accent remains in the Orbit landing source.');
  assert((source.match(/#191970/gi) || []).length >= 10, 'Midnight blue is not the landing accent.');
  assert(readFileSync(path.join(repositoryRoot, 'player-web/public/orbit-logo.svg')).equals(readFileSync(path.join(repositoryRoot, 'public/orbit-logo.svg'))), 'Player Web logo is not byte-identical to the canonical Orbit logo.');
  assert(readFileSync(path.join(repositoryRoot, 'player-web/app/favicon.ico')).equals(readFileSync(path.join(repositoryRoot, 'build/icon.ico'))), 'Player Web favicon is not byte-identical to the canonical Orbit favicon.');
  await contractContext.close();
} finally {
  await browser.close();
}

const report = {
  referenceUrl,
  targetUrl,
  landingPageIdenticalWithinAllowedSubstitutions: failures.length === 0,
  midnightBlueAccent: failures.every((failure) => !failure.includes('accent') && !failure.includes('orange') && !failure.includes('Midnight')),
  canonicalLogoAndFavicon: failures.every((failure) => !failure.includes('logo') && !failure.includes('favicon')),
  homeRoutingRewired: failures.every((failure) => !failure.includes('wired')),
  visualCheckpoints: observations.length,
  failures,
  observations
};
writeFileSync(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
