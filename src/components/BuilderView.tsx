import { Download, Plus, Target, X } from 'lucide-react';
import type { BalancePlanResult } from '../lib/resultBuilders';
import type { getDemand, getViabilityState } from '../domain/operations';
import type { ParticipantCandidate } from '../domain/participants';
import type { GameConfig, GameSession, Interest, PlayerProfile } from '../domain/types';
import PanelTitle from './PanelTitle';
import type { CoordinationConfig } from '../features/games/gamesWorkspace';

type BuilderBalancePlan = BalancePlanResult<
  GameConfig,
  ReturnType<typeof getDemand>,
  GameSession,
  Interest,
  PlayerProfile
>;

type BuilderViewProps = {
  games: GameConfig[];
  sessions: GameSession[];
  coordinationConfig: CoordinationConfig;
  gameFormatFilter: string;
  gameStakesFilter: string;
  gameStatusFilter: string;
  participantPool: ParticipantCandidate[];
  balancePlans: BuilderBalancePlan[];
  getGameDemand: (game: GameConfig) => ReturnType<typeof getDemand>;
  getGameViability: (game: GameConfig) => ReturnType<typeof getViabilityState>;
  onAddPlannedSession: () => void;
  onBuildGame: (gameId: string) => void;
  onClose: () => void;
  onCoordinationConfigChange: (config: CoordinationConfig) => void;
  onCreateBalancedTable: (plan: BuilderBalancePlan) => void;
  onExportPilotReport: () => void;
  onGameFormatFilterChange: (value: string) => void;
  onGameStakesFilterChange: (value: string) => void;
  onGameStatusFilterChange: (value: string) => void;
  onOpenOutreach: () => void;
  onOpenConfiguration: () => void;
};

const getGameFormat = (name: string) =>
  /\broe\b|round of each/i.test(name) ? 'ROE'
  : /\bdc\b|dealer.?s choice/i.test(name) ? 'Dealer’s Choice'
  : /\bplo\b|omaha/i.test(name) ? 'PLO'
  : /\bnlh\b|hold.?em/i.test(name) ? 'NLH'
  : /mixed|mix/i.test(name) ? 'Mixed'
  : 'Other';

const getGameStakes = (name: string) => name.match(/\d+\s*\/\s*\d+/)?.[0]?.replace(/\s/g, '') ?? 'Unspecified';

