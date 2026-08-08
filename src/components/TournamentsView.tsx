import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { ChevronLeft, Clock, Edit3, Eye, LayoutDashboard, MoreHorizontal, Plus, Target, Users, WalletCards } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import PanelTitle from './PanelTitle';
import type { AppState, Tournament, TournamentLevel } from '../domain/types';
import type {
  TournamentDraft,
  TournamentPlayerDraft,
  TournamentSection,
  TournamentView
} from '../features/tournaments/tournamentWorkspace';

type TournamentsViewProps = {
  state: AppState;
  tournament: Tournament | null;
  currentLevel: TournamentLevel | null;
  nextLevel: TournamentLevel | null;
  prizePool: number;
  remaining: number;
  tournamentDraft: TournamentDraft;
  tournamentPayoutDrafts: Record<number, string>;
  tournamentPlayerDraft: TournamentPlayerDraft;
  tournamentSection: TournamentSection;
  tournamentView: TournamentView;
  addTournamentEntry: (tournament: Tournament, playerId: string, field: 'rebuys' | 'addOns') => void;
  advanceTournamentLevel: (tournament: Tournament, direction: 1 | -1) => void;
  beginTournamentEdit: (tournament: Tournament) => void;
  checkInTournamentPlayer: (tournament: Tournament, playerId: string) => void;
  createTournament: (event: FormEvent) => void;
  drawTournamentTables: (tournament: Tournament) => void;
  eliminateTournamentPlayer: (tournament: Tournament, playerId: string) => void;
  formatTournamentTime: (seconds: number) => string;
  getTournamentActivePlayers: (tournament?: Tournament | null) => number;
  getTournamentAverageStack: (tournament?: Tournament | null) => number;
  getTournamentEntries: (tournament?: Tournament | null) => number;
  onBeginCreate: () => void;
  openTournamentTv: (tournamentId: string) => void;
  pauseTournament: (tournament: Tournament) => void;
  registerTournamentPlayer: (event: FormEvent) => void;
  resumeTournament: (tournament: Tournament) => void;
  runTournamentAgain: (tournament: Tournament) => void;
  saveTournamentSettings: (event: FormEvent) => void;
  setSelectedTournamentId: Dispatch<SetStateAction<string>>;
  setTournamentDraft: Dispatch<SetStateAction<TournamentDraft>>;
  setTournamentPayoutDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  setTournamentPlayerDraft: Dispatch<SetStateAction<TournamentPlayerDraft>>;
  setTournamentSection: Dispatch<SetStateAction<TournamentSection>>;
  setTournamentView: Dispatch<SetStateAction<TournamentView>>;
  startTournament: (tournament: Tournament) => void;
  updateTournamentPayout: (tournament: Tournament, place: number, percent: number) => void;
};

