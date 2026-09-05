import { createServer } from 'node:http';
import { discovery } from '../fixtures.ts';

const port = Number(process.env.ORBIT_QA_API_PORT || 4629);
const authenticatedDiscovery = structuredClone(discovery);
const publicDiscovery = {
  ...structuredClone(discovery),
  clubs: discovery.clubs.map((club) => ({
    ...structuredClone(club),
    memberships: [],
    waitlists: [],
    notifications: []
  })),
  interests: []
};

function send(response, status, payload) {
  response.writeHead(status, {
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-origin': 'http://127.0.0.1:4175',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (request.method === 'OPTIONS') {
    send(response, 204, {});
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    send(response, 200, { ok: true, fixture: 'player-web-browser-qa' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/player/public/discovery') {
    send(response, 200, { ok: true, ...publicDiscovery });
    return;
  }
  if (request.method === 'GET' && url.pathname.startsWith('/player/public/clubs/')) {
    const clubId = decodeURIComponent(url.pathname.split('/').at(-1) || '');
    const club = publicDiscovery.clubs.find((candidate) => candidate.club.id === clubId);
    if (!club) {
      send(response, 404, { ok: false, error: 'Club not found.' });
      return;
    }
    send(response, 200, {
      ok: true,
      club,
      tournaments: publicDiscovery.tournaments.filter((tournament) => tournament.clubId === clubId)
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/player/discovery') {
    if (request.headers.authorization !== 'Bearer browser-qa-token') {
      send(response, 401, { ok: false, error: 'Fixture player sign-in is required.' });
      return;
    }
    send(response, 200, { ok: true, ...authenticatedDiscovery });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/player/identity/status') {
    send(response, 200, { ok: true, identity: { status: 'verified', level: 21, verifiedAt: '2030-06-01T12:00:00.000Z' } });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/player/identity/session') {
    send(response, 200, { ok: true, identity: { status: 'verified', level: 21 }, alreadyVerified: true, verificationUrl: null });
    return;
  }
  if (request.method === 'POST' && ['/player/membership-requests', '/player/waitlist-requests'].includes(url.pathname)) {
    const body = await readBody(request);
    const club = authenticatedDiscovery.clubs.find((candidate) => candidate.club.id === body.clubId);
    if (!club) {
      send(response, 404, { ok: false, error: 'Club not found.' });
      return;
    }
    send(response, 201, { ok: true, accountKey: club.club.id, snapshot: club });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/player/tournament-interests') {
    const body = await readBody(request);
    const tournament = authenticatedDiscovery.tournaments.find((candidate) => candidate.id === body.tournamentId);
    if (!tournament) {
      send(response, 404, { ok: false, error: 'Tournament not found.' });
      return;
    }
    send(response, 201, {
      ok: true,
      interest: {
        id: `${tournament.id}:player-1`,
        tournamentId: tournament.id,
        clubId: tournament.clubId,
        playerId: 'player-1',
        status: 'interested',
        createdAt: '2030-06-01T12:00:00.000Z',
        updatedAt: '2030-06-01T12:00:00.000Z'
      }
    });
    return;
  }
  if (request.method === 'DELETE' && url.pathname === '/player/tournament-interests') {
    send(response, 200, { ok: true });
    return;
  }
  send(response, 404, { ok: false, error: 'Fixture route not found.' });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Orbit Player Web QA API listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
