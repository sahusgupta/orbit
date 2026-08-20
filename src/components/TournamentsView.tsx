import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { ChevronLeft, Edit3, Eye, MoreHorizontal, Plus, Target, Users, WalletCards } from 'lucide-react';
import {
  createDefaultTournamentPayoutDrafts,
  validateTournamentPayoutDrafts
} from '../application/management/tournamentCommands';
import type { AppState, Tournament, TournamentLevel } from '../domain/types';
import type {
  TournamentDraft,
  TournamentPlayerDraft,
  TournamentSection,
  TournamentView
} from '../features/tournaments/tournamentWorkspace';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import PanelTitle from './PanelTitle';

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

const formatPlace = (place: number) => {
  const modulo100 = place % 100;
  if (modulo100 >= 11 && modulo100 <= 13) return `${place}th`;
  if (place % 10 === 1) return `${place}st`;
  if (place % 10 === 2) return `${place}nd`;
  if (place % 10 === 3) return `${place}rd`;
  return `${place}th`;
};

export default function TournamentsView({
  state,
  tournament,
  currentLevel,
  prizePool,
  remaining,
  tournamentDraft,
  tournamentPlayerDraft,
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
  setTournamentPlayerDraft,
  setTournamentView,
  startTournament
}: TournamentsViewProps) {
  const payoutDrafts = tournamentDraft.payouts ?? createDefaultTournamentPayoutDrafts();
  const payoutValidation = validateTournamentPayoutDrafts(payoutDrafts);

  const setPayoutDrafts = (payouts: NonNullable<TournamentDraft['payouts']>) => {
    setTournamentDraft({ ...tournamentDraft, payouts });
  };

  const tournamentForm = (mode: 'create' | 'edit') => (
    <form className="tournament-form tournament-focused-form" onSubmit={mode === 'create' ? createTournament : saveTournamentSettings}>
      <label className="tournament-field tournament-field-wide">
        <span>Tournament name</span>
        <input required value={tournamentDraft.name} onChange={(event) => setTournamentDraft({ ...tournamentDraft, name: event.target.value })} placeholder="Friday Night Main Event" />
      </label>
      <label className="tournament-field">
        <span>Buy-in</span>
        <input value={tournamentDraft.buyIn} onChange={(event) => setTournamentDraft({ ...tournamentDraft, buyIn: event.target.value })} placeholder="$100" type="number" min="0" />
      </label>
      <label className="tournament-field">
        <span>Starting stack</span>
        <input value={tournamentDraft.startingStack} onChange={(event) => setTournamentDraft({ ...tournamentDraft, startingStack: event.target.value })} placeholder="20,000" type="number" min="1000" />
      </label>
      <label className="tournament-field tournament-field-wide">
        <span>Level length <small>Minutes per blind level</small></span>
        <input value={tournamentDraft.levelMinutes} onChange={(event) => setTournamentDraft({ ...tournamentDraft, levelMinutes: event.target.value })} placeholder="20 minutes" type="number" min="5" />
      </label>
      <label className="tournament-field">
        <span>Rebuy to prize pool <small>Percent</small></span>
        <input value={tournamentDraft.rebuyPrizePercent} onChange={(event) => setTournamentDraft({ ...tournamentDraft, rebuyPrizePercent: event.target.value })} type="number" min="0" max="100" />
      </label>
      <label className="tournament-field">
        <span>Players per table</span>
        <input value={tournamentDraft.tableSize} onChange={(event) => setTournamentDraft({ ...tournamentDraft, tableSize: event.target.value })} type="number" min="2" max="10" />
      </label>

      <fieldset className="tournament-payout-editor">
        <legend>Prize pool allocation</legend>
        <div className="tournament-payout-editor-head">
          <span>Paid places</span>
          <strong className={payoutValidation.valid ? 'valid' : 'invalid'}>{payoutValidation.total}% allocated</strong>
        </div>
        <div className="tournament-payout-draft-list">
          {payoutDrafts.map((payout, index) => (
            <div className="tournament-payout-draft-row" key={payout.place}>
              <strong>{formatPlace(payout.place)}</strong>
              <label>
                <input
                  aria-label={`${formatPlace(payout.place)} place percent`}
                  max="100"
                  min="0"
                  onChange={(event) => setPayoutDrafts(payoutDrafts.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, percent: event.target.value } : item
                  )))}
                  step="0.01"
                  type="number"
                  value={payout.percent}
                />
                <span aria-hidden="true">%</span>
              </label>
              <button
                aria-label={`Remove ${formatPlace(payout.place)} payout`}
                className="ghost-button tournament-payout-remove"
                disabled={payoutDrafts.length === 1}
                onClick={() => setPayoutDrafts(
                  payoutDrafts
                    .filter((_, itemIndex) => itemIndex !== index)
                    .map((item, itemIndex) => ({ ...item, place: itemIndex + 1 }))
                )}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="tournament-payout-editor-footer">
          <button
            className="ghost-button"
            onClick={() => setPayoutDrafts([
              ...payoutDrafts,
              { place: payoutDrafts.length + 1, percent: '0' }
            ])}
            type="button"
          >
            <Plus size={15} /> Add paid place
          </button>
          <span aria-live="polite" className={payoutValidation.valid ? 'valid' : 'invalid'}>
            {payoutValidation.valid ? 'Allocation complete.' : payoutValidation.error}
          </span>
        </div>
      </fieldset>

      <div className="tournament-form-actions">
        <button className="ghost-button" type="button" onClick={() => setTournamentView(mode === 'edit' ? 'manage' : 'library')}>Cancel</button>
        <button className="primary-button" disabled={!payoutValidation.valid || !tournamentDraft.name.trim()} type="submit">
          {mode === 'create' ? 'Create tournament' : 'Save changes'}
        </button>
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
              <span aria-hidden="true">·</span>
              <span>Level {currentLevel?.level ?? '-'} / {formatTournamentTime(remaining)}</span>
            </div>
          ) : null}
        </div>
        <div className="header-actions">
          {tournamentView === 'library' ? <button className="primary-button" onClick={onBeginCreate}><Plus size={17} /> New tournament</button> : null}
          {tournamentView === 'manage' && tournament ? (
            <>
              <button className="ghost-button tournament-library-back" onClick={() => setTournamentView('library')}><ChevronLeft size={17} /> All tournaments</button>
              <div className="tournament-lifecycle-actions" aria-label="Tournament controls">
                {tournament.status === 'Draft' ? <button className="primary-button" onClick={() => startTournament(tournament)}>Start</button> : null}
                {tournament.status === 'Running' ? <button className="secondary-button" onClick={() => pauseTournament(tournament)}>Pause</button> : null}
                {tournament.status === 'Paused' ? <button className="primary-button" onClick={() => resumeTournament(tournament)}>Resume</button> : null}
                {tournament.status !== 'Finished' ? (
                  <>
                    <button className="ghost-button" disabled={tournament.currentLevelIndex === 0} onClick={() => advanceTournamentLevel(tournament, -1)}>Prev Level</button>
                    <button className="ghost-button" disabled={tournament.currentLevelIndex >= tournament.levels.length - 1} onClick={() => advanceTournamentLevel(tournament, 1)}>Next Level</button>
                  </>
                ) : null}
                <button className="secondary-button" onClick={() => openTournamentTv(tournament.id)}><Eye size={17} /> TV View</button>
              </div>
            </>
          ) : null}
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
                <button className="tournament-library-main" onClick={() => { setSelectedTournamentId(item.id); setTournamentView('manage'); }}>
                  <span className={`tournament-library-icon tournament-library-icon-${item.status.toLowerCase()}`}><Target size={22} /></span>
                  <span><strong>{item.name}</strong><small>{item.status} · {getTournamentEntries(item)} entries · ${item.buyIn.toLocaleString()} buy-in</small></span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button aria-label={`Actions for ${item.name}`} className="icon-button" title="Tournament actions"><MoreHorizontal size={18} /></button></DropdownMenuTrigger>
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
          <div className="tournament-client-grid">
            <section className="panel tournament-panel tournament-players-panel">
              <div className="tournament-panel-heading">
                <PanelTitle icon={<Users />} title="Players" />
                <div>
                  <span>{getTournamentActivePlayers(tournament)} active</span>
                  <button className="ghost-button" onClick={() => drawTournamentTables(tournament)}>Assign tables</button>
                </div>
              </div>
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
                      <span>{[
                        player.status,
                        player.tableNumber ? `Table ${player.tableNumber}${player.seatNumber ? ` / Seat ${player.seatNumber}` : ''}` : '',
                        `${player.rebuys} rebuys`,
                        `${player.addOns} add-ons`
                      ].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="tournament-player-actions">
                      {player.status === 'Registered' ? <button className="mini-button" onClick={() => checkInTournamentPlayer(tournament, player.id)}>Check in</button> : null}
                      <button className="mini-button" onClick={() => addTournamentEntry(tournament, player.id, 'rebuys')}>Rebuy</button>
                      <button className="mini-button" onClick={() => addTournamentEntry(tournament, player.id, 'addOns')}>Add-on</button>
                      {player.status !== 'Eliminated' ? <button className="mini-button" onClick={() => eliminateTournamentPlayer(tournament, player.id)}>Out</button> : null}
                    </div>
                  </article>
                ))}
                {!tournament.players.length ? <div className="tournament-player-empty">No players registered.</div> : null}
              </div>
            </section>

            <section className="panel tournament-panel tournament-prize-panel">
              <div className="tournament-panel-heading">
                <PanelTitle icon={<WalletCards />} title="Prize Pool" />
                <button className="ghost-button" onClick={() => beginTournamentEdit(tournament)}><Edit3 size={15} /> Edit allocation</button>
              </div>
              <div className="tournament-prize-total">
                <span>Total prize pool</span>
                <strong>${prizePool.toLocaleString()}</strong>
              </div>
              <div className="tournament-payout-list">
                {tournament.payouts.map((payout) => (
                  <article key={payout.place}>
                    <span>{formatPlace(payout.place)}</span>
                    <strong>{payout.percent}%</strong>
                    <b>${Math.round(prizePool * (payout.percent / 100)).toLocaleString()}</b>
                  </article>
                ))}
                {!tournament.payouts.length ? <div className="tournament-player-empty">No payout allocation configured.</div> : null}
              </div>
            </section>
          </div>
        </section>
      ) : null}
    </main>
  );
}
