import * as Dialog from '@radix-ui/react-dialog';
import { Activity, Clock, Maximize2, Minimize2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameConfig, GameSession, PlayerSession } from '../domain/types';
import {
  filterFloorActivityItems,
  type FloorActivityEventType,
  type FloorActivityItem
} from '../features/floor/floorActivity';
import { getTimerStatusFromSeconds } from '../lib/appCore';

type FloorUtilitiesProps = {
  sessions: GameSession[];
  games: GameConfig[];
  playerSessions: PlayerSession[];
  activityItems: FloorActivityItem[];
  clockNow: number;
  getTimeRemainingSeconds: (session: PlayerSession, nowMs?: number) => number;
  formatClock: (iso?: string) => string;
  formatTimeLeft: (seconds: number) => string;
};

type OpenUtility = 'timers' | 'activity' | null;
type TimerTone = 'red' | 'yellow' | 'green' | 'neutral';

type TimerRow = {
  playerSession: PlayerSession;
  table: GameSession;
  tone: TimerTone;
  displayTime: string;
  statusText: string;
  sortSeconds: number;
  isLegacyCountdown: boolean;
};

const timerToneOrder: Record<TimerTone, number> = {
  red: 0,
  yellow: 1,
  green: 2,
  neutral: 3
};

const eventClassName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

type TableOptionCandidate = {
  id: string;
  label: string;
  qualifier: string;
};

const optionKey = (value: string) => value.trim().toLocaleLowerCase();

