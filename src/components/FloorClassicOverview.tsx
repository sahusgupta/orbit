import * as Dialog from '@radix-ui/react-dialog';
import { Clock, Eye, Settings2, Users, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { createPortal } from 'react-dom';
import type { GameConfig, GameSession, PlayerSession } from '../domain/types';
import { getTimerStatusFromSeconds } from '../lib/appCore';

type FloorClassicOverviewProps = {
  sessions: GameSession[];
  games: GameConfig[];
  playerSessions: PlayerSession[];
  clockNow: number;
  getTimeRemainingSeconds: (session: PlayerSession, nowMs?: number) => number;
  formatTimeLeft: (seconds: number) => string;
  onOpenTable: (sessionId: string) => void;
  onManageTables: () => void;
  onClearTable: (sessionId: string) => void;
  onDeleteTable: (tableId: string) => void;
  onMergeTable: (sourceSessionId: string, targetSessionId: string) => void;
};

type TableContextMenu = { sessionId: string; x: number; y: number };

const getCollectionMode = (session: GameSession) =>
  session.collectionMode === 'Time' || session.timeFeeBased ? 'Time' : 'Drop';

export default function FloorClassicOverview({
  sessions,
  games,
  playerSessions,
  clockNow,
  getTimeRemainingSeconds,
  formatTimeLeft,
  onOpenTable,
  onManageTables,
  onClearTable,
  onDeleteTable,
  onMergeTable
}: FloorClassicOverviewProps) {
  const [contextMenu, setContextMenu] = useState<TableContextMenu | null>(null);
  const [mergeSourceSessionId, setMergeSourceSessionId] = useState<string | null>(null);
  const [mergeTargetSessionId, setMergeTargetSessionId] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextTriggerRef = useRef<HTMLElement | null>(null);
  const openSessions = sessions.filter(
    (session) => session.status !== 'Closed' && session.status !== 'Failed to Start'
  );
  const getActivePlayerCount = (sessionId: string) => playerSessions.filter(
    (playerSession) => playerSession.tableId === sessionId && !playerSession.leftAt
  ).length;
  const getMergeTargets = (sourceSession: GameSession) => openSessions.filter((session) =>
    session.id !== sourceSession.id &&
    session.gameId === sourceSession.gameId &&
    getCollectionMode(session) === getCollectionMode(sourceSession) &&
    session.maxSeats - getActivePlayerCount(session.id) >= getActivePlayerCount(sourceSession.id)
  );
  const contextSession = contextMenu
    ? openSessions.find((session) => session.id === contextMenu.sessionId)
    : undefined;
  const contextMergeTargets = contextSession ? getMergeTargets(contextSession) : [];
  const mergeSourceSession = mergeSourceSessionId
    ? openSessions.find((session) => session.id === mergeSourceSessionId)
    : undefined;
  const mergeTargets = mergeSourceSession ? getMergeTargets(mergeSourceSession) : [];

  useEffect(() => {
    if (!contextMenu) return;
    contextMenuRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setContextMenu(null);
      contextTriggerRef.current?.focus();
    };
    const closeMenu = () => setContextMenu(null);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [contextMenu]);

  const openTableContextMenu = (
    sessionId: string,
    event: ReactMouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
  ) => {
    event.preventDefault();
    contextTriggerRef.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = 'clientX' in event && event.clientX ? event.clientX : bounds.left + bounds.width / 2;
    const y = 'clientY' in event && event.clientY ? event.clientY : bounds.top + bounds.height / 2;
    setContextMenu({
      sessionId,
      x: Math.max(8, Math.min(x, window.innerWidth - 224)),
      y: Math.max(8, Math.min(y, window.innerHeight - 154))
    });
  };

  const handleTableKeyDown = (event: KeyboardEvent<HTMLElement>, sessionId: string) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      openTableContextMenu(sessionId, event);
    }
  };

  const handleContextMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
    );
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const submitMerge = (event: FormEvent) => {
    event.preventDefault();
    if (!mergeSourceSession || !mergeTargets.some((session) => session.id === mergeTargetSessionId)) return;
    onMergeTable(mergeSourceSession.id, mergeTargetSessionId);
    setMergeSourceSessionId(null);
    setMergeTargetSessionId('');
  };

  return (
    <section className="floor-classic-overview" aria-labelledby="floor-classic-title">
      <Dialog.Root
        open={Boolean(mergeSourceSessionId)}
        onOpenChange={(open) => {
          if (!open) {
            setMergeSourceSessionId(null);
            setMergeTargetSessionId('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="floor-map-dialog-overlay" />
          <Dialog.Content className="floor-map-dialog" aria-describedby="classic-merge-table-description">
            <div className="floor-map-dialog-head">
              <div>
                <Dialog.Title>Merge {mergeSourceSession?.label ?? 'table'}</Dialog.Title>
                <Dialog.Description id="classic-merge-table-description">
                  Move every seated player and close the source table.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="Close merge table" type="button"><X size={18} /></button>
              </Dialog.Close>
            </div>
            <form className="floor-map-dialog-form" onSubmit={submitMerge}>
              <label>
                <span>Merge into</span>
                <select
                  autoFocus
                  aria-label="Merge destination table"
                  value={mergeTargetSessionId}
                  onChange={(event) => setMergeTargetSessionId(event.target.value)}
                >
                  {mergeTargets.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.label} ({session.maxSeats - getActivePlayerCount(session.id)} open)
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" type="submit" disabled={!mergeTargetSessionId}>Merge tables</button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <header>
        <div>
          <span>Classic floor</span>
          <h2 id="floor-classic-title">Current tables</h2>
        </div>
        <button className="secondary-button" onClick={onManageTables} type="button">
          <Settings2 size={15} /> Manage tables
        </button>
      </header>
      <div className="floor-classic-table-list">
        {openSessions.length ? openSessions.map((session) => {
          const game = games.find((item) => item.id === session.gameId);
          const seatedPlayers = playerSessions
            .filter((playerSession) => playerSession.tableId === session.id && !playerSession.leftAt)
            .sort((left, right) => (left.seatNumber ?? 99) - (right.seatNumber ?? 99));
          const isTimeCollection = session.collectionMode === 'Time' || session.timeFeeBased;
          return (
            <article
              aria-label={`${session.label} table. Press Shift+F10 for table actions.`}
              className="floor-classic-table"
              data-session-id={session.id}
              key={session.id}
              onContextMenu={(event) => openTableContextMenu(session.id, event)}
              onKeyDown={(event) => handleTableKeyDown(event, session.id)}
              tabIndex={0}
            >
              <div className="floor-classic-table-head">
                <div>
                  <span>{game?.name ?? 'Unknown game'}</span>
                  <h3>{session.label}</h3>
                </div>
                <div className="floor-classic-table-actions">
                  <span className={`status-${session.status.toLowerCase().replace(/\s+/g, '-')}`}>{session.status}</span>
                  <button
                    aria-label={`Open ${session.label}`}
                    className="ghost-button"
                    onClick={() => onOpenTable(session.id)}
                    type="button"
                  ><Eye size={15} /> Open</button>
                </div>
              </div>
              <div className="floor-classic-table-summary">
                <span><Users size={14} /><strong>{seatedPlayers.length}/{session.maxSeats}</strong> seated</span>
                <span><Clock size={14} />{isTimeCollection ? 'Time' : 'Drop'}</span>
              </div>
              <div className="floor-classic-player-list">
                {seatedPlayers.length ? seatedPlayers.map((playerSession) => {
                  const hasTimer = Boolean(isTimeCollection || playerSession.timeFeeEnabled);
                  const remainingSeconds = hasTimer
                    ? getTimeRemainingSeconds(playerSession, clockNow)
                    : 0;
                  const timerStatus = hasTimer ? getTimerStatusFromSeconds(remainingSeconds) : 'off';
                  return (
                    <div className="floor-classic-player" key={playerSession.id}>
                      <span>Seat {playerSession.seatNumber ?? '-'}</span>
                      <strong>{playerSession.playerName}</strong>
                      <em className={timerStatus}>{hasTimer ? formatTimeLeft(remainingSeconds) : '—'}</em>
                    </div>
                  );
                }) : <p>No players seated.</p>}
              </div>
            </article>
          );
        }) : (
          <div className="floor-classic-empty">
            <strong>No open tables</strong>
            <span>Create a table from the management workspace.</span>
          </div>
        )}
      </div>
      {contextMenu && contextSession ? createPortal(
        <div
          aria-label={`${contextSession.label} table actions`}
          className="floor-table-context-menu"
          onKeyDown={handleContextMenuKeyDown}
          ref={contextMenuRef}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              onClearTable(contextSession.id);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            Clear table
          </button>
          <button
            onClick={() => {
              onDeleteTable(contextSession.physicalTableId ?? contextSession.id);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            Delete table
          </button>
          <button
            disabled={!contextMergeTargets.length}
            onClick={() => {
              if (!contextMergeTargets.length) return;
              setMergeSourceSessionId(contextSession.id);
              setMergeTargetSessionId(contextMergeTargets[0].id);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            Merge table
          </button>
        </div>,
        document.body
      ) : null}
    </section>
  );
}
