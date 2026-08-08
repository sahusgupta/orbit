function createLiveUpdates() {
  const liveClients = new Set();

  function broadcast(type, payload) {
    const body = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of liveClients) {
      client.write(body);
    }
  }

  function connect(request, response, startedAt) {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*'
    });
    response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, startedAt })}\n\n`);
    liveClients.add(response);
    request.on('close', () => {
      liveClients.delete(response);
    });
  }

  return { broadcast, connect };
}

module.exports = { createLiveUpdates };
