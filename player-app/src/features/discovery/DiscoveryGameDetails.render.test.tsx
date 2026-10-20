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
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityRole, accessibilityState, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
      ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
      ...(accessibilityState && typeof accessibilityState === 'object' && 'expanded' in accessibilityState
        ? { 'aria-expanded': accessibilityState.expanded } : {})
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
  AnimatedButton: ({ children, onPress, disabled }: { children: React.ReactNode; onPress?: () => void; disabled?: boolean }) => <button data-testid="primary-action" disabled={disabled} onClick={onPress}>{children}</button>
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

  it('opens an existing request instead of creating another and keeps coordinate-only directions available', () => {
    const onJoin = vi.fn();
    const onViewRequest = vi.fn();
    const onDirections = vi.fn();
    const coordinateClub = { ...club, club: { ...club.club, coordinate: { latitude: 30.27, longitude: -97.74 } } };
    act(() => root.render(<GameDetailsScreen
      backLabel="Matches"
      item={{ club: coordinateClub, game, distanceMiles: null, isJoined: true, isPreferred: false, seatRequestAccess: 'active' }}
      player={player} onBack={vi.fn()} onDirections={onDirections} onJoin={onJoin}
      onRefresh={vi.fn()} onViewStore={vi.fn()} activeRequest onViewRequest={onViewRequest}
    />));

    const primaryAction = container.querySelector('[data-testid="primary-action"]') as HTMLButtonElement;
    expect(primaryAction.textContent).toContain('View your request');
    act(() => primaryAction.click());
    expect(onViewRequest).toHaveBeenCalledOnce();
    expect(onJoin).not.toHaveBeenCalled();
    const directions = container.querySelector('[aria-label="Directions to Published Club"]') as HTMLButtonElement;
    expect(directions).not.toBeNull();
    act(() => directions.click());
    expect(onDirections).toHaveBeenCalledOnce();
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

  it('keeps pass, save, and details accessible on the compact game card', () => {
    const onPass = vi.fn();
    const onPick = vi.fn();
    const onDetails = vi.fn();
    act(() => root.render(
      <DiscoveryCardContent
        item={{ club, game, distanceMiles: null, isJoined: true, isPreferred: false, seatRequestAccess: 'active' }}
        onPass={onPass}
        onPick={onPick}
        onDetails={onDetails}
      />
    ));
    for (const label of ['Pass on 1/2 NLH', 'Save 1/2 NLH', 'See full details for 1/2 NLH']) {
      const button = container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
      expect(button).not.toBeNull();
      act(() => button.click());
    }
    expect(onPass).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledOnce();
    expect(onDetails).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('1Open seats');
    expect(container.textContent).toContain('3Waitlist');
  });

  it('keeps directions direct and requires a request disclosure before the existing confirmation handoff', () => {
    const addressedClub = { ...club, club: { ...club.club, address: '100 Example Street, Austin, TX' } };
    const onJoin = vi.fn();
    const onDirections = vi.fn();
    act(() => root.render(
      <GameDetailsScreen
        backLabel="Games"
        item={{ club: addressedClub, game, distanceMiles: null, isJoined: true, isPreferred: false, seatRequestAccess: 'active' }}
        player={player}
        onBack={vi.fn()}
        onDirections={onDirections}
        onJoin={onJoin}
        onRefresh={vi.fn()}
        onViewStore={vi.fn()}
      />
    ));
    const directions = container.querySelector('[aria-label="Directions to Published Club"]') as HTMLButtonElement;
    const request = container.querySelector('[aria-label="Seat request options"]') as HTMLButtonElement;
    expect(container.querySelector('[aria-label="Back to Games"]')).not.toBeNull();
    expect(container.textContent).toContain('1 seat open · 3 waiting');
    expect(container.textContent).not.toContain('Why this game');
    expect(container.querySelector('[data-testid="primary-action"]')).toBeNull();
    expect(request.getAttribute('aria-expanded')).toBe('false');
    act(() => { request.click(); directions.click(); });
    expect(onJoin).not.toHaveBeenCalled();
    expect(onDirections).toHaveBeenCalledOnce();
    expect(request.getAttribute('aria-expanded')).toBe('true');
    const primaryAction = container.querySelector('[data-testid="primary-action"]') as HTMLButtonElement;
    expect(primaryAction.textContent).toContain('Continue to request');
    act(() => primaryAction.click());
    expect(onJoin).toHaveBeenCalledOnce();
    act(() => request.click());
    expect(container.querySelector('[data-testid="primary-action"]')).toBeNull();
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

    const request = container.querySelector('[aria-label="Seat request options"]') as HTMLButtonElement;
    expect(request.textContent).toContain(actionLabel);
    expect(container.querySelector('[data-testid="primary-action"]')).toBeNull();
    act(() => request.click());
    expect(onJoin).not.toHaveBeenCalled();
    expect(onViewStore).not.toHaveBeenCalled();
    const primaryAction = container.querySelector('[data-testid="primary-action"]') as HTMLButtonElement;
    expect(primaryAction.textContent).toContain(status === 'Active' ? 'Continue to request' : actionLabel);
    act(() => primaryAction.click());
    expect(onJoin).toHaveBeenCalledOnce();

    if (accessLabel) {
      expect(container.textContent).toContain(accessLabel);
      const accessAction = container.querySelector<HTMLButtonElement>('[aria-label="Venue access options"]');
      expect(accessAction).toBeDefined();
      expect(accessAction!.compareDocumentPosition(primaryAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  const renderDetails = (overrides: Partial<React.ComponentProps<typeof GameDetailsScreen>> = {}) => {
    const props: React.ComponentProps<typeof GameDetailsScreen> = {
      backLabel: 'Matches',
      item: { club, game, distanceMiles: 2.4, isJoined: true, isPreferred: false, seatRequestAccess: 'active' },
      player, onBack: vi.fn(), onDirections: vi.fn(), onJoin: vi.fn(), onRefresh: vi.fn(), onViewStore: vi.fn(),
      ...overrides
    };
    act(() => root.render(<GameDetailsScreen {...props} />));
    return props;
  };
  const disclosure = (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    if (!button) throw new Error(`Missing disclosure: ${label}`);
    return button;
  };

  it('starts with only the game overview and explicit Rules, Structure and seat entries', () => {
    const props = renderDetails();
    expect(container.textContent).toContain('1/2 NLH');
    expect(container.textContent).toContain('Published Club');
    expect(container.textContent).toContain('1 seat open');
    for (const label of ['Rules', 'Structure', 'Seat request options']) expect(disclosure(label).getAttribute('aria-expanded')).toBe('false');
    for (const text of ['Why this game', 'Time rate not published', 'Maximum seats', 'House rules are not published', 'You’ll confirm']) expect(container.textContent).not.toContain(text);
    expect(container.querySelector('[data-testid="primary-action"]')).toBeNull();
    expect(props.onJoin).not.toHaveBeenCalled();
  });

  it('reveals only requested rule or structure facts without inventing cash terms or invoking actions', () => {
    const props = renderDetails();
    act(() => disclosure('Rules').click());
    expect(disclosure('Rules').getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('House rules are not published');
    expect(container.textContent).not.toContain('Time rate not published');
    act(() => disclosure('Structure').click());
    expect(disclosure('Rules').getAttribute('aria-expanded')).toBe('false');
    expect(disclosure('Structure').getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).not.toContain('House rules are not published');
    expect(container.textContent).toContain('Maximum seats9');
    expect(container.textContent).toContain('Time rate not published');
    expect(container.textContent).toContain('Buy-in limits are not published');
    expect(container.textContent).toContain('Why this game');
    expect(container.textContent).toContain('running');
    expect(container.textContent).toContain('forming');
    expect(container.textContent).toContain('paused');
    expect(container.textContent).not.toContain('15 seats open');
    expect(props.onJoin).not.toHaveBeenCalled();
    expect(props.onViewStore).not.toHaveBeenCalled();
    expect(props.onDirections).not.toHaveBeenCalled();
  });

  it('resets every disclosure for another game or venue and after an interrupted stale listing', () => {
    const props = renderDetails();
    act(() => disclosure('Seat request options').click());
    expect(container.querySelector('[data-testid="primary-action"]')).not.toBeNull();
    renderDetails({ ...props, item: props.item ? { ...props.item, game: { ...game, id: 'game-2' } } : null });
    expect(disclosure('Seat request options').getAttribute('aria-expanded')).toBe('false');
    act(() => disclosure('Rules').click());
    renderDetails({ ...props, item: props.item ? { ...props.item, club: { ...club, club: { ...club.club, id: 'club-2' } } } : null });
    expect(disclosure('Rules').getAttribute('aria-expanded')).toBe('false');
    renderDetails(props);
    act(() => disclosure('Seat request options').click());
    renderDetails({ ...props, readOnly: true });
    expect(container.querySelector('[data-testid="primary-action"]')).toBeNull();
    renderDetails(props);
    expect(disclosure('Seat request options').getAttribute('aria-expanded')).toBe('false');
    expect(props.onJoin).not.toHaveBeenCalled();
  });

  it('keeps a forming-game interest explicit and an existing request without a route disabled', () => {
    const formingGame = { ...game, openTables: [table('forming', 'Forming', 9)] };
    const props = renderDetails({ item: { club, game: formingGame, distanceMiles: null, isJoined: true, isPreferred: false, seatRequestAccess: 'active' } });
    expect(disclosure('Seat request options').textContent).toContain('Send interest');
    act(() => disclosure('Seat request options').click());
    expect(props.onJoin).not.toHaveBeenCalled();
    const handoff = container.querySelector<HTMLButtonElement>('[data-testid="primary-action"]');
    expect(handoff?.textContent).toContain('Send interest');
    act(() => handoff?.click());
    expect(props.onJoin).toHaveBeenCalledOnce();
    renderDetails({ activeRequest: true });
    const existing = container.querySelector<HTMLButtonElement>('[data-testid="primary-action"]');
    expect(existing?.textContent).toContain('View your request');
    expect(existing?.disabled).toBe(true);
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
