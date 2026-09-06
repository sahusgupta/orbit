/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount, PlayerClubSnapshot, PlayerMembership, PlayerSyncGame } from '../../domain/playerSync';
import { decodePlayerClubSnapshot } from '../../domain/decoders/playerBoundaryDecoders';
import { deriveClubsViewState, type PlayerClubsViewState } from '../../domain/playerClubViewState';
import { ClubMembershipPlanScreen, ClubsScreen, SeatRequestModal } from './ClubRoutes';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, editable, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(editable === false ? { disabled: true } : {}),
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {})
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
vi.mock('../../components/PlayerPresentation', () => ({
  AnimatedButton: ({ children, disabled, onPress }: { children: React.ReactNode; disabled?: boolean; onPress?: () => void }) => (
    <button disabled={disabled} onClick={onPress}>{children}</button>
  )
}));
vi.mock('./ClubHub', () => ({
  ClubHubSections: () => <div data-testid="club-hub-actions">club hub actions</div>,
  PlayerTimePanel: () => <div data-testid="player-time-panel">player time panel</div>
}));
vi.mock('./MembershipWallet', () => ({
  MembershipApplicationStatusCard: () => <div data-testid="membership-status">membership status</div>,
  MembershipWalletCard: () => <div data-testid="membership-wallet">membership wallet</div>
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
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(viewState: PlayerClubsViewState, memberClubs: PlayerClubSnapshot[], selectedMembership?: PlayerMembership) {
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
          onSelectClub={vi.fn()}
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
    const submit = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Refresh required'));
    expect(submit?.disabled).toBe(true);
    expect(Array.from(container.querySelectorAll('input')).every((input) => input.disabled)).toBe(true);
    act(() => submit?.click());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
