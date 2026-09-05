/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerClubSnapshot, PlayerMembership, PlayerSyncGame, PlayerTournament } from '../../domain/playerSync';
import { ClubHubSections } from './ClubHub';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
    style: _style,
    ...props
  }: Record<string, unknown>) => ReactModule.createElement(tag, {
    ...props,
    ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
    ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
    ...(
      typeof accessibilityState === 'object' && accessibilityState !== null && 'expanded' in accessibilityState
        ? { 'aria-expanded': (accessibilityState as { expanded?: boolean }).expanded }
        : {}
    )
  }, children as React.ReactNode);
  return {
    Platform: { OS: 'web' },
    Pressable: element('button'),
    Text: element('span'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span data-testid="icon" /> }));
vi.mock('../../components/PlayerPresentation', () => ({}));
vi.mock('../tournaments/TournamentScreen', () => ({ formatEventDate: (value: string) => value }));

const membership: PlayerMembership = {
  id: 'membership-1',
  clubId: 'club-1',
  playerId: 'player-1',
  playerName: 'Alex',
  status: 'Active',
  planName: 'Annual access',
  membershipDurationDays: 365,
  expiresAt: '2027-08-09T12:00:00.000Z',
  loyalty: { clubId: 'club-1', points: 9000, lifetimeHours: 900, tier: 'Anchor', nextTierAtHours: null },
  preferredGameIds: []
};

const formingGame: PlayerSyncGame = {
  id: 'game-1',
  name: '1/2 NLH',
  maxSeats: 9,
  openTables: [{
    id: 'table-1',
    gameId: 'game-1',
    label: 'Feature table',
    status: 'Forming',
    seatsFilled: 0,
    maxSeats: 9,
    availableSeats: 9,
    collectionMode: 'Time',
    tags: [],
    startedAt: '2026-08-09T12:00:00.000Z',
    social: { seatedPlayerCount: 0, adminCount: 0, knownPlayersCount: 0 }
  }],
  waitlistCount: 0,
  formingCount: 1,
  availableSeats: 9,
  knownPlayersCount: 0
};

const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Published Club' },
  games: [formingGame],
  memberships: [membership],
  waitlists: [],
  notifications: [],
  generatedAt: '2026-08-09T12:00:00.000Z'
};

const event = (id: string, name: string, startsAt: string): PlayerTournament => ({
  id,
  clubId: 'club-1',
  name,
  startsAt,
  interestOpensAt: '2026-08-01T00:00:00.000Z',
  interestClosesAt: '2026-08-09T11:00:00.000Z',
  interestStatus: 'closed',
  rebuysAllowed: false,
  addOnsAllowed: false,
  rules: [],
  withdrawalAllowed: false,
  entrantCount: 0,
  totalRebuys: 0,
  totalAddOns: 0
});

describe('Club hub factual composition', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(
      <ClubHubSections
        club={club}
        membership={membership}
        games={[formingGame]}
        waitlists={[]}
        tournaments={[]}
        nowMs={Date.parse('2026-08-09T12:00:00.000Z')}
        onGame={vi.fn()}
        onManageAccess={vi.fn()}
        onViewEvents={vi.fn()}
      />
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('labels forming games as forming, uses request copy, and hides synthetic loyalty values', () => {
    act(() => (container.querySelector('[aria-label="Games"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('OPEN OR FORMING');
    expect(container.textContent).toContain('Send interest');
    expect(container.textContent).not.toContain('ACTIVE NOW');
    expect(container.textContent).not.toContain('Live');

    act(() => (container.querySelector('[aria-label="Membership"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Annual access');
    expect(container.textContent).not.toContain('9,000');
    expect(container.textContent).not.toContain('Anchor');
    expect(container.textContent).not.toContain('Points');
    expect(container.textContent).not.toContain('Tier');
  });

  it('counts and renders only events whose published start time is still ahead', () => {
    act(() => root.render(
      <ClubHubSections
        club={club}
        membership={membership}
        games={[formingGame]}
        waitlists={[]}
        tournaments={[
          event('past', 'Already started', '2026-08-09T11:59:59.999Z'),
          event('now', 'Starts now', '2026-08-09T12:00:00.000Z'),
          event('future', 'Tomorrow event', '2026-08-10T12:00:00.000Z')
        ]}
        nowMs={Date.parse('2026-08-09T12:00:00.000Z')}
        onGame={vi.fn()}
        onManageAccess={vi.fn()}
        onViewEvents={vi.fn()}
      />
    ));

    expect(container.textContent).toContain('1 upcoming');
    act(() => (container.querySelector('[aria-label="Events"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('Tomorrow event');
    expect(container.textContent).not.toContain('Already started');
    expect(container.textContent).not.toContain('Starts now');
  });
});
