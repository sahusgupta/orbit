import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);
const express = require('express');
const assetTargets = [
  ['/privacy', 'privacy.html'], ['/privacy.html', 'privacy.html'],
  ['/terms', 'terms.html'], ['/terms.html', 'terms.html'],
  ['/support', 'support.html'], ['/support.html', 'support.html'],
  ['/legal.css', 'legal.css'], ['/orbit-logo.svg', 'orbit-logo.svg'],
  ['/dashboard', 'dashboard.html'], ['/dashboard.js', 'dashboard.js'], ['/dashboard.css', 'dashboard.css'],
  ['/check-in', 'self-check-in.html'], ['/self-check-in.css', 'self-check-in.css'], ['/self-check-in.js', 'self-check-in.js']
];
const filenames = [...new Set(assetTargets.map(([, filename]) => filename))];
const fixtureBody = (filename) => `Synthetic asset: ${filename}\n${'synthetic '.repeat(160)}`;
const forbiddenModule = new Proxy({}, {
  get(_target, name) { return () => { throw new Error(`Unexpected service call: ${String(name)}`); }; }
});
const denyAuth = (_request, response) => response.status(401).json({ ok: false, syntheticAuth: 'denied' });
const auth = new Proxy({
  requireOwnerApiKey: denyAuth, requireClientAuth: denyAuth, requireDashboardAuth: denyAuth,
  asyncRoute: (operation) => (request, response, next) => Promise.resolve(operation(request, response)).catch(next)
}, { get(target, name) { return target[name] || forbiddenModule[name]; } });
const dataProtection = {
  isHostedOrProduction: () => true, protectedIdentifier: () => 'synthetic-reference', redactText: (value) => String(value)
};

