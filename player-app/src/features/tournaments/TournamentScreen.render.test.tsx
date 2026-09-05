/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tournamentScopeKey, type PlayerClubSnapshot, type PlayerTournament, type PlayerTournamentInterest } from '../../domain/playerSync';
import { TournamentScreen } from './TournamentScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {})
    }, children as React.ReactNode);
  return {
    Platform: { OS: 'web' },
    Pressable: element('button'),
    ScrollView: element('div'),
    Text: element('span'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span data-testid="icon" /> }));
vi.mock('../../components/PlayerPresentation', () => ({ SearchToolbar: () => <div data-testid="search" /> }));
vi.mock('../../components/PlayerFields', () => ({ Chip: ({ label }: { label: string }) => <button>{label}</button> }));

const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Published Club', address: '100 Main St' },
  games: [],
  memberships: [],
  waitlists: [],
  notifications: [],
  generatedAt: '2026-08-09T12:00:00.000Z'
};

const tournament = (overrides: Partial<PlayerTournament> = {}): PlayerTournament => ({
  id: 'event-1',
  clubId: 'club-1',
  name: 'Sunday Event',
  startsAt: '2026-08-10T18:00:00.000Z',
  interestOpensAt: '2026-08-01T00:00:00.000Z',
  interestClosesAt: '2026-08-10T17:00:00.000Z',
  interestStatus: 'open',
  buyIn: 0,
  startingStack: 0,
  levelMinutes: 0,
  rebuysAllowed: false,
  addOnsAllowed: false,
  rules: [],
  withdrawalAllowed: true,
  entrantCount: 0,
  totalRebuys: 0,
  totalAddOns: 0,
  ...overrides
});

const interest: PlayerTournamentInterest = {
  id: 'interest-opaque-1',
  tournamentId: 'event-1',
  clubId: 'club-1',
  playerId: 'player-1',
  status: 'interested',
  createdAt: '2026-08-09T10:00:00.000Z',
  updatedAt: '2026-08-09T10:00:00.000Z'
};

describe('TournamentScreen factual composition', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-09T12:00:00.000Z'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function render(options: {
    event?: PlayerTournament;
    eventInterest?: PlayerTournamentInterest;
    hasOrbitAccount?: boolean;
    message?: string;
    readOnly?: boolean;
  } = {}) {
    act(() => {
      root.render(
        <TournamentScreen
          query=""
          onQueryChange={vi.fn()}
          onOpenFilters={vi.fn()}
          opportunities={[{ tournament: options.event ?? tournament(), club, distanceMiles: null, interest: options.eventInterest }]}
          hasOrbitAccount={options.hasOrbitAccount ?? true}
          readOnly={options.readOnly ?? false}
          message={options.message ?? ''}
          pendingTournamentKeys={[]}
          onSelectClub={vi.fn()}
          onExpressInterest={vi.fn()}
          onWithdrawInterest={vi.fn()}
        />
      );
    });
  }

  it('allows signed-out browsing, shows one result message, and exposes the exact disabled CTA', () => {
    render({ hasOrbitAccount: false, message: 'Sign in to express interest.' });
    expect(container.textContent).toContain('Browse without signing in');
    expect(container.textContent?.match(/Sign in to express interest\./g)).toHaveLength(1);
    expect(container.textContent).toContain('Express interest');
    const expressButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Express interest');
    expect(expressButton?.hasAttribute('disabled')).toBe(true);
    expect(container.textContent?.toLowerCase()).not.toContain('registration');
  });

  it('preserves published zero values while identifying disallowed structures', () => {
    render();
    expect(container.textContent).toContain('$0 VENUE-PUBLISHED BUY-IN');
    expect(container.textContent).toContain('0 min');
    expect(container.textContent).toContain('0Entrants');
    expect(container.textContent).toContain('Not allowed');
    expect(container.textContent).toContain('Rebuys are not allowed.');
    expect(container.textContent).toContain('Add-ons are not allowed.');
    expect(container.textContent).toContain('Venue totals: 0 rebuys · 0 add-ons');
  });

  it('renders unpublished optional facts neutrally and does not inflate entrants for interest', () => {
    render({
      event: tournament({
        buyIn: undefined,
        startingStack: undefined,
        levelMinutes: undefined,
        prizePoolLabel: undefined,
        rebuysAllowed: true,
        rebuyPrice: undefined,
        rebuyStack: undefined,
        unlimitedRebuys: undefined,
        lateRegistrationThroughLevel: undefined,
        addOnsAllowed: true,
        addOnPrice: undefined,
        addOnStack: undefined,
        entrantCount: undefined,
        totalRebuys: undefined,
        totalAddOns: undefined
      }),
      eventInterest: interest
    });
    expect(container.textContent).toContain('BUY-IN NOT PUBLISHED');
    expect(container.textContent).toContain('Price not published · limit not published');
    expect(container.textContent).toContain('Venue totals not published.');
    expect(container.textContent).toContain('Interest expressed');
    expect(container.textContent).toContain('nonbinding and does not reserve a seat');
    expect(container.textContent).not.toContain('1Entrants');
  });

  it('keeps stale tournament interest read-only', () => {
    const onExpressInterest = vi.fn();
    act(() => {
      root.render(
        <TournamentScreen
          query=""
          onQueryChange={vi.fn()}
          onOpenFilters={vi.fn()}
          opportunities={[{ tournament: tournament(), club, distanceMiles: null, interest: undefined }]}
          hasOrbitAccount
          readOnly
          message=""
          pendingTournamentKeys={[]}
          onSelectClub={vi.fn()}
          onExpressInterest={onExpressInterest}
          onWithdrawInterest={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Tournament listings are read-only');
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Refresh required');
    expect(action?.hasAttribute('disabled')).toBe(true);
    act(() => action?.click());
    expect(onExpressInterest).not.toHaveBeenCalled();
  });

  it('marks only the pending club-scoped tournament busy when venue IDs collide', () => {
    const clubBeta: PlayerClubSnapshot = {
      ...club,
      club: { ...club.club, id: 'club-2', name: 'Second Published Club' }
    };
    const firstTournament = tournament({ name: 'First Sunday Event' });
    const secondTournament = tournament({ clubId: clubBeta.club.id, name: 'Second Sunday Event' });
    const onExpressInterest = vi.fn();

    act(() => {
      root.render(
        <TournamentScreen
          query=""
          onQueryChange={vi.fn()}
          onOpenFilters={vi.fn()}
          opportunities={[
            { tournament: firstTournament, club, distanceMiles: null, interest: undefined },
            { tournament: secondTournament, club: clubBeta, distanceMiles: null, interest: undefined }
          ]}
          hasOrbitAccount
          readOnly={false}
          message=""
          pendingTournamentKeys={[tournamentScopeKey(firstTournament)]}
          onSelectClub={vi.fn()}
          onExpressInterest={onExpressInterest}
          onWithdrawInterest={vi.fn()}
        />
      );
    });

    const updating = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('Updating'));
    const available = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Express interest');
    expect(updating?.hasAttribute('disabled')).toBe(true);
    expect(available?.hasAttribute('disabled')).toBe(false);
    act(() => available?.click());
    expect(onExpressInterest).toHaveBeenCalledWith(secondTournament);
  });
});
