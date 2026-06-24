export type TimerStatus = 'green' | 'yellow' | 'red';

export type BackupEnvelope<TState = unknown> = {
  app: 'TableManager';
  kind: 'full-state-backup';
  version: 1;
  exportedAt: string;
  state: TState;
};

export function getTimerStatusFromSeconds(seconds: number): TimerStatus {
  if (seconds < 5 * 60) return 'red';
  if (seconds < 20 * 60) return 'yellow';
  return 'green';
}

export function getTimerStatusFromMinutes(minutes: number): TimerStatus {
  return getTimerStatusFromSeconds(minutes * 60);
}

export function canonicalPayload(payload: Record<string, unknown>) {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .reduce<Record<string, unknown>>((record, key) => {
        record[key] = payload[key];
        return record;
      }, {})
  );
}

export function createBackupEnvelope<TState>(state: TState, exportedAt = new Date().toISOString()): BackupEnvelope<TState> {
  return {
    app: 'TableManager',
    kind: 'full-state-backup',
    version: 1,
    exportedAt,
    state
  };
}

export function readBackupEnvelope<TState = unknown>(input: unknown): BackupEnvelope<TState> {
  const record = input as Partial<BackupEnvelope<TState>>;
  if (!record || typeof record !== 'object') {
    throw new Error('Backup file is not valid JSON.');
  }

  if (record.app === 'TableManager' && record.kind === 'full-state-backup' && record.state) {
    return record as BackupEnvelope<TState>;
  }

  if ('games' in record && 'sessions' in record && 'settings' in record) {
    return createBackupEnvelope(record as TState);
  }

  throw new Error('Backup file does not look like an Orbit backup.');
}

type GameLookupItem = {
  id: string;
  name: string;
};

const gameAliasMap: Record<string, string> = {
  'no limit holdem': 'nlh',
  'no limit hold em': 'nlh',
  'no limit hold': 'nlh',
  holdem: 'nlh',
  "hold'em": 'nlh',
  plo: 'pot limit omaha',
  omaha: 'pot limit omaha'
};

export function normalizeGameLookupValue(value: string) {
  const lower = value.toLowerCase().replace(/&/g, ' and ');
  const expanded = Object.entries(gameAliasMap).reduce(
    (next, [from, to]) => next.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), to),
    lower
  );
  return expanded
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const gameLookupTokens = (value: string) => normalizeGameLookupValue(value).split(' ').filter(Boolean);

export function resolveGameId<TGame extends GameLookupItem>(games: TGame[], value?: string, fallbackId = '') {
  const rawValue = value?.trim();
  if (!rawValue) return fallbackId;

  const normalizedValue = normalizeGameLookupValue(rawValue);
  const exactMatch = games.find(
    (game) =>
      game.id === rawValue ||
      normalizeGameLookupValue(game.id) === normalizedValue ||
      normalizeGameLookupValue(game.name) === normalizedValue
  );
  if (exactMatch) return exactMatch.id;

  const valueTokens = gameLookupTokens(rawValue);
  const tokenMatch = games.find((game) => {
    const gameTokens = new Set([...gameLookupTokens(game.id), ...gameLookupTokens(game.name)]);
    return valueTokens.length > 0 && valueTokens.every((token) => gameTokens.has(token));
  });
  if (tokenMatch) return tokenMatch.id;

  const partialMatch = games.find((game) => {
    const normalizedId = normalizeGameLookupValue(game.id);
    const normalizedName = normalizeGameLookupValue(game.name);
    return normalizedName.includes(normalizedValue) || normalizedValue.includes(normalizedName) || normalizedId.includes(normalizedValue);
  });
  return partialMatch?.id ?? fallbackId;
}

export function countActivePlayersForTable<TPlayer extends { tableId: string; leftAt?: string }>(
  players: TPlayer[],
  tableId: string
) {
  return players.filter((player) => player.tableId === tableId && !player.leftAt).length;
}