function compile(relativePath, dirname, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8'), {
    module, __dirname: dirname, Buffer, URL,
    process: { env: { NODE_ENV: 'production', ORBIT_PUBLIC_ORIGIN: 'https://synthetic-public.invalid' } },
    console: { error() {} },
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unapproved dependency ${name}`);
      return dependencies[name];
    }
  });
  return module.exports;
}

function exportedFunction(module, name) {
  const operation = Reflect.get(module, name);
  if (typeof operation !== 'function') throw new Error(`Missing exported function ${name}`);
  return operation;
}

/** @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string }>} */
function request(port, pathname, { method = 'GET', gzip = false } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: '127.0.0.1', port, path: pathname, method, agent: false,
      headers: { 'accept-encoding': gzip ? 'gzip' : 'identity' }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: Number(response.statusCode), headers: response.headers,
          body: (response.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(body) : body).toString('utf8') });
      });
    });
    outgoing.setTimeout(2_000, () => outgoing.destroy(new Error('Synthetic loopback request timed out.')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function withFixture(dotAncestor, operation) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-public-assets-'));
  const appRoot = dotAncestor ? path.join(temporary, '.codex') : temporary;
  if (dotAncestor) fs.mkdirSync(appRoot);
  const publicDirectory = path.join(appRoot, 'public');
  fs.mkdirSync(publicDirectory);
  for (const filename of filenames) fs.writeFileSync(path.join(publicDirectory, filename), fixtureBody(filename));
  fs.writeFileSync(path.join(publicDirectory, '.synthetic-hidden'), 'synthetic hidden marker');
  fs.writeFileSync(path.join(appRoot, 'outside-marker.txt'), 'synthetic outside marker');
  const app = express();
  app.disable('x-powered-by');
  const security = compile('../http/security.js', '', {
    './operationalAlerts': forbiddenModule, './dataProtection': dataProtection, '../db/rateLimits': forbiddenModule
  });
  const middleware = compile('../http/middleware.js', '', {
    crypto: require('node:crypto'), './dataProtection': dataProtection,
    './operationalAlerts': { sendOperationalAlert: () => undefined }
  });
  const performance = compile('../http/performance.js', '', { compression: require('compression') });
  app.use(exportedFunction(performance, 'responseCompression'));
  app.use(exportedFunction(security, 'applySecurityHeaders'));
  const dependencies = {
    path, crypto: require('node:crypto'), '../database': forbiddenModule,
    '../firebasePublisher': forbiddenModule, '../identityService': forbiddenModule, '../paymentService': forbiddenModule,
    '../http/auth': auth, '../http/releaseVersion': forbiddenModule, '../licenseService': forbiddenModule,
    '../http/domainEvents': forbiddenModule, '../http/dataProtection': dataProtection,
    '../managementAccountService': { getManagementAccountService: () => ({}) },
    '../http/operationalAlerts': forbiddenModule, '../orbitCore': forbiddenModule,
    '../selfCheckIn': forbiddenModule, '../selfCheckInSecurity': forbiddenModule
  };
  const sourceDirectory = path.join(appRoot, 'src/routes');
  const system = compile('system.js', sourceDirectory, dependencies);
  const dashboard = compile('dashboard.js', sourceDirectory, dependencies);
  const checkIn = compile('selfCheckIn.js', sourceDirectory, dependencies);
  exportedFunction(system, 'registerLegalRoutes')(app);
  exportedFunction(dashboard, 'registerDashboardRoutes')(app, forbiddenModule, 'synthetic-start');
  exportedFunction(checkIn, 'registerSelfCheckInRoutes')(app);
  // This synthetic-only route probes the installed send library's root policy;
  // product routes above accept only fixed filenames, never this query value.
  app.get('/__relative_path_probe', (incoming, response) => {
    response.sendFile(incoming.query.name, { root: publicDirectory }, (error) => {
      if (error) response.status(error.status || 500).end('Synthetic file rejection.');
    });
  });
  app.use(exportedFunction(middleware, 'handleApiError'));
  const server = http.createServer(app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(undefined));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback server address.');
    await operation({ port: address.port, publicDirectory });
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    // Delete only explicitly created fixture files, then empty directories.
    for (const filename of [...filenames, '.synthetic-hidden']) {
      const fixture = path.join(publicDirectory, filename);
      if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
    }
    fs.unlinkSync(path.join(appRoot, 'outside-marker.txt'));
    fs.rmdirSync(publicDirectory);
    if (dotAncestor) fs.rmdirSync(appRoot);
    fs.rmdirSync(temporary);
  }
}

function expectSecurityHeaders(response) {
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['x-frame-options']).toBe('DENY');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(response.headers['content-security-policy']).toContain("script-src 'self'");
}

describe('fixed public asset routes with actual Express/send', () => {
  // Service/auth callbacks are intentionally stubbed here. The unchanged
  // server.routes.test.js suite covers actual route authentication composition.
  it('preserves every fixed target, MIME type, legal canonical link and private security headers under a neutral root', async () => {
    await withFixture(false, async ({ port }) => {
      for (const [pathname, filename] of assetTargets) {
        const response = await request(port, `${pathname}?filename=..%2Foutside-marker.txt`);
        expect(response.status, pathname).toBe(200);
        expect(response.body, pathname).toBe(fixtureBody(filename));
        expectSecurityHeaders(response);
        const mime = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'javascript';
        expect(response.headers['content-type'], pathname).toContain(mime);
        if (filename.startsWith('self-check-in')) {
          expect(response.headers['cache-control'], pathname).toContain('no-store');
          expect(response.headers['x-robots-tag'], pathname).toBe('noindex, nofollow');
        }
      }
      const privacy = await request(port, '/privacy', { gzip: true });
      expect(privacy.headers.link).toBe('<https://synthetic-public.invalid/privacy.html>; rel="canonical"');
      expect(privacy.headers['x-robots-tag']).toBe('noindex, follow');
      expect(privacy.headers['content-encoding']).toBe('gzip');
      expect(privacy.body).toBe(fixtureBody('privacy.html'));
      const head = await request(port, '/dashboard.js', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.body).toBe('');
    });
  });

  it('retains stub-protected routes, disabled check-in, unknown asset and unhandled-file error behavior', async () => {
    await withFixture(false, async ({ port, publicDirectory }) => {
      expect((await request(port, '/dashboard/data')).status).toBe(401);
      expect((await request(port, '/management/self-check-in/qr', { method: 'POST' })).status).toBe(401);
      expect((await request(port, '/player/check-in/context', { method: 'POST' })).status).toBe(410);
      for (const pathname of ['/unknown.js', '/.synthetic-hidden', '/privacy/.synthetic-hidden', '/%2e%2e%2foutside-marker.txt']) {
        const response = await request(port, pathname);
        expect(response.status, pathname).toBe(404);
        expect(response.headers['content-security-policy']).toBe("default-src 'none'");
        expect(response.body).not.toContain('synthetic outside marker');
        expect(response.body).not.toContain('synthetic hidden marker');
      }
      fs.unlinkSync(path.join(publicDirectory, 'privacy.html'));
      const missing = await request(port, '/privacy');
      expect(missing.status).toBe(500);
      expect(JSON.parse(missing.body)).toMatchObject({ code: 'INTERNAL_ERROR', error: 'Request could not be completed.' });
      expectSecurityHeaders(missing);
    });
  });

  it.each([false, true])('keeps native relative-root hidden-file and traversal rejection without allowing dotfiles (dot ancestor: %s)', async (dotAncestor) => {
    await withFixture(dotAncestor, async ({ port }) => {
      for (const [filename, status] of [['privacy.html', 200], ['.synthetic-hidden', 404], ['../outside-marker.txt', 403], ['missing.html', 404]]) {
        expect((await request(port, `/__relative_path_probe?name=${encodeURIComponent(filename)}`)).status, String(filename)).toBe(status);
      }
    });
  });

  it.each([
    ['legal', assetTargets.slice(0, 8)],
    ['dashboard', assetTargets.slice(8, 11)],
    ['self-check-in', assetTargets.slice(11)]
  ])('serves fixed %s assets when only the application ancestor is a dot directory', async (_name, targets) => {
    await withFixture(true, async ({ port }) => {
      for (const [pathname, filename] of targets) {
        const response = await request(port, pathname);
        expect(response.status, pathname).toBe(200);
        expect(response.body, pathname).toBe(fixtureBody(filename));
        expectSecurityHeaders(response);
      }
    });
  });
});
