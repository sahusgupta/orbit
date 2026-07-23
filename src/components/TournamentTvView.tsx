type TournamentTvLevel = {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
};

type TournamentTvPlayer = {
  status: string;
  rebuys: number;
  addOns: number;
  startingStack: number;
  currentStack?: number;
  tableNumber?: number;
};

type TournamentTvTournament = {
  id: string;
  name: string;
  status: 'Draft' | 'Running' | 'Paused' | 'Finished';
  startedAt?: string;
  pausedAt?: string;
  currentLevelIndex: number;
  buyIn: number;
  startingStack: number;
  rebuyPrizePercent: number;
  rebuyPrice?: number;
  addOnPrice?: number;
  lateRegistrationThroughLevel?: number;
  registrationClosesAt?: string;
  tableSize: number;
  levels: TournamentTvLevel[];
  players: TournamentTvPlayer[];
  payouts: Array<{ place: number; percent: number }>;
};

type TournamentTvViewProps = {
  tournament: TournamentTvTournament;
  nowMs: number;
  remainingSeconds: number;
  prizePool: number;
};

const formatClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
};

const formatRunningTime = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
};

const formatBlinds = (level?: TournamentTvLevel) => {
  if (!level) return '—';
  return `${level.smallBlind.toLocaleString()} / ${level.bigBlind.toLocaleString()}${level.ante ? ` (${level.ante.toLocaleString()})` : ''}`;
};

const formatPlace = (place: number) => {
  const modulo100 = place % 100;
  if (modulo100 >= 11 && modulo100 <= 13) return `${place}th`;
  if (place % 10 === 1) return `${place}st`;
  if (place % 10 === 2) return `${place}nd`;
  if (place % 10 === 3) return `${place}rd`;
  return `${place}th`;
};

const getLateRegistrationSeconds = (tournament: TournamentTvTournament, nowMs: number, remainingSeconds: number) => {
  if (tournament.registrationClosesAt) {
    return Math.max(0, Math.floor((new Date(tournament.registrationClosesAt).getTime() - nowMs) / 1000));
  }
  const lastRegistrationLevel = tournament.lateRegistrationThroughLevel;
  if (!lastRegistrationLevel || tournament.currentLevelIndex + 1 > lastRegistrationLevel) return 0;
  return tournament.levels
    .slice(tournament.currentLevelIndex + 1, lastRegistrationLevel)
    .reduce((seconds, level) => seconds + level.durationMinutes * 60, remainingSeconds);
};

