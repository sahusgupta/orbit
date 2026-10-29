const maximumFrameBytes = 8_192;

// The wire carries revision hints only. Never forward arbitrary server data to IPC.
function projectManagementStateEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.type === 'change' && Number.isSafeInteger(value.revision) && value.revision >= 0) {
    return { type: 'change', revision: value.revision };
  }
  if (value.type === 'status' && typeof value.connected === 'boolean') {
    return { type: 'status', connected: value.connected };
  }
  return null;
}

function createStateEventParser(onFrame) {
  let line = '';
  let event = '';
  let data = [];
  let bytes = 0;
  let skipLineFeed = false;
  function finishLine() {
    if (!line) {
      if (data.length) onFrame(event || 'message', data.join('\n'));
      event = '';
      data = [];
      bytes = 0;
    } else if (!line.startsWith(':')) {
      const colon = line.indexOf(':');
      const name = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (name === 'event') event = value;
      if (name === 'data') data.push(value);
    }
    line = '';
  }
  return {
    push(text) {
      for (const character of text) {
        if (skipLineFeed) {
          skipLineFeed = false;
          if (character === '\n') continue;
        }
        bytes += Buffer.byteLength(character, 'utf8');
        if (bytes > maximumFrameBytes) throw new Error('State event frame exceeds its limit.');
        if (character === '\r' || character === '\n') {
          finishLine();
          skipLineFeed = character === '\r';
        } else {
          line += character;
        }
      }
    }
  };
}

function createManagementStateEvents({ connect, onEvent, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout, random = Math.random }) {
  let disposed = false;
  let controller;
  let reader;
  let reconnectTimer;
  let idleTimer;
  let sessionTimer;
  let failures = 0;
  let connected;
  function emit(value) {
    if (disposed) return;
    try { onEvent(value); } catch { /* Renderer lifecycle races cannot escape the transport. */ }
  }
  function status(value) {
    if (connected === value) return;
    connected = value;
    emit({ type: 'status', connected: value });
  }
  function cancelReader() {
    try {
      if (reader) void Promise.resolve(reader.cancel()).catch(() => undefined);
    } catch { /* A concurrently closed reader has already released its stream. */ }
  }
  function abortConnection() {
    controller?.abort();
    cancelReader();
  }
  function resetIdleTimeout(milliseconds) {
    clearTimeoutImpl(idleTimer);
    idleTimer = setTimeoutImpl(abortConnection, milliseconds);
  }
  async function run() {
    if (disposed) return;
    controller = new AbortController();
    let retry = true;
    let ready = false;
    let initialized = false;
    resetIdleTimeout(10_000);
    sessionTimer = setTimeoutImpl(abortConnection, 60_000);
    try {
      const response = await connect({ signal: controller.signal });
      if (disposed || controller.signal.aborted) {
        if (response?.body) void Promise.resolve(response.body.cancel()).catch(() => undefined);
        return;
      }
      if (response?.status === 401 || response?.status === 403) retry = false;
      if (!response?.ok || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers?.get('content-type') || '') || !response.body?.getReader) {
        if (response?.body) void Promise.resolve(response.body.cancel()).catch(() => undefined);
        throw new Error('State event stream is unavailable.');
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const parser = createStateEventParser((event, text) => {
        if (!['ready', 'change', 'heartbeat'].includes(event)) return;
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid state event.');
        if (event === 'change') {
          if (!ready || !Number.isSafeInteger(payload.revision) || payload.revision < 0) throw new Error('Invalid state revision event.');
          if (!initialized) {
            initialized = true;
            failures = 0;
            status(true);
          }
          emit({ type: 'change', revision: payload.revision });
        } else {
          if (Object.keys(payload).length || (event === 'heartbeat' && !ready)) throw new Error('Invalid state stream control event.');
          if (event === 'ready') {
            if (ready) throw new Error('Duplicate state stream readiness event.');
            ready = true;
          }
        }
        // Ready/heartbeat alone do not prove the authoritative watch initialized.
        if (initialized) resetIdleTimeout(25_000);
      });
      while (!disposed && !controller.signal.aborted) {
        const chunk = await reader.read();
        if (disposed || controller.signal.aborted || chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > 65_536) throw new Error('Invalid state stream chunk.');
        parser.push(decoder.decode(chunk.value, { stream: true }));
      }
      // An unterminated frame is intentionally discarded at EOF, as SSE requires.
    } catch {
      // Auth keys, response bodies, URLs, and server errors must not reach logs or IPC.
    } finally {
      abortConnection();
      try { reader?.releaseLock(); } catch { /* Cancellation may still be settling. */ }
      reader = undefined;
      clearTimeoutImpl(idleTimer);
      clearTimeoutImpl(sessionTimer);
      status(false);
      if (!disposed && retry) {
        const baseDelay = Math.min(30_000, 1_000 * (2 ** Math.min(failures, 5)));
        const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
        failures += 1;
        reconnectTimer = setTimeoutImpl(() => void run(), Math.min(30_000, Math.round(baseDelay * (0.75 + jitter * 0.5))));
      }
    }
  }
  status(false);
  void run();
  return () => {
    if (disposed) return;
    disposed = true;
    clearTimeoutImpl(reconnectTimer);
    clearTimeoutImpl(idleTimer);
    clearTimeoutImpl(sessionTimer);
    abortConnection();
  };
}

function createManagementStateSubscriptions({ subscribe }) {
  const subscriptions = new Map();
  function remove(sender) {
    const current = subscriptions.get(sender);
    if (!current) return;
    subscriptions.delete(sender);
    current.stop?.();
    for (const [name, listener] of current.listeners) sender.removeListener(name, listener);
  }
  return {
    subscribe(sender, subscriptionId, access) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(subscriptionId) || typeof subscriptionId !== 'string') throw new Error('Invalid state subscription ID.');
      remove(sender);
      if (sender.isDestroyed()) return;
      const current = { subscriptionId, stop: undefined, listeners: [] };
      const close = () => remove(sender);
      const navigate = (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) close(); };
      current.listeners = [['destroyed', close], ['render-process-gone', close], ['did-start-navigation', navigate]];
      subscriptions.set(sender, current);
      for (const [name, listener] of current.listeners) sender.on(name, listener);
      try {
        current.stop = subscribe(access, (event) => {
          if (subscriptions.get(sender) !== current || sender.isDestroyed()) return;
          const projected = projectManagementStateEvent(event);
          if (projected) sender.send('management-state-event', subscriptionId, projected);
        });
      } catch {
        remove(sender);
        throw new Error('Management state notifications could not start.');
      }
      // A lifecycle callback may dispose synchronously during subscription setup.
      if (subscriptions.get(sender) !== current) current.stop?.();
    },
    unsubscribe(sender, subscriptionId) {
      if (subscriptions.get(sender)?.subscriptionId === subscriptionId) remove(sender);
    },
    stop() {
      for (const sender of subscriptions.keys()) remove(sender);
    }
  };
}

module.exports = { createManagementStateEvents, createManagementStateSubscriptions, createStateEventParser };
