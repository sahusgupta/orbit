import { useEffect, useState } from 'react';
import { Clock, DollarSign, Plus, X } from 'lucide-react';
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
  tonightHours?: string;
  totalHours?: string;
  buyInTotal?: number;
  recentBuyIns?: { id: string; label: string }[];
}

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
  onAddBuyIn?: (playerId: string, amount: number, note: string) => void;
  onRemovePlayer?: (playerId: string) => void;
  onChangeSeat?: (playerId: string, seatNumber: number) => void;
  moveTargets?: { id: string; label: string; openSeats: number }[];
  onMovePlayer?: (playerId: string, targetTableId: string) => void;
}

interface PlayerCardProps {
  player: Player;
  position: number;
  totalPositions: number;
  showTimeRemaining: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onAddTime?: (playerId: string, minutes: number) => void;
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

const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

function PlayerCard({
  player,
  position,
  totalPositions,
  showTimeRemaining,
  isOpen,
  onToggle,
  onAddTime,
  onAddBuyIn,
  onRemovePlayer,
  onChangeSeat,
  seatOptions,
  moveTargets = [],
  onMovePlayer
}: PlayerCardProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [customMinutes, setCustomMinutes] = useState('');
  const [buyInAmount, setBuyInAmount] = useState('');
  const [buyInNote, setBuyInNote] = useState('');

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const totalSecondsAtTable = Math.max(0, Math.floor((currentTime - player.joinedAt) / 1000));
  const timeAtTableDisplay = formatDuration(totalSecondsAtTable);
  const timeRemainingSeconds = player.timeRemainingSeconds ?? (
    player.hourlyTimeLimit
      ? Math.max(0, player.hourlyTimeLimit * 60 - (totalSecondsAtTable % (player.hourlyTimeLimit * 60)))
      : 0
  );
  const timeRemainingDisplay = formatDuration(timeRemainingSeconds);
  const timerStatus = getTimerStatusFromSeconds(timeRemainingSeconds);
  const isDense = totalPositions >= 8;
  const seat = getSeatPosition(player.seatNumber ?? position + 1, totalPositions);
  const menuPositionClass = [
    seat.y > 58 ? 'above' : 'below',
    seat.x < 24 ? 'align-left' : seat.x > 76 ? 'align-right' : 'align-center'
  ].join(' ');
  const seatEdgeClass = seat.y < 34 ? 'edge-top' : seat.y > 66 ? 'edge-bottom' : seat.x < 50 ? 'edge-left' : 'edge-right';
  const addCustomTime = () => {
    const minutes = Number(customMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    onAddTime?.(player.id, minutes);
    setCustomMinutes('');
  };
  const addBuyIn = () => {
    const amount = Number(buyInAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    onAddBuyIn?.(player.id, amount, buyInNote.trim());
    setBuyInAmount('');
    setBuyInNote('');
  };

  return (
    <div className={`poker-seat-card ${seatEdgeClass} ${isOpen ? 'open' : ''} ${isDense ? 'dense' : ''}`} style={{ left: `${seat.x}%`, top: `${seat.y}%` }}>
      <button
        className="poker-seat-remove-button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemovePlayer?.(player.id);
        }}
        title={`${player.name} left table`}
      >
        <X size={13} />
      </button>
      <button
        className={`poker-seat-card-inner ${isOpen ? 'open' : ''}`}
        type="button"
        onClick={onToggle}
        onContextMenu={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        <span className="poker-seat-number">{player.seatNumber ?? position + 1}</span>
        <span className="poker-seat-initials">{getInitials(player.name)}</span>
      </button>
      <div className="poker-seat-player-label">
        <strong>{player.name}</strong>
        <span>${(player.buyInTotal ?? 0).toLocaleString()}</span>
        {showTimeRemaining ? <em className={timerStatus}>{timeRemainingDisplay}</em> : <em>{timeAtTableDisplay}</em>}
      </div>
      {isOpen ? (
        <div className={`poker-seat-menu ${menuPositionClass}`} onClick={(event) => event.stopPropagation()}>
          <div className="poker-seat-menu-header">
            <div>
              <strong>{player.name}</strong>
              <span>ID: {player.membershipId}</span>
            </div>
            <div className="poker-seat-menu-header-actions">
              <strong>${(player.buyInTotal ?? 0).toLocaleString()}</strong>
              <button className="icon-button" type="button" onClick={onToggle} title="Close player details">
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="poker-seat-menu-summary">
            <span>At table <strong>{timeAtTableDisplay}</strong></span>
            {showTimeRemaining ? <span>Time left <strong>{timeRemainingDisplay}</strong></span> : null}
            <span>Tonight <strong>{player.tonightHours ?? '0.0h'}</strong></span>
            <span>Total <strong>{player.totalHours ?? '0.0h'}</strong></span>
          </div>
          <div className="poker-seat-menu-row seat-number-row">
            <label htmlFor={`change-seat-${player.id}`}>Seat #</label>
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
          {showTimeRemaining ? (
            <div className="poker-seat-menu-row">
              <button className="mini-button" type="button" onClick={() => onAddTime?.(player.id, 30)}>+30</button>
              <button className="mini-button" type="button" onClick={() => onAddTime?.(player.id, 60)}>+60</button>
              <input
                value={customMinutes}
                onChange={(event) => setCustomMinutes(event.target.value)}
                placeholder="Min"
                type="number"
              />
              <button className="secondary-button" type="button" onClick={addCustomTime}>
                <Plus size={15} />
                Time
              </button>
            </div>
          ) : null}
          <div className="poker-seat-menu-row buyin">
            <input
              value={buyInAmount}
              onChange={(event) => setBuyInAmount(event.target.value)}
              placeholder="Buy-in $"
              type="number"
            />
            <input value={buyInNote} onChange={(event) => setBuyInNote(event.target.value)} placeholder="Note" />
            <button className="secondary-button" type="button" onClick={addBuyIn}>
              <DollarSign size={15} />
              Add
            </button>
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
                  onToggle();
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
          {player.recentBuyIns?.length ? (
            <div className="poker-seat-log">
              {player.recentBuyIns.slice(0, 4).map((buyIn) => (
                <span key={buyIn.id}>{buyIn.label}</span>
              ))}
            </div>
          ) : null}
          <button className="poker-seat-cashout" type="button" onClick={() => onRemovePlayer?.(player.id)}>
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
  onAddBuyIn,
  onRemovePlayer,
  onChangeSeat,
  moveTargets = [],
  onMovePlayer
}: PokerTableProps) {
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  const seatCount = Math.max(1, maxPlayers);
  const tablePositionCount = seatCount + 1;
  const isDense = seatCount >= 8;
  const occupiedSeatNumbers = new Set(players.map((player, index) => player.seatNumber ?? index + 1));
  const orderedPlayers = [...players]
    .filter((player, index) => (player.seatNumber ?? index + 1) <= seatCount)
    .sort((a, b) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99));

  return (
    <div className={`poker-table-shell ${isDense ? 'dense' : ''}`}>
      <div className="poker-table-stage">
        <div className="poker-table-rail">
          <div className="poker-table-ring">
            <div className="poker-table-inner-rail">
              <div className="poker-table-surface">
                <div className="poker-table-border" />
                <div className="poker-table-center">
                  <img src="./orbit-table-logo.svg" alt="Orbit" />
                  <span>ORBIT</span>
                </div>

                {Array.from({ length: seatCount }).map((_, i) => {
                  const seatNumber = i + 1;
                  const marker = getSeatPosition(seatNumber, tablePositionCount);
                  const occupied = occupiedSeatNumbers.has(seatNumber);
                  return (
                    <button
                      key={i}
                      className={`poker-position-marker ${occupied ? 'occupied' : 'open'} ${selectedSeatNumber === seatNumber ? 'selected' : ''}`}
                      type="button"
                      disabled={occupied}
                      onClick={() => onSeatClick?.(seatNumber)}
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
              onAddTime={onAddTime}
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
