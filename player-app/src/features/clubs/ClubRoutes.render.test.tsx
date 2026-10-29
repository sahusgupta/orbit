/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeTextContrast } from '../../test-utils/nativeContrast';
import { colors } from '../../styles/playerTheme';
import type { PlayerAccount, PlayerClubSnapshot, PlayerMembership, PlayerSyncGame } from '../../domain/playerSync';
import { decodePlayerClubSnapshot } from '../../domain/decoders/playerBoundaryDecoders';
import { deriveClubsViewState, type PlayerClubsViewState } from '../../domain/playerClubViewState';
import { ClubMembershipPlanScreen, ClubsScreen, SeatRequestModal } from './ClubRoutes';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const { nativePaintStyle } = await import('../../test-utils/nativeContrast');
  const minHeight = (style: unknown): number => Array.isArray(style) ? Math.max(0, ...style.map(minHeight))
    : style && typeof style === 'object' && 'minHeight' in style && typeof style.minHeight === 'number' ? style.minHeight : 0;
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityRole, accessibilityState, editable, style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      style: { backgroundColor: 'transparent', ...nativePaintStyle(style) },
      ...(editable === false ? { disabled: true } : {}),
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
      ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
      ...(accessibilityState && typeof accessibilityState === 'object' && 'selected' in accessibilityState ? { 'aria-selected': accessibilityState.selected } : {}),
      'data-min-height': minHeight(style)
    }, children as React.ReactNode);
  return {
    Modal: element('div'),
    Platform: { OS: 'web' },
    Pressable: element('button'),
    Text: element('span'),
    TextInput: element('input'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span data-testid="icon" /> }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../components/PlayerPresentation', () => ({
  AnimatedButton: ({ children, disabled, onPress }: { children: React.ReactNode; disabled?: boolean; onPress?: () => void }) => (
    <button disabled={disabled} onClick={onPress}>{children}</button>
  )
}));
vi.mock('./ClubHub', () => ({
  ClubHubSections: () => <div data-testid="club-hub-actions"><button>Request synthetic seat</button></div>,
  PlayerTimePanel: () => <div data-testid="player-time-panel">player time panel</div>
}));
vi.mock('./MembershipWallet', () => ({
  MembershipApplicationStatusCard: () => <div data-testid="membership-status">membership status</div>,
  MembershipWalletCard: () => <div data-testid="membership-wallet"><button>Generate synthetic check-in code</button></div>
}));

const player: PlayerAccount = {
  id: 'player-1',
  name: 'Alex',
  email: 'alex@example.test',
  preferredGameIds: []
};

const membership: PlayerMembership = {
  id: 'membership-1',
  clubId: 'club-1',
  playerId: 'player-1',
  playerName: 'Alex',
  status: 'Active',
  plan: 'monthly',
  planName: 'Annual access',
  membershipDurationDays: 365,
  paymentMethod: 'core',
  requestedAt: '2026-08-01T00:00:00.000Z',
  loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New', nextTierAtHours: 12 },
  preferredGameIds: []
};

const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Published Club' },
  games: [],
  memberships: [membership],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  generatedAt: '2026-08-09T12:00:00.000Z'
};

