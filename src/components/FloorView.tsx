import * as Dialog from '@radix-ui/react-dialog';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import { ChevronDown, ChevronUp, Clock, Eye, LayoutDashboard, MessageCircle, MoreHorizontal, Plus, Target, Users, WalletCards, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import PokerTable, { type Player as PokerTablePlayer } from './PokerTable';
import PanelTitle from './PanelTitle';
import { getTimerStatusFromSeconds } from '../lib/appCore';
import { hasProfileReference } from '../lib/profileRelationships';
import { getTableFinancialOverview, getTablePlayerFinancialOverview } from '../domain/reporting';
import {
  getAverageStackForTable,
  getDemand,
  getPlayerLoggedHours,
  getSessionBuyIns,
  getTableHealth,
  getViabilityState
} from '../domain/operations';
import { activeInterestStatuses, getParticipantPool } from '../domain/participants';
import type { getAnalytics } from '../domain/analytics';
import type {
  AppState,
  GameConfig,
  GameSession,
  Interest,
  InterestStatus,
  PlayerProfile,
  PlayerSession,
  TableEventType
} from '../domain/types';
import type {
  EventDraft,
  MoneyDraft,
  OpenPanels,
  QuickAddForm,
  SeatPickerState
} from '../features/floor/floorWorkspace';
type LiveFeedItem = { id: string; timestamp: string; label: string; actor: string; detail: string; kind: string };

type FloorViewProps = {
  state: AppState;
  analytics: ReturnType<typeof getAnalytics>;
  clockNow: number;
  openPanels: OpenPanels;
  collapsedTables: Record<string, boolean>;
  startPlayerDrafts: Record<string, string[]>;
  eventDrafts: Record<string, EventDraft>;
  dropDrafts: Record<string, MoneyDraft>;
  dealerDrafts: Record<string, string>;
  handCountDrafts: Record<string, string>;
  formingGameId: string;
  overviewTableId: string;
  financialOverviewTableId: string;
  waitlistPopupOpen: boolean;
  seatPickerModal: ReactNode;
  cashOutModal: ReactNode;
  tableLedgerModal: ReactNode;
  seatPicker: SeatPickerState | null;
  liveFeedItems: LiveFeedItem[];
  quickAddOpenSeatSessions: GameSession[];
  form: QuickAddForm;
  statuses: InterestStatus[];
  checkInSearch: string;
  checkInMatches: PlayerProfile[];
  inClubInterests: Interest[];
  failedStartReasons: string[];
  tableBreakReasons: string[];
  setWaitlistPopupOpen: Dispatch<SetStateAction<boolean>>;
  setOpenPanels: Dispatch<SetStateAction<OpenPanels>>;
  setCollapsedTables: Dispatch<SetStateAction<Record<string, boolean>>>;
  setStartPlayerDrafts: Dispatch<SetStateAction<Record<string, string[]>>>;
  setEventDrafts: Dispatch<SetStateAction<Record<string, EventDraft>>>;
  setDropDrafts: Dispatch<SetStateAction<Record<string, MoneyDraft>>>;
  setDealerDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setHandCountDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setFormingGameId: Dispatch<SetStateAction<string>>;
  setOverviewTableId: Dispatch<SetStateAction<string>>;
  setFinancialOverviewTableId: Dispatch<SetStateAction<string>>;
  setTableLedgerSessionId: Dispatch<SetStateAction<string | null>>;
  setForm: Dispatch<SetStateAction<QuickAddForm>>;
  setCheckInSearch: Dispatch<SetStateAction<string>>;
  minutesSince: (iso?: string) => number;
  getAvailableSeatNumber: (session: GameSession, requestedSeat?: number) => number | undefined;
  getActivePlayerSessionsForTable: (state: AppState, tableId: string) => PlayerSession[];
  getSeatOptions: (gameId: string) => Interest[];
  getTimeRemainingSeconds: (session: PlayerSession, nowMs?: number) => number;
  getMoveTargets: (sourceTableId: string) => { id: string; label: string; openSeats: number }[];
  formatHours: (hours: number) => string;
  formatClock: (iso?: string) => string;
  formatTimeLeft: (seconds: number) => string;
  toDateTimeInput: (iso?: string) => string;
  togglePanel: (panel: string) => void;
  seatInterestAtTable: (interest: Interest, tableId?: string, seatNumber?: number) => void;
  updateInterest: (id: string, patch: Partial<Interest>) => void;
  deleteInterest: (id: string) => void;
  openTableView: (sessionId: string) => void;
  openSeatPicker: (session: GameSession, requestedSeatNumber?: number) => void;
  startSessionWithPlayers: (session: GameSession) => void;
  updateSession: (id: string, patch: Partial<GameSession>) => void;
  recordTableEvent: (session: GameSession, type: TableEventType, reason: string, note?: string) => void;
  toggleStartPlayer: (sessionId: string, interestId: string) => void;
  addPlayerTime: (playerSession: PlayerSession, minutes: number) => void;
  addBuyIn: (playerSession: PlayerSession, amountOverride?: number, noteOverride?: string) => void;
  requestPlayerCashOut: (playerSession: PlayerSession) => void;
  changePlayerSeat: (playerSession: PlayerSession, seatNumber: number) => void;
  movePlayerToTable: (playerSession: PlayerSession, targetTableId: string) => void;
  setTableCollectionMode: (sessionId: string, mode: 'Time' | 'Drop') => void;
  updateSessionTimestamp: (id: string, key: 'startedAt' | 'endedAt', value: string) => void;
  assignDealer: (session: GameSession) => void;
  endDealerAssignment: (session: GameSession) => void;
  recordHands: (session: GameSession) => void;
  addTableDrop: (session: GameSession) => void;
  failFormingGame: (session: GameSession) => void;
  addSession: (gameId: string) => void;
  addInterest: (event: FormEvent) => void;
  checkInProfileFromSearch: (profile: PlayerProfile) => void;
};

export default function FloorView(props: FloorViewProps) {
  const {
    state, analytics, clockNow, openPanels, collapsedTables, startPlayerDrafts, eventDrafts, dropDrafts,
    dealerDrafts, handCountDrafts, formingGameId, overviewTableId, financialOverviewTableId,
    waitlistPopupOpen, seatPickerModal, cashOutModal, tableLedgerModal, seatPicker, liveFeedItems,
    quickAddOpenSeatSessions, form, statuses, checkInSearch, checkInMatches, inClubInterests,
    failedStartReasons, tableBreakReasons, setWaitlistPopupOpen, setOpenPanels, setCollapsedTables,
    setStartPlayerDrafts, setEventDrafts, setDropDrafts, setDealerDrafts, setHandCountDrafts,
    setFormingGameId, setOverviewTableId, setFinancialOverviewTableId, setTableLedgerSessionId,
    setForm, setCheckInSearch, minutesSince, getAvailableSeatNumber, getActivePlayerSessionsForTable,
    getSeatOptions, getTimeRemainingSeconds, getMoveTargets, formatHours, formatClock, formatTimeLeft,
    toDateTimeInput, togglePanel, seatInterestAtTable, updateInterest, deleteInterest, openTableView,
    openSeatPicker, startSessionWithPlayers, updateSession, recordTableEvent, toggleStartPlayer,
    addPlayerTime, addBuyIn, requestPlayerCashOut, changePlayerSeat, movePlayerToTable,
    setTableCollectionMode, updateSessionTimestamp, assignDealer, endDealerAssignment, recordHands,
    addTableDrop, failFormingGame, addSession, addInterest, checkInProfileFromSearch
  } = props;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Floor</h1>
          <p className="page-subtitle">Live room operations</p>
        </div>
        <div className="topbar-actions">
          <button className="waitlist-icon-trigger" onClick={() => setWaitlistPopupOpen(true)} title="Open waitlist" aria-label={`Open waitlist, ${state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length} waiting`}>
            <Users size={19} />
            {state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length ? <span>{state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length}</span> : null}
          </button>
          <button className="primary-button" onClick={() => setOpenPanels((panels) => ({ ...panels, quickAdd: true }))}><Plus size={18} /> Add player</button>
        </div>
      </header>
      {seatPickerModal}
      {cashOutModal}
      {tableLedgerModal}

      <Dialog.Root open={waitlistPopupOpen} onOpenChange={setWaitlistPopupOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="waitlist-popup-overlay" />
          <Dialog.Content className="waitlist-popup-content">
            <div className="waitlist-popup-header">
              <div><Dialog.Title>Waitlist</Dialog.Title><Dialog.Description>{state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length} players need attention</Dialog.Description></div>
              <Dialog.Close asChild><button className="icon-button" aria-label="Close waitlist" title="Close waitlist"><X size={18} /></button></Dialog.Close>
            </div>
            <div className="waitlist-popup-list">
              {state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length ? state.interests
                .filter((interest) => activeInterestStatuses.includes(interest.status))
                .sort((left, right) => left.interestedAt.localeCompare(right.interestedAt))
                .map((interest) => {
                  const game = state.games.find((item) => item.id === interest.gameId);
                  const openTables = state.sessions.filter(
                    (session) =>
                      session.gameId === interest.gameId &&
                      session.status !== 'Closed' &&
                      session.status !== 'Failed to Start' &&
                      getAvailableSeatNumber(session) !== undefined
                  );
                  return <article className="waitlist-popup-row" key={interest.id}>
                    <div>
                      <strong>{interest.playerName}</strong>
                      <span>{game?.name ?? 'Unknown game'} · {interest.status === 'Confirmed Coming' ? 'Coming' : interest.status === 'Arrived' ? 'Here' : interest.status}</span>
                      {interest.expectedArrivalTime ? <span>Expected at {interest.expectedArrivalTime}</span> : null}
                      {interest.availabilityStartTime ? <span>Available {interest.availabilityStartTime}{interest.availabilityEndTime ? `–${interest.availabilityEndTime}` : ''}</span> : null}
                    </div>
                    <em className="waitlist-popup-age">{minutesSince(interest.interestedAt)}m</em>
                    <div className="waitlist-popup-actions">
                      {interest.status === 'Arrived' ? (
                        openTables.length ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="secondary-button waitlist-seat-button" type="button">Seat at table</button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="waitlist-action-menu">
                              {openTables.map((session) => (
                                <DropdownMenuItem
                                  key={session.id}
                                  onSelect={() => {
                                    seatInterestAtTable(interest, session.id);
                                    setWaitlistPopupOpen(false);
                                  }}
                                >
                                  {session.label} · {session.maxSeats - getActivePlayerSessionsForTable(state, session.id).length} open
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : <span className="waitlist-no-table">No open table</span>
                      ) : (
                        <button className="secondary-button waitlist-arrive-button" onClick={() => updateInterest(interest.id, { status: 'Arrived' })}>
                          Mark arrived
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><button className="icon-button" aria-label={`Actions for ${interest.playerName}`}><MoreHorizontal size={17} /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="waitlist-action-menu"><DropdownMenuItem onSelect={() => deleteInterest(interest.id)}>Remove from waitlist</DropdownMenuItem></DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </article>;
                }) : <div className="waitlist-popup-empty"><strong>No one is waiting</strong><span>New interest will appear here.</span></div>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <section className="floor-summary-bar" aria-label="Floor summary">
        <span><strong>{state.sessions.filter((session) => session.status === 'Running').length}</strong> running</span>
        <span><strong>{state.playerSessions.filter((session) => !session.leftAt).length}</strong> seated</span>
        <span><strong>{state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length}</strong> waiting</span>
        <span className={analytics.expiredTimeFeeSeats ? 'alert' : ''}><strong>{analytics.expiredTimeFeeSeats}</strong> actions needed</span>
      </section>

      <section className="minimal-dashboard dashboard-simple">
        <div className="dashboard-main-column">
        <section className={`panel floor-panel current-tables-panel ${openPanels.currentTables ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<LayoutDashboard />}
            title="Current Tables"
            collapsed={!openPanels.currentTables}
            onToggle={() => togglePanel('currentTables')}
          />
          {openPanels.currentTables ? <div className="active-game-list">
            {state.sessions.filter((session: { status: string; }) => session.status !== 'Closed' && session.status !== 'Failed to Start').length ? (
              state.sessions.filter((session: { status: string; }) => session.status !== 'Closed' && session.status !== 'Failed to Start').map((session: GameSession) => {
                const game = state.games.find((item) => item.id === session.gameId);
                const health = getTableHealth(state, session);
                const seatOptions = getSeatOptions(session.gameId);
                const seatedPlayers = state.playerSessions.filter((playerSession) => playerSession.tableId === session.id && !playerSession.leftAt);
                const selectedForStart = startPlayerDrafts[session.id] ?? [];
                const isTimeCollection = session.collectionMode === 'Time' || session.timeFeeBased;
                const averageStack = getAverageStackForTable(state, session.id);
                const tableDropTotal = state.dropLogs
                  .filter((drop) => drop.tableId === session.id)
                  .reduce((sum, drop) => sum + drop.amount, 0);
                const currentDealer = state.dealerAssignments.find((assignment) => assignment.tableId === session.id && !assignment.endedAt);
                const tableHandsTotal = state.handCountLogs
                  .filter((entry) => entry.tableId === session.id)
                  .reduce((sum, entry) => sum + entry.hands, 0);
                const tableExpanded = collapsedTables[session.id] ?? true;
                const pokerTablePlayers: PokerTablePlayer[] = seatedPlayers.map((playerSession, index) => {
                  const hours = getPlayerLoggedHours(state, playerSession);
                  const buyIns = getSessionBuyIns(state, playerSession);
                  const buyInTotal = buyIns.reduce((sum, buyIn) => sum + buyIn.amount, 0);
                  return {
                    id: playerSession.id,
                    seatNumber: playerSession.seatNumber ?? index + 1,
                    name: playerSession.playerName,
                    membershipId: playerSession.profileId ?? playerSession.id.slice(0, 8),
                    joinedAt: new Date(playerSession.seatedAt).getTime(),
                    hourlyTimeLimit: isTimeCollection ? Math.max(1, playerSession.timePurchasedMinutes ?? 60) : undefined,
                    timeRemainingSeconds: isTimeCollection ? getTimeRemainingSeconds(playerSession, clockNow) : undefined,
                    tonightHours: formatHours(hours.tonight),
                    totalHours: formatHours(hours.total),
                    buyInTotal,
                    recentBuyIns: buyIns.slice(0, 4).map((buyIn) => ({
                      id: buyIn.id,
                      label: `$${buyIn.amount.toLocaleString()} at ${formatClock(buyIn.timestamp)}${buyIn.note ? ` - ${buyIn.note}` : ''}`
                    }))
                  };
                });
                return (
                  <article className="active-game-card floor-table-launcher" key={session.id} onClick={() => openTableView(session.id)}>
                    <div>
                      <h3>{game?.name ?? 'Unknown'}</h3>
                    <span>{session.label} - {session.status} - {isTimeCollection ? 'Time fees' : 'Drop'}</span>
                      <small>
                        Start {formatClock(session.startedAt)} {session.manualEdits?.startedAt ? <em className="edited-marker">edited</em> : null}
                        {session.endedAt ? <> / End {formatClock(session.endedAt)} {session.manualEdits?.endedAt ? <em className="edited-marker">edited</em> : null}</> : null}
                        {' '} / Avg stack ${averageStack.toLocaleString()}
                        {currentDealer ? <> / Dealer {currentDealer.dealerName}</> : null}
                        {tableHandsTotal ? <> / {tableHandsTotal} hands logged</> : null}
                      </small>
                    </div>
                    <strong>{pokerTablePlayers.length}/{session.maxSeats}</strong>
                    <span className={`health-pill ${health.toLowerCase().replace(/\s+/g, '-')}`}>{health}</span>
                    <div className="seat-control" onClick={(event) => event.stopPropagation()}>
                      <button
                        aria-label="Add player to an open seat"
                        className="mini-button"
                        onClick={() => {
                          openSeatPicker(session);
                          setCollapsedTables((tables) => ({ ...tables, [session.id]: true }));
                        }}
                        title="Add player to an open seat"
                      >
                        +
                      </button>
                      {session.status !== 'Running' ? (
                        <button className="secondary-button" onClick={() => startSessionWithPlayers(session)}>Start Table</button>
                      ) : null}
                      <button className="ghost-button" onClick={() => openTableView(session.id)}><Eye size={17} /> Open</button>
                      <button className="ghost-button" onClick={() => setTableLedgerSessionId(session.id)}><WalletCards size={17} /> Ledger</button>
                      <button
                        aria-label={tableExpanded ? 'Hide table' : 'Show table'}
                        className="icon-button"
                        onClick={() => setCollapsedTables((tables) => ({ ...tables, [session.id]: !(tables[session.id] ?? true) }))}
                        title={tableExpanded ? 'Hide table' : 'Show table'}
                      >
                        {tableExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><button aria-label="Table actions" className="icon-button" title="Table actions"><MoreHorizontal size={17} /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {session.status === 'Running' ? <DropdownMenuItem onSelect={() => updateSession(session.id, { status: 'Paused' })}>Pause table</DropdownMenuItem> : null}
                          <DropdownMenuItem onSelect={() => setCollapsedTables((tables) => ({ ...tables, [session.id]: true }))}>Table settings</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => recordTableEvent(session, 'Broke', eventDrafts[session.id]?.breakReason || tableBreakReasons[0], eventDrafts[session.id]?.breakNote ?? '')}>Mark as broke</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => recordTableEvent(session, 'Closed', 'Staff closed table')}>Close table</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="table-detail-panel">
                      <div className="seat-help-row">
                        <span>Click an open seat and choose a player from the club database.</span>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            openSeatPicker(session);
                            setCollapsedTables((tables) => ({ ...tables, [session.id]: true }));
                          }}
                        >
                          Next open seat
                        </button>
                      </div>
                      {session.status !== 'Running' ? (
                        <div className="start-table-panel">
                          <div className="start-table-head">
                            <strong>Select players to start this table</strong>
                            <span>{selectedForStart.length}/{session.maxSeats} selected</span>
                          </div>
                          <div className="player-picker-list start-table-picker">
                            {seatOptions.length ? (
                              seatOptions.slice(0, session.maxSeats).map((interest) => (
                                <label className="player-pick-row" key={interest.id}>
                                  <input
                                    type="checkbox"
                                    checked={selectedForStart.includes(interest.id)}
                                    onChange={() => toggleStartPlayer(session.id, interest.id)}
                                  />
                                  <span>{interest.playerName}</span>
                                  <small>{interest.status}</small>
                                </label>
                              ))
                            ) : (
                              <span className="muted-copy">No waiting or arrived players for this game yet. You can still start the table empty and add players from the + seat control.</span>
                            )}
                          </div>
                          <div className="inline-actions">
                            <button className="primary-button" onClick={() => startSessionWithPlayers(session)}>
                              {selectedForStart.length ? 'Start with selected' : 'Start empty'}
                            </button>
                            {selectedForStart.length ? (
                              <button className="ghost-button" onClick={() => setStartPlayerDrafts((drafts) => ({ ...drafts, [session.id]: [] }))}>
                                Clear
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {tableExpanded ? (
                        <div className="poker-table-display">
                          <PokerTable
                            players={pokerTablePlayers}
                            showTimeRemaining={isTimeCollection}
                            maxPlayers={session.maxSeats}
                            selectedSeatNumber={seatPicker?.sessionId === session.id ? seatPicker.seatNumber : undefined}
                            moveTargets={getMoveTargets(session.id)}
                            onSeatClick={(seatNumber) =>
                              openSeatPicker(session, seatNumber)
                            }
                            onAddTime={(playerId, minutes) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) addPlayerTime(playerSession, minutes);
                            }}
                            onAddBuyIn={(playerId, amount, note) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) addBuyIn(playerSession, amount, note);
                            }}
                            onRemovePlayer={(playerId) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) requestPlayerCashOut(playerSession);
                            }}
                            onChangeSeat={(playerId, seatNumber) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) changePlayerSeat(playerSession, seatNumber);
                            }}
                            onMovePlayer={(playerId, targetTableId) => {
                              const playerSession = seatedPlayers.find((player) => player.id === playerId);
                              if (playerSession) movePlayerToTable(playerSession, targetTableId);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="table-collapsed-note">
                          <span>{seatedPlayers.length} seated player{seatedPlayers.length === 1 ? '' : 's'}</span>
                          <button
                            className="ghost-button"
                            onClick={() => setCollapsedTables((tables) => ({ ...tables, [session.id]: true }))}
                          >
                            Show table
                          </button>
                        </div>
                      )}
                    </div>
                    <details className="compact-details table-admin-details" onClick={(event) => event.stopPropagation()}>
                      <summary>Table admin</summary>
                      <div className="correction-grid">
                        <label>
                          Collection mode
                          <div className="segmented-control table-mode-control">
                            <button
                              type="button"
                              className={!isTimeCollection ? 'secondary-button active' : 'ghost-button'}
                              onClick={() => setTableCollectionMode(session.id, 'Drop')}
                            >
                              Drop
                            </button>
                            <button
                              type="button"
                              className={isTimeCollection ? 'secondary-button active' : 'ghost-button'}
                              onClick={() => setTableCollectionMode(session.id, 'Time')}
                            >
                              Time fees
                            </button>
                          </div>
                        </label>
                        <label>
                          Start
                          <input
                            type="datetime-local"
                            value={toDateTimeInput(session.startedAt)}
                            onChange={(event: { target: { value: string; }; }) => updateSessionTimestamp(session.id, 'startedAt', event.target.value)}
                          />
                        </label>
                        <label>
                          End
                          <input
                            type="datetime-local"
                            value={toDateTimeInput(session.endedAt)}
                            onChange={(event: { target: { value: string; }; }) => updateSessionTimestamp(session.id, 'endedAt', event.target.value)}
                          />
                        </label>
                        <label>
                          Current dealer
                          <input
                            list={`dealer-options-${session.id}`}
                            value={dealerDrafts[session.id] ?? currentDealer?.dealerName ?? ''}
                            onChange={(event) => setDealerDrafts((drafts) => ({ ...drafts, [session.id]: event.target.value }))}
                            placeholder="Dealer name"
                          />
                          <datalist id={`dealer-options-${session.id}`}>
                            {state.settings.staffAccounts.filter((staff) => staff.active).map((staff) => <option key={staff.id} value={staff.name} />)}
                          </datalist>
                        </label>
                        <div className="table-tracking-actions">
                          <button className="secondary-button" onClick={() => assignDealer(session)}>Start dealer down</button>
                          {currentDealer ? <button className="ghost-button" onClick={() => endDealerAssignment(session)}>End {currentDealer.dealerName}</button> : null}
                        </div>
                        <label>
                          Hands since last count
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={handCountDrafts[session.id] ?? ''}
                            onChange={(event) => setHandCountDrafts((drafts) => ({ ...drafts, [session.id]: event.target.value }))}
                            placeholder="Example: 15"
                          />
                        </label>
                        <div className="table-tracking-actions">
                          <button className="secondary-button" onClick={() => recordHands(session)}>Record hands</button>
                          <span className="muted-copy">{tableHandsTotal} total logged</span>
                        </div>
                        <label>
                          Break reason
                          <select
                            value={eventDrafts[session.id]?.breakReason ?? tableBreakReasons[0]}
                            onChange={(event) =>
                              setEventDrafts((drafts) => ({
                                ...drafts,
                                [session.id]: {
                                  failReason: drafts[session.id]?.failReason ?? failedStartReasons[0],
                                  failNote: drafts[session.id]?.failNote ?? '',
                                  breakReason: event.target.value,
                                  breakNote: drafts[session.id]?.breakNote ?? ''
                                }
                              }))
                            }
                          >
                            {tableBreakReasons.map((reason) => (
                              <option key={reason}>{reason}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Break note
                          <input
                            value={eventDrafts[session.id]?.breakNote ?? ''}
                            onChange={(event) =>
                              setEventDrafts((drafts) => ({
                                ...drafts,
                                [session.id]: {
                                  failReason: drafts[session.id]?.failReason ?? failedStartReasons[0],
                                  failNote: drafts[session.id]?.failNote ?? '',
                                  breakReason: drafts[session.id]?.breakReason ?? tableBreakReasons[0],
                                  breakNote: event.target.value
                                }
                              }))
                            }
                            placeholder="Optional"
                          />
                        </label>
                        {!isTimeCollection ? (
                          <>
                            <label>
                              Table drop
                              <input
                                value={dropDrafts[session.id]?.amount ?? ''}
                                onChange={(event) =>
                                  setDropDrafts((drafts) => ({
                                    ...drafts,
                                    [session.id]: { amount: event.target.value, note: drafts[session.id]?.note ?? '' }
                                  }))
                                }
                                placeholder="Amount removed"
                                type="number"
                                min="0"
                                step="1"
                              />
                            </label>
                            <label>
                              Drop note
                              <input
                                value={dropDrafts[session.id]?.note ?? ''}
                                onChange={(event) =>
                                  setDropDrafts((drafts) => ({
                                    ...drafts,
                                    [session.id]: { amount: drafts[session.id]?.amount ?? '', note: event.target.value }
                                  }))
                                }
                                placeholder="Down, dealer, or note"
                              />
                            </label>
                            <button className="secondary-button" onClick={() => addTableDrop(session)}>
                              Record Drop
                            </button>
                            <span className="muted-copy">Recorded drop: ${tableDropTotal.toLocaleString()}</span>
                          </>
                        ) : null}
                      </div>
                    </details>
                  </article>
                );
              })
            ) : (
              <p className="muted-copy">No active tables.</p>
            )}
          </div> : null}
        </section>
        </div>

        <div className="dashboard-side-column">
        <section className={`panel floor-panel table-overview-panel ${openPanels.tableOverview ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<Clock />}
            title="Time Overview"
            collapsed={!openPanels.tableOverview}
            onToggle={() => togglePanel('tableOverview')}
          />
          {openPanels.tableOverview ? (() => {
            const allTimeOverviewId = 'all-time-overview';
            const openSessions = state.sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start');
            const isAllTimeOverview = overviewTableId === allTimeOverviewId;
            const openSessionsById = new Map(openSessions.map((session) => [session.id, session]));
            const selectedTable = openSessions.find((session) => session.id === overviewTableId) ?? openSessions[0];
            const selectedPlayers = selectedTable
              ? state.playerSessions
                  .filter((playerSession) => playerSession.tableId === selectedTable.id && !playerSession.leftAt)
                  .map((playerSession) => ({
                    playerSession,
                    isTimeCollection: Boolean(selectedTable.collectionMode === 'Time' || selectedTable.timeFeeBased || playerSession.timeFeeEnabled),
                    remainingSeconds: getTimeRemainingSeconds(playerSession, clockNow)
                  }))
                  .sort((left, right) => {
                    if (left.isTimeCollection !== right.isTimeCollection) return left.isTimeCollection ? -1 : 1;
                    if (left.isTimeCollection && right.isTimeCollection) return left.remainingSeconds - right.remainingSeconds;
                    return left.playerSession.playerName.localeCompare(right.playerSession.playerName);
                  })
              : [];
            const allTimePlayers = state.playerSessions
              .filter((playerSession) => !playerSession.leftAt && openSessionsById.has(playerSession.tableId))
              .map((playerSession) => {
                const table = openSessionsById.get(playerSession.tableId);
                const isTimeCollection = Boolean(table && (table.collectionMode === 'Time' || table.timeFeeBased || playerSession.timeFeeEnabled));
                const remainingSeconds = getTimeRemainingSeconds(playerSession, clockNow);
                return { playerSession, table, isTimeCollection, remainingSeconds };
              })
              .sort((left, right) => {
                if (left.isTimeCollection !== right.isTimeCollection) return left.isTimeCollection ? -1 : 1;
                if (left.isTimeCollection && right.isTimeCollection) return left.remainingSeconds - right.remainingSeconds;
                return minutesSince(right.playerSession.seatedAt) - minutesSince(left.playerSession.seatedAt);
              });
            return (
              <div className="table-overview-content">
                {openSessions.length ? (
                  <>
                    <select value={isAllTimeOverview ? allTimeOverviewId : selectedTable?.id ?? ''} onChange={(event) => setOverviewTableId(event.target.value)}>
                      <option value={allTimeOverviewId}>All Players - Time Left</option>
                      {openSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.label} - {state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown'}
                        </option>
                      ))}
                    </select>
                    <div className="overview-player-list">
                      {isAllTimeOverview ? (
                        allTimePlayers.length ? (
                          allTimePlayers.map(({ playerSession, table, isTimeCollection, remainingSeconds }) => {
                            const timeStatus = isTimeCollection ? getTimerStatusFromSeconds(remainingSeconds) : 'off';
                            return (
                              <div className="overview-player-row all-time-row" key={playerSession.id}>
                                <span>{table?.label ?? 'Table'} - Seat {playerSession.seatNumber ?? '-'}</span>
                                <strong title={playerSession.playerName}>{playerSession.playerName}</strong>
                                <small title={state.games.find((game) => game.id === playerSession.gameId)?.name ?? 'Unknown'}>{state.games.find((game) => game.id === playerSession.gameId)?.name ?? 'Unknown'}</small>
                                <em className={`time-left-pill ${timeStatus}`}>
                                  {isTimeCollection ? formatTimeLeft(remainingSeconds) : 'No timer'}
                                </em>
                              </div>
                            );
                          })
                        ) : (
                          <p className="muted-copy">No seated players on open tables.</p>
                        )
                      ) : selectedPlayers.length ? (
                        selectedPlayers.map(({ playerSession, isTimeCollection, remainingSeconds }) => {
                          const timeStatus = isTimeCollection ? getTimerStatusFromSeconds(remainingSeconds) : 'off';
                          return (
                            <div className="overview-player-row" key={playerSession.id}>
                              <span>Seat {playerSession.seatNumber ?? '-'}</span>
                              <strong title={playerSession.playerName}>{playerSession.playerName}</strong>
                              <em className={`time-left-pill ${timeStatus}`}>
                                {isTimeCollection ? formatTimeLeft(remainingSeconds) : 'No timer'}
                              </em>
                            </div>
                          );
                        })
                      ) : (
                        <p className="muted-copy">No seated players on this table.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="muted-copy">No open tables to summarize.</p>
                )}
              </div>
            );
          })() : null}
        </section>

        <section className={`panel floor-panel table-financial-overview-panel ${openPanels.tableFinancials ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<WalletCards />}
            title="Table Overview"
            collapsed={!openPanels.tableFinancials}
            onToggle={() => togglePanel('tableFinancials')}
          />
          {openPanels.tableFinancials ? (() => {
            const allTableFinancialsId = 'all-table-financials';
            const openSessions = state.sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start');
            const selectedTable = openSessions.find((session) => session.id === financialOverviewTableId);
            const isAllTables = financialOverviewTableId === allTableFinancialsId || !selectedTable;
            const sessionsToShow: GameSession[] = isAllTables || !selectedTable ? openSessions : [selectedTable];
            return openSessions.length ? (
              <div className="table-financial-content">
                <select
                  className="table-financial-selector"
                  value={isAllTables ? allTableFinancialsId : selectedTable?.id ?? allTableFinancialsId}
                  onChange={(event) => setFinancialOverviewTableId(event.target.value)}
                  aria-label="Choose table financial overview"
                >
                  <option value={allTableFinancialsId}>All Tables - Financial Overview</option>
                  {openSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.label} - {state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown'}
                    </option>
                  ))}
                </select>
                <div className="table-financial-list">
                {sessionsToShow.map((session) => {
                  const game = state.games.find((entry) => entry.id === session.gameId);
                  const currentDealer = state.dealerAssignments
                    .filter((assignment) => assignment.tableId === session.id && !assignment.endedAt)
                    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
                  const tablePlayers = getActivePlayerSessionsForTable(state, session.id)
                    .sort((left, right) => (left.seatNumber ?? Number.MAX_SAFE_INTEGER) - (right.seatNumber ?? Number.MAX_SAFE_INTEGER));
                  const seatedCount = tablePlayers.length;
                  const financials = getTableFinancialOverview(state, session);
                  const currency = (amount: number) =>
                    `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                  return (
                    <article className="table-financial-card" key={session.id}>
                      <div className="table-financial-head">
                        <div>
                          <strong>{session.label}</strong>
                          <span>{game?.name ?? 'Unknown game'} · {session.collectionMode ?? (session.timeFeeBased ? 'Time' : 'Drop')}</span>
                        </div>
                        <em>{seatedCount}/{session.maxSeats} seated</em>
                      </div>
                      <div className="table-financial-metrics">
                        <div>
                          <span>Buy-ins</span>
                          <strong>{currency(financials.totalBuyIns)}</strong>
                        </div>
                        <div className="table-profit-metric">
                          <span>Table profit</span>
                          <strong>{currency(financials.tableProfit)}</strong>
                          <small>{currency(financials.totalDrop)} drop · {currency(financials.totalTimeFees)} time</small>
                        </div>
                        <div>
                          <span>Cash in play</span>
                          <strong>{currency(financials.cashInPlay)}</strong>
                        </div>
                      </div>
                      <div className="table-financial-footer">
                        <div>
                          <span>Current dealer</span>
                          <strong>{currentDealer?.dealerName ?? 'Unassigned'}</strong>
                        </div>
                        <div>
                          <span>Cash-outs</span>
                          <strong>{currency(financials.totalCashOuts)}</strong>
                        </div>
                      </div>
                      {!isAllTables ? (
                        <div className="table-player-financials">
                          <div className="table-player-financials-title">
                            <strong>Players at this table</strong>
                            <span>{tablePlayers.length} currently seated</span>
                          </div>
                          {tablePlayers.length ? (
                            <div className="table-player-financial-list">
                              {tablePlayers.map((playerSession) => {
                                const playerFinancials = getTablePlayerFinancialOverview(state, session, playerSession);
                                return (
                                  <article className="table-player-financial-row" key={playerSession.id}>
                                    <div className="table-player-financial-head">
                                      <strong>{playerSession.playerName}</strong>
                                      <span>Seat {playerSession.seatNumber ?? '-'}</span>
                                    </div>
                                    <div className="table-player-financial-metrics">
                                      <div><span>Buy-ins</span><strong>{currency(playerFinancials.totalBuyIns)}</strong></div>
                                      <div><span>Cash-outs</span><strong>{currency(playerFinancials.totalCashOuts)}</strong></div>
                                      <div><span>Time paid</span><strong>{currency(playerFinancials.totalTimeFees)}</strong></div>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="muted-copy">No players are currently seated at this table.</p>
                          )}
                          <small className="table-player-financial-note">Recorded drop stays in the table total because it is not assigned to an individual player.</small>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                </div>
              </div>
            ) : (
              <p className="muted-copy">No open tables to summarize.</p>
            );
          })() : null}
        </section>

        <section className={`panel floor-panel live-feed-panel ${openPanels.recentActivity ? '' : 'collapsed-panel'}`}>
          <PanelTitle
            icon={<MessageCircle />}
            title="Recent Activity"
            collapsed={!openPanels.recentActivity}
            onToggle={() => togglePanel('recentActivity')}
          />
          {openPanels.recentActivity ? <div className="live-feed-list" aria-live="polite">
            {liveFeedItems.length ? (
              liveFeedItems.map((item) => (
                <article className={`live-feed-item ${item.kind}`} key={item.id}>
                  <div className="live-feed-dot" />
                  <div>
                    <div className="live-feed-head">
                      <strong>{item.actor}</strong>
                      <span>{formatClock(item.timestamp)}</span>
                    </div>
                    <p>{item.label}{item.detail ? ` - ${item.detail}` : ''}</p>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted-copy">Live floor events will appear here.</p>
            )}
          </div> : null}
        </section>

        <section className={`panel floor-panel shown-interest-panel ${openPanels.formingGames ? '' : 'collapsed-panel'}`}>
          <PanelTitle icon={<Users />} title="Forming Games" collapsed={!openPanels.formingGames} onToggle={() => togglePanel('formingGames')} />
          {openPanels.formingGames ? <div className="forming-list">
            {state.games.length ? (
              <label className="forming-game-menu">
                <span>Game to form</span>
                <select
                  value={state.games.some((game) => game.id === formingGameId) ? formingGameId : state.games[0].id}
                  onChange={(event) => setFormingGameId(event.target.value)}
                >
                  {state.games.map((game) => {
                    const demand = getDemand(game, state.interests);
                    const forming = state.sessions.some((session) => session.gameId === game.id && session.status === 'Forming');
                    return (
                      <option key={game.id} value={game.id}>
                        {game.name}{forming ? ', forming' : ''}{demand.inRoom ? `, ${demand.inRoom} in room` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
            {state.games
              .filter((game) => game.id === (state.games.some((item) => item.id === formingGameId) ? formingGameId : state.games[0]?.id))
              .map((game: GameConfig) => {
              const demand = getDemand(game, state.interests);
              const viability = getViabilityState(state, game);
              const formingSession = state.sessions.find((session) => session.gameId === game.id && session.status === 'Forming');
              const candidates = getParticipantPool(state, game.id, 3);
              const startOptions = getSeatOptions(game.id);
              const selectedForStart = formingSession ? (startPlayerDrafts[formingSession.id] ?? []) : [];
              return (
                <article className="forming-card" key={game.id}>
                  <div>
                    <strong>{game.name}</strong>
                    <span className={`status-pill ${viability.state === 'Ready to Start' || viability.state === 'Likely to Start' ? 'likely' : ''}`}>
                      {viability.state}
                    </span>
                  </div>
                  <p>{demand.inRoom} in / {demand.confirmed} coming / {demand.interested + demand.waiting} waiting</p>
                  <small>{viability.nextStep}</small>
                  {candidates.length ? <small>Likely: {candidates.map((candidate) => candidate.playerName).join(', ')}</small> : null}
                  <div className="inline-actions">
                    {formingSession ? (
                      <>
                        <button className="secondary-button" onClick={() => startSessionWithPlayers(formingSession)}>
                          Select + Start
                        </button>
                        <button className="ghost-button" onClick={() => failFormingGame(formingSession)}>
                          Failed
                        </button>
                      </>
                    ) : (
                      <button className="secondary-button" onClick={() => addSession(game.id)}>
                        Build Game
                      </button>
                    )}
                  </div>
                  {formingSession ? (
                    <details className="compact-details">
                      <summary>Players</summary>
                      <div className="player-picker-list">
                        {startOptions.length ? (
                          startOptions.slice(0, formingSession.maxSeats).map((interest) => (
                            <label className="player-pick-row" key={interest.id}>
                              <input
                                type="checkbox"
                                checked={selectedForStart.includes(interest.id)}
                                onChange={() => toggleStartPlayer(formingSession.id, interest.id)}
                              />
                              <span>{interest.playerName}</span>
                              <small>{interest.status}</small>
                            </label>
                          ))
                        ) : (
                          <span className="muted-copy">No players available.</span>
                        )}
                      </div>
                    </details>
                  ) : null}
                  {formingSession ? (
                    <details className="compact-details">
                      <summary>Failed start</summary>
                      <div className="correction-grid">
                      <label>
                        Failed reason
                        <select
                          value={eventDrafts[formingSession.id]?.failReason ?? failedStartReasons[0]}
                          onChange={(event) =>
                            setEventDrafts((drafts) => ({
                              ...drafts,
                              [formingSession.id]: {
                                failReason: event.target.value,
                                failNote: drafts[formingSession.id]?.failNote ?? '',
                                breakReason: drafts[formingSession.id]?.breakReason ?? tableBreakReasons[0],
                                breakNote: drafts[formingSession.id]?.breakNote ?? ''
                              }
                            }))
                          }
                        >
                          {failedStartReasons.map((reason) => (
                            <option key={reason}>{reason}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Failed note
                        <input
                          value={eventDrafts[formingSession.id]?.failNote ?? ''}
                          onChange={(event) =>
                            setEventDrafts((drafts) => ({
                              ...drafts,
                              [formingSession.id]: {
                                failReason: drafts[formingSession.id]?.failReason ?? failedStartReasons[0],
                                failNote: event.target.value,
                                breakReason: drafts[formingSession.id]?.breakReason ?? tableBreakReasons[0],
                                breakNote: drafts[formingSession.id]?.breakNote ?? ''
                              }
                            }))
                          }
                          placeholder="Optional"
                        />
                      </label>
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}
            {!state.games.length ? <p className="muted-copy">Add a game in Settings before forming a table.</p> : null}
          </div> : null}
        </section>

        <section className={`panel floor-panel recommended-panel ${openPanels.waitlist ? '' : 'collapsed-panel'}`}>
          <PanelTitle icon={<Target />} title="Waitlist" collapsed={!openPanels.waitlist} onToggle={() => togglePanel('waitlist')} />
          {openPanels.waitlist ? <div className="waitlist-list">
            {state.interests.filter((interest) => activeInterestStatuses.includes(interest.status)).length ? (
              state.interests
                .filter((interest) => activeInterestStatuses.includes(interest.status))
                .slice(0, 8)
                .map((interest: Interest) => {
                const game = state.games.find((item) => item.id === interest.gameId);
                return (
                  <article className="waitlist-card" key={interest.id}>
                    <div>
                      <strong>{interest.playerName}</strong>
                      <span>{game?.name ?? 'Unknown'} - {interest.status}</span>
                      <small>
                        Logged {formatClock(interest.interestedAt)} ({minutesSince(interest.interestedAt)}m)
                        {interest.manualEdits?.interestedAt ? <em className="edited-marker">edited</em> : null}
                      </small>
                      {interest.arrivedAt ? (
                        <small>
                          Arrived {formatClock(interest.arrivedAt)} ({minutesSince(interest.arrivedAt)}m)
                          {interest.manualEdits?.arrivedAt ? <em className="edited-marker">edited</em> : null}
                        </small>
                      ) : null}
                    </div>
                    <div className="lifecycle-actions">
                      <button className="ghost-button" onClick={() => deleteInterest(interest.id)}>Remove</button>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="muted-copy">No one is on the waitlist.</p>
            )}
          </div> : null}
        </section>

        {openPanels.quickAdd ? (
          <button
            className="quick-add-drawer-backdrop"
            type="button"
            aria-label="Close Quick Add"
            onClick={() => setOpenPanels((panels) => ({ ...panels, quickAdd: false }))}
          />
        ) : null}
        <section className={`panel floor-panel quick-add-panel ${openPanels.quickAdd ? '' : 'collapsed-panel'}`}>
          {openPanels.quickAdd ? (
            <button
              className="quick-add-drawer-close"
              type="button"
              aria-label="Close Quick Add"
              title="Close Quick Add"
              onClick={() => setOpenPanels((panels) => ({ ...panels, quickAdd: false }))}
            >
              <X size={19} />
            </button>
          ) : null}
          <PanelTitle icon={<Plus />} title="Quick Add" collapsed={!openPanels.quickAdd} onToggle={() => togglePanel('quickAdd')} />
          {openPanels.quickAdd ? <>
          <form className="quick-form" onSubmit={addInterest}>
            <input
              value={form.playerName}
              onChange={(event) => setForm({ ...form, playerName: event.target.value })}
              placeholder="Player name"
            />
            <select value={form.gameId} onChange={(event) => setForm({ ...form, gameId: event.target.value, tableId: '', seatNumber: '' })}>
              {state.games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
            <select
              id="quick-add-status"
              value={form.status}
              onChange={(event) =>
                setForm({
                  ...form,
                  status: event.target.value as InterestStatus,
                  tableId: event.target.value === 'Seated' ? form.tableId : '',
                  seatNumber: event.target.value === 'Seated' ? form.seatNumber : '',
                  initialBuyIn: event.target.value === 'Seated' ? form.initialBuyIn : ''
                })
              }
            >
              {statuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
            {form.status === 'Seated' ? (
              <>
                <select value={form.tableId} onChange={(event) => setForm({ ...form, tableId: event.target.value, seatNumber: '' })}>
                  <option value="">
                    {quickAddOpenSeatSessions.length > 1 ? 'Choose table' : 'Auto table'}
                  </option>
                  {quickAddOpenSeatSessions.map((session) => {
                    const game = state.games.find((item) => item.id === session.gameId);
                    const openSeatCount = session.maxSeats - getActivePlayerSessionsForTable(state, session.id).length;
                    return (
                      <option key={session.id} value={session.id}>
                        {session.label} - {game?.name ?? 'Table'} ({openSeatCount} open)
                      </option>
                    );
                  })}
                </select>
                <input
                  value={form.seatNumber}
                  onChange={(event) => setForm({ ...form, seatNumber: event.target.value })}
                  placeholder="Seat #"
                  type="number"
                  min="1"
                  step="1"
                />
                <input
                  value={form.initialBuyIn}
                  onChange={(event) => setForm({ ...form, initialBuyIn: event.target.value })}
                  placeholder="Initial buy-in $"
                  type="number"
                  min="0"
                  step="1"
                />
              </>
            ) : null}
            <input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Notes"
            />
            <button className="primary-button">
              <Plus size={18} />
              Add
            </button>
          </form>
          <div className="check-in-search">
            <input
              value={checkInSearch}
              onChange={(event) => setCheckInSearch(event.target.value)}
              placeholder="Search first or last name"
            />
            <p className="check-in-help">Choose a member, then use the game and status options above.</p>
            <div className="check-in-results">
              {checkInMatches.length ? (
                checkInMatches.map((profile) => {
                  const preferredGame = state.games.find((game) => game.id === profile.preferredGameId)?.name ?? profile.preferredStakes;
                  const inClub = hasProfileReference(inClubInterests, state.profiles, profile);
                  return (
                    <button className="check-in-result" type="button" key={profile.id} onClick={() => checkInProfileFromSearch(profile)}>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{preferredGame || 'No preferred game'}</small>
                      </span>
                      <em>{inClub ? 'Edit status' : 'Choose'}</em>
                    </button>
                  );
                })
              ) : (
                <p className="muted-copy">No matching players.</p>
              )}
            </div>
          </div>
          </> : null}
        </section>
        </div>

      </section>
    </main>
  );
}
