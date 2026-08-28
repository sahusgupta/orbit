import { useEffect, useId, useRef, useState } from 'react';
import { DollarSign, Minus, Pause, Play, Plus, X } from 'lucide-react';
import { getTimerStatusFromSeconds } from '../lib/appCore';

/**
 * Player data structure for the poker table
 */
export interface Player {
  id: string;
  name: string;
  seatNumber?: number;
  membershipId: string;
  joinedAt: number; // Unix timestamp in milliseconds when player joined
  hourlyTimeLimit?: number; // Time limit in minutes before requiring another purchase
  timeRemainingSeconds?: number;
  savedTimeCreditMinutes?: number;
  tonightHours?: string;
  totalHours?: string;
  buyInTotal?: number;
  recentBuyIns?: { id: string; label: string }[];
}

export type PokerTableRevenueEstimate = {
  label: string;
  value: string;
};

export type PokerTableDealerControl = {
  currentDealer?: string;
  value: string;
  options: readonly string[];
  onChange: (dealerName: string) => void;
  onAssign: () => void;
  onEnd?: () => void;
};

/**
 * Props for the PokerTable component
 */
export interface PokerTableProps {
  players: Player[];
  showTimeRemaining?: boolean;
  maxPlayers?: number;
  selectedSeatNumber?: number;
  onSeatClick?: (seatNumber: number) => void;
  onAddTime?: (playerId: string, minutes: number) => void;
  onDeductTime?: (playerId: string, minutes: number) => boolean | void;
  onPauseAndSaveTime?: (playerId: string) => boolean | void;
  onUseSavedTime?: (playerId: string, minutes: number) => boolean | void;
  onAddBuyIn?: (playerId: string, amount: number, note: string) => void;
  onRemovePlayer?: (playerId: string) => void;
  onChangeSeat?: (playerId: string, seatNumber: number) => void;
  moveTargets?: { id: string; label: string; openSeats: number }[];
  onMovePlayer?: (playerId: string, targetTableId: string) => void;
  revenueEstimate?: PokerTableRevenueEstimate;
  dealerControl?: PokerTableDealerControl;
}

interface PlayerCardProps {
  player: Player;
  position: number;
  totalPositions: number;
  showTimeRemaining: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  isDragging: boolean;
  onDragStart: (playerId: string) => void;
  onDragEnd: () => void;
  onAddTime?: (playerId: string, minutes: number) => void;
  onDeductTime?: (playerId: string, minutes: number) => boolean | void;
  onPauseAndSaveTime?: (playerId: string) => boolean | void;
  onUseSavedTime?: (playerId: string, minutes: number) => boolean | void;
  onAddBuyIn?: (playerId: string, amount: number, note: string) => void;
  onRemovePlayer?: (playerId: string) => void;
  onChangeSeat?: (playerId: string, seatNumber: number) => void;
  seatOptions: number[];
  moveTargets?: { id: string; label: string; openSeats: number }[];
  onMovePlayer?: (playerId: string, targetTableId: string) => void;
}

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

type PlayerAction = 'time' | 'deduct-time' | 'buy-in' | null;

