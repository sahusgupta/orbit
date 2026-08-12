const http = require('http');
const { sanitizeAccountKey } = require('./runtimeUtils.cjs');

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function createEmbeddedBackend(dependencies) {
  const {
    buildPlayerClubSnapshot,
    getAccountKeyFromState,
    getReportCount,
    loadStateWithFirebaseFallback,
    storeAnalyticalReport
  } = dependencies;
  const environment = dependencies.environment || process.env;
  const httpServer = dependencies.http || http;

  let server;
  let status = { running: false, host: '127.0.0.1', port: 0, reportCount: 0 };

  function getStatus() {
    return status;
  }

  function updateReportCount(reportCount) {
    status = { ...status, reportCount };
    return status;
  }

  function start() {
    if (server) return;

    server = httpServer.createServer(async (request, response) => {
      try {
        const remoteAddress = request.socket.remoteAddress;
        const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
        const allowLanPlayerSync = environment.TABLEMANAGER_PLAYER_SYNC_ALLOW_LAN === 'true';
        if (!isLoopback && !allowLanPlayerSync) {
          sendJson(response, 403, { ok: false, error: 'Embedded backend only accepts loopback requests.' });
          return;
        }

        if (request.method === 'OPTIONS') {
          sendJson(response, 204, {});
          return;
        }

        const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

        if (request.method === 'GET' && requestUrl.pathname === '/health') {
          sendJson(response, 200, { ok: true, ...status, reportCount: getReportCount() });
          return;
        }

        if (request.method === 'GET' && requestUrl.pathname === '/player/snapshot') {
          const accountKey = sanitizeAccountKey(requestUrl.searchParams.get('accountKey') || '');
          const record = await loadStateWithFirebaseFallback(accountKey);
          if (!record?.state) {
            sendJson(response, 404, { ok: false, error: 'No Orbit club database is available yet.' });
            return;
          }
          const player = {
            id: requestUrl.searchParams.get('playerId') || '',
            name: requestUrl.searchParams.get('playerName') || ''
          };
          sendJson(response, 200, {
            ok: true,
            accountKey: getAccountKeyFromState(record.state),
            savedAt: record.savedAt,
            snapshot: buildPlayerClubSnapshot(record.state, player),
            source: 'offline-cache',
            authoritative: false
          });
          return;
        }

        if (request.method === 'POST' && requestUrl.pathname === '/player/membership-requests') {
          sendJson(response, 503, { ok: false, error: 'Player mutations require the authoritative Orbit API.' });
          return;
        }

        if (request.method === 'POST' && requestUrl.pathname === '/player/waitlist-requests') {
          sendJson(response, 503, { ok: false, error: 'Player mutations require the authoritative Orbit API.' });
          return;
        }

        if (request.method === 'POST' && requestUrl.pathname === '/analytical-reports') {
          const body = await readRequestBody(request);
          const result = await storeAnalyticalReport(JSON.parse(body));
          sendJson(response, 201, result);
          return;
        }

        sendJson(response, 404, { ok: false, error: 'Not found.' });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Request failed.' });
      }
    });

    const configuredPort = Number(environment.TABLEMANAGER_SYNC_PORT || environment.TABLEMANAGER_BACKEND_PORT || 4629);
    const configuredHost = environment.TABLEMANAGER_SYNC_HOST || '127.0.0.1';
    const activeServer = server;

    activeServer.listen(configuredPort, configuredHost, () => {
      const address = activeServer.address();
      status = {
        running: true,
        host: configuredHost,
        port: typeof address === 'object' && address ? address.port : 0,
        reportCount: getReportCount()
      };
    });

    activeServer.on('close', () => {
      status = { ...status, running: false, port: 0 };
    });
  }

  function stop() {
    if (!server) return;
    server.close();
    server = undefined;
  }

  return { getStatus, start, stop, updateReportCount };
}

module.exports = { createEmbeddedBackend, readRequestBody, sendJson };