const disambiguateTableOptions = (options: TableOptionCandidate[]) => {
  const baseCounts = new Map<string, number>();
  options.forEach((option) => {
    const key = optionKey(option.label);
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
  });

  const contextualOptions = options.map((option) => ({
    id: option.id,
    label: (baseCounts.get(optionKey(option.label)) ?? 0) > 1
      ? `${option.label} · ${option.qualifier || option.id}`
      : option.label
  }));
  const contextualCounts = new Map<string, number>();
  contextualOptions.forEach((option) => {
    const key = optionKey(option.label);
    contextualCounts.set(key, (contextualCounts.get(key) ?? 0) + 1);
  });

  return contextualOptions
    .map((option) => ({
      ...option,
      label: (contextualCounts.get(optionKey(option.label)) ?? 0) > 1
        ? `${option.label} · ${option.id}`
        : option.label
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
};

export default function FloorUtilities({
  sessions,
  games,
  playerSessions,
  activityItems,
  clockNow,
  getTimeRemainingSeconds,
  formatClock,
  formatTimeLeft
}: FloorUtilitiesProps) {
  const [openUtility, setOpenUtility] = useState<OpenUtility>(null);
  const [timerTableId, setTimerTableId] = useState('');
  const [activityTableId, setActivityTableId] = useState('');
  const [activityEventType, setActivityEventType] = useState<FloorActivityEventType | ''>('');
  const [activityExpanded, setActivityExpanded] = useState(false);
  const timerTriggerRef = useRef<HTMLButtonElement>(null);
  const activityTriggerRef = useRef<HTMLButtonElement>(null);
  const timerTableFilterRef = useRef<HTMLSelectElement>(null);
  const activityTableFilterRef = useRef<HTMLSelectElement>(null);
  const lastOpenUtilityRef = useRef<Exclude<OpenUtility, null> | null>(null);

  useEffect(() => {
    if (openUtility) {
      lastOpenUtilityRef.current = openUtility;
      return;
    }
    const closedUtility = lastOpenUtilityRef.current;
    if (!closedUtility) return;
    lastOpenUtilityRef.current = null;
    const trigger = closedUtility === 'timers' ? timerTriggerRef.current : activityTriggerRef.current;
    const focusTimer = window.setTimeout(() => trigger?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [openUtility]);

  const openSessions = useMemo(
    () => sessions.filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start'),
    [sessions]
  );
  const gameNamesById = useMemo(
    () => new Map(games.map((game) => [game.id, game.name])),
    [games]
  );
  const timerTableOptions = useMemo(() => disambiguateTableOptions(
    openSessions.map((session) => ({
      id: session.id,
      label: session.label.trim() || 'Unknown table',
      qualifier: gameNamesById.get(session.gameId) ?? 'Unknown game'
    }))
  ), [gameNamesById, openSessions]);
  const effectiveTimerTableId = timerTableId && timerTableOptions.some(
    (option) => option.id === timerTableId
  ) ? timerTableId : '';

  useEffect(() => {
    if (timerTableId && !effectiveTimerTableId) setTimerTableId('');
  }, [effectiveTimerTableId, timerTableId]);

  const timerRows = useMemo(() => {
    const openSessionsById = new Map(openSessions.map((session) => [session.id, session]));

    return playerSessions
      .filter((playerSession) => !playerSession.leftAt && openSessionsById.has(playerSession.tableId))
      .map<TimerRow>((playerSession) => {
        const table = openSessionsById.get(playerSession.tableId)!;
        const isTimeCollection = table.collectionMode === 'Time' || table.timeFeeBased;

        if (isTimeCollection || playerSession.timeFeeEnabled) {
          const remainingSeconds = getTimeRemainingSeconds(playerSession, clockNow);
          const tone = getTimerStatusFromSeconds(remainingSeconds);
          return {
            playerSession,
            table,
            tone,
            displayTime: formatTimeLeft(remainingSeconds),
            statusText: tone === 'red' ? 'Needs attention' : tone === 'yellow' ? 'Approaching' : 'On track',
            sortSeconds: remainingSeconds,
            isLegacyCountdown: !isTimeCollection
          };
        }

        const seatedAt = new Date(playerSession.seatedAt).getTime();
        const elapsedSeconds = Number.isFinite(seatedAt)
          ? Math.max(0, Math.floor((clockNow - seatedAt) / 1000))
          : 0;
        return {
          playerSession,
          table,
          tone: 'neutral',
          displayTime: formatTimeLeft(elapsedSeconds),
          statusText: 'At table',
          sortSeconds: elapsedSeconds,
          isLegacyCountdown: false
        };
      });
  }, [clockNow, formatTimeLeft, getTimeRemainingSeconds, openSessions, playerSessions]);

  const urgentTimerCount = timerRows.filter((row) => row.tone === 'red').length;
  const approachingTimerCount = timerRows.filter((row) => row.tone === 'yellow').length;
  const timerTriggerLabel = urgentTimerCount
    ? `Timers, ${pluralize(urgentTimerCount, 'player')} due`
    : approachingTimerCount
      ? `Timers, ${pluralize(approachingTimerCount, 'player')} soon`
      : timerRows.length
        ? 'Timers, no players need attention'
        : 'Timers, no seated players';

  const timerGroups = useMemo(() => openSessions
    .filter((session) => !effectiveTimerTableId || session.id === effectiveTimerTableId)
    .map((session) => ({
      session,
      rows: timerRows
        .filter((row) => row.table.id === session.id)
        .sort((left, right) =>
          timerToneOrder[left.tone] - timerToneOrder[right.tone] ||
          left.sortSeconds - right.sortSeconds ||
          (left.playerSession.seatNumber ?? 99) - (right.playerSession.seatNumber ?? 99)
        )
    }))
    .filter((group) => group.rows.length), [effectiveTimerTableId, openSessions, timerRows]);

  const activityEventTypes = useMemo(
    () => Array.from(new Set(activityItems.map((item) => item.eventType)))
      .sort((left, right) => left.localeCompare(right)),
    [activityItems]
  );

  const activityTableOptions = useMemo(() => {
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const labelsById = new Map(openSessions.map((session) => [
      session.id,
      session.label.trim() || 'Unknown table'
    ]));
    activityItems.forEach((item) => {
      if (!item.tableId) return;
      const session = sessionsById.get(item.tableId);
      labelsById.set(
        item.tableId,
        item.tableLabel?.trim() || session?.label.trim() || labelsById.get(item.tableId) || 'Unknown table'
      );
    });
    return disambiguateTableOptions(Array.from(labelsById, ([id, label]) => {
      const session = sessionsById.get(id);
      return {
        id,
        label,
        qualifier: session
          ? `${gameNamesById.get(session.gameId) ?? 'Unknown game'} · ${session.status}`
          : id
      };
    }));
  }, [activityItems, gameNamesById, openSessions, sessions]);

  const effectiveActivityTableId = activityTableId && activityTableOptions.some(
    (option) => option.id === activityTableId
  ) ? activityTableId : '';
  const effectiveActivityEventType = activityEventType && activityEventTypes.includes(
    activityEventType
  ) ? activityEventType : '';

  useEffect(() => {
    if (activityTableId && !effectiveActivityTableId) setActivityTableId('');
  }, [activityTableId, effectiveActivityTableId]);

  useEffect(() => {
    if (activityEventType && !effectiveActivityEventType) setActivityEventType('');
  }, [activityEventType, effectiveActivityEventType]);

  const filteredActivityItems = useMemo(() => filterFloorActivityItems(activityItems, {
    ...(effectiveActivityTableId ? { tableId: effectiveActivityTableId } : {}),
    ...(effectiveActivityEventType ? { eventType: effectiveActivityEventType } : {})
  }), [activityItems, effectiveActivityEventType, effectiveActivityTableId]);

  return (
    <div className="floor-utilities" role="group" aria-label="Room utilities">
      <Dialog.Root
        open={openUtility === 'timers'}
        onOpenChange={(open) => setOpenUtility(open ? 'timers' : null)}
      >
        <Dialog.Trigger asChild>
          <button
            ref={timerTriggerRef}
            aria-label={timerTriggerLabel}
            className={`floor-utility-button ${urgentTimerCount ? 'requires-action' : approachingTimerCount ? 'approaching-action' : ''}`}
            type="button"
          >
            <Clock size={16} />
            <span>Timers</span>
            {urgentTimerCount ? <strong>{urgentTimerCount} due</strong> : null}
            {!urgentTimerCount && approachingTimerCount ? <strong>{approachingTimerCount} soon</strong> : null}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="floor-utility-overlay" />
          <Dialog.Content
            className="floor-utility-drawer floor-timers-drawer"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              timerTableFilterRef.current?.focus();
            }}
          >
            <div className="floor-utility-drawer-head">
              <div>
                <span>Room overview</span>
                <Dialog.Title className="floor-utility-title">Timers</Dialog.Title>
                <Dialog.Description className="floor-utility-description">
                  Time counts down. Drop counts up unless an existing legacy countdown is active.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button aria-label="Close room timers" className="icon-button" title="Close room timers" type="button">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>

            <div className="floor-utility-filters">
              <label>
                <span>Table</span>
                <select
                  ref={timerTableFilterRef}
                  aria-label="Filter timers by table"
                  value={effectiveTimerTableId}
                  onChange={(event) => setTimerTableId(event.target.value)}
                >
                  <option value="">All tables</option>
                  {timerTableOptions.map((table) => (
                    <option key={table.id} value={table.id}>{table.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div
              aria-label="Room timer overview"
              className="floor-utility-list floor-timer-list"
              role="region"
              tabIndex={0}
            >
              {timerGroups.length ? timerGroups.map(({ session, rows }) => {
                const game = games.find((item) => item.id === session.gameId);
                const isTimeCollection = session.collectionMode === 'Time' || session.timeFeeBased;
                const groupTitleId = `floor-timer-group-${session.id}`;
                return (
                  <section className="floor-timer-group" aria-labelledby={groupTitleId} key={session.id}>
                    <header>
                      <div>
                        <strong id={groupTitleId}>{session.label}</strong>
                        <span>{game?.name ?? 'Unknown game'}</span>
                      </div>
                      <em>{isTimeCollection ? 'Time · countdown' : 'Drop · session length'}</em>
                    </header>
                    <div>
                      {rows.map((row) => (
                        <article className={`floor-timer-row ${row.tone}`} key={row.playerSession.id}>
                          <div>
                            <span>Seat {row.playerSession.seatNumber ?? '-'}</span>
                            <strong title={row.playerSession.playerName}>{row.playerSession.playerName}</strong>
                            <small>{row.isLegacyCountdown ? `Legacy timer · ${row.statusText}` : row.statusText}</small>
                          </div>
                          <em aria-label={`${row.displayTime}, ${row.statusText.toLowerCase()}`}>{row.displayTime}</em>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              }) : (
                <p className="floor-utility-empty">
                  {effectiveTimerTableId ? 'No players are seated at this table.' : 'No players are seated on open tables.'}
                </p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={openUtility === 'activity'}
        onOpenChange={(open) => {
          setOpenUtility(open ? 'activity' : null);
          if (open) setActivityExpanded(false);
        }}
      >
        <Dialog.Trigger asChild>
          <button
            ref={activityTriggerRef}
            aria-label={`Activity, ${pluralize(activityItems.length, 'recent event')}`}
            className="floor-utility-button"
            type="button"
          >
            <Activity size={16} />
            <span>Activity</span>
            {activityItems.length ? <strong>{activityItems.length}</strong> : null}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="floor-utility-overlay" />
          <Dialog.Content
            className={`floor-utility-drawer floor-activity-drawer ${activityExpanded ? 'is-expanded' : ''}`}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              activityTableFilterRef.current?.focus();
            }}
          >
            <div className="floor-utility-drawer-head">
              <div>
                <span>Room-wide history</span>
                <Dialog.Title className="floor-utility-title">Activity</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Review recent events and narrow them by exact table and event type.
                </Dialog.Description>
              </div>
              <div className="floor-utility-drawer-actions">
                <button
                  aria-label={activityExpanded ? 'Restore compact activity' : 'Expand activity'}
                  className="icon-button"
                  onClick={() => setActivityExpanded((expanded) => !expanded)}
                  title={activityExpanded ? 'Restore compact activity' : 'Expand activity'}
                  type="button"
                >{activityExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
                <Dialog.Close asChild>
                  <button aria-label="Close room activity" className="icon-button" title="Close room activity" type="button">
                    <X size={18} />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            <div className="floor-utility-filters floor-activity-filters">
              <label>
                <span>Table</span>
                <select
                  ref={activityTableFilterRef}
                  aria-label="Filter activity by table"
                  value={effectiveActivityTableId}
                  onChange={(event) => setActivityTableId(event.target.value)}
                >
                  <option value="">All tables</option>
                  {activityTableOptions.map((table) => (
                    <option key={table.id} value={table.id}>{table.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Event</span>
                <select
                  aria-label="Filter activity by event type"
                  value={effectiveActivityEventType}
                  onChange={(event) => setActivityEventType(event.target.value as FloorActivityEventType | '')}
                >
                  <option value="">All event types</option>
                  {activityEventTypes.map((eventType) => (
                    <option key={eventType} value={eventType}>{eventType}</option>
                  ))}
                </select>
              </label>
            </div>

            <p className="floor-utility-filter-summary" role="status">
              Showing {filteredActivityItems.length} of {activityItems.length} recent events
            </p>

            <div
              aria-label="Room activity"
              className="floor-utility-list floor-activity-list"
              role="region"
              tabIndex={0}
            >
              {filteredActivityItems.length ? filteredActivityItems.map((item) => (
                <article className={`floor-activity-row ${eventClassName(item.kind)}`} key={item.id}>
                  <i aria-hidden="true" />
                  <div>
                    <span>{item.scope === 'room'
                      ? 'Room'
                      : item.scope === 'unassigned-table'
                        ? 'Unassigned table'
                        : item.tableLabel?.trim() || (item.tableId ? sessions.find((session) => session.id === item.tableId)?.label || 'Unknown table' : 'Unknown table')} · {item.eventType}</span>
                    <strong>{item.actor}</strong>
                    <p>{item.label}{item.detail ? ` — ${item.detail}` : ''}</p>
                  </div>
                  <time dateTime={item.timestamp}>{formatClock(item.timestamp)}</time>
                </article>
              )) : (
                <p className="floor-utility-empty">No activity matches both filters.</p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
