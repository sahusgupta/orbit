import type { PlayerRecordDocument, PlayerSyncGame } from '../playerSync';

type UnknownRecord = Record<string, unknown>;

const activeSessionFreshnessWindowMs = 36 * 60 * 60 * 1000;

function requireRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Published game records must be objects.');
  }
  return value as UnknownRecord;
}

function numeric(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizePublishedGame(raw: UnknownRecord, documentId: string): PlayerSyncGame {
  const openTables = Array.isArray(raw.openTables)
    ? raw.openTables as PlayerSyncGame['openTables']
    : [];
  return {
    ...raw,
    id: String(raw.id || documentId),
    name: String(raw.name || '').trim(),
    maxSeats: numeric(raw.maxSeats, 10),
    collectionMode: raw.collectionMode === 'Time' || raw.collectionMode === 'Drop'
      ? raw.collectionMode
      : openTables[0]?.collectionMode === 'Time'
        ? 'Time'
        : 'Drop',
    openTables,
    waitlistCount: numeric(raw.waitlistCount),
    formingCount: numeric(raw.formingCount),
    availableSeats: numeric(raw.availableSeats, openTables.reduce((sum, table) => sum + numeric(table?.availableSeats), 0)),
    knownPlayersCount: numeric(raw.knownPlayersCount)
  };
}

export function normalizePublishedGames(gameDocs: readonly PlayerRecordDocument[]): PlayerSyncGame[] {
  const records = gameDocs.map((gameDoc) => ({ documentId: gameDoc.id, raw: requireRecord(gameDoc.data()) }));
  const aggregateRecords = records.filter(({ raw }) => typeof raw.name === 'string' && raw.name.trim());

  // Protocol-v2 aggregate records are committed atomically. Legacy clubs used
  // this collection for both aggregate games and individual table sessions.
  if (aggregateRecords.some(({ raw }) => raw.syncRevision)) {
    return aggregateRecords.map(({ raw, documentId }) => normalizePublishedGame(raw, documentId));
  }

  const games = new Map<string, PlayerSyncGame>();
  aggregateRecords.forEach(({ raw, documentId }) => {
    const game = normalizePublishedGame(raw, documentId);
    games.set(game.id, {
      ...game,
      openTables: [],
      formingCount: 0,
      availableSeats: 0,
      knownPlayersCount: 0,
      waitlistCount: 0
    });
  });

  records
    .filter(({ raw }) =>
      typeof raw.gameId === 'string' &&
      typeof raw.gameName === 'string' &&
      (raw.status === 'Running' || raw.status === 'Forming' || raw.status === 'Paused') &&
      isFreshActiveSession(raw)
    )
    .sort((left, right) => getSessionActivityTime(right.raw) - getSessionActivityTime(left.raw))
    .forEach(({ raw, documentId }) => {
      const gameId = String(raw.gameId).trim();
      const gameName = String(raw.gameName).trim();
      if (!gameId || !gameName) return;
      if (raw.status !== 'Running' && raw.status !== 'Forming' && raw.status !== 'Paused') return;
      const players = Array.isArray(raw.players) ? raw.players : [];
      const activePlayers = players.filter((player) => !player || typeof player !== 'object' || !(player as UnknownRecord).leftAt);
      const maxSeats = numeric(raw.maxSeats, 10);
      const seatsFilled = Math.min(maxSeats, activePlayers.length || numeric(raw.seatsFilled));
      const sessionWaitlist = Array.isArray(raw.waitlist) ? raw.waitlist : [];
      const table: PlayerSyncGame['openTables'][number] = {
        id: String(raw.id || documentId),
        gameId,
        label: String(raw.label || 'Active table'),
        status: raw.status,
        seatsFilled,
        maxSeats,
        availableSeats: Math.max(0, maxSeats - seatsFilled),
        collectionMode: raw.format === 'Time' ? 'Time' : 'Drop',
        tags: Array.isArray(raw.tags) ? raw.tags as string[] : [],
        startedAt: String(raw.timeStarted || raw.startedAt || raw.updatedAt || new Date().toISOString()),
        social: {
          seatedPlayerCount: seatsFilled,
          adminCount: 0,
          knownPlayersCount: activePlayers.length
        }
      };
      const existing = games.get(gameId);
      const openTables = [...(existing?.openTables ?? []), table];
      games.set(gameId, {
        id: gameId,
        name: gameName,
        maxSeats,
        collectionMode: table.collectionMode,
        openTables,
        waitlistCount: (existing?.waitlistCount ?? 0) + sessionWaitlist.length,
        formingCount: openTables.filter((openTable) => openTable.status === 'Forming').length,
        availableSeats: openTables.reduce((sum, openTable) => sum + openTable.availableSeats, 0),
        knownPlayersCount: openTables.reduce((sum, openTable) => sum + openTable.social.knownPlayersCount, 0),
        updatedAt: String(raw.updatedAt || raw.timeStarted || '')
      });
    });

  return Array.from(games.values());
}

function getSessionActivityTime(raw: UnknownRecord) {
  const timestamp = Date.parse(String(raw.updatedAt || raw.timeStarted || raw.startedAt || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isFreshActiveSession(raw: UnknownRecord) {
  const activityTime = getSessionActivityTime(raw);
  return activityTime > 0 && Date.now() - activityTime <= activeSessionFreshnessWindowMs;
}