export default function TournamentsView({
  state,
  tournament,
  currentLevel,
  nextLevel,
  prizePool,
  remaining,
  tournamentDraft,
  tournamentPayoutDrafts,
  tournamentPlayerDraft,
  tournamentSection,
  tournamentView,
  addTournamentEntry,
  advanceTournamentLevel,
  beginTournamentEdit,
  checkInTournamentPlayer,
  createTournament,
  drawTournamentTables,
  eliminateTournamentPlayer,
  formatTournamentTime,
  getTournamentActivePlayers,
  getTournamentAverageStack,
  getTournamentEntries,
  onBeginCreate,
  openTournamentTv,
  pauseTournament,
  registerTournamentPlayer,
  resumeTournament,
  runTournamentAgain,
  saveTournamentSettings,
  setSelectedTournamentId,
  setTournamentDraft,
  setTournamentPayoutDrafts,
  setTournamentPlayerDraft,
  setTournamentSection,
  setTournamentView,
  startTournament,
  updateTournamentPayout
}: TournamentsViewProps) {
  const tournamentForm = (mode: 'create' | 'edit') => (
    <form className="tournament-form tournament-focused-form" onSubmit={mode === 'create' ? createTournament : saveTournamentSettings}>
      <label className="tournament-field tournament-field-wide"><span>Tournament name</span><input value={tournamentDraft.name} onChange={(event) => setTournamentDraft({ ...tournamentDraft, name: event.target.value })} placeholder="Friday Night Main Event" /></label>
      <label className="tournament-field"><span>Buy-in</span><input value={tournamentDraft.buyIn} onChange={(event) => setTournamentDraft({ ...tournamentDraft, buyIn: event.target.value })} placeholder="$100" type="number" min="0" /></label>
      <label className="tournament-field"><span>Starting stack</span><input value={tournamentDraft.startingStack} onChange={(event) => setTournamentDraft({ ...tournamentDraft, startingStack: event.target.value })} placeholder="20,000" type="number" min="1000" /></label>
      <label className="tournament-field tournament-field-wide"><span>Level length <small>Minutes per blind level</small></span><input value={tournamentDraft.levelMinutes} onChange={(event) => setTournamentDraft({ ...tournamentDraft, levelMinutes: event.target.value })} placeholder="20 minutes" type="number" min="5" /></label>
      <label className="tournament-field"><span>Rebuy to prize pool <small>Percent</small></span><input value={tournamentDraft.rebuyPrizePercent} onChange={(event) => setTournamentDraft({ ...tournamentDraft, rebuyPrizePercent: event.target.value })} type="number" min="0" max="100" /></label>
      <label className="tournament-field"><span>Players per table</span><input value={tournamentDraft.tableSize} onChange={(event) => setTournamentDraft({ ...tournamentDraft, tableSize: event.target.value })} type="number" min="2" max="10" /></label>
      <div className="tournament-form-actions">
        <button className="ghost-button" type="button" onClick={() => setTournamentView('library')}>Cancel</button>
        <button className="primary-button" type="submit">{mode === 'create' ? 'Create tournament' : 'Save changes'}</button>
      </div>
    </form>
  );

  return (
      <main className="app-shell compact-shell tournament-manager-shell">
        <header className={tournamentView === 'library' ? 'topbar tournament-library-header' : 'page-header'}>
          <div>
            <h1>{tournamentView === 'library' ? 'Tournaments' : tournamentView === 'create' ? 'Create tournament' : tournamentView === 'edit' ? 'Edit tournament' : tournament?.name}</h1>
            {tournamentView === 'manage' && tournament ? (
              <div className="tournament-header-meta">
                <span className={`tournament-status-dot status-${tournament.status.toLowerCase()}`} />
                <span>{tournament.status}</span>
                <span aria-hidden="true">·</span>
                <span>{getTournamentEntries(tournament)} entries</span>
                <span aria-hidden="true">·</span>
                <span>${tournament.buyIn.toLocaleString()} buy-in</span>
              </div>
            ) : null}
          </div>
          <div className="header-actions">
            {tournamentView === 'library' ? <button className="primary-button" onClick={onBeginCreate}><Plus size={17} /> New tournament</button> : null}
            {tournamentView === 'create' || tournamentView === 'edit' ? <button className="ghost-button" onClick={() => setTournamentView('library')}><ChevronLeft size={17} /> Cancel</button> : null}
            {tournamentView === 'manage' && tournament && (tournament.status === 'Running' || tournament.status === 'Paused') ? <button className="secondary-button" onClick={() => openTournamentTv(tournament.id)}><Eye size={17} /> TV View</button> : null}
          </div>
        </header>

        {tournamentView === 'library' ? (
          <section className="tournament-library">
            <button className="tournament-new-card" onClick={onBeginCreate}>
              <span><Plus size={28} /></span><strong>Create a new tournament</strong><small>Build a fresh structure from scratch</small>
            </button>
            {state.tournaments.length ? <div className="tournament-library-list">
              {state.tournaments.map((item) => (
                <article className="tournament-library-card" key={item.id}>
                  <button className="tournament-library-main" onClick={() => { setSelectedTournamentId(item.id); setTournamentSection('clock'); setTournamentView('manage'); }}>
                    <span className={`tournament-library-icon tournament-library-icon-${item.status.toLowerCase()}`}><Target size={22} /></span>
                    <span><strong>{item.name}</strong><small>{item.status} · {getTournamentEntries(item)} entries · ${item.buyIn.toLocaleString()} buy-in</small></span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="icon-button" title="Tournament actions"><MoreHorizontal size={18} /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => beginTournamentEdit(item)}>Edit tournament</DropdownMenuItem><DropdownMenuItem onSelect={() => runTournamentAgain(item)}>Run again</DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>
                </article>
              ))}
            </div> : <div className="tournament-empty-library"><Target size={32} /><strong>No tournaments yet</strong><span>Create your first one above.</span></div>}
          </section>
        ) : tournamentView === 'create' || tournamentView === 'edit' ? (
          <section className="panel tournament-panel tournament-form-panel">
            <PanelTitle icon={tournamentView === 'create' ? <Plus /> : <Edit3 />} title={tournamentView === 'create' ? 'Tournament setup' : 'Tournament details'} />
            {tournamentForm(tournamentView)}
          </section>
        ) : tournament ? (
          <section className="tournament-workspace">
            <nav className="tournament-section-nav" aria-label="Tournament sections">
              <button className={tournamentSection === 'clock' ? 'active' : ''} onClick={() => setTournamentSection('clock')}><Clock size={18} /> Clock & levels</button>
              <button className={tournamentSection === 'players' ? 'active' : ''} onClick={() => setTournamentSection('players')}><Users size={18} /> Players</button>
              <button className={tournamentSection === 'tables' ? 'active' : ''} onClick={() => setTournamentSection('tables')}><LayoutDashboard size={18} /> Tables</button>
              <button className={tournamentSection === 'payouts' ? 'active' : ''} onClick={() => setTournamentSection('payouts')}><WalletCards size={18} /> Payouts</button>
            </nav>

            {tournamentSection === 'clock' ? <section className="panel tournament-panel tournament-control-panel">
                <div className="tournament-clock-card">
                  <span className={`tournament-status tournament-status-${tournament.status.toLowerCase()}`}>{tournament.status}</span>
                  <strong>{formatTournamentTime(remaining)}</strong>
                  <small>Level {(tournament.currentLevelIndex + 1).toString()} - {currentLevel ? `${currentLevel.smallBlind}/${currentLevel.bigBlind}${currentLevel.ante ? `/${currentLevel.ante}` : ''}` : '-'}</small>
                </div>
                <div className="tournament-actions">
                  {tournament.status === 'Running' ? (
                    <button className="secondary-button" onClick={() => pauseTournament(tournament)}>Pause</button>
                  ) : tournament.status === 'Paused' ? (
                    <button className="primary-button" onClick={() => resumeTournament(tournament)}>Resume</button>
                  ) : (
                    <button className="primary-button" onClick={() => startTournament(tournament)}>Start</button>
                  )}
                  <button className="ghost-button" onClick={() => advanceTournamentLevel(tournament, -1)}>Prev Level</button>
                  <button className="ghost-button" onClick={() => advanceTournamentLevel(tournament, 1)}>Next Level</button>
                </div>
                <div className="tournament-level-strip">
                  <article><span>Next</span><strong>{nextLevel ? `${nextLevel.smallBlind}/${nextLevel.bigBlind}` : 'Final'}</strong></article>
                  <article><span>Entries</span><strong>{getTournamentEntries(tournament)}</strong></article>
                  <article><span>Remaining</span><strong>{getTournamentActivePlayers(tournament)}</strong></article>
                  <article><span>Avg stack</span><strong>{getTournamentAverageStack(tournament).toLocaleString()}</strong></article>
                </div>
            </section> : null}

            {tournamentSection === 'tables' ? <section className="panel tournament-panel tournament-tables-panel">
              <div className="tournament-tables-head"><div><h2>Table overview</h2><p>{tournament.players.filter((player) => player.status !== 'Eliminated').length} active participants · {tournament.tableSize} seats per table</p></div><button className="primary-button" onClick={() => drawTournamentTables(tournament)}>Draw all participants</button></div>
              <div className="tournament-table-grid">
                {Array.from(new Set(tournament.players.filter((player) => player.tableNumber).map((player) => player.tableNumber!))).sort((a, b) => a - b).map((tableNumber) => <article key={tableNumber}><header><strong>Table {tableNumber}</strong><span>{tournament.players.filter((player) => player.tableNumber === tableNumber && player.status !== 'Eliminated').length}/{tournament.tableSize}</span></header>{tournament.players.filter((player) => player.tableNumber === tableNumber && player.status !== 'Eliminated').sort((a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0)).map((player) => <div key={player.id}><span>Seat {player.seatNumber}</span><strong>{player.name}</strong></div>)}</article>)}
                {!tournament.players.some((player) => player.tableNumber) ? <div className="tournament-table-empty">Draw participants to create balanced table assignments.</div> : null}
              </div>
            </section> : null}

            {tournamentSection === 'players' ? <section className="panel tournament-panel tournament-players-panel">
            <PanelTitle icon={<Users />} title="Register Players" />
                <form className="tournament-form" onSubmit={registerTournamentPlayer}>
                  <label className="tournament-field tournament-field-wide"><span>Player source <small>Saved profile or someone new</small></span><select value={tournamentPlayerDraft.profileId} onChange={(event) => {
                    const profile = state.profiles.find((item) => item.id === event.target.value);
                    setTournamentPlayerDraft({ ...tournamentPlayerDraft, profileId: event.target.value, name: profile?.name ?? tournamentPlayerDraft.name, phone: profile?.phone ?? tournamentPlayerDraft.phone });
                  }}>
                    <option value="">New / manual player</option>
                    {state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select></label>
                  <label className="tournament-field tournament-field-wide"><span>Player name</span><input value={tournamentPlayerDraft.name} onChange={(event) => setTournamentPlayerDraft({ ...tournamentPlayerDraft, name: event.target.value })} placeholder="Full name" /></label>
                  <label className="tournament-field"><span>Phone <small>Optional</small></span><input value={tournamentPlayerDraft.phone} onChange={(event) => setTournamentPlayerDraft({ ...tournamentPlayerDraft, phone: event.target.value })} placeholder="(555) 555-0123" /></label>
                  <label className="tournament-field"><span>Email <small>Optional</small></span><input value={tournamentPlayerDraft.email} onChange={(event) => setTournamentPlayerDraft({ ...tournamentPlayerDraft, email: event.target.value })} placeholder="player@example.com" /></label>
                  <button className="primary-button tournament-submit" type="submit">Register player</button>
                </form>
                <div className="tournament-section-label">Registered field</div>
                <div className="tournament-player-list">
                  {tournament.players.map((player) => (
                    <article key={player.id}>
                      <div>
                        <strong>{player.name}</strong>
                        <span>{player.status} · {player.rebuys} rebuys · {player.addOns} add-ons</span>
                      </div>
                      <div className="tournament-player-actions">
                        {player.status === 'Registered' ? <button className="mini-button" onClick={() => checkInTournamentPlayer(tournament, player.id)}>Check in</button> : null}
                        <button className="mini-button" onClick={() => addTournamentEntry(tournament, player.id, 'rebuys')}>Rebuy</button>
                        <button className="mini-button" onClick={() => addTournamentEntry(tournament, player.id, 'addOns')}>Add-on</button>
                        {player.status !== 'Eliminated' ? <button className="mini-button" onClick={() => eliminateTournamentPlayer(tournament, player.id)}>Out</button> : null}
                      </div>
                    </article>
                  ))}
                </div>
            </section> : null}

            {tournamentSection === 'payouts' ? <section className="panel tournament-panel tournament-prize-panel">
            <PanelTitle icon={<Target />} title="Prize Pool" />
                <div className="tournament-prize-total">
                  <span>Total prize pool</span>
                  <strong>${prizePool.toLocaleString()}</strong>
                </div>
                <div className="tournament-payout-list">
                  {tournament.payouts.map((payout) => (
                    <label key={payout.place}>
                      <span>{payout.place}{payout.place === 1 ? 'st' : payout.place === 2 ? 'nd' : payout.place === 3 ? 'rd' : 'th'}</span>
                      <input
                        value={tournamentPayoutDrafts[payout.place] ?? String(payout.percent)}
                        onChange={(event) => setTournamentPayoutDrafts({ ...tournamentPayoutDrafts, [payout.place]: event.target.value })}
                        onBlur={(event) => updateTournamentPayout(tournament, payout.place, Number(event.target.value) || 0)}
                        type="number"
                        min="0"
                        max="100"
                      />
                      <strong>${Math.round(prizePool * (payout.percent / 100)).toLocaleString()}</strong>
                    </label>
                  ))}
                </div>
            </section> : null}
          </section>
        ) : null}
      </main>
  );
}