describe('PlayerApp to ClubsScreen safe composition', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    container.style.backgroundColor = colors.canvas;
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(viewState: PlayerClubsViewState, memberClubs: PlayerClubSnapshot[], selectedMembership?: PlayerMembership, navigation: {
    onSelectClub?: (club: PlayerClubSnapshot) => void;
    onOpenMembership?: (club: PlayerClubSnapshot) => void;
  } = {}) {
    act(() => {
      root.render(
        <ClubsScreen
          memberClubs={memberClubs}
          selectedMembership={selectedMembership}
          viewState={viewState}
          player={player}
          originCoordinate={null}
          nowMs={Date.parse('2026-08-09T12:00:00.000Z')}
          message=""
          waitlists={[]}
          tournaments={[]}
          onSelectClub={navigation.onSelectClub ?? vi.fn()}
          onOpenMembership={navigation.onOpenMembership}
          onGame={vi.fn()}
          onManageAccess={vi.fn()}
          onViewEvents={vi.fn()}
        />
      );
    });
  }

  function expectNoClubDependentPanels() {
    expect(container.querySelector('[data-testid="club-hub-actions"]')).toBeNull();
    expect(container.querySelector('[data-testid="player-time-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="membership-wallet"]')).toBeNull();
    expect(container.querySelector('[data-testid="membership-status"]')).toBeNull();
  }

  it.each([
    ['cold/idle empty', deriveClubsViewState('idle', [], undefined, false, '')],
    ['slow loading', deriveClubsViewState('loading', [], undefined, false, '')],
    ['offline error', deriveClubsViewState('error', [], undefined, false, '')],
    ['empty ready', deriveClubsViewState('ready', [], undefined, false, '')],
    ['stale data', deriveClubsViewState('error', [club], club, false, '')],
    ['removed selection', deriveClubsViewState('ready', [club], undefined, false, 'The selected club was removed.')]
  ])('does not compose club-dependent panels for %s', (_label, viewState) => {
    render(viewState, viewState.kind === 'stale' || viewState.kind === 'removed' ? [club] : [], membership);
    expectNoClubDependentPanels();
  });

  it('treats a decoder-rejected malformed club as empty and renders no dependent actions', () => {
    const decoded = decodePlayerClubSnapshot({ club: { id: '', name: '' }, games: null });
    const memberClubs = decoded ? [decoded] : [];
    render(deriveClubsViewState('ready', memberClubs, undefined, false, ''), memberClubs, membership);
    expect(container.textContent).toContain('No club memberships yet');
    expectNoClubDependentPanels();
  });

  it('composes dependent panels only for a current ready selection', () => {
    render(deriveClubsViewState('ready', [club], club, false, ''), [club], membership);
    expect(container.querySelector('[data-testid="club-hub-actions"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="player-time-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="membership-wallet"]')).not.toBeNull();
  });

  it('opens a separate membership page and keeps the native membership list free of inline detail panels', () => {
    const onSelectClub = vi.fn();
    const onOpenMembership = vi.fn();
    render(deriveClubsViewState('ready', [club], club, false, ''), [club], membership, { onSelectClub, onOpenMembership });
    expectNoClubDependentPanels();
    expect(container.textContent).not.toMatch(/Your wallet|Your rooms\.|Tap a card/);
    expect(container.textContent).toContain('MEMBERSHIP ID');
    expect(container.textContent).toContain(membership.id);
    const row = container.querySelector('[aria-label="Published Club, Active"]') as HTMLButtonElement;
    expect(row).not.toBeNull();
    act(() => row.click());
    expect(onOpenMembership).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Back to wallet"]')).not.toBeNull();
    act(() => row.click());
    expect(onOpenMembership).toHaveBeenCalledExactlyOnceWith(club);
    expect(onSelectClub).not.toHaveBeenCalled();
  });

  it('keeps legacy inline selection behavior when no membership detail navigation is supplied', () => {
    const onSelectClub = vi.fn();
    render(deriveClubsViewState('ready', [club], club, false, ''), [club], membership, { onSelectClub });
    act(() => (container.querySelector('[aria-label="Published Club, Active"]') as HTMLButtonElement).click());
    expect(onSelectClub).toHaveBeenCalledExactlyOnceWith(club);
    expect(container.querySelector('[data-testid="membership-wallet"]')).not.toBeNull();
  });

  it('keeps retained membership rows readable through a failed refresh and restores actions only on success', () => {
    const ready = () => render(deriveClubsViewState('ready', [club], club, false, ''), [club], membership);
    ready();
    expect(container.querySelector('[data-testid="membership-wallet"] button')).not.toBeNull();
    expect(container.querySelector('[data-testid="club-hub-actions"] button')).not.toBeNull();

    render(deriveClubsViewState('error', [club], club, false, ''), [club], membership);
    expect(container.querySelector('[aria-label="Published Club, Active"]')).not.toBeNull();
    expect(container.textContent).toContain('Showing last loaded club data');
    expectNoClubDependentPanels();

    ready();
    expect(container.querySelector('[data-testid="membership-wallet"] button')).not.toBeNull();
    expect(container.querySelector('[data-testid="club-hub-actions"] button')).not.toBeNull();
  });

  it.each(['idle', 'loading'] as const)('keeps retained membership readable without wallet or game actions during %s', (status) => {
    render(deriveClubsViewState('ready', [club], club, false, ''), [club], membership);
    expect(container.querySelector('[data-testid="membership-wallet"] button')).not.toBeNull();
    expect(container.querySelector('[data-testid="club-hub-actions"] button')).not.toBeNull();

    render(deriveClubsViewState(status, [club], club, false, ''), [club], membership);
    expect(container.querySelector('[aria-label="Published Club, Active"]')).not.toBeNull();
    expect(container.textContent).toContain('Published Club');
    expect(container.textContent).toContain('Active');
    expect(container.querySelectorAll('[data-testid="membership-wallet"] button:not(:disabled), [data-testid="club-hub-actions"] button:not(:disabled)')).toHaveLength(0);
    expectNoClubDependentPanels();

    render(deriveClubsViewState('ready', [club], club, false, ''), [club], membership);
    expect(container.querySelector('[data-testid="membership-wallet"] button')).not.toBeNull();
    expect(container.querySelector('[data-testid="club-hub-actions"] button')).not.toBeNull();
  });

  it('names the selected club and presents expired access without fabricating player distance', () => {
    const expiredMembership = { ...membership, expiresAt: '2026-08-08T12:00:00.000Z' };
    const expiredClub = { ...club, club: { ...club.club, address: '100 Example Street, Austin, TX' }, memberships: [expiredMembership] };
    render(deriveClubsViewState('ready', [expiredClub], expiredClub, false, ''), [expiredClub], expiredMembership);
    const row = container.querySelector('[aria-label="Published Club, Expired"]') as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(Number(row.getAttribute('data-min-height'))).toBeGreaterThanOrEqual(44);
    expect(container.textContent).toContain('Austin');
    expect(container.textContent).not.toContain('Distance unavailable');
    expect(container.textContent).not.toMatch(/\d+(?:\.\d+)? mi/);
  });

  it('renders club-level availability from Running tables only', () => {
    const table = (id: string, status: 'Running' | 'Forming' | 'Paused', availableSeats: number) => ({
      id,
      gameId: 'game-1',
      label: id,
      status,
      seatsFilled: 9 - availableSeats,
      maxSeats: 9,
      availableSeats,
      collectionMode: 'Time' as const,
      tags: [],
      startedAt: '2026-08-09T12:00:00.000Z',
      social: { seatedPlayerCount: 9 - availableSeats, adminCount: 0, knownPlayersCount: 0 }
    });
    const mixedGame: PlayerSyncGame = {
      id: 'game-1',
      name: '1/2 NLH',
      maxSeats: 9,
      openTables: [table('running', 'Running', 1), table('forming', 'Forming', 9), table('paused', 'Paused', 5)],
      waitlistCount: 0,
      formingCount: 1,
      availableSeats: 15,
      knownPlayersCount: 0
    };
    const mixedClub = { ...club, games: [mixedGame] };
    render(deriveClubsViewState('ready', [mixedClub], mixedClub, false, ''), [mixedClub], membership);
    expect(container.textContent).toContain('1 seat open');
    expect(container.textContent).not.toContain('15 seats');
  });

  it('labels membership and seat submissions as requests rather than confirmed joins or hidden continuation', () => {
    const openGame: PlayerSyncGame = {
      id: 'game-1',
      name: '1/2 NLH',
      maxSeats: 9,
      openTables: [{
        id: 'table-1', gameId: 'game-1', label: 'Feature table', status: 'Running',
        seatsFilled: 8, maxSeats: 9, availableSeats: 1, collectionMode: 'Time', tags: [],
        startedAt: '2026-08-09T12:00:00.000Z',
        social: { seatedPlayerCount: 8, adminCount: 0, knownPlayersCount: 0 }
      }],
      waitlistCount: 0,
      formingCount: 0,
      availableSeats: 1,
      knownPlayersCount: 0
    };
    const planClub: PlayerClubSnapshot = {
      ...club,
      club: {
        ...club.club,
        membershipOptions: [{ id: 'seven-day', name: 'Seven-day access', priceLabel: '$25', durationDays: 7 }]
      },
      games: [openGame]
    };

    act(() => root.render(
      <>
        <ClubMembershipPlanScreen
          club={planClub}
          message=""
          player={player}
          busy={false}
          onBack={vi.fn()}
          onSubmit={vi.fn()}
        />
        <SeatRequestModal
          draft={{
            club: planClub,
            game: openGame,
            attendance: 'confirmed',
            expectedArrivalTime: '',
            availabilityStartTime: '',
            availabilityEndTime: ''
          }}
          message=""
          busy={false}
          onChange={vi.fn()}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </>
    ));
    expect(container.textContent).toContain('Request a seat for 1/2 NLH');
    expect(container.textContent).not.toContain('Join 1/2 NLH');

    act(() => (container.querySelector('[aria-label="Seven-day access, $25"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Request Seven-day access');
    expect(container.textContent).not.toContain('Continue with');
  });

  it.each([
    ['Forming', 'Forming' as const],
    ['Paused', 'Paused' as const],
    ['no-table', null]
  ])('renders the %s game as an interest-only request without arrived controls', (_label, status) => {
    const interestOnlyGame: PlayerSyncGame = {
      id: 'game-interest',
      name: 'Interest Game',
      maxSeats: 9,
      openTables: status ? [{
        id: `table-${status.toLowerCase()}`,
        gameId: 'game-interest',
        label: `${status} table`,
        status,
        seatsFilled: 4,
        maxSeats: 9,
        availableSeats: 5,
        collectionMode: 'Time',
        tags: [],
        startedAt: '2026-09-04T12:00:00.000Z',
        social: { seatedPlayerCount: 4, adminCount: 0, knownPlayersCount: 0 }
      }] : [],
      waitlistCount: 0,
      formingCount: status === 'Forming' ? 1 : 0,
      availableSeats: 0,
      knownPlayersCount: 0
    };

    act(() => root.render(
      <SeatRequestModal
        draft={{
          club: { ...club, games: [interestOnlyGame] },
          game: interestOnlyGame,
          attendance: 'interested',
          expectedArrivalTime: '',
          availabilityStartTime: '',
          availabilityEndTime: ''
        }}
        message=""
        busy={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    ));

    expect(container.textContent).toContain('When would you play Interest Game?');
    expect(container.textContent).toContain('no table is open');
    expect(container.textContent).toContain('Time or range you would come');
    expect(container.textContent).not.toContain('At club now');
    expect(container.textContent).toContain('Send request');
  });

  it('makes an already-open seat request read-only when published data becomes stale', () => {
    const onSubmit = vi.fn();
    const staleGame: PlayerSyncGame = {
      id: 'game-stale',
      name: 'Stale Game',
      maxSeats: 9,
      openTables: [],
      waitlistCount: 0,
      formingCount: 0,
      availableSeats: 0,
      knownPlayersCount: 0
    };
    act(() => root.render(
      <SeatRequestModal
        draft={{
          club: { ...club, games: [staleGame] },
          game: staleGame,
          attendance: 'interested',
          expectedArrivalTime: '',
          availabilityStartTime: '6 PM',
          availabilityEndTime: '8 PM'
        }}
        message=""
        busy={false}
        readOnly
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    ));

    expect(container.textContent).toContain('Refresh published venue data before sending this request.');
    const warning = Array.from(container.querySelectorAll('span')).find(element => element.textContent === 'Refresh published venue data before sending this request.');
    expect(nativeTextContrast(warning)).toBeGreaterThanOrEqual(4.5);
    const submit = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Refresh required'));
    expect(submit?.disabled).toBe(true);
    expect(Array.from(container.querySelectorAll('input')).every((input) => input.disabled)).toBe(true);
    act(() => submit?.click());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