export default function BuilderView({
  games,
  sessions,
  coordinationConfig,
  gameFormatFilter,
  gameStakesFilter,
  gameStatusFilter,
  participantPool,
  balancePlans,
  getGameDemand,
  getGameViability,
  onAddPlannedSession,
  onBuildGame,
  onClose,
  onCoordinationConfigChange,
  onCreateBalancedTable,
  onExportPilotReport,
  onGameFormatFilterChange,
  onGameStakesFilterChange,
  onGameStatusFilterChange,
  onOpenOutreach,
  onOpenConfiguration
}: BuilderViewProps) {
  const getGameStatus = (game: GameConfig) => {
    if (sessions.some((session) => session.gameId === game.id && session.status === 'Running')) return 'Running';
    const viability = getGameViability(game).state;
    return viability === 'Ready to Start' || viability === 'Likely to Start' ? 'Ready' : 'Needs players';
  };
  const gameFormats = ['All formats', ...Array.from(new Set(games.map((game) => getGameFormat(game.name))))];
  const gameStakes = ['All stakes', ...Array.from(new Set(games.map((game) => getGameStakes(game.name))))];
  const filteredGameOptions = games.filter((game) =>
    (gameFormatFilter === 'All formats' || getGameFormat(game.name) === gameFormatFilter) &&
    (gameStakesFilter === 'All stakes' || getGameStakes(game.name) === gameStakesFilter) &&
    (gameStatusFilter === 'All statuses' || getGameStatus(game) === gameStatusFilter)
  );
  const requestedGames = games
    .map((game) => ({ game, demand: getGameDemand(game) }))
    .filter(({ demand }) => demand.interested + demand.confirmed + demand.waiting > 0)
    .sort((left, right) => right.demand.totalDemand - left.demand.totalDemand);
  const selectedBalancePlans = balancePlans.filter((plan) => plan.game.id === coordinationConfig.gameId);

  return (
    <main className="app-shell compact-shell">
      <header className="topbar">
        <div>
          <h1>Games</h1>
          <p className="page-subtitle">Tonight's demand and forming tables</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={onExportPilotReport}>
            <Download size={18} />
            Export Pilot
          </button>
          <button className="ghost-button" onClick={onClose}>
            <X size={18} />
            Close
          </button>
        </div>
      </header>

      <nav className="route-tabs" aria-label="Games sections">
        <span className="active" aria-current="page">Tonight</span>
        <button onClick={onOpenOutreach}>Outreach</button>
        <button onClick={onOpenConfiguration}>Configuration</button>
      </nav>

      <section className="game-filter-bar">
        <label><span>Stakes</span><select value={gameStakesFilter} onChange={(event) => onGameStakesFilterChange(event.target.value)}>{gameStakes.map((stakes) => <option key={stakes}>{stakes}</option>)}</select></label>
        <label><span>Format</span><select value={gameFormatFilter} onChange={(event) => onGameFormatFilterChange(event.target.value)}>{gameFormats.map((format) => <option key={format}>{format}</option>)}</select></label>
        <label><span>Status</span><select value={gameStatusFilter} onChange={(event) => onGameStatusFilterChange(event.target.value)}>{['All statuses', 'Running', 'Ready', 'Needs players'].map((status) => <option key={status}>{status}</option>)}</select></label>
      </section>

      <section className="panel game-requests-panel">
        <div className="section-heading">
          <div>
            <h2>Player Game Requests</h2>
            <p className="muted-copy">Member interest by exact stakes and format. Build a forming table when demand is ready.</p>
          </div>
        </div>
        <div className="forming-list">
          {requestedGames.map(({ game, demand }) => {
            const activeSession = sessions.find((session) => session.gameId === game.id && ['Running', 'Forming', 'Paused'].includes(session.status));
            const viability = getGameViability(game);
            return (
              <article className="forming-card" key={`request-${game.id}`}>
                <div>
                  <strong>{game.name}</strong>
                  <span className={`status-pill ${viability.state === 'Ready to Start' || viability.state === 'Likely to Start' ? 'likely' : ''}`}>
                    {activeSession ? activeSession.status : viability.state}
                  </span>
                </div>
                <p>{demand.interested} interested / {demand.confirmed} coming / {demand.inRoom} in room</p>
                <small>{viability.nextStep}</small>
                {!activeSession ? (
                  <button className="secondary-button" onClick={() => onBuildGame(game.id)}>
                    Build {game.name}
                  </button>
                ) : (
                  <small>{activeSession.label} is already {activeSession.status.toLowerCase()}.</small>
                )}
              </article>
            );
          })}
          {!requestedGames.length ? <p className="muted-copy">No member game requests yet.</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="builder-controls">
          <label>
            Game
            <select
              value={coordinationConfig.gameId}
              onChange={(event) => onCoordinationConfigChange({ ...coordinationConfig, gameId: event.target.value })}
            >
              {filteredGameOptions.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
              {!filteredGameOptions.length ? <option value="">No matching games</option> : null}
            </select>
          </label>
          <label>
            Seats
            <input
              type="number"
              min="2"
              max={games.find((game) => game.id === coordinationConfig.gameId)?.maxSeats ?? 10}
              value={coordinationConfig.seats}
              onChange={(event) => onCoordinationConfigChange({ ...coordinationConfig, seats: Number(event.target.value) })}
            />
          </label>
          <button className="primary-button" onClick={onAddPlannedSession}>
            <Plus size={18} />
            Start Forming Table
          </button>
        </div>
        <div className="builder-grid single-window-grid">
          {participantPool.map((candidate, index) => (
            <article className="candidate-card" key={candidate.id}>
              <div className="candidate-rank">{index + 1}</div>
              <div>
                <h3>{candidate.playerName}</h3>
                <p>{candidate.reasons.slice(0, 3).join(' - ')}</p>
                <small>
                  {candidate.profile?.preferredStakes || 'No saved stakes'} -{' '}
                  {candidate.profile
                    ? `$${candidate.profile.typicalBuyInMin}-${candidate.profile.typicalBuyInMax} buy-in`
                    : 'No profile'}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={<Target />} title="Two-Table Balance Option" />
        <div className="balance-list">
          {selectedBalancePlans.length ? (
            selectedBalancePlans.map((plan) => (
              <article className="balance-card" key={`${plan.game.id}-${plan.fromTable.id}`}>
                <div>
                  <h3>{plan.game.name}</h3>
                  <p>{plan.demand.totalDemand} total demand - Table A {plan.tableASeatsAfterMove}/{plan.fromTable.maxSeats} after move - Table B projected {plan.tableBProjectedSeats}/{plan.game.maxSeats}</p>
                  <small>{plan.nextStep}</small>
                </div>
                <div className="balance-movers">
                  {plan.moveCandidates.map((candidate) => (
                    <span key={candidate.id}>{candidate.playerName} - {candidate.reasons.slice(0, 2).join(' - ')}</span>
                  ))}
                </div>
                <button className="primary-button" onClick={() => onCreateBalancedTable(plan)}>
                  Create Table B
                </button>
              </article>
            ))
          ) : (
            <p className="muted-copy">This appears when a game has more than 12 total players across in-room, waiting, coming, and interested demand.</p>
          )}
        </div>
      </section>
    </main>
  );
}
