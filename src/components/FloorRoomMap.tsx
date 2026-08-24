import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, LayoutGrid, Maximize2, Pencil, Plus, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { GameConfig, GameSession, PhysicalTable, PlayerSession, TableCap } from '../domain/types';
import { getTimerStatusFromSeconds } from '../lib/appCore';

type FloorPosition = { x: number; y: number };
type FloorLayout = Record<string, FloorPosition>;
type FloorRoomNode = {
  id: string;
  label: string;
  maxSeats: number;
  physicalTable?: PhysicalTable;
  session?: GameSession;
};

type FloorRoomMapProps = {
  sessions: GameSession[];
  physicalTables?: PhysicalTable[];
  games: GameConfig[];
  playerSessions: PlayerSession[];
  clockNow: number;
  layoutStorageKey: string;
  getTimeRemainingSeconds: (session: PlayerSession, nowMs?: number) => number;
  onOpenTable: (sessionId: string) => void;
  onAddPhysicalTable?: (label: string, maxSeats: TableCap) => void;
  onStartGameAtTable?: (physicalTableId: string, gameId: string) => void;
  onClearTable?: (sessionId: string) => void;
  onDeleteTable?: (tableId: string) => void;
  onMergeTable?: (sourceSessionId: string, targetSessionId: string) => void;
};

type TableContextMenu = { nodeId: string; x: number; y: number };

const minimumX = 16;
const maximumX = 84;
const minimumY = 15;
const maximumY = 85;
const keyboardStep = 2;
const keyboardLargeStep = 6;
const minimumZoom = 0.75;
const maximumZoom = 1.25;
const zoomStep = 0.125;

const getCollectionMode = (session: GameSession) =>
  session.collectionMode === 'Time' || session.timeFeeBased ? 'Time' : 'Drop';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const snap = (value: number) => Math.round(value / 2) * 2;

const isFloorPosition = (value: unknown): value is FloorPosition => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FloorPosition>;
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' && Number.isFinite(candidate.y);
};

const normalizePosition = ({ x, y }: FloorPosition): FloorPosition => ({
  x: clamp(x, minimumX, maximumX),
  y: clamp(y, minimumY, maximumY)
});

export const getFloorLayoutStorageKey = (accountKey: string) =>
  `orbit-floor-layout-v1:${accountKey}`;

const getFloorGridDimensions = (sessionCount: number) => {
  if (!sessionCount) return { columns: 1, rows: 1 };
  const columns = Math.min(5, sessionCount, Math.max(1, Math.ceil(Math.sqrt(sessionCount * 1.6))));
  return { columns, rows: Math.ceil(sessionCount / columns) };
};

export const createDefaultFloorLayout = (nodes: Array<{ id: string }>): FloorLayout => {
  if (!nodes.length) return {};
  const { columns, rows } = getFloorGridDimensions(nodes.length);

  return Object.fromEntries(nodes.map((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return [node.id, {
      x: columns === 1 ? 50 : minimumX + (column / (columns - 1)) * (maximumX - minimumX),
      y: rows === 1 ? 50 : minimumY + (row / (rows - 1)) * (maximumY - minimumY)
    }];
  }));
};

const readFloorLayout = (storageKey: string): FloorLayout => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, FloorPosition] => isFloorPosition(entry[1]))
        .map(([sessionId, position]) => [sessionId, normalizePosition(position)])
    );
  } catch {
    return {};
  }
};

const mergeWithDefaults = (layout: FloorLayout, nodes: Array<{ id: string }>) => {
  const defaults = createDefaultFloorLayout(nodes);
  return Object.fromEntries(nodes.map((node) => [
    node.id,
    normalizePosition(layout[node.id] ?? defaults[node.id])
  ]));
};

const getMiniSeatPosition = (seatIndex: number, seatCount: number) => {
  const angle = -Math.PI / 2 + (seatIndex / Math.max(1, seatCount)) * Math.PI * 2;
  return {
    left: `${50 + 48 * Math.cos(angle)}%`,
    top: `${50 + 54 * Math.sin(angle)}%`
  };
};

