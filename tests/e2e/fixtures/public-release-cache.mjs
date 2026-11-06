import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// Real Chromium HTTP cache regression; no routes, interception, or fake fetch.
export async function runPublicReleaseCacheSmoke() {
  const root = process.cwd();
  const phase = 'release-cache-regression';
  const builtHtml = fs.readFileSync(path.join(root, 'download-dist/index.html'), 'utf8');
  const scripts = [...builtHtml.matchAll(/<script[^>]+src="([^"]+\.js)"/g)];
  assert.equal(scripts.length, 1);
  const relativeBundle = scripts[0][1].replace(/^\.\//, '');
  assert.match(relativeBundle, /^assets\/index-[A-Za-z0-9_-]+\.js$/);
  const bundle = fs.readFileSync(path.join(root, 'download-dist', relativeBundle));
  const policy = 'public,max-age=0,must-revalidate';
  const oldEtag = '"ad585906c02a52fcddbe558b46278913"';
  let state = { version: '0.1.84', status: 200 };
  let manifestRequests = [];
  let origin;
  let proxyDenied = 0;
  let forwardedExternal = 0;
  const contexts = [];
  let browserServer;
  let browser;
  const report = { phase, cachePolicy: policy, actualHeaderEvidence: 'parent public HEAD at 01:06:06Z', bundle: relativeBundle,
    bundleSha256: createHash('sha256').update(bundle).digest('hex'), routesOrInterceptionUsed: false,
    pageActionDeadlineMs: 5000, cases: [], pageExternalRequests: [], proxyDenied: 0, forwardedExternal: 0 };
  const installer = version => `https://github.com/sahusgupta/orbit/releases/download/v${version}/Orbit-${version}-x64.exe`;
  const site = http.createServer((request, response) => {
    const url = new URL(request.url, origin);
    if (url.pathname === '/release-manifest.json') {
      const record = { version: state.version, status: state.status, conditional: Boolean(request.headers['if-none-match']), cookie: request.headers.cookie === 'orbit-cache-proof=synthetic' };
      manifestRequests.push(record);
      const body = JSON.stringify({ schemaVersion: 1, productName: 'Orbit', version: state.version, publishedLabel: 'Synthetic release '+state.version, installerUrl: installer(state.version) });
      const etag = state.version === '0.1.75' ? oldEtag : '"owned-0.1.84-different-manifest"';
      response.writeHead(state.status === 200 && request.headers['if-none-match'] === etag ? 304 : state.status, {
        'content-type': 'application/json', 'cache-control': policy, etag,
        age: state.version === '0.1.75' ? '1363' : '0', 'x-vercel-cache': 'HIT',
        'content-length': state.status === 200 && request.headers['if-none-match'] === etag ? '0' : String(Buffer.byteLength(body))
      });
      response.end(state.status === 200 && request.headers['if-none-match'] === etag ? undefined : body); return;
    }
    if (url.pathname === '/'+relativeBundle) {
      response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'public,max-age=31536000,immutable' }); response.end(bundle); return;
    }
    if (url.pathname === '/') {
      const version = state.version;
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': policy,
        'set-cookie': 'orbit-cache-proof=synthetic; SameSite=Strict; Path=/',
        'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'" });
      response.end(`<!doctype html><html><head>${state.loadBundle === false ? '' : `<script type="module" src="/${relativeBundle}"></script>`}</head><body data-html-version="${version}"><h1>Owned release cache fixture</h1><div id="release-status"><span id="version">${version}</span><span id="updated">Waiting</span><a id="installer-link" href="${installer(version)}">Download default</a></div></body></html>`); return;
    }
    response.writeHead(404); response.end();
  });
  const proxy = http.createServer((request, response) => {
    let url;
    try { url = new URL(request.url); } catch { proxyDenied++; response.writeHead(403); response.end(); return; }
    if (url.origin !== origin || url.username || url.password || request.method !== 'GET') {
      proxyDenied++; response.writeHead(403); response.end(); return;
    }
    if (!['/', '/release-manifest.json', '/'+relativeBundle, '/favicon.ico'].includes(url.pathname)) {
      proxyDenied++; response.writeHead(403); response.end(); return;
    }
    if (url.hostname !== '127.0.0.1') forwardedExternal++;
    const headers = { ...request.headers, host: url.host, connection: 'close' };
    delete headers['proxy-connection']; delete headers['proxy-authorization'];
    const upstream = http.request(url, { method: 'GET', headers }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); }); upstream.end();
  });
  proxy.on('connect', (_request, socket) => { proxyDenied++; socket.destroy(); });
  const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const closeServer = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  let failure;
  try {
    await listen(site); origin = `http://127.0.0.1:${site.address().port}`; await listen(proxy);
    const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`;
    const denialStatus = await new Promise((resolve, reject) => {
      const request = http.get(proxyOrigin, { path: 'http://example.invalid/owned-denial-proof' }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(denialStatus, 403); assert.equal(proxyDenied, 1); report.proxyDenialControlPassed = true;
    browserServer = await chromium.launchServer({ headless: true, timeout: 15000, proxy: { server: proxyOrigin, bypass: '<-loopback>' },
      args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    report.browserPid = browserServer.process().pid;
    browser = await chromium.connect(browserServer.wsEndpoint()); report.browserVersion = browser.version();
    async function fresh() {
      const context = await browser.newContext({ serviceWorkers: 'block' }); contexts.push(context);
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(5000);
      page.on('request', request => { if (new URL(request.url()).origin !== origin) report.pageExternalRequests.push({ method: request.method(), origin: new URL(request.url()).origin }); });
      return { context, page };
    }
    async function settled(page, navigate) {
      await navigate();
      await page.waitForFunction(() => document.querySelector('#updated')?.textContent !== 'Waiting');
      return page.evaluate(() => ({ version: document.querySelector('#version').textContent,
        updated: document.querySelector('#updated').textContent, href: document.querySelector('#installer-link').getAttribute('href'), htmlVersion: document.body.dataset.htmlVersion }));
    }
    state = { version: '0.1.84', status: 200 }; manifestRequests = [];
    {
      const { context, page } = await fresh(); const observed = await settled(page, () => page.goto(origin, { waitUntil: 'load' }));
      assert.equal(observed.version, '0.1.84'); assert.equal(observed.href, installer('0.1.84'));
      assert.equal(manifestRequests.length, 1); assert.equal(manifestRequests[0].cookie, true);
      report.cases.push({ name: 'fresh84', passed: true, observed, manifestRequests: [...manifestRequests] }); await context.close();
    }
    state = { version: '0.1.84', status: 503 }; manifestRequests = [];
    {
      const { context, page } = await fresh(); const observed = await settled(page, () => page.goto(origin, { waitUntil: 'load' }));
      assert.equal(observed.version, '0.1.84'); assert.equal(observed.href, installer('0.1.84')); assert.equal(observed.updated, 'Release metadata unavailable');
      assert.equal(manifestRequests.length, 1); report.cases.push({ name: '503Fallback', passed: true, observed, manifestRequests: [...manifestRequests] }); await context.close();
    }
    state = { version: '0.1.75', status: 200, loadBundle: false }; manifestRequests = [];
    {
      const { context, page } = await fresh();
      await page.goto(origin, { waitUntil: 'load' });
      // Use the native browser cache with the legacy request policy. The
      // current bundle is absent from this primer page; fetch is never replaced.
      const readLegacyManifest = () => page.evaluate(async () => {
        const response = await fetch('./release-manifest.json', { cache: 'force-cache', credentials: 'same-origin' });
        const payload = await response.json();
        return { version: payload.version, href: payload.installerUrl };
      });
      const initial = await readLegacyManifest();
      assert.equal(initial.version, '0.1.75'); assert.equal(manifestRequests.length, 1);
      state = { version: '0.1.84', status: 200 };
      const staleBeforeUpgrade = await readLegacyManifest();
      assert.equal(staleBeforeUpgrade.version, '0.1.75'); assert.equal(manifestRequests.length, 1);
      const observed = await settled(page, () => page.reload({ waitUntil: 'load' }));
      assert.equal(observed.htmlVersion, '0.1.84');
      const row = { name: 'cached75ThenReload84', initial, staleBeforeUpgrade, legacyCacheConfirmed: true, observed, manifestRequests: [...manifestRequests], passed: observed.version === '0.1.84' && observed.href === installer('0.1.84') };
      report.cases.push(row);
      assert.equal(observed.version, '0.1.84', 'New84 HTML must not be overwritten by the cached75 manifest');
      assert.equal(observed.href, installer('0.1.84')); assert.equal(manifestRequests.length, 2); await context.close();
    }
    assert.deepEqual(report.pageExternalRequests, []); assert.equal(forwardedExternal, 0);
  } catch (error) {
    failure = error; report.failure = { name: error.name, message: error.message };
  } finally {
    report.proxyDenied = proxyDenied; report.forwardedExternal = forwardedExternal;
    let cleanupError;
    try {
      for (const context of contexts) await context.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
      if (browserServer) await browserServer.close();
    } catch (error) {
      cleanupError = error;
    } finally {
      const results = await Promise.allSettled([closeServer(proxy), closeServer(site)]);
      const rejected = results.find(result => result.status === 'rejected');
      if (!cleanupError && rejected) cleanupError = rejected.reason;
      if (browserServer) report.browserExited = browserServer.process().exitCode !== null || browserServer.process().signalCode !== null;
      report.serversClosed = !proxy.listening && !site.listening;
    }
    if (cleanupError) {
      report.cleanupFailure = { name: cleanupError.name, message: cleanupError.message };
      if (!failure) failure = cleanupError;
    }
  }
  console.log(JSON.stringify(report));
  if (failure) throw failure;
  assert.equal(report.browserExited, true);
  assert.equal(report.serversClosed, true);
  assert.deepEqual(report.pageExternalRequests, []);
  assert.equal(forwardedExternal, 0);
  return report;
}