export default function TournamentTvView({ tournament, nowMs, remainingSeconds, prizePool }: TournamentTvViewProps) {
  const currentLevel = tournament.levels[tournament.currentLevelIndex];
  const nextLevel = tournament.levels[tournament.currentLevelIndex + 1];
  const activePlayers = tournament.players.filter((player) => !['Eliminated', 'Finished'].includes(player.status));
  const totalEntries = tournament.players.length;
  const totalChips = activePlayers.reduce(
    (sum, player) => sum + (player.currentStack ?? (1 + player.rebuys + player.addOns) * player.startingStack),
    0
  );
  const averageStack = activePlayers.length ? Math.round(totalChips / activePlayers.length) : 0;
  const assignedTables = new Set(activePlayers.map((player) => player.tableNumber).filter(Boolean)).size;
  const tableCount = assignedTables || (activePlayers.length ? Math.ceil(activePlayers.length / Math.max(2, tournament.tableSize)) : 0);
  const paidPlaces = Math.max(0, ...tournament.payouts.map((payout) => payout.place));
  const elapsedUntil = tournament.status === 'Paused' && tournament.pausedAt
    ? new Date(tournament.pausedAt).getTime()
    : nowMs;
  const runningSeconds = tournament.startedAt
    ? Math.max(0, Math.floor((elapsedUntil - new Date(tournament.startedAt).getTime()) / 1000))
    : 0;
  const durationSeconds = Math.max(1, (currentLevel?.durationMinutes ?? 20) * 60);
  const elapsedPercent = Math.min(100, Math.max(0, ((durationSeconds - remainingSeconds) / durationSeconds) * 100));
  const ringCircumference = 2 * Math.PI * 128;
  const lateRegistrationSeconds = getLateRegistrationSeconds(tournament, nowMs, remainingSeconds);
  const lateRegistrationOpen = tournament.status !== 'Finished' && lateRegistrationSeconds > 0;
  const lowTime = remainingSeconds <= 60 && tournament.status === 'Running';
  const clockLabel = tournament.status === 'Paused' ? 'PAUSED' : tournament.status === 'Finished' ? 'FINAL' : `LEVEL ${currentLevel?.level ?? '—'}`;

  const statistics = [
    { label: 'Total entries', value: totalEntries.toLocaleString() },
    { label: 'Remaining', value: `${activePlayers.length.toLocaleString()} / ${totalEntries.toLocaleString()}` },
    { label: 'In the money', value: paidPlaces.toLocaleString(), highlight: true },
    { label: 'Number of tables', value: tableCount.toLocaleString() },
    { label: 'Average stack', value: averageStack.toLocaleString() },
    { label: 'Total chips', value: totalChips.toLocaleString() }
  ];

  return (
    <main className="orbit-tournament-display">
      <header className="orbit-tournament-display-header">
        <div className="orbit-tournament-display-brand">
          <img src="./orbit-table-logo.svg" alt="" />
          <span>Orbit Tournament</span>
        </div>
        <h1>{tournament.name}</h1>
        <span className={`orbit-tournament-display-status status-${tournament.status.toLowerCase()}`}>{tournament.status}</span>
      </header>

      <section className="orbit-tournament-display-layout">
        <aside className="orbit-tournament-display-prizes">
          <article className="orbit-tv-prize-pool">
            <span>Prize pool</span>
            <strong>${prizePool.toLocaleString()}</strong>
            <small>{totalEntries} registered player{totalEntries === 1 ? '' : 's'}</small>
          </article>

          <div className="orbit-tv-payout-list">
            <div className="orbit-tv-section-label">Prize distribution</div>
            {tournament.payouts.length ? tournament.payouts.map((payout, index) => (
              <article className={index === 0 ? 'featured' : ''} key={payout.place}>
                <span>{formatPlace(payout.place)}</span>
                <strong>${Math.round(prizePool * payout.percent / 100).toLocaleString()}</strong>
                <small>{payout.percent}%</small>
              </article>
            )) : <p>No payouts posted</p>}
          </div>
        </aside>

        <section className="orbit-tournament-display-clock">
          <header>
            <span>{clockLabel}</span>
            <strong>Blinds: <em>{formatBlinds(currentLevel)}</em></strong>
          </header>

          <div className="orbit-tv-clock-stage" aria-live="polite">
            <div className={`orbit-tv-clock-ring ${lowTime ? 'low-time' : ''} ${tournament.status === 'Paused' ? 'paused' : ''}`}>
              <svg viewBox="0 0 280 280" aria-hidden="true">
                <circle className="orbit-tv-clock-track" cx="140" cy="140" r="128" />
                <circle
                  className="orbit-tv-clock-progress"
                  cx="140"
                  cy="140"
                  r="128"
                  pathLength="100"
                  strokeDasharray="100"
                  strokeDashoffset={100 - elapsedPercent}
                />
              </svg>
              <div>
                <strong>{formatClock(remainingSeconds)}</strong>
                <span>{tournament.status === 'Paused' ? 'clock paused' : 'until next level'}</span>
              </div>
            </div>
            <div className="orbit-tv-running-time">
              <span>Running for</span>
              <strong>{formatRunningTime(runningSeconds)}</strong>
            </div>
          </div>

          <footer className={lateRegistrationOpen ? 'open' : 'closed'}>
            {lateRegistrationOpen ? (
              <>
                <span>Late registration open for</span>
                <strong>{formatRunningTime(lateRegistrationSeconds)}</strong>
              </>
            ) : <strong>Late registration closed</strong>}
          </footer>
        </section>

        <aside className="orbit-tournament-display-stats">
          <div className="orbit-tv-stat-list">
            {statistics.map((stat) => (
              <article className={stat.highlight ? 'highlight' : ''} key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            ))}
          </div>
          <article className="orbit-tv-next-level">
            <span>Next level</span>
            <strong>{nextLevel ? `Level ${nextLevel.level}` : 'Final level'}</strong>
            <small>{nextLevel ? formatBlinds(nextLevel) : 'No level scheduled'}</small>
          </article>
        </aside>
      </section>
    </main>
  );
}