const assignPlayersToSeats = (players: PlayerSession[], maximumSeats: number) => {
  const playersBySeat = new Map<number, PlayerSession>();
  const playersNeedingSeat: PlayerSession[] = [];

  for (const player of players) {
    const seatNumber = player.seatNumber;
    if (typeof seatNumber === 'number' && Number.isInteger(seatNumber) && seatNumber >= 1 && seatNumber <= maximumSeats && !playersBySeat.has(seatNumber)) {
      playersBySeat.set(seatNumber, player);
    } else {
      playersNeedingSeat.push(player);
    }
  }

  const openSeatNumbers = Array.from({ length: maximumSeats }, (_, index) => index + 1)
    .filter((seatNumber) => !playersBySeat.has(seatNumber));
  playersNeedingSeat.slice(0, openSeatNumbers.length).forEach((player, index) => {
    playersBySeat.set(openSeatNumbers[index], player);
  });
  return playersBySeat;
};

export default function FloorRoomMap({
  sessions,
  physicalTables = [],
  games,
  playerSessions,
  clockNow,
  layoutStorageKey,
  getTimeRemainingSeconds,
  onOpenTable,
  onAddPhysicalTable,
  onStartGameAtTable,
  onClearTable,
  onDeleteTable,
  onMergeTable
}: FloorRoomMapProps) {
  const [savedLayout, setSavedLayout] = useState<FloorLayout>(() => readFloorLayout(layoutStorageKey));
  const [draftLayout, setDraftLayout] = useState<FloorLayout>({});
  const [isEditing, setIsEditing] = useState(false);
  const [draggedTableId, setDraggedTableId] = useState<string | null>(null);
  const [layoutSaveError, setLayoutSaveError] = useState('');
  const [layoutAnnouncement, setLayoutAnnouncement] = useState('');
  const [zoom, setZoom] = useState(1);
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [newTableLabel, setNewTableLabel] = useState('');
  const [newTableCap, setNewTableCap] = useState<TableCap>(10);
  const [startTableId, setStartTableId] = useState<string | null>(null);
  const [startGameId, setStartGameId] = useState('');
  const [contextMenu, setContextMenu] = useState<TableContextMenu | null>(null);
  const [mergeSourceSessionId, setMergeSourceSessionId] = useState<string | null>(null);
  const [mergeTargetSessionId, setMergeTargetSessionId] = useState('');
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const firstTableRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<'map' | 'edit' | null>(null);
  const focusedTableIdRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setSavedLayout(readFloorLayout(layoutStorageKey));
    setDraftLayout({});
    setIsEditing(false);
    setDraggedTableId(null);
    setLayoutSaveError('');
    setLayoutAnnouncement('');
    setZoom(1);
    pendingFocusRef.current = null;
    focusedTableIdRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
    setContextMenu(null);
    setMergeSourceSessionId(null);
    setMergeTargetSessionId('');
  }, [layoutStorageKey]);

  useEffect(() => {
    if (pendingFocusRef.current === 'map' && isEditing) {
      firstTableRef.current?.focus();
      pendingFocusRef.current = null;
    } else if (pendingFocusRef.current === 'edit' && !isEditing) {
      editButtonRef.current?.focus();
      pendingFocusRef.current = null;
    }
  }, [isEditing]);

  const openSessions = useMemo(
    () => sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start'),
    [sessions]
  );
  const roomNodes = useMemo<FloorRoomNode[]>(() => {
    const sessionsByPhysicalTable = new Map<string, GameSession>();
    openSessions.forEach((session) => {
      if (session.physicalTableId && !sessionsByPhysicalTable.has(session.physicalTableId)) {
        sessionsByPhysicalTable.set(session.physicalTableId, session);
      }
    });
    const boundSessionIds = new Set(
      Array.from(sessionsByPhysicalTable.values(), (session) => session.id)
    );
    return [
      ...physicalTables.map((physicalTable) => {
        const session = sessionsByPhysicalTable.get(physicalTable.id);
        return {
          id: physicalTable.id,
          label: physicalTable.label,
          maxSeats: session?.maxSeats ?? physicalTable.maxSeats,
          physicalTable,
          session
        };
      }),
      ...openSessions
        .filter((session) => !boundSessionIds.has(session.id))
        .map((session) => ({
          id: session.id,
          label: session.label,
          maxSeats: session.maxSeats,
          session
        }))
    ];
  }, [openSessions, physicalTables]);
  const activeLayout = mergeWithDefaults(isEditing ? draftLayout : savedLayout, roomNodes);
  const gridDimensions = getFloorGridDimensions(roomNodes.length);
  const canvasBaseWidth = Math.max(760, gridDimensions.columns * 260);
  const canvasBaseHeight = Math.max(500, gridDimensions.rows * 200);
  const canvasStyle = {
    '--room-map-node-scale': zoom,
    height: `${canvasBaseHeight * zoom}px`,
    minWidth: `${canvasBaseWidth * zoom}px`,
    width: `${zoom * 100}%`
  } as CSSProperties;

  const getActivePlayerCount = (sessionId: string) => playerSessions.filter(
    (playerSession) => playerSession.tableId === sessionId && !playerSession.leftAt
  ).length;
  const mergeSourceSession = openSessions.find((session) => session.id === mergeSourceSessionId);
  const mergeTargets = mergeSourceSession
    ? openSessions.filter((session) =>
        session.id !== mergeSourceSession.id &&
        session.gameId === mergeSourceSession.gameId &&
        getCollectionMode(session) === getCollectionMode(mergeSourceSession) &&
        session.maxSeats - getActivePlayerCount(session.id) >= getActivePlayerCount(mergeSourceSession.id)
      )
    : [];
  const contextNode = contextMenu ? roomNodes.find((node) => node.id === contextMenu.nodeId) : undefined;
  const contextMergeTargets = contextNode?.session
    ? openSessions.filter((session) =>
        session.id !== contextNode.session?.id &&
        session.gameId === contextNode.session?.gameId &&
        getCollectionMode(session) === getCollectionMode(contextNode.session) &&
        session.maxSeats - getActivePlayerCount(session.id) >= getActivePlayerCount(contextNode.session?.id ?? '')
      )
    : [];

  useEffect(() => {
    if (!contextMenu) return;
    contextMenuRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setContextMenu(null);
      contextTriggerRef.current?.focus();
    };
    const closeMenu = () => setContextMenu(null);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [contextMenu]);

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

  useEffect(() => {
    if (!isEditing || !focusedTableIdRef.current) return;
    if (roomNodes.some((node) => node.id === focusedTableIdRef.current)) return;
    focusedTableIdRef.current = roomNodes[0]?.id ?? null;
    if (roomNodes.length) firstTableRef.current?.focus();
    else cancelButtonRef.current?.focus();
  }, [isEditing, roomNodes]);

  const beginEditing = () => {
    setDraftLayout(mergeWithDefaults(savedLayout, roomNodes));
    setLayoutSaveError('');
    setLayoutAnnouncement('Layout editing started.');
    pendingFocusRef.current = 'map';
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftLayout({});
    setDraggedTableId(null);
    setLayoutSaveError('');
    setLayoutAnnouncement('Layout changes canceled.');
    pendingFocusRef.current = 'edit';
    focusedTableIdRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
    setIsEditing(false);
  };

  const saveLayout = () => {
    const nextLayout = mergeWithDefaults(draftLayout, roomNodes);
    try {
      window.localStorage.setItem(layoutStorageKey, JSON.stringify(nextLayout));
    } catch {
      setLayoutSaveError('Layout could not be saved on this device. Your draft is still open.');
      return;
    }
    setSavedLayout(nextLayout);
    setDraftLayout({});
    setDraggedTableId(null);
    setLayoutSaveError('');
    setLayoutAnnouncement('Layout saved.');
    pendingFocusRef.current = 'edit';
    focusedTableIdRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
    setIsEditing(false);
  };

  const resetDraftLayout = () => {
    setDraftLayout(createDefaultFloorLayout(roomNodes));
    setLayoutAnnouncement('Layout reset to automatic positions.');
  };

  const fitRoomMap = () => {
    const viewport = viewportRef.current;
    if (!viewport?.clientWidth || !viewport.clientHeight) {
      setZoom(roomNodes.length > 14 ? minimumZoom : roomNodes.length > 8 ? 0.875 : 1);
      return;
    }
    const fittedZoom = Math.min(
      1,
      (viewport.clientWidth - 8) / canvasBaseWidth,
      (viewport.clientHeight - 8) / canvasBaseHeight
    );
    setZoom(clamp(Number(fittedZoom.toFixed(3)), minimumZoom, maximumZoom));
  };

  const moveDraftTable = (sessionId: string, position: FloorPosition, snapToGrid = true) => {
    const nextPosition = normalizePosition({
      x: snapToGrid ? snap(position.x) : position.x,
      y: snapToGrid ? snap(position.y) : position.y
    });
    setDraftLayout((current) => ({
      ...mergeWithDefaults(current, roomNodes),
      [sessionId]: nextPosition
    }));
    const tableLabel = roomNodes.find((node) => node.id === sessionId)?.label ?? 'Table';
    setLayoutAnnouncement(`${tableLabel} moved to ${Math.round(nextPosition.x)} percent across and ${Math.round(nextPosition.y)} percent down.`);
  };

  const handleMapDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isEditing) return;
    event.preventDefault();
    const sessionId = draggedTableId ?? event.dataTransfer.getData('text/plain');
    if (!roomNodes.some((node) => node.id === sessionId)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    moveDraftTable(sessionId, {
      x: ((event.clientX - bounds.left - dragOffsetRef.current.x) / bounds.width) * 100,
      y: ((event.clientY - bounds.top - dragOffsetRef.current.y) / bounds.height) * 100
    });
    setDraggedTableId(null);
    dragOffsetRef.current = { x: 0, y: 0 };
  };

  const handleTableKeyDown = (event: KeyboardEvent<HTMLElement>, sessionId: string) => {
    if (!isEditing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const current = activeLayout[sessionId];
    const step = event.shiftKey ? keyboardLargeStep : keyboardStep;
    moveDraftTable(sessionId, {
      x: current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      y: current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
    }, false);
  };

  const openTableContextMenu = (
    nodeId: string,
    event: ReactMouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
  ) => {
    if (isEditing) return;
    event.preventDefault();
    contextTriggerRef.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = 'clientX' in event && event.clientX ? event.clientX : bounds.left + bounds.width / 2;
    const y = 'clientY' in event && event.clientY ? event.clientY : bounds.top + bounds.height / 2;
    setContextMenu({
      nodeId,
      x: Math.max(8, Math.min(x, window.innerWidth - 224)),
      y: Math.max(8, Math.min(y, window.innerHeight - 154))
    });
  };

  const handleTableIdentityKeyDown = (event: KeyboardEvent<HTMLButtonElement>, nodeId: string) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      openTableContextMenu(nodeId, event);
    }
  };

  const submitPhysicalTable = (event: FormEvent) => {
    event.preventDefault();
    const label = newTableLabel.trim();
    if (!label) return;
    onAddPhysicalTable?.(label, newTableCap);
    setAddTableOpen(false);
  };

  const submitGameAtTable = (event: FormEvent) => {
    event.preventDefault();
    if (!startTableId || !startGameId) return;
    onStartGameAtTable?.(startTableId, startGameId);
    setStartTableId(null);
  };

  const selectedStartTable = physicalTables.find((table) => table.id === startTableId);

  return (
    <section className={`floor-room-map ${isEditing ? 'is-editing' : ''}`} aria-labelledby="floor-room-map-title">
      <header className="floor-room-map-header">
        <div>
          <span className="floor-room-map-eyebrow"><LayoutGrid size={14} /> Live room</span>
          <h2 id="floor-room-map-title">Room map</h2>
          {isEditing ? <p>Drag tables or use the arrow keys to match the physical room.</p> : null}
          {layoutSaveError ? <p className="floor-room-map-save-error" role="alert">{layoutSaveError}</p> : null}
          <span className="sr-only" role="status" aria-live="polite">{layoutAnnouncement}</span>
        </div>
        <div className="floor-room-map-actions">
          <div className="floor-room-map-zoom" role="group" aria-label="Room map zoom">
            <button
              className="floor-room-map-action"
              type="button"
              onClick={() => setZoom((current) => clamp(Number((current - zoomStep).toFixed(3)), minimumZoom, maximumZoom))}
              disabled={zoom <= minimumZoom}
              aria-label="Zoom room map out"
              title="Zoom out"
            ><ZoomOut size={15} /></button>
            <output aria-live="polite">{Math.round(zoom * 100)}%</output>
            <button
              className="floor-room-map-action"
              type="button"
              onClick={() => setZoom((current) => clamp(Number((current + zoomStep).toFixed(3)), minimumZoom, maximumZoom))}
              disabled={zoom >= maximumZoom}
              aria-label="Zoom room map in"
              title="Zoom in"
            ><ZoomIn size={15} /></button>
            <button className="floor-room-map-action floor-room-map-fit-action" type="button" onClick={fitRoomMap} title="Fit room">
              <Maximize2 size={14} /> Fit
            </button>
          </div>
          {isEditing ? (
            <>
              <button className="ghost-button floor-room-map-action" type="button" onClick={resetDraftLayout}><RotateCcw size={15} /> Reset</button>
              <button ref={cancelButtonRef} className="ghost-button floor-room-map-action" type="button" onClick={cancelEditing}><X size={15} /> Cancel</button>
              <button className="primary-button floor-room-map-action" type="button" onClick={saveLayout}><Check size={15} /> Save layout</button>
            </>
          ) : (
            <>
              <Dialog.Root
                open={addTableOpen}
                onOpenChange={(open) => {
                  setAddTableOpen(open);
                  if (open) {
                    setNewTableLabel(`Table ${physicalTables.length + 1}`);
                    setNewTableCap(10);
                  }
                }}
              >
                <Dialog.Trigger asChild>
                  <button className="secondary-button floor-room-map-action" type="button">
                    <Plus size={15} /> Add permanent table
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="floor-map-dialog-overlay" />
                  <Dialog.Content className="floor-map-dialog" aria-describedby="add-physical-table-description">
                    <div className="floor-map-dialog-head">
                      <div>
                        <Dialog.Title>Add permanent table</Dialog.Title>
                        <Dialog.Description className="sr-only" id="add-physical-table-description">
                          Add a physical table that remains visible when it has no game.
                        </Dialog.Description>
                      </div>
                      <Dialog.Close asChild><button className="icon-button" aria-label="Close add table"><X size={18} /></button></Dialog.Close>
                    </div>
                    <form className="floor-map-dialog-form" onSubmit={submitPhysicalTable}>
                      <label><span>Table name</span><input autoFocus value={newTableLabel} onChange={(event) => setNewTableLabel(event.target.value)} /></label>
                      <label><span>Seats</span><select value={newTableCap} onChange={(event) => setNewTableCap(Number(event.target.value) as TableCap)}><option value={6}>6</option><option value={8}>8</option><option value={10}>10</option></select></label>
                      <button className="primary-button" type="submit" disabled={!newTableLabel.trim()}>Add table</button>
                    </form>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              <button ref={editButtonRef} className="secondary-button floor-room-map-action" type="button" onClick={beginEditing} disabled={!roomNodes.length}>
                <Pencil size={15} /> Edit layout
              </button>
            </>
          )}
        </div>
      </header>

      <Dialog.Root open={Boolean(startTableId)} onOpenChange={(open) => { if (!open) setStartTableId(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="floor-map-dialog-overlay" />
          <Dialog.Content className="floor-map-dialog" aria-describedby="start-table-game-description">
            <div className="floor-map-dialog-head">
              <div>
                <Dialog.Title>Start a game at {selectedStartTable?.label ?? 'table'}</Dialog.Title>
                <Dialog.Description className="sr-only" id="start-table-game-description">
                  Choose which configured game will use this physical table.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild><button className="icon-button" aria-label="Close game selection"><X size={18} /></button></Dialog.Close>
            </div>
            <form className="floor-map-dialog-form" onSubmit={submitGameAtTable}>
              <label><span>Game</span><select autoFocus value={startGameId} onChange={(event) => setStartGameId(event.target.value)}>{games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
              {!games.length ? <p>Add a game in Settings first.</p> : null}
              <button className="primary-button" type="submit" disabled={!startGameId}>Create forming game</button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
          <Dialog.Content className="floor-map-dialog" aria-describedby="merge-table-description">
            <div className="floor-map-dialog-head">
              <div>
                <Dialog.Title>Merge {mergeSourceSession?.label ?? 'table'}</Dialog.Title>
                <Dialog.Description id="merge-table-description">
                  Move every seated player and close the source table.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild><button className="icon-button" aria-label="Close merge table"><X size={18} /></button></Dialog.Close>
            </div>
            <form
              className="floor-map-dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!mergeSourceSessionId || !mergeTargetSessionId) return;
                onMergeTable?.(mergeSourceSessionId, mergeTargetSessionId);
                setMergeSourceSessionId(null);
                setMergeTargetSessionId('');
              }}
            >
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

      <div className="floor-room-map-viewport" ref={viewportRef}>
        <div
          className="floor-room-map-canvas"
          style={canvasStyle}
          onDragOver={(event) => {
            if (isEditing) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={handleMapDrop}
        >
          {roomNodes.length ? roomNodes.map((node, nodeIndex) => {
            const { session, physicalTable } = node;
            const game = session ? games.find((item) => item.id === session.gameId) : undefined;
            const seatedPlayers = playerSessions
              .filter((playerSession) => session && playerSession.tableId === session.id && !playerSession.leftAt)
              .sort((left, right) => (left.seatNumber ?? 99) - (right.seatNumber ?? 99));
            const playersBySeat = assignPlayersToSeats(seatedPlayers, node.maxSeats);
            const isTimeCollection = Boolean(session && (session.collectionMode === 'Time' || session.timeFeeBased));
            const timerStatuses = seatedPlayers
              .filter((playerSession) => playerSession.timeFeeEnabled)
              .map((playerSession) => getTimerStatusFromSeconds(getTimeRemainingSeconds(playerSession, clockNow)));
            const urgentCount = timerStatuses.filter((status) => status === 'red').length;
            const approachingCount = timerStatuses.filter((status) => status === 'yellow').length;
            const attentionTone = urgentCount
              ? 'requires-action'
              : approachingCount || session?.status === 'Paused'
                ? 'approaching-action'
                : '';
            const occupiedSeatSummary = Array.from(playersBySeat.entries())
              .map(([seatNumber, playerSession]) => {
                const timerStatus = playerSession.timeFeeEnabled
                  ? getTimerStatusFromSeconds(getTimeRemainingSeconds(playerSession, clockNow))
                  : '';
                const timerSummary = timerStatus === 'red'
                  ? ', timer due'
                  : timerStatus === 'yellow'
                    ? ', timer approaching'
                    : '';
                return `Seat ${seatNumber}, ${playerSession.playerName}${timerSummary}`;
              })
              .join('; ');
            const position = activeLayout[node.id];
            const status = session?.status ?? 'Empty';

            return (
              <article
                className={`floor-map-table ${session ? '' : 'is-empty'} ${attentionTone} ${draggedTableId === node.id ? 'is-dragging' : ''}`}
                draggable={isEditing}
                key={node.id}
                onDragStart={(event) => {
                  if (!isEditing) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  dragOffsetRef.current = {
                    x: event.clientX - (bounds.left + bounds.width / 2),
                    y: event.clientY - (bounds.top + bounds.height / 2)
                  };
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', node.id);
                  setDraggedTableId(node.id);
                }}
                onDragEnd={() => {
                  setDraggedTableId(null);
                  dragOffsetRef.current = { x: 0, y: 0 };
                }}
                onFocus={() => { focusedTableIdRef.current = node.id; }}
                onKeyDown={(event) => handleTableKeyDown(event, node.id)}
                onContextMenu={(event) => openTableContextMenu(node.id, event)}
                ref={nodeIndex === 0 ? firstTableRef : undefined}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                tabIndex={isEditing ? 0 : -1}
                aria-label={isEditing ? `Move ${node.label}. Current position ${Math.round(position.x)} percent across and ${Math.round(position.y)} percent down. Use arrow keys to reposition.` : undefined}
              >
                <div className="floor-map-table-meta">
                  <span className={`floor-map-table-status status-${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
                  <span className="floor-map-table-mode" aria-label={session ? (isTimeCollection ? 'Time countdown' : 'Drop session count up') : 'Available physical table'}>
                    {session ? (isTimeCollection ? '↓ Time' : '↑ Drop') : 'Available'}
                  </span>
                </div>
                <div className="floor-map-table-object">
                  <div className="floor-map-table-apron" aria-hidden="true" />
                  <div className="floor-map-table-felt">
                    <span className="floor-map-chip-rack" aria-hidden="true" />
                    {Array.from({ length: node.maxSeats }, (_, index) => {
                      const seatNumber = index + 1;
                      const playerSession = playersBySeat.get(seatNumber);
                      const timerStatus = playerSession?.timeFeeEnabled
                        ? getTimerStatusFromSeconds(getTimeRemainingSeconds(playerSession, clockNow))
                        : '';
                      return (
                        <span
                          className={`floor-map-seat ${playerSession ? 'occupied' : 'open'} ${timerStatus}`}
                          key={seatNumber}
                          style={getMiniSeatPosition(index, node.maxSeats)}
                          title={playerSession ? `Seat ${seatNumber}: ${playerSession.playerName}` : `Seat ${seatNumber}: open`}
                        />
                      );
                    })}
                    <button
                      className="floor-map-table-identity"
                      type="button"
                      disabled={isEditing}
                      onClick={() => {
                        if (session) onOpenTable(session.id);
                        else if (physicalTable) {
                          setStartGameId(games[0]?.id ?? '');
                          setStartTableId(physicalTable.id);
                        }
                      }}
                      onKeyDown={(event) => handleTableIdentityKeyDown(event, node.id)}
                      aria-label={session
                        ? `Open ${node.label}, ${seatedPlayers.length} of ${node.maxSeats} seats filled${occupiedSeatSummary ? `. ${occupiedSeatSummary}` : ''}`
                        : `Start a game at ${node.label}`}
                    >
                      <strong>{node.label}</strong>
                      {!session ? <small>Start game</small> : null}
                    </button>
                  </div>
                </div>
                <div className="floor-map-table-summary">
                  <strong>{game?.name ?? 'No game assigned'}</strong>
                  <span>{seatedPlayers.length}/{node.maxSeats} seated</span>
                  {urgentCount
                    ? <em className="urgent">{urgentCount} timer{urgentCount === 1 ? '' : 's'} due</em>
                    : approachingCount
                      ? <em className="soon">{approachingCount} timer{approachingCount === 1 ? '' : 's'} soon</em>
                      : null}
                </div>
              </article>
            );
          }) : (
            <div className="floor-room-map-empty">
              <LayoutGrid size={24} />
              <strong>No tables configured</strong>
              <span>Add the club's first permanent table.</span>
            </div>
          )}
        </div>
      </div>
      {contextMenu && contextNode ? createPortal(
        <div
          aria-label={`${contextNode.label} table actions`}
          className="floor-table-context-menu"
          onKeyDown={handleContextMenuKeyDown}
          ref={contextMenuRef}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            disabled={!contextNode.session}
            onClick={() => {
              if (contextNode.session) onClearTable?.(contextNode.session.id);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            Clear table
          </button>
          <button
            onClick={() => {
              onDeleteTable?.(contextNode.id);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            Delete table
          </button>
          <button
            disabled={!contextNode.session || !contextMergeTargets.length}
            onClick={() => {
              if (!contextNode.session || !contextMergeTargets.length) return;
              setMergeSourceSessionId(contextNode.session.id);
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
