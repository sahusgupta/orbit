/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlayerSeatRequestAccess, type PlayerAccount, type PlayerClubSnapshot, type PlayerMembership, type PlayerSyncGame } from '../../domain/playerSync';
import { DiscoveryCardContent } from './DiscoveryDeck';
import { GameDetailsScreen } from './DiscoveryGameDetails';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {})
    }, children as React.ReactNode);
  return {
    Modal: element('div'),
    Platform: { OS: 'web' },
    Pressable: element('button'),
    ScrollView: element('div'),
    Text: element('span'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span data-testid="icon" /> }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../components/PlayerPresentation', () => ({
  AnimatedButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button data-testid="primary-action" onClick={onPress}>{children}</button>
}));

const table = (id: string, status: 'Running' | 'Forming' | 'Paused', availableSeats: number): PlayerSyncGame['openTables'][number] => ({
  id,
  gameId: 'game-1',
  label: id,
  status,
  seatsFilled: 9 - availableSeats,
  maxSeats: 9,
  availableSeats,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-09T12:00:00.000Z',
  social: { seatedPlayerCount: 9 - availableSeats, adminCount: 0, knownPlayersCount: 0 }
});

const game: PlayerSyncGame = {
  id: 'game-1',
  name: '1/2 NLH',
  maxSeats: 9,
  collectionMode: 'Time',
  openTables: [table('running', 'Running', 1), table('forming', 'Forming', 9), table('paused', 'Paused', 5)],
  waitlistCount: 3,
  formingCount: 1,
  availableSeats: 15,
  knownPlayersCount: 0
};

const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Published Club' },
  games: [game],
  memberships: [],
  waitlists: [],
  notifications: [],
  generatedAt: '2026-08-09T12:00:00.000Z'
};

const player: PlayerAccount = { id: 'player-1', name: 'Alex', email: 'alex@example.test', preferredGameIds: [] };

describe('Game details published table status', () => {
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

  it('renders only Running-table seats when aggregate counts include forming and paused capacity', () => {
    act(() => root.render(
      <GameDetailsScreen
        backLabel="Matches"
        item={{ club, game, distanceMiles: null, isJoined: true, isPreferred: false, seatRequestAccess: 'active' }}
        player={player}
        onBack={vi.fn()}
        onDirections={vi.fn()}
        onJoin={vi.fn()}
        onRefresh={vi.fn()}
        onViewStore={vi.fn()}
      />
    ));

    expect(container.textContent).toContain('1 seat open · 3 waiting');
    expect(container.textContent).not.toContain('15 seats open');
    expect(container.textContent).not.toContain('15 open');
  });

  it('labels the relationship-scoped player count as familiar rather than all players', () => {
    const relationshipGame = { ...game, knownPlayersCount: 2 };
    act(() => root.render(
      <DiscoveryCardContent
        item={{ club: { ...club, games: [relationshipGame] }, game: relationshipGame, distanceMiles: null, isJoined: false, isPreferred: false, seatRequestAccess: 'missing' }}
      />
    ));

    expect(container.textContent).toContain('2Familiar');
    expect(container.textContent).not.toContain('Playing');
  });

  it.each([
    ['Requested', 'Await venue activation', 'Membership activation pending'],
    ['Approved', 'Await venue activation', 'Membership activation pending'],
    ['Active', 'Request a seat', null],
    ['Expired', 'Renew access', 'Renew access'],
    ['missing', 'See access options', 'Access options']
  ] as const)('renders truthful seat access for %s membership state', (status, actionLabel, accessLabel) => {
    const membership: PlayerMembership | undefined = status === 'missing' ? undefined : {
      id: `membership-${status.toLowerCase()}`,
      clubId: club.club.id,
      playerId: player.id,
      playerName: player.name,
      status,
      ...(status === 'Active' ? { expiresAt: '2026-09-05T12:00:00.000Z' } : {}),
      loyalty: { clubId: club.club.id, points: 0, lifetimeHours: 0, tier: 'New', nextTierAtHours: 12 },
      preferredGameIds: []
    };
    const membershipClub = { ...club, memberships: membership ? [membership] : [] };
    const seatRequestAccess = getPlayerSeatRequestAccess(membershipClub, player, Date.parse('2026-09-04T12:00:00.000Z'));
    const onJoin = vi.fn();
    const onViewStore = vi.fn();

    act(() => root.render(
      <GameDetailsScreen
        backLabel="Matches"
        item={{
          club: membershipClub,
          game,
          distanceMiles: null,
          isJoined: seatRequestAccess === 'active',
          isPreferred: false,
          seatRequestAccess
        }}
        player={player}
        onBack={vi.fn()}
        onDirections={vi.fn()}
        onJoin={onJoin}
        onRefresh={vi.fn()}
        onViewStore={onViewStore}
      />
    ));

    const primaryAction = container.querySelector('[data-testid="primary-action"]') as HTMLButtonElement;
    expect(primaryAction.textContent).toContain(actionLabel);
    act(() => primaryAction.click());
    expect(onJoin).toHaveBeenCalledOnce();

    if (accessLabel) {
      expect(container.textContent).toContain(accessLabel);
      const accessAction = Array.from(container.querySelectorAll('button'))
        .find((candidate) => candidate !== primaryAction && candidate.textContent?.includes(accessLabel));
      expect(accessAction).toBeDefined();
      act(() => accessAction?.click());
      if (seatRequestAccess === 'pending') {
        expect(onJoin).toHaveBeenCalledTimes(2);
        expect(onViewStore).not.toHaveBeenCalled();
      } else {
        expect(onViewStore).toHaveBeenCalledOnce();
      }
    } else {
      expect(container.textContent).not.toContain('Access options');
      expect(onViewStore).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['removed', null, false, 'This listing is no longer available'],
    ['stale', { club, game, distanceMiles: null, isJoined: true, isPreferred: false, seatRequestAccess: 'active' as const }, true, 'This listing could not be refreshed']
  ] as const)('keeps %s listing details read-only with only back and refresh reachable', (_case, item, readOnly, title) => {
    const onBack = vi.fn();
    const onDirections = vi.fn();
    const onJoin = vi.fn();
    const onRefresh = vi.fn();
    const onViewStore = vi.fn();

    act(() => root.render(
      <GameDetailsScreen
        backLabel="Matches"
        item={item}
        player={player}
        onBack={onBack}
        onDirections={onDirections}
        onJoin={onJoin}
        onRefresh={onRefresh}
        readOnly={readOnly}
        onViewStore={onViewStore}
      />
    ));

    expect(container.textContent).toContain(title);
    expect(container.textContent).not.toContain('Request a seat');
    expect(container.querySelector('[aria-label^="Directions"]')).toBeNull();
    act(() => Array.from(container.querySelectorAll('button')).forEach((button) => button.click()));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onDirections).not.toHaveBeenCalled();
    expect(onJoin).not.toHaveBeenCalled();
    expect(onViewStore).not.toHaveBeenCalled();
  });
});
