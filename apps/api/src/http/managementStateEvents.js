const { getAdminApp, getAdminSdk } = require('../services/firebaseAdmin');
const { getDatabaseStatus } = require('../db/connection');
const { accountPath } = require('../db/state');

/** @typedef {{ revision?: unknown }} StateHeader */
/** @typedef {(accountKey: string, changed: (header: StateHeader | null) => void, failed: () => void) => () => void} WatchStateHeader */

/**
 * Each connection watches the authoritative header, so writes in another API
 * instance are visible without an in-process event broker or a state payload.
 * @param {{ watchStateHeader?: WatchStateHeader, getDatabaseStatus?: typeof getDatabaseStatus, getAdminApp?: typeof getAdminApp, getAdminSdk?: typeof getAdminSdk, maximumConnections?: number }} [dependencies]
 */
function createManagementStateEvents(dependencies = {}) {
  const clients = new Set();
  const configuredMaximum = Number(dependencies.maximumConnections ?? process.env.ORBIT_MANAGEMENT_SSE_MAX_CONNECTIONS ?? 50);
  const maximumConnections = Number.isFinite(configuredMaximum)
    ? Math.min(Math.max(Math.floor(configuredMaximum), 1), 500)
    : 50;
  const databaseStatus = dependencies.getDatabaseStatus || getDatabaseStatus;
  const adminApp = dependencies.getAdminApp || getAdminApp;
  const adminSdk = dependencies.getAdminSdk || getAdminSdk;
  /** @type {WatchStateHeader} */
  const watchStateHeader = dependencies.watchStateHeader || ((accountKey, changed, failed) =>
    adminSdk().firestore(adminApp({ allowCredentialsFile: true })).doc(accountPath(accountKey))
      .onSnapshot((snapshot) => changed(snapshot.exists ? snapshot.data() : null), failed));

  /**
   * Authentication and tenant checks run before entry and again before every
   * change notification. A denied recheck closes quietly after headers start.
   * @param {Pick<import('node:events').EventEmitter, 'once' | 'off'>} request
   * @param {import('express').Response} response
   * @param {{ accountKey: string, revalidate: () => Promise<boolean>, getExpiresAt: () => number | undefined }} options
   */
  function connect(request, response, options) {
    if (!dependencies.watchStateHeader && databaseStatus().mode === 'memory-test') {
      response.status(503).json({ ok: false, code: 'MANAGEMENT_STATE_EVENTS_UNAVAILABLE' });
      return;
    }
    if (clients.size >= maximumConnections) {
      response.set('retry-after', '3');
      response.status(503).json({ ok: false, code: 'MANAGEMENT_STATE_EVENTS_CAPACITY' });
      return;
    }
    const initialExpiry = options.getExpiresAt();
    if (initialExpiry !== undefined && initialExpiry <= Date.now()) {
      response.status(403).json({ ok: false, code: 'MANAGEMENT_STATE_EVENTS_EXPIRED' });
      return;
    }

    let closed = false;
    let notifying = false;
    /** @type {number | undefined} */
    let pendingRevision;
    /** @type {number | undefined} */
    let lastSentRevision;
    /** @type {(() => void) | undefined} */
    let unsubscribe;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let heartbeat;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let sessionExpiry;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let credentialExpiry;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (sessionExpiry) clearTimeout(sessionExpiry);
      if (credentialExpiry) clearTimeout(credentialExpiry);
      request.off('aborted', close);
      request.off('error', close);
      response.off('close', cleanup);
      response.off('error', close);
      clients.delete(close);
      if (unsubscribe) {
        const release = unsubscribe;
        unsubscribe = undefined;
        try { release(); } catch { /* The connection is already retired. */ }
      }
    };
    const close = () => {
      if (closed) return;
      cleanup();
      try { if (!response.writableEnded) response.end(); }
      catch { /* A disconnected transport is already retired. */ }
    };
    const write = (type, payload) => {
      if (closed) return false;
      try {
        if (response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)) return true;
      } catch { /* Failed writes retire the watch without exposing an error. */ }
      close();
      return false;
    };
    const refreshCredentialExpiry = () => {
      if (credentialExpiry) clearTimeout(credentialExpiry);
      const expiresAt = options.getExpiresAt();
      if (expiresAt === undefined) return true;
      const remaining = expiresAt - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        close();
        return false;
      }
      credentialExpiry = setTimeout(close, Math.min(remaining, 45_000));
      credentialExpiry.unref?.();
      return true;
    };
    const notify = async () => {
      if (notifying || closed) return;
      notifying = true;
      try {
        while (!closed && pendingRevision !== undefined) {
          const revision = pendingRevision;
          pendingRevision = undefined;
          if (revision === lastSentRevision) continue;
          if (!await options.revalidate()) {
            close();
            return;
          }
          if (closed || !refreshCredentialExpiry()) return;
          if (!write('change', { revision })) return;
          lastSentRevision = revision;
        }
      } catch { close(); }
      finally { notifying = false; }
    };
    const changed = (header) => {
      if (closed) return;
      const revision = header === null ? 0 : header.revision;
      if (!Number.isSafeInteger(revision) || revision < 0) {
        close();
        return;
      }
      pendingRevision = revision;
      void notify();
    };

    clients.add(close);
    request.once('aborted', close);
    request.once('error', close);
    response.once('close', cleanup);
    response.once('error', close);
    try {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'private, no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
    } catch { close(); return; }
    if (!write('ready', {}) || !refreshCredentialExpiry()) return;
    heartbeat = setInterval(() => write('heartbeat', {}), 15_000);
    sessionExpiry = setTimeout(close, 45_000);
    heartbeat.unref?.();
    sessionExpiry.unref?.();
    try {
      const release = watchStateHeader(options.accountKey, changed, close);
      if (closed) release();
      else unsubscribe = release;
    } catch { close(); }
  }

  return { connect, getConnectionCount: () => clients.size };
}

module.exports = { createManagementStateEvents };
