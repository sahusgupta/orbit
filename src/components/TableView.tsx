import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Clock, WalletCards, X } from 'lucide-react';
import PokerTable, { type Player as PokerTablePlayer } from './PokerTable';
import type { BuyInLog, GameConfig, GameSession, PlayerSession } from '../domain/types';
import type { SeatPickerState } from '../features/floor/floorWorkspace';

type TableActivity = { id: string; timestamp: string; type: string; text: string };
type TableBuyInRow = { entry: BuyInLog; seatNumber: number | undefined };
type TableTimePlayer = { playerSession: PlayerSession; remainingSeconds: number; hasTimer: boolean };

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
  return (
      <main className="table-view-shell">
        <header className="table-view-topbar">
          <button className="icon-button" onClick={closeRoute} title="Back to floor">
            <X size={18} />
          </button>
          <div>
            <span>{tableGame?.name ?? 'Table View'}</span>
            <h1>{tableSession?.label ?? 'No Open Table'}</h1>
          </div>
          {tableSession ? (
            <div className="table-view-stats">
              <span>{tableSession.status}</span>
              <strong>{seatedPlayers.length}/{tableSession.maxSeats}</strong>
              <em>Avg ${tableAverageStack.toLocaleString()}</em>
              <em>{isTimeCollection ? 'Time' : 'Drop'}</em>
              <button className="ghost-button" onClick={() => setTableLedgerSessionId(tableSession.id)}><WalletCards size={17} /> Ledger</button>
            </div>
          ) : null}
        </header>
        {seatPickerModal}
        {cashOutModal}
        {tableLedgerModal}
        {tableSession ? <button className="table-live-feed-overlay" onClick={() => setTableEventLogSessionId(tableSession.id)}>
          <span className="table-live-feed-title"><i /> Live feed <em>View full log →</em></span>
          <span className="table-live-feed-items">
            {tableActivity.length ? tableActivity.slice(0, 3).map((entry) => <span key={entry.id}><i className={entry.type.toLowerCase().replace(/\s+/g, '-')} /><span><strong>{entry.type}</strong>{entry.text}</span><time>{formatClock(entry.timestamp)}</time></span>) : <small>Awaiting table activity…</small>}
          </span>
        </button> : null}
        {tableSession ? <button className="table-buyin-float" onClick={() => setTableLedgerSessionId(tableSession.id)}>
          <span className="table-buyin-float-title"><WalletCards size={12} /> Buy-in ledger</span>
          <span className="table-buyin-float-rows">
            {tableBuyInRows.length ? tableBuyInRows.map(({ entry, seatNumber }) => <span key={entry.id}><i>S{seatNumber ?? '-'}</i><span>{entry.playerName}<small>{formatClock(entry.timestamp)}</small></span><em>Buy-in</em><strong>+${entry.amount.toLocaleString()}</strong></span>) : <small>No buy-ins recorded</small>}
          </span>
          <span className="table-buyin-float-total"><span>Total buy-ins</span><strong>${tableBuyInRows.reduce((sum, row) => sum + row.entry.amount, 0).toLocaleString()}</strong></span>
        </button> : null}
        {tableSession && tableEventLogSessionId === tableSession.id ? <div className="modal-backdrop table-event-log-backdrop" role="dialog" aria-modal="true" aria-label={`${tableSession.label} event log`}>
          <section className="table-event-log-modal">
            <div className="table-event-log-head"><div><span>Table event log</span><h2>{tableSession.label}</h2></div><button className="icon-button" onClick={() => setTableEventLogSessionId(null)}><X size={18} /></button></div>
            <div className="table-event-log-list">{tableActivity.length ? tableActivity.map((entry) => <article key={entry.id}><i className={entry.type.toLowerCase().replace(/\s+/g, '-')} /><div><strong>{entry.type}</strong><span>{entry.text}</span></div><time>{formatClock(entry.timestamp)}</time></article>) : <p className="muted-copy">No table activity recorded yet.</p>}</div>
          </section>
        </div> : null}

        {tableSession ? (
          <section className="table-view-grid">
            <section className="table-view-stage">
              <div className="table-view-stage-head">
                <p>Click any open seat and choose a player from the club database.</p>
                <button
                  className="ghost-button"
                  onClick={() => {
                    openSeatPicker(tableSession);
                  }}
                >
                  Next seat
                </button>
              </div>
              <div className="table-view-table">
                <div className="table-view-poker-table">
                  <PokerTable
                    players={pokerTablePlayers}
                    showTimeRemaining={isTimeCollection}
                    maxPlayers={tableSession.maxSeats}
                    selectedSeatNumber={seatPicker?.sessionId === tableSession.id ? seatPicker.seatNumber : undefined}
                    moveTargets={getMoveTargets(tableSession.id)}
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
            </section>

            <aside className="table-view-time-overview" aria-label="Table time overview">
              <div className="table-view-panel-title">
                <span><Clock size={13} /> Time overview</span>
                <strong>{tableTimePlayers.filter((item) => item.hasTimer).length}</strong>
              </div>
              <div className="table-view-time-list">
                {tableTimePlayers.length ? (
                  tableTimePlayers.map(({ playerSession, remainingSeconds, hasTimer }) => {
                    const timeStatus = hasTimer ? getTimerStatusFromSeconds(remainingSeconds) : 'off';
                    return <article key={playerSession.id}>
                      <div>
                        <span>Seat {playerSession.seatNumber ?? '-'}</span>
                        <strong>{playerSession.playerName}</strong>
                      </div>
                      <em className={`time-left-pill ${timeStatus}`}>{hasTimer ? formatTimeLeft(remainingSeconds) : 'No timer'}</em>
                    </article>;
                  })
                ) : (
                  <p className="muted-copy">No players are seated at this table.</p>
                )}
              </div>
            </aside>
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
