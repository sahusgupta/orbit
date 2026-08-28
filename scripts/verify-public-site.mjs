import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicPages, resolvePublicOrigin } from '../download-site/public-config.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'download-dist');
const publicOrigin = 'https://orbit-preview.invalid';
const expectedVersion = '0.1.73';
const expectedInstallerUrl = 'https://github.com/sahusgupta/orbit/releases/download/v0.1.73/Orbit-0.1.73-x64.exe';
assert.equal(resolvePublicOrigin({}), 'http://127.0.0.1:4174');
assert.equal(resolvePublicOrigin({ VERCEL_URL: 'orbit-branch-preview.invalid' }), 'https://orbit-branch-preview.invalid');
assert.equal(resolvePublicOrigin({ ORBIT_PUBLIC_PREVIEW_ORIGIN: publicOrigin }), publicOrigin);
assert.equal(resolvePublicOrigin({
  ORBIT_PUBLIC_ORIGIN: 'https://configured-production.invalid',
  ORBIT_PUBLIC_PREVIEW_ORIGIN: publicOrigin
}), 'https://configured-production.invalid');
assert.throws(() => resolvePublicOrigin({ ORBIT_PUBLIC_ORIGIN: 'https://example.invalid/path' }), /must not include a path/);
const viteEntrypoint = path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const build = spawnSync(process.execPath, [viteEntrypoint, 'build', '--config', 'download-site/vite.config.mjs'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  env: { ...process.env, ORBIT_PUBLIC_PREVIEW_ORIGIN: publicOrigin }
});
process.stdout.write(build.stdout || '');
process.stderr.write(build.stderr || '');
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

const read = (relativePath) => fs.readFileSync(path.join(outputRoot, relativePath), 'utf8');
const matchOne = (source, expression, label) => {
  const matches = [...source.matchAll(expression)];
  assert.equal(matches.length, 1, `${label} must occur exactly once`);
  return matches[0][1];
};
const titles = new Set();
const descriptions = new Set();

for (const [fileName, page] of Object.entries(publicPages)) {
  const html = read(fileName);
  const title = matchOne(html, /<title>([^<]+)<\/title>/g, `${fileName} title`);
  const description = matchOne(html, /<meta name="description" content="([^"]+)"/g, `${fileName} description`);
  const canonical = matchOne(html, /<link rel="canonical" href="([^"]+)"/g, `${fileName} canonical`);
  const ogImage = matchOne(html, /<meta property="og:image" content="([^"]+)"/g, `${fileName} OG image`);
  const h1Count = (html.match(/<h1(?:\s[^>]*)?>/g) || []).length;
  const schemaText = matchOne(html, /<script type="application\/ld\+json">([^<]+)<\/script>/g, `${fileName} JSON-LD`);

  assert.equal(title, page.title);
  assert.equal(description, page.description);
  assert.equal(canonical, new URL(page.path, `${publicOrigin}/`).href);
  assert.equal(ogImage, `${publicOrigin}/orbit-icon.png`);
  assert.equal(h1Count, 1, `${fileName} must contain one H1`);
  assert.doesNotThrow(() => JSON.parse(schemaText), `${fileName} JSON-LD must parse`);
  assert.match(html, page.indexable ? /name="robots" content="index,follow"/ : /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(
    html.replaceAll(expectedInstallerUrl, ''),
    /orbit-public-metadata|sahusgupta|orbitapp-one\.vercel\.app/i
  );
  assert.ok(html.length > 1_000, `${fileName} must expose meaningful static HTML`);
  titles.add(title);
  descriptions.add(description);
}

assert.equal(titles.size, Object.keys(publicPages).length, 'Public page titles must be unique');
assert.equal(descriptions.size, Object.keys(publicPages).length, 'Public page descriptions must be unique');

const indexedPages = Object.values(publicPages).filter((page) => page.indexable);
const sitemap = read('sitemap.xml');
assert.equal((sitemap.match(/<url>/g) || []).length, indexedPages.length);
for (const page of indexedPages) assert.ok(sitemap.includes(new URL(page.path, `${publicOrigin}/`).href));
assert.doesNotMatch(sitemap, /404\.html|500\.html/);

const robots = read('robots.txt');
assert.match(robots, /User-agent: \*/);
assert.match(robots, /User-agent: GPTBot/);
assert.match(robots, /User-agent: ClaudeBot/);
assert.ok(robots.includes(`Sitemap: ${publicOrigin}/sitemap.xml`));
assert.match(read('llms.txt'), /Authenticated, administrative, API, player-private, and venue-private routes/);
assert.match(read('ai-policy.txt'), /Automated crawlers may index the public static pages/);
const privacy = read('privacy.html');
for (const service of ['Google Firebase and Google Cloud', 'Vercel', 'Stripe', 'Twilio', 'RevenueCat', 'OpenStreetMap Foundation', 'Expo Application Services', 'GitHub']) {
  assert.match(privacy, new RegExp(service));
}
assert.match(privacy, /built with assistance from AI development tools, including OpenAI Codex/);
assert.match(privacy, /currently has no user-facing generative-AI runtime feature/);
assert.doesNotMatch(privacy, /Orbit Technologies LLC/);
assert.ok(fs.existsSync(path.join(outputRoot, 'orbit-icon.png')), 'OG image must be emitted');
const emittedFiles = fs.readdirSync(outputRoot, { recursive: true }).map(String);

const generatedArt = path.join(outputRoot, 'art', 'orbit-table-rhythm-v1.jpg');
const productProof = path.join(outputRoot, 'proof', 'orbit-core-empty-workspace.jpg');
assert.ok(fs.statSync(generatedArt).size > 100_000, 'Intentional generated atmospheric artwork must be emitted');
assert.ok(fs.statSync(productProof).size > 40_000, 'Current redacted product capture must be emitted');
assert.match(read('index.html'), /alt="Abstract editorial illustration[^\"]+does not depict the Orbit product\./);
assert.match(read('product.html'), /alt="Current Orbit Core Floor interface in an empty local workspace[^\"]+redacted\./);
assert.match(read('product.html'), /Current application capture/);
assert.equal((read('faq.html').match(/<details class="faq-disclosure">/g) || []).length, 7, 'FAQ must contain seven factual disclosures');

const marketingSource = ['index.html', 'product.html', 'faq.html', 'support.html'].map(read).join('\n');
assert.doesNotMatch(marketingSource, /testimonial|trusted by|customer stor(?:y|ies)|five-star|pricing card|built for the future/i);
const publicStyles = read(emittedFiles.find((fileName) => fileName.endsWith('.css')));
assert.doesNotMatch(publicStyles, /(?:linear|radial)-gradient|aurora|gradient-blob|backdrop-filter|noise-overlay/i);

assert.equal(emittedFiles.some((fileName) => fileName.endsWith('.map')), false, 'Public source maps must not be emitted');

const releaseManifest = JSON.parse(read('release-manifest.json'));
assert.deepEqual(releaseManifest, {
  schemaVersion: 1,
  productName: 'Orbit',
  version: expectedVersion,
  publishedLabel: 'Verified stable release',
  installerUrl: expectedInstallerUrl
});
const home = read('index.html');
assert.ok(home.includes(`id="installer-link" href="${expectedInstallerUrl}"`));
assert.ok(home.includes(`id="version">${expectedVersion}`));

console.log(`Public site verification passed: ${Object.keys(publicPages).length} static pages, ${indexedPages.length} indexed routes, configured preview origin.`);
