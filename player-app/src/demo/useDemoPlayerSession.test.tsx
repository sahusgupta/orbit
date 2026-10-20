/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAppState } from '../app/playerPlatform';
import { isMembershipCurrentlyActive, isTournamentInterestOpen } from '../domain/playerSync';
import { createDemoPlayerData } from './demoPlayerData';
import { useDemoPlayerSession } from './useDemoPlayerSession';

const appState = vi.hoisted(() => {
  const current: { listener?: (state: PlayerAppState) => void } = {};
  return { current, subscribe: vi.fn(), unsubscribe: vi.fn() };
});

vi.mock('../app/playerPlatform', () => ({
  playerPlatform: {
    subscribeToAppState: appState.subscribe.mockImplementation((listener: (state: PlayerAppState) => void) => {
      appState.current.listener = listener;
      return appState.unsubscribe;
    })
  }
}));

vi.mock('../application/usePlayerStorage', () => {
  throw new Error('The demo session must not load connected player storage.');
});
vi.mock('../data/storage/playerStorage', () => {
  throw new Error('The demo session must not load persisted player data.');
});
vi.mock('../data/orbitSyncApi', () => {
  throw new Error('The demo session must not load the Orbit API.');
});

const startTime = Date.parse('2026-10-11T12:00:00.000Z');
const dayMs = 24 * 60 * 60 * 1000;

describe('In-memory demo player session', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let session: ReturnType<typeof useDemoPlayerSession> | undefined;

  function Harness() {
    session = useDemoPlayerSession();
    return <button onClick={session.liveData.retryLiveData}>Refresh demo games</button>;
  }

  const current = () => {
    if (!session) throw new Error('The demo session has not mounted.');
    return session;
  };

  const mount = () => {
    act(() => root.render(<Harness />));
    mounted = true;
  };

  const unmount = () => {
    if (mounted) act(() => root.unmount());
    mounted = false;
  };

  const changeAppState = (state: PlayerAppState) => {
    const listener = appState.current.listener;
    if (!listener) throw new Error('The demo did not subscribe to app state.');
    act(() => listener(state));
  };

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    vi.setSystemTime(startTime);
    vi.clearAllMocks();
    appState.current.listener = undefined;
    session = undefined;
    mounted = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    unmount();
    container.remove();
    vi.useRealTimers();
  });

  it('starts ready with a demo account and complete inventory without importing persistence or the API', () => {
    mount();
    const expected = createDemoPlayerData(startTime);
    expect(current().storage).toMatchObject({
      accountLoaded: true,
      dismissedAlertsLoaded: true,
      hasAccount: true,
      player: expected.player,
      draftPlayer: expected.player,
      playerStorageError: ''
    });
    expect(current().liveData).toMatchObject({
      clockNow: startTime,
      clubs: expected.clubs,
      tournaments: expected.tournaments,
      tournamentInterests: expected.tournamentInterests,
      liveDataStatus: 'ready',
      liveDataPartial: false,
      profileEditingReady: true,
      profileSyncNotice: '',
      tournamentLoadError: ''
    });
    expect(appState.subscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reseeds changed games from the current clock when retry receives a press event', () => {
    mount();
    act(() => {
      current().liveData.setClubs([]);
      current().liveData.setTournamentInterests([]);
      current().liveData.setSelectedClubId('demo-removed-club');
      current().liveData.setClubMembershipMessage('Changed membership message');
      current().liveData.setClubSelectionNotice('Changed selection');
      current().storage.dismissInAppAlert('demo-dismissed');
    });
    expect(current().liveData.clubs).toEqual([]);
    expect(current().storage.dismissedNotificationIds).toEqual(['demo-dismissed']);

    const refreshedAt = startTime + 2 * 60 * 60 * 1000;
    vi.setSystemTime(refreshedAt);
    const button = container.querySelector('button');
    if (!button) throw new Error('The refresh button is missing.');
    act(() => button.click());

    const expected = createDemoPlayerData(refreshedAt);
    expect(current().liveData.clockNow).toBe(refreshedAt);
    expect(current().liveData.clubs).toEqual(expected.clubs);
    expect(current().liveData.tournaments).toEqual(expected.tournaments);
    expect(current().liveData.tournamentInterests).toEqual(expected.tournamentInterests);
    expect(current().liveData.selectedClubId).toBe(expected.clubs[0].club.id);
    expect(current().liveData.clubMembershipMessage).toBe('');
    expect(current().liveData.clubSelectionNotice).toBe('');
    expect(current().storage.dismissedNotificationIds).toEqual([]);
  });

  it('regenerates event and membership dates when the minute clock crosses midnight', () => {
    const beforeMidnight = Date.parse('2026-10-11T23:59:30.000Z');
    vi.setSystemTime(beforeMidnight);
    mount();
    const oldClubs = current().liveData.clubs;
    const oldStart = current().liveData.tournaments[0].startsAt;

    act(() => vi.advanceTimersByTime(60_000));

    const afterMidnight = beforeMidnight + 60_000;
    expect(current().liveData.clockNow).toBe(afterMidnight);
    expect(current().liveData.clubs).not.toBe(oldClubs);
    expect(current().liveData.clubs).toEqual(createDemoPlayerData(afterMidnight).clubs);
    expect(Date.parse(current().liveData.tournaments[0].startsAt) - Date.parse(oldStart)).toBe(60_000);
    expect(current().liveData.tournaments.every((event) => isTournamentInterestOpen(event, afterMidnight))).toBe(true);
    expect(current().liveData.clubs.flatMap((club) => club.memberships)
      .every((membership) => isMembershipCurrentlyActive(membership, afterMidnight))).toBe(true);
  });

  it('refreshes stale demo dates on foreground after the app clock skips multiple days', () => {
    mount();
    const originalClubs = current().liveData.clubs;
    const resumedAt = startTime + 40 * dayMs;
    vi.setSystemTime(resumedAt);
    changeAppState('background');
    expect(current().liveData.clockNow).toBe(startTime);
    expect(current().liveData.clubs).toBe(originalClubs);

    changeAppState('active');

    expect(current().liveData.clockNow).toBe(resumedAt);
    expect(current().liveData.clubs).toEqual(createDemoPlayerData(resumedAt).clubs);
    expect(current().liveData.tournaments.every((event) => isTournamentInterestOpen(event, resumedAt))).toBe(true);
    expect(current().liveData.clubs.flatMap((club) => club.memberships)
      .every((membership) => isMembershipCurrentlyActive(membership, resumedAt))).toBe(true);
  });

  it('removes the minute interval and app-state subscription on unmount', () => {
    mount();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(appState.unsubscribe).toHaveBeenCalledOnce();
  });
});
