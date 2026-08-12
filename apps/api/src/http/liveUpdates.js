function createLiveUpdates() {
  const liveClients = new Set();
  const replayBuffer = [];
  let sequence = 0;
  const maximumConnections = Math.min(Math.max(Number(process.env.ORBIT_SSE_MAX_CONNECTIONS || 50), 1), 500);
  const maximumReplayEvents = Math.min(Math.max(Number(process.env.ORBIT_SSE_REPLAY_EVENTS || 250), 10), 1000);

  function serialize(event) {
    return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  }

  function broadcast(type, payload) {
    const event = { id: ++sequence, type, payload };
    replayBuffer.push(event);
    if (replayBuffer.length > maximumReplayEvents) replayBuffer.splice(0, replayBuffer.length - maximumReplayEvents);
    const body = serialize(event);
    for (const client of liveClients) client.write(body);
    return event.id;
  }

  function connect(request, response, startedAt) {
    if (liveClients.size >= maximumConnections) {
      response.set('retry-after', '15');
      response.status(503).json({ ok: false, error: 'Live update capacity reached.' });
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    let heartbeat;
    let sessionExpiry;
    let closed = false;
    let client;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (sessionExpiry) clearTimeout(sessionExpiry);
      if (client) liveClients.delete(client);
    };
    const write = (body) => {
      if (closed) return false;
      if (response.write(body)) return true;
      cleanup();
      response.end();
      return false;
    };
    client = { write };
    write('retry: 3000\n');
    write(`event: ready\ndata: ${JSON.stringify({ ok: true, startedAt })}\n\n`);
    const lastEventId = Number(request.get('last-event-id') || 0);
    if (Number.isSafeInteger(lastEventId) && lastEventId > 0) {
      const oldestAvailableId = replayBuffer[0]?.id ?? sequence + 1;
      if (lastEventId < oldestAvailableId - 1 || lastEventId > sequence) {
        write('event: replay-reset\ndata: {"reload":true}\n\n');
      } else {
        replayBuffer.filter((event) => event.id > lastEventId).forEach((event) => write(serialize(event)));
      }
    }
    liveClients.add(client);
    heartbeat = setInterval(() => write(': heartbeat\n\n'), 20_000);
    sessionExpiry = setTimeout(() => {
      write('event: session-expiring\ndata: {"reconnect":true}\n\n');
      cleanup();
      response.end();
    }, 15 * 60_000);
    heartbeat.unref?.();
    sessionExpiry.unref?.();
    request.once('close', cleanup);
    request.once('error', cleanup);
  }

  return {
    broadcast,
    connect,
    getConnectionCount: () => liveClients.size,
    getReplayWindow: () => replayBuffer.map((event) => event.id)
  };
}

module.exports = { createLiveUpdates };
