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

function PlayerCard({ player, position, totalPositions, showTimeRemaining, isOpen, onToggle, onAddTime, onAddBuyIn, onRemovePlayer }: PlayerCardProps) {
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
    <div className={`poker-seat-card ${isOpen ? 'open' : ''} ${isDense ? 'dense' : ''}`} style={{ left: `${seat.x}%`, top: `${seat.y}%` }}>
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
      <button className={`poker-seat-card-inner ${isOpen ? 'open' : ''}`} type="button" onClick={onToggle}>
        <div className="poker-seat-header">
          <div className="poker-seat-avatar">
            <span>{getInitials(player.name)}</span>
          </div>
          <div className="poker-seat-name">
            <span>Seat {player.seatNumber ?? position + 1}</span>
            <h3>{player.name}</h3>
          </div>
        </div>

        <div className="poker-seat-stats">
          {showTimeRemaining ? (
            <div className={`poker-seat-stat time-left ${timerStatus}`}>
              <div>
                <Clock size={14} />
                <span>Time</span>
              </div>
              <span>{timeRemainingDisplay}</span>
            </div>
          ) : (
            <div className="poker-seat-stat">
              <div>
                <Clock size={14} />
                <span>Table</span>
              </div>
              <span>{timeAtTableDisplay}</span>
            </div>
          )}
        </div>
      </button>
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
          {player.recentBuyIns?.length ? (
            <div className="poker-seat-log">
              {player.recentBuyIns.slice(0, 4).map((buyIn) => (
                <span key={buyIn.id}>{buyIn.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const getSeatPosition = (seatNumber: number, totalPositions: number) => {
  const safeTotal = Math.max(1, totalPositions);
  const normalizedSeat = Math.max(1, Math.min(safeTotal, seatNumber));
  const angle = ((normalizedSeat - 1) / safeTotal) * Math.PI * 2 - Math.PI / 2;
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
  onRemovePlayer
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
                  <div />
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

        {orderedPlayers.map((player, index) => (
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
          />
        ))}
      </div>
    </div>
  );
}

