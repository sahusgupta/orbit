import * as Dialog from '@radix-ui/react-dialog';
import { Activity, Clock, Maximize2, Minimize2, Plus, WalletCards, X } from 'lucide-react';
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import PokerTable, {
  type Player as PokerTablePlayer,
  type PokerTableDealerControl,
  type PokerTableRevenueEstimate
} from './PokerTable';
import type { BuyInLog, GameConfig, GameSession, PlayerSession } from '../domain/types';
import type { SeatPickerState } from '../features/floor/floorWorkspace';

type TableActivity = { id: string; timestamp: string; type: string; text: string };
type TableBuyInRow = { entry: BuyInLog; seatNumber: number | undefined };
type TableTimePlayer = {
  playerSession: PlayerSession;
  remainingSeconds: number;
  elapsedSeconds: number;
  hasTimer: boolean;
};

type TableViewProps = {
  tableGame: GameConfig | undefined;
  tableSession: GameSession | undefined;
  seatedPlayers: PlayerSession[];
  tableAverageStack: number;
  isTimeCollection: boolean;
  seatPickerModal: ReactNode;
  cashOutModal: ReactNode;
  tableLedgerModal: ReactNode;
  tableActivity: TableActivity[];
  tableBuyInRows: TableBuyInRow[];
  tableTimePlayers: TableTimePlayer[];
  pokerTablePlayers: PokerTablePlayer[];
  tableRevenueEstimate?: PokerTableRevenueEstimate;
  tableDealerControl?: PokerTableDealerControl;
  tableEventLogSessionId: string | null;
  seatPicker: SeatPickerState | null;
  closeRoute: () => void;
  formatClock: (iso?: string) => string;
  formatTimeLeft: (seconds: number) => string;
  getTimerStatusFromSeconds: (seconds: number) => string;
  getMoveTargets: (sourceTableId: string) => { id: string; label: string; openSeats: number }[];
  openSeatPicker: (session: GameSession, requestedSeatNumber?: number) => void;
  addPlayerTime: (playerSession: PlayerSession, minutes: number) => void;
  addBuyIn: (playerSession: PlayerSession, amountOverride?: number, noteOverride?: string) => void;
  requestPlayerCashOut: (playerSession: PlayerSession) => void;
  changePlayerSeat: (playerSession: PlayerSession, seatNumber: number) => void;
  movePlayerToTable: (playerSession: PlayerSession, targetTableId: string) => void;
  setTableEventLogSessionId: Dispatch<SetStateAction<string | null>>;
  setTableLedgerSessionId: Dispatch<SetStateAction<string | null>>;
};

