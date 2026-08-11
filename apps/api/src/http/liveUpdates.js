function createLiveUpdates() {
  const liveClients = new Set();
  const maximumConnections = Math.min(Math.max(Number(process.env.ORBIT_SSE_MAX_CONNECTIONS || 50), 1), 500);

  function broadcast(type, payload) {
    const body = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of liveClients) {
      client.write(body);
    }
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
    response.write('retry: 3000\n');
    response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, startedAt })}\n\n`);
    liveClients.add(response);
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
    heartbeat.unref?.();
    request.on('close', () => {
      clearInterval(heartbeat);
      liveClients.delete(response);
    });
  }

  return { broadcast, connect, getConnectionCount: () => liveClients.size };
}

module.exports = { createLiveUpdates };
