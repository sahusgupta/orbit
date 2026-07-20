export type NightCloseTable = {
  tableId: string;
  tableLabel: string;
  gameName: string;
  buyIns: number;
  cashOuts: number;
  drop: number;
  timeFees: number;
  expectedCash: number;
  actualCash?: number;
  discrepancy?: number;
  warnings: string[];
};

type NightCloseSource = {
  games: Array<{ id: string; name: string }>;
  sessions: Array<{ id: string; gameId: string; label: string; status: string; collectionMode?: 'Time' | 'Drop'; timeFeeBased?: boolean; startedAt: string }>;
  playerSessions: Array<{ playerName: string; profileId?: string; tableId: string; seatedAt: string; timePurchasedMinutes?: number }>;
  buyIns: Array<{ tableId: string; amount: number; timestamp: string }>;
  dropLogs: Array<{ tableId: string; amount: number; timestamp: string }>;
  playerLedger: Array<{ tableId?: string; type: string; profileId?: string; playerName: string; amount?: number; timestamp: string }>;
  nightCloses: Array<{ status: string; lockedAt?: string }>;
  settings: {
    defaultHourlyFee: number;
    collectionProfiles: Array<{ gameId: string; hourlyFee: number }>;
  };
};

export function buildNightCloseTables(state: NightCloseSource, actuals: Record<string, string | number | undefined>): NightCloseTable[] {
  const lastLockedAt = state.nightCloses
    .filter((close) => close.status === 'Locked' && close.lockedAt)
    .sort((left, right) => (right.lockedAt ?? '').localeCompare(left.lockedAt ?? ''))[0]?.lockedAt;
  const isCurrentShift = (timestamp?: string) => Boolean(timestamp && (!lastLockedAt || timestamp > lastLockedAt));
  const currentSessions = state.sessions.filter((session) => session.status !== 'Closed' || isCurrentShift(session.startedAt));

  return currentSessions.map((session) => {
    const playerSessions = state.playerSessions.filter((item) => item.tableId === session.id && isCurrentShift(item.seatedAt));
    const buyIns = state.buyIns.filter((entry) => entry.tableId === session.id && isCurrentShift(entry.timestamp)).reduce((sum, entry) => sum + entry.amount, 0);
    const cashOutEntries = state.playerLedger.filter((entry) => entry.tableId === session.id && entry.type === 'Cash-Out' && isCurrentShift(entry.timestamp));
    const cashOuts = cashOutEntries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    const drop = state.dropLogs.filter((entry) => entry.tableId === session.id && isCurrentShift(entry.timestamp)).reduce((sum, entry) => sum + entry.amount, 0);
    const hourlyFee = state.settings.collectionProfiles.find((profile) => profile.gameId === session.gameId)?.hourlyFee ?? state.settings.defaultHourlyFee;
    const timeFees = session.collectionMode === 'Time' || session.timeFeeBased
      ? playerSessions.reduce((sum, player) => sum + ((player.timePurchasedMinutes ?? 0) / 60) * hourlyFee, 0)
      : 0;
    const expectedCash = buyIns - cashOuts - drop - timeFees;
    const rawActual = actuals[session.id];
    const actualCash = rawActual === '' || rawActual === undefined ? undefined : Number(rawActual);
    const warnings: string[] = [];
    if (session.status !== 'Closed') warnings.push('Table is still open');
    const playersWithoutCashOut = playerSessions.filter((player) => !cashOutEntries.some((entry) =>
      player.profileId ? entry.profileId === player.profileId : entry.playerName.toLowerCase() === player.playerName.toLowerCase()
    ));
    if (playersWithoutCashOut.length) warnings.push(`${playersWithoutCashOut.length} player${playersWithoutCashOut.length === 1 ? '' : 's'} missing cash-out`);
    const missingTime = session.collectionMode === 'Time' || session.timeFeeBased
      ? playerSessions.filter((player) => (player.timePurchasedMinutes ?? 0) <= 0).length
      : 0;
    if (missingTime) warnings.push(`${missingTime} player${missingTime === 1 ? '' : 's'} missing time collection`);
    if (expectedCash < 0) warnings.push('Expected cash is negative');
    if (actualCash === undefined || !Number.isFinite(actualCash)) warnings.push('Actual cash count required');

    return {
      tableId: session.id,
      tableLabel: session.label,
      gameName: state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown game',
      buyIns, cashOuts, drop, timeFees, expectedCash,
      actualCash: Number.isFinite(actualCash) ? actualCash : undefined,
      discrepancy: Number.isFinite(actualCash) ? (actualCash as number) - expectedCash : undefined,
      warnings
    };
  });
}