const eventTypeClass = (type: string) => type.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default function TableView({
  tableGame,
  tableSession,
  seatedPlayers,
  tableAverageStack,
  isTimeCollection,
  seatPickerModal,
  cashOutModal,
  tableLedgerModal,
  tableActivity,
  tableBuyInRows,
  tableTimePlayers,
  pokerTablePlayers,
  tableRevenueEstimate,
  tableDealerControl,
  tableEventLogSessionId,
  seatPicker,
  closeRoute,
  formatClock,
  formatTimeLeft,
  getTimerStatusFromSeconds,
  getMoveTargets,
  openSeatPicker,
  addPlayerTime,
  addBuyIn,
  requestPlayerCashOut,
  changePlayerSeat,
  movePlayerToTable,
  setTableEventLogSessionId,
  setTableLedgerSessionId
}: TableViewProps) {
  const [timeDrawerOpen, setTimeDrawerOpen] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const tableBuyInTotal = tableBuyInRows.reduce((sum, row) => sum + row.entry.amount, 0);
  const timedPlayers = tableTimePlayers.filter((item) => item.hasTimer);
  const urgentTimerCount = timedPlayers.filter(
    (item) => getTimerStatusFromSeconds(item.remainingSeconds) === 'red'
  ).length;
  const approachingTimerCount = timedPlayers.filter(
    (item) => getTimerStatusFromSeconds(item.remainingSeconds) === 'yellow'
  ).length;
  const timeUtilityLabel = isTimeCollection ? 'Timers' : 'Sessions';
  const timeUtilitySummary = urgentTimerCount
    ? `${urgentTimerCount} due`
    : approachingTimerCount
      ? `${approachingTimerCount} soon`
      : String(isTimeCollection ? timedPlayers.length : tableTimePlayers.length);
  const activityOpen = Boolean(tableSession && tableEventLogSessionId === tableSession.id);

  return (
    <main className="table-view-shell">
      <header className="table-view-topbar">
        <button aria-label="Back to floor" className="icon-button" onClick={closeRoute} title="Back to floor">
          <X size={18} />
        </button>
        <div className="table-view-identity">
          <span>{tableGame?.name ?? 'Table View'}</span>
          <div>
            <h1>{tableSession?.label ?? 'No Open Table'}</h1>
            {tableSession ? (
              <div className="table-view-meta" aria-label="Current table status">
                <span className={`table-view-status status-${eventTypeClass(tableSession.status)}`}><i />{tableSession.status}</span>
                <span className="table-view-occupancy"><strong>{seatedPlayers.length}/{tableSession.maxSeats}</strong> seated</span>
                <span className="table-view-mode"><Clock size={13} /><strong>{isTimeCollection ? 'Time' : 'Drop'}</strong></span>
              </div>
            ) : null}
          </div>
        </div>

        {tableSession ? (
          <div className="table-view-utilities" aria-label="Table utilities" role="group">
            <button
              className="table-view-seat-player-button"
              onClick={() => openSeatPicker(tableSession)}
              type="button"
            >
              <Plus size={16} />
              <span>Seat player</span>
            </button>

            <Dialog.Root
              open={activityOpen}
              onOpenChange={(open) => {
                setTableEventLogSessionId(open ? tableSession.id : null);
                if (!open) setActivityExpanded(false);
              }}
            >
              <Dialog.Trigger asChild>
                <button
                  aria-label={`Activity, ${tableActivity.length} ${tableActivity.length === 1 ? 'event' : 'events'}`}
                  className="table-view-utility-button"
                  type="button"
                >
                  <Activity size={16} />
                  <span>Activity</span>
                  <strong>{tableActivity.length}</strong>
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="table-utility-overlay" />
                <Dialog.Content className={`table-utility-drawer table-activity-drawer ${activityExpanded ? 'is-expanded' : ''}`}>
                  <div className="table-utility-drawer-head">
                    <div>
                      <span>Table activity</span>
                      <Dialog.Title className="table-utility-title">{tableSession.label}</Dialog.Title>
                      <Dialog.Description className="sr-only">
                        {tableActivity.length} {tableActivity.length === 1 ? 'event' : 'events'} recorded for this table.
                      </Dialog.Description>
                    </div>
                    <div className="table-utility-drawer-actions">
                      <button
                        aria-label={activityExpanded ? 'Restore compact table activity' : 'Expand table activity'}
                        aria-pressed={activityExpanded}
                        className="icon-button"
                        onClick={() => setActivityExpanded((expanded) => !expanded)}
                        title={activityExpanded ? 'Restore compact activity' : 'Expand activity'}
                        type="button"
                      >
                        {activityExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                      </button>
                      <Dialog.Close asChild>
                        <button aria-label="Close table activity" className="icon-button" title="Close table activity" type="button">
                          <X size={18} />
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>
                  <div
                    aria-label={`${tableSession.label} activity`}
                    className="table-utility-list table-activity-list"
                    role="region"
                    tabIndex={0}
                  >
                    {tableActivity.length ? tableActivity.map((entry) => (
                      <article key={entry.id}>
                        <i className={eventTypeClass(entry.type)} />
                        <div>
                          <strong>{entry.type}</strong>
                          <span>{entry.text}</span>
                        </div>
                        <time>{formatClock(entry.timestamp)}</time>
                      </article>
                    )) : <p className="table-utility-empty">No table activity recorded yet.</p>}
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>

            <button
              aria-label={`Ledger, ${tableBuyInRows.length} ${tableBuyInRows.length === 1 ? 'buy-in' : 'buy-ins'}`}
              className="table-view-utility-button"
              onClick={() => setTableLedgerSessionId(tableSession.id)}
              type="button"
            >
              <WalletCards size={16} />
              <span>Ledger</span>
              <strong>{tableBuyInRows.length}</strong>
            </button>

            <Dialog.Root open={timeDrawerOpen} onOpenChange={setTimeDrawerOpen}>
              <Dialog.Trigger asChild>
                <button
                  aria-label={`${timeUtilityLabel}, ${timeUtilitySummary}`}
                  className={`table-view-utility-button ${urgentTimerCount ? 'requires-action' : approachingTimerCount ? 'approaching-action' : ''}`}
                  type="button"
                >
                  <Clock size={16} />
                  <span>{timeUtilityLabel}</span>
                  <strong>{timeUtilitySummary}</strong>
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="table-utility-overlay" />
                <Dialog.Content className="table-utility-drawer table-time-drawer">
                  <div className="table-utility-drawer-head">
                    <div>
                      <span>{isTimeCollection ? 'Time collection' : 'At-table duration'}</span>
                      <Dialog.Title className="table-utility-title">{timeUtilityLabel}</Dialog.Title>
                      <Dialog.Description className="table-utility-description">
                        {isTimeCollection
                          ? `Countdowns for ${tableSession.label}.`
                          : `At-table duration and active countdowns for ${tableSession.label}.`}
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button aria-label={`Close ${timeUtilityLabel.toLowerCase()}`} className="icon-button" title={`Close ${timeUtilityLabel.toLowerCase()}`}>
                        <X size={18} />
                      </button>
                    </Dialog.Close>
                  </div>
                  <div
                    aria-label={`${tableSession.label} ${timeUtilityLabel.toLowerCase()}`}
                    className="table-utility-list table-time-list"
                    role="region"
                    tabIndex={0}
                  >
                    {tableTimePlayers.length ? tableTimePlayers.map(({ playerSession, remainingSeconds, elapsedSeconds, hasTimer }) => {
                      const timerStatus = hasTimer ? getTimerStatusFromSeconds(remainingSeconds) : isTimeCollection ? 'off' : 'neutral';
                      const isExpired = hasTimer && remainingSeconds <= 0;
                      const displayTime = hasTimer
                        ? formatTimeLeft(remainingSeconds)
                        : isTimeCollection
                          ? 'No timer'
                          : formatTimeLeft(elapsedSeconds);
                      const statusText = isExpired
                        ? 'Expired'
                        : timerStatus === 'red'
                        ? 'Needs attention'
                        : timerStatus === 'yellow'
                          ? 'Approaching'
                          : timerStatus === 'green'
                            ? 'On track'
                            : timerStatus === 'off'
                              ? 'Timer off'
                              : 'At table';

                      return (
                        <article className={`${timerStatus} ${isExpired ? 'expired' : ''}`} key={playerSession.id}>
                          <div>
                            <span>Seat {playerSession.seatNumber ?? '-'}</span>
                            <strong>{playerSession.playerName}</strong>
                            <small>{statusText}</small>
                          </div>
                          <div className="table-time-row-controls">
                            <em aria-label={`${displayTime}, ${statusText.toLowerCase()}`}>{displayTime}</em>
                            {isExpired ? (
                              <div className="table-time-expired-actions" role="group" aria-label={`Add time for ${playerSession.playerName}`}>
                                <button
                                  aria-label={`Add 30 minutes to ${playerSession.playerName}`}
                                  onClick={() => addPlayerTime(playerSession, 30)}
                                  type="button"
                                >
                                  +30 min
                                </button>
                                <button
                                  aria-label={`Add 60 minutes to ${playerSession.playerName}`}
                                  onClick={() => addPlayerTime(playerSession, 60)}
                                  type="button"
                                >
                                  +60 min
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    }) : <p className="table-utility-empty">No players are seated at this table.</p>}
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        ) : null}
      </header>

      {seatPickerModal}
      {cashOutModal}
      {tableLedgerModal}

      {tableSession ? (
        <section className="table-view-grid">
          <section className="table-view-stage">
            <div className="table-view-table">
              <div className="table-view-poker-table">
                <PokerTable
                  players={pokerTablePlayers}
                  showTimeRemaining={isTimeCollection}
                  maxPlayers={tableSession.maxSeats}
                  selectedSeatNumber={seatPicker?.sessionId === tableSession.id ? seatPicker.seatNumber : undefined}
                  moveTargets={getMoveTargets(tableSession.id)}
                  revenueEstimate={tableRevenueEstimate}
                  dealerControl={tableDealerControl}
                  onSeatClick={(seatNumber) =>
                    openSeatPicker(tableSession, seatNumber)
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
            </div>
            <footer className="table-view-statusbar" aria-label="Table summary">
              <span>Open seats <strong>{Math.max(0, tableSession.maxSeats - seatedPlayers.length)}</strong></span>
              <span>Average stack <strong>${tableAverageStack.toLocaleString()}</strong></span>
              <span>Total buy-ins <strong>${tableBuyInTotal.toLocaleString()}</strong></span>
              <span>Started <strong>{formatClock(tableSession.startedAt)}</strong></span>
            </footer>
          </section>
        </section>
      ) : (
        <section className="table-view-empty">
          <h2>No open tables</h2>
          <p>Create or run a table from the floor to use Table View.</p>
          <button className="ghost-button" onClick={closeRoute}>Back to floor</button>
        </section>
      )}
    </main>
  );
}
