/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerClubSnapshot, PlayerSyncGame, PlayerWaitlistEntry } from '../../domain/playerSync';
import { MyGamesSection } from './DiscoveryLists';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, style: _style, ...props }: Record<string, unknown>) => (
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {})
    }, children as React.ReactNode)
  );
  return {
    Platform: { OS: 'web' },
    Pressable: element('button'),
    ScrollView: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: element('span'),
    View: element('div')
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span /> }));

const game: PlayerSyncGame = {
  id: 'game-1', name: 'Published Game', maxSeats: 9, openTables: [], waitlistCount: 1,
  formingCount: 0, availableSeats: 0, knownPlayersCount: 0
};
const entry: PlayerWaitlistEntry = {
  id: 'wait-1', clubId: 'club-1', gameId: game.id, playerId: 'player-1', playerName: 'Alex',
  status: 'Interested', position: 0, requestedAt: '2026-09-04T12:00:00.000Z'
};
const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Published Club' }, games: [game], memberships: [], waitlists: [entry],
  notifications: [], social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 1 },
  generatedAt: '2026-09-04T12:00:00.000Z'
};

describe('My Games stale action boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps stale request facts visible but prevents cancellation', () => {
    const onCancel = vi.fn();
    act(() => root.render(
      <MyGamesSection games={[{ club, game, entry }]} readOnly onCancel={onCancel} />
    ));

    expect(container.textContent).toContain('Requests are read-only until published venue data refreshes.');
    expect(container.textContent).toContain('Published Game');
    const cancel = container.querySelector('[aria-label="Cancel request for Published Game"]') as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    act(() => cancel.click());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('surfaces a cancellation failure beside the restored active request', () => {
    act(() => root.render(
      <MyGamesSection
        games={[{ club, game, entry }]}
        message="Cancellation was not sent. The service is unavailable."
        onCancel={vi.fn()}
      />
    ));

    expect(container.textContent).toContain('Published Game');
    expect(container.textContent).toContain('Cancellation was not sent. The service is unavailable.');
  });
});