function PlayerCard({
  player,
  position,
  totalPositions,
  showTimeRemaining,
  isOpen,
  onToggle,
  onClose,
  isDragging,
  onDragStart,
  onDragEnd,
  onAddTime,
  onDeductTime,
  onPauseAndSaveTime,
  onUseSavedTime,
  onAddBuyIn,
  onRemovePlayer,
  onChangeSeat,
  seatOptions,
  moveTargets = [],
  onMovePlayer
}: PlayerCardProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [customMinutes, setCustomMinutes] = useState('');
  const [customDeductMinutes, setCustomDeductMinutes] = useState('');
  const [buyInAmount, setBuyInAmount] = useState('');
  const [buyInNote, setBuyInNote] = useState('');
  const [activeAction, setActiveAction] = useState<PlayerAction>(null);
  const [actionMessage, setActionMessage] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const suppressClickRef = useRef(false);
  const menuId = useId();
  const menuHeadingId = `${menuId}-heading`;
  const timerDescriptionId = `${menuId}-timer`;
  const positionHeadingId = `${menuId}-position-heading`;
  const actionsHeadingId = `${menuId}-actions-heading`;
  const timePanelId = `${menuId}-time-panel`;
  const deductTimePanelId = `${menuId}-deduct-time-panel`;
  const buyInPanelId = `${menuId}-buy-in-panel`;
  const customMinutesId = `${menuId}-custom-minutes`;
  const customDeductMinutesId = `${menuId}-custom-deduct-minutes`;
  const buyInAmountId = `${menuId}-buy-in-amount`;
  const buyInNoteId = `${menuId}-buy-in-note`;

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !cardRef.current?.contains(event.target)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) return;
    setActiveAction(null);
    setCustomMinutes('');
    setCustomDeductMinutes('');
    setBuyInAmount('');
    setBuyInNote('');
    setActionMessage('');
  }, [isOpen]);

  const totalSecondsAtTable = Math.max(0, Math.floor((currentTime - player.joinedAt) / 1000));
  const timeAtTableDisplay = formatDuration(totalSecondsAtTable);
  const timeRemainingSeconds = player.timeRemainingSeconds ?? (
    player.hourlyTimeLimit
      ? Math.max(0, player.hourlyTimeLimit * 60 - (totalSecondsAtTable % (player.hourlyTimeLimit * 60)))
      : 0
  );
  const timeRemainingDisplay = formatDuration(timeRemainingSeconds);
  const timerStatus = getTimerStatusFromSeconds(timeRemainingSeconds);
  const timerStatusLabel = timerStatus === 'red'
    ? 'needs attention'
    : timerStatus === 'yellow'
      ? 'approaching'
      : 'on track';
  const isDense = totalPositions >= 8;
  const seat = getSeatPosition(player.seatNumber ?? position + 1, totalPositions);
  const menuPositionClass = [
    seat.y > 58 ? 'above' : 'below',
    seat.x < 24 ? 'align-left' : seat.x > 76 ? 'align-right' : 'align-center'
  ].join(' ');
  const seatEdgeClass = seat.y < 34 ? 'edge-top' : seat.y > 66 ? 'edge-bottom' : seat.x < 50 ? 'edge-left' : 'edge-right';
  const addTime = (minutes: number) => {
    onAddTime?.(player.id, minutes);
    setCustomMinutes('');
    setActiveAction(null);
    setActionMessage(`${minutes} minutes added.`);
  };
  const addCustomTime = () => {
    const minutes = Number(customMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setActionMessage('Enter minutes greater than zero.');
      return;
    }
    addTime(minutes);
  };
  const deductTime = (minutes: number) => {
    const result = onDeductTime?.(player.id, minutes);
    if (result === false) return;
    setCustomDeductMinutes('');
    setActiveAction(null);
    setActionMessage(`${minutes} minutes deducted.`);
  };
  const deductCustomTime = () => {
    const minutes = Number(customDeductMinutes);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      setActionMessage('Enter a whole number of minutes greater than zero.');
      return;
    }
    deductTime(minutes);
  };
  const pauseAndSaveTime = () => {
    const result = onPauseAndSaveTime?.(player.id);
    if (result === false) return;
    setActiveAction(null);
    setActionMessage('Remaining time paused and saved to the player profile.');
  };
  const useSavedTime = () => {
    const minutes = Math.max(0, Math.floor(player.savedTimeCreditMinutes ?? 0));
    if (!minutes) return;
    const result = onUseSavedTime?.(player.id, minutes);
    if (result === false) return;
    setActiveAction(null);
    setActionMessage(`${minutes} saved minutes applied.`);
  };
  const addBuyIn = () => {
    const amount = Number(buyInAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setActionMessage('Enter a buy-in amount greater than zero.');
      return;
    }
    onAddBuyIn?.(player.id, amount, buyInNote.trim());
    setBuyInAmount('');
    setBuyInNote('');
    setActiveAction(null);
    setActionMessage(`$${amount.toLocaleString()} buy-in recorded.`);
  };
  const selectAction = (action: Exclude<PlayerAction, null>) => {
    setActiveAction((current) => current === action ? null : action);
    setActionMessage('');
    if (action === 'time' || action === 'deduct-time') {
      setBuyInAmount('');
      setBuyInNote('');
    } else {
      setCustomMinutes('');
      setCustomDeductMinutes('');
    }
  };
  const hasTimeAction = Boolean(showTimeRemaining && (onAddTime || onDeductTime || onPauseAndSaveTime || onUseSavedTime));
  const hasBuyInAction = Boolean(onAddBuyIn);
  const hasPlayerActions = hasTimeAction || hasBuyInAction;

  return (
    <div ref={cardRef} className={`poker-seat-card ${seatEdgeClass} ${isOpen ? 'open' : ''} ${isDense ? 'dense' : ''} ${isDragging ? 'dragging' : ''}`} style={{ left: `${seat.x}%`, top: `${seat.y}%` }}>
      <button
        ref={triggerRef}
        className={`poker-seat-card-inner ${isOpen ? 'open' : ''}`}
        type="button"
        draggable
        aria-controls={menuId}
        aria-describedby={timerDescriptionId}
        aria-expanded={isOpen}
        aria-label={`Open details for ${player.name} at seat ${player.seatNumber ?? position + 1}`}
        title={`Open player details for ${player.name}`}
        onClick={() => {
          if (!suppressClickRef.current) onToggle();
        }}
        onDragStart={(event) => {
          suppressClickRef.current = true;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', player.id);
          onDragStart(player.id);
        }}
        onDragEnd={() => {
          onDragEnd();
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        <span className="poker-seat-number">{player.seatNumber ?? position + 1}</span>
        <strong className="poker-seat-player-name">{player.name}</strong>
        {showTimeRemaining
          ? <em aria-hidden="true" className={`poker-seat-time ${timerStatus}`}>{timeRemainingDisplay}</em>
          : <em aria-hidden="true" className="poker-seat-time">{timeAtTableDisplay}</em>}
        <span className="sr-only" id={timerDescriptionId}>
          {showTimeRemaining
            ? `${timeRemainingDisplay} remaining, ${timerStatusLabel}`
            : `${timeAtTableDisplay} at table`}
        </span>
      </button>
      {isOpen ? (
        <div
          aria-labelledby={menuHeadingId}
          className={`poker-seat-menu ${menuPositionClass}`}
          id={menuId}
          onClick={(event) => event.stopPropagation()}
          role="region"
        >
          <div className="poker-seat-menu-header">
            <div>
              <strong id={menuHeadingId}>{player.name}</strong>
            </div>
            <div className="poker-seat-menu-header-actions">
              <strong>${(player.buyInTotal ?? 0).toLocaleString()}</strong>
              <button
                aria-label="Close player details"
                className="icon-button"
                type="button"
                onClick={() => {
                  onClose();
                  triggerRef.current?.focus();
                }}
                title="Close player details"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="poker-seat-menu-summary">
            <span>At table <strong>{timeAtTableDisplay}</strong></span>
            {showTimeRemaining ? <span>Time left <strong>{timeRemainingDisplay}</strong></span> : null}
            {player.savedTimeCreditMinutes ? <span>Saved time <strong>{player.savedTimeCreditMinutes} min</strong></span> : null}
            <span>Tonight <strong>{player.tonightHours ?? '0.0h'}</strong></span>
            <span>Total <strong>{player.totalHours ?? '0.0h'}</strong></span>
          </div>
          <div className={`poker-seat-menu-workspace ${hasPlayerActions ? 'with-actions' : ''}`}>
            {activeAction === null ? (
              <section className="poker-seat-menu-section" aria-labelledby={positionHeadingId}>
                <h4 className="poker-seat-menu-section-title" id={positionHeadingId}>Table position</h4>
                <div className="poker-seat-menu-row seat-number-row">
                  <label htmlFor={`change-seat-${player.id}`}>Seat</label>
                  <select
                    id={`change-seat-${player.id}`}
                    value={player.seatNumber ?? position + 1}
                    onChange={(event) => onChangeSeat?.(player.id, Number(event.target.value))}
                  >
                    {seatOptions.map((seatNumber) => (
                      <option key={seatNumber} value={seatNumber}>
                        Seat {seatNumber}
                      </option>
                    ))}
                  </select>
                </div>
                {moveTargets.length ? (
                  <div className="poker-seat-menu-row move-player-row">
                    <label htmlFor={`move-player-${player.id}`}>Move to table</label>
                    <select
                      id={`move-player-${player.id}`}
                      defaultValue=""
                      onChange={(event) => {
                        const targetTableId = event.target.value;
                        if (!targetTableId) return;
                        onMovePlayer?.(player.id, targetTableId);
                        onClose();
                      }}
                    >
                      <option value="">Choose table...</option>
                      {moveTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label} ({target.openSeats} open)
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </section>
            ) : null}
            {hasPlayerActions ? (
              <section className="poker-seat-menu-section poker-seat-actions" aria-labelledby={actionsHeadingId}>
                <h4 className="poker-seat-menu-section-title" id={actionsHeadingId}>Player actions</h4>
                <div className="poker-seat-action-picker" role="group" aria-label={`Choose an action for ${player.name}`}>
                  {showTimeRemaining && onAddTime ? (
                    <button
                      aria-label={`${activeAction === 'time' ? 'Hide' : 'Show'} add time controls for ${player.name}`}
                      aria-controls={timePanelId}
                      aria-pressed={activeAction === 'time'}
                      className="poker-seat-action-choice"
                      onClick={() => selectAction('time')}
                      type="button"
                    >
                      <Plus size={15} /> Add time
                    </button>
                  ) : null}
                  {showTimeRemaining && onDeductTime ? (
                    <button
                      aria-label={`${activeAction === 'deduct-time' ? 'Hide' : 'Show'} deduct time controls for ${player.name}`}
                      aria-controls={deductTimePanelId}
                      aria-pressed={activeAction === 'deduct-time'}
                      className="poker-seat-action-choice"
                      onClick={() => selectAction('deduct-time')}
                      type="button"
                    >
                      <Minus size={15} /> Deduct time
                    </button>
                  ) : null}
                  {showTimeRemaining && onPauseAndSaveTime && timeRemainingSeconds > 0 ? (
                    <button className="poker-seat-action-choice" onClick={pauseAndSaveTime} type="button">
                      <Pause size={15} /> Pause &amp; save
                    </button>
                  ) : null}
                  {showTimeRemaining && onUseSavedTime && (player.savedTimeCreditMinutes ?? 0) > 0 ? (
                    <button className="poker-seat-action-choice" onClick={useSavedTime} type="button">
                      <Play size={15} /> Use saved time
                    </button>
                  ) : null}
                  {hasBuyInAction ? (
                    <button
                      aria-label={`${activeAction === 'buy-in' ? 'Hide' : 'Show'} buy-in form for ${player.name}`}
                      aria-controls={buyInPanelId}
                      aria-pressed={activeAction === 'buy-in'}
                      className="poker-seat-action-choice"
                      onClick={() => selectAction('buy-in')}
                      type="button"
                    >
                      <DollarSign size={15} /> Record buy-in
                    </button>
                  ) : null}
                </div>
                {actionMessage ? (
                  <p
                    className="poker-seat-action-feedback"
                    role={actionMessage.startsWith('Enter ') ? 'alert' : 'status'}
                  >
                    {actionMessage}
                  </p>
                ) : null}
                {activeAction === 'time' && showTimeRemaining && onAddTime ? (
                  <div className="poker-seat-action-panel time-action-panel" id={timePanelId}>
                    <strong>Add time</strong>
                    <div className="poker-seat-time-actions">
                      <button className="mini-button" type="button" onClick={() => addTime(30)}>+30 min</button>
                      <button className="mini-button" type="button" onClick={() => addTime(60)}>+60 min</button>
                    </div>
                    <label className="poker-seat-field" htmlFor={customMinutesId}>
                      <span>Custom minutes</span>
                      <input
                        id={customMinutesId}
                        value={customMinutes}
                        onChange={(event) => setCustomMinutes(event.target.value)}
                        min="1"
                        placeholder="Minutes"
                        type="number"
                      />
                    </label>
                    <button className="secondary-button poker-seat-submit-action" type="button" onClick={addCustomTime}>
                      Add custom time
                    </button>
                  </div>
                ) : null}
                {activeAction === 'deduct-time' && showTimeRemaining && onDeductTime ? (
                  <div className="poker-seat-action-panel deduct-time-action-panel" id={deductTimePanelId}>
                    <strong>Deduct mistaken time</strong>
                    <div className="poker-seat-time-actions">
                      <button className="mini-button" type="button" onClick={() => deductTime(15)}>-15 min</button>
                      <button className="mini-button" type="button" onClick={() => deductTime(30)}>-30 min</button>
                      <button className="mini-button" type="button" onClick={() => deductTime(60)}>-60 min</button>
                    </div>
                    <label className="poker-seat-field" htmlFor={customDeductMinutesId}>
                      <span>Custom minutes</span>
                      <input
                        id={customDeductMinutesId}
                        value={customDeductMinutes}
                        onChange={(event) => setCustomDeductMinutes(event.target.value)}
                        min="1"
                        placeholder="Minutes"
                        step="1"
                        type="number"
                      />
                    </label>
                    <button className="secondary-button poker-seat-submit-action" type="button" onClick={deductCustomTime}>
                      Deduct custom time
                    </button>
                    <small>Use this only to correct time added by mistake. Reports receive an offsetting fee correction.</small>
                  </div>
                ) : null}
                {activeAction === 'buy-in' && onAddBuyIn ? (
                  <div className="poker-seat-action-panel buyin-action-panel" id={buyInPanelId}>
                    <strong>Record buy-in</strong>
                    <label className="poker-seat-field" htmlFor={buyInAmountId}>
                      <span>Amount</span>
                      <input
                        id={buyInAmountId}
                        value={buyInAmount}
                        onChange={(event) => setBuyInAmount(event.target.value)}
                        min="1"
                        placeholder="$0"
                        type="number"
                      />
                    </label>
                    <label className="poker-seat-field" htmlFor={buyInNoteId}>
                      <span>Note (optional)</span>
                      <input id={buyInNoteId} value={buyInNote} onChange={(event) => setBuyInNote(event.target.value)} placeholder="Buy-in note" />
                    </label>
                    <button className="secondary-button poker-seat-submit-action" type="button" onClick={addBuyIn}>
                      Record buy-in
                    </button>
                    {player.recentBuyIns?.length ? (
                      <div className="poker-seat-log" aria-label="Recent buy-ins">
                        {player.recentBuyIns.slice(0, 4).map((buyIn) => (
                          <span key={buyIn.id}>{buyIn.label}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
          <button className="poker-seat-cashout" type="button" onClick={() => {
            onRemovePlayer?.(player.id);
            onClose();
          }}>
            Cash out and leave table
          </button>
        </div>
      ) : null}
    </div>
  );
}

const getSeatPosition = (seatNumber: number, totalPositions: number) => {
  const safeTotal = Math.max(1, totalPositions);
  const normalizedSeat = Math.max(1, Math.min(safeTotal - 1, seatNumber));
  // The bottom-center position is reserved for the dealer. Seat 1 begins
  // immediately to the dealer's left, then numbering continues around the table.
  const angle = Math.PI / 2 + (normalizedSeat / safeTotal) * Math.PI * 2;
  return {
    x: 50 + 47 * Math.cos(angle),
    y: 50 + 41 * Math.sin(angle)
  };
};

export default function PokerTable({
  players,
  showTimeRemaining = false,
  maxPlayers = 10,
  selectedSeatNumber,
  onSeatClick,
  onAddTime,
  onDeductTime,
  onPauseAndSaveTime,
  onUseSavedTime,
  onAddBuyIn,
  onRemovePlayer,
  onChangeSeat,
  moveTargets = [],
  onMovePlayer,
  revenueEstimate,
  dealerControl
}: PokerTableProps) {
  const dealerOptionsId = useId();
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [dragOverSeatNumber, setDragOverSeatNumber] = useState<number | null>(null);
  const seatCount = Math.max(1, maxPlayers);
  const tablePositionCount = seatCount + 1;
  const isDense = seatCount >= 8;
  const occupiedSeatNumbers = new Set(players.map((player, index) => player.seatNumber ?? index + 1));
  const orderedPlayers = [...players]
    .filter((player, index) => (player.seatNumber ?? index + 1) <= seatCount)
    .sort((a, b) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99));
  const dealerOptions = dealerControl
    ? Array.from(new Set([
        ...dealerControl.options,
        dealerControl.currentDealer ?? '',
        dealerControl.value
      ].map((name) => name.trim()).filter(Boolean)))
    : [];
  const hasCenterControls = Boolean(revenueEstimate || dealerControl);

  return (
    <div className={`poker-table-shell ${isDense ? 'dense' : ''} ${draggedPlayerId ? 'is-dragging-player' : ''}`}>
      <div className="poker-table-stage">
        <div className="poker-table-rail">
          <div className="poker-table-ring">
            <div className="poker-table-inner-rail">
              <div className="poker-table-surface">
                <div className="poker-table-border" />
                <div className={`poker-table-center ${hasCenterControls ? 'with-controls' : ''}`}>
                  <img src="./orbit-table-logo.svg" alt="Orbit" />
                  <span>ORBIT</span>
                  {hasCenterControls ? (
                    <section className="poker-table-center-controls" aria-label="Table revenue and dealer controls">
                      {revenueEstimate ? (
                        <p className="poker-table-revenue-estimate">
                          <span>{revenueEstimate.label}</span>
                          <strong>{revenueEstimate.value}</strong>
                        </p>
                      ) : null}
                      {dealerControl ? (
                        <div className="poker-table-dealer-control">
                          <label>
                            <span>Dealer</span>
                            <input
                              aria-label="Dealer selection"
                              autoComplete="off"
                              list={dealerOptionsId}
                              placeholder="Type or choose dealer"
                              value={dealerControl.value}
                              onChange={(event) => dealerControl.onChange(event.target.value)}
                            />
                            <datalist id={dealerOptionsId}>
                              {dealerOptions.map((dealerName) => (
                                <option key={dealerName} value={dealerName}>{dealerName}</option>
                              ))}
                            </datalist>
                          </label>
                          <div>
                            <button
                              disabled={
                                !dealerControl.value.trim() ||
                                dealerControl.value.trim() === dealerControl.currentDealer?.trim()
                              }
                              onClick={dealerControl.onAssign}
                              type="button"
                            >Assign dealer</button>
                            {dealerControl.currentDealer && dealerControl.onEnd ? (
                              <button onClick={dealerControl.onEnd} type="button">End down</button>
                            ) : null}
                          </div>
                          <small>Current: {dealerControl.currentDealer ?? 'Unassigned'}</small>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </div>

                {Array.from({ length: seatCount }).map((_, i) => {
                  const seatNumber = i + 1;
                  const marker = getSeatPosition(seatNumber, tablePositionCount);
                  const occupied = occupiedSeatNumbers.has(seatNumber);
                  return (
                    <button
                      key={i}
                      className={`poker-position-marker ${occupied ? 'occupied' : 'open'} ${selectedSeatNumber === seatNumber ? 'selected' : ''} ${draggedPlayerId && !occupied ? 'drop-target' : ''} ${dragOverSeatNumber === seatNumber ? 'drag-over' : ''}`}
                      type="button"
                      disabled={occupied}
                      aria-label={occupied ? `Seat ${seatNumber} occupied` : `Add player to seat ${seatNumber}`}
                      onClick={() => onSeatClick?.(seatNumber)}
                      onDragEnter={() => {
                        if (draggedPlayerId && !occupied) setDragOverSeatNumber(seatNumber);
                      }}
                      onDragLeave={() => {
                        setDragOverSeatNumber((current) => current === seatNumber ? null : current);
                      }}
                      onDragOver={(event) => {
                        if (!draggedPlayerId || occupied) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        if (occupied) return;
                        event.preventDefault();
                        const playerId = draggedPlayerId || event.dataTransfer.getData('text/plain');
                        if (playerId) onChangeSeat?.(playerId, seatNumber);
                        setDraggedPlayerId(null);
                        setDragOverSeatNumber(null);
                        setOpenPlayerId(null);
                      }}
                      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                      title={occupied ? `Seat ${seatNumber} occupied` : `Add player to seat ${seatNumber}`}
                    >
                      <span>{seatNumber}</span>
                    </button>
                  );
                })}

                <div className="poker-dealer-position">Dealer</div>
              </div>
            </div>
          </div>
        </div>

        {orderedPlayers.map((player, index) => {
          const currentSeatNumber = player.seatNumber ?? index + 1;
          const seatOptions = Array.from({ length: seatCount }, (_, seatIndex) => seatIndex + 1)
            .filter((seatNumber) => seatNumber === currentSeatNumber || !occupiedSeatNumbers.has(seatNumber));
          return (
            <PlayerCard
              key={player.id}
              player={player}
              position={index}
              totalPositions={tablePositionCount}
              showTimeRemaining={showTimeRemaining}
              isOpen={openPlayerId === player.id}
              onToggle={() => setOpenPlayerId((current) => (current === player.id ? null : player.id))}
              onClose={() => setOpenPlayerId(null)}
              isDragging={draggedPlayerId === player.id}
              onDragStart={(playerId) => {
                setOpenPlayerId(null);
                setDraggedPlayerId(playerId);
              }}
              onDragEnd={() => {
                setDraggedPlayerId(null);
                setDragOverSeatNumber(null);
              }}
              onAddTime={onAddTime}
              onDeductTime={onDeductTime}
              onPauseAndSaveTime={onPauseAndSaveTime}
              onUseSavedTime={onUseSavedTime}
              onAddBuyIn={onAddBuyIn}
              onRemovePlayer={onRemovePlayer}
              onChangeSeat={onChangeSeat}
              seatOptions={seatOptions}
              moveTargets={moveTargets}
              onMovePlayer={onMovePlayer}
            />
          );
        })}
      </div>
    </div>
  );
}
