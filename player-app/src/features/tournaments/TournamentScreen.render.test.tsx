/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tournamentScopeKey, type PlayerClubSnapshot, type PlayerTournament, type PlayerTournamentInterest, type PlayerTournamentRegistration } from '../../domain/playerSync';
import { TournamentCard, TournamentScreen } from './TournamentScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityRole, accessibilityState: _accessibilityState, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
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
    busy?: boolean;
    empty?: boolean;
    inventoryStatus?: 'idle' | 'loading' | 'ready' | 'error';
    inventoryPartial?: boolean;
    registrationEnabled?: boolean;
    registration?: PlayerTournamentRegistration;
  } = {}) {
    const onSelectClub = vi.fn(), onExpressInterest = vi.fn(), onWithdrawInterest = vi.fn(), onRegisterTournament = vi.fn();
    act(() => {
      root.render(
        <TournamentScreen
          query=""
          onQueryChange={vi.fn()}
          onOpenFilters={vi.fn()}
          opportunities={options.empty ? [] : [{ tournament: options.event ?? tournament(), club, distanceMiles: null, interest: options.eventInterest }]}
          hasOrbitAccount={options.hasOrbitAccount ?? true}
          readOnly={options.readOnly ?? false}
          inventoryStatus={options.inventoryStatus}
          inventoryPartial={options.inventoryPartial}
          message={options.message ?? ''}
          pendingTournamentKeys={options.busy ? [tournamentScopeKey(options.event ?? tournament())] : []}
          onSelectClub={onSelectClub}
          onExpressInterest={onExpressInterest}
          onWithdrawInterest={onWithdrawInterest}
          onRegisterTournament={options.registrationEnabled ? onRegisterTournament : undefined}
          tournamentRegistrations={options.registration ? { [tournamentScopeKey(options.event ?? tournament())]: options.registration } : {}}
        />
      );
    });
    return { onSelectClub, onExpressInterest, onWithdrawInterest, onRegisterTournament };
  }

  function click(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === label || node.textContent === label);
    expect(button, `button ${label}`).toBeDefined();
    act(() => button?.click());
    return button;
  }

  it('starts with a compact event summary and three closed detail sections', () => {
    const actions = render({ event: tournament({ rules: ['No electronics at the table.'], prizePoolLabel: 'Venue-published prize details' }) });
    for (const label of ['Structure', 'Rules', 'Request']) {
      const control = Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === `${label} for Sunday Event`);
      expect(control?.getAttribute('aria-expanded')).toBe('false');
    }
    expect(container.textContent).toContain('Sunday Event');
    expect(container.textContent).toContain('Published Club');
    expect(container.textContent).toContain('$0');
    expect(container.textContent).toContain('Interest open');
    for (const detail of ['Starting chips', 'Blind levels', 'Entrants', 'No electronics at the table.', 'Venue-published prize details', 'Expressing interest is nonbinding.']) {
      expect(container.textContent).not.toContain(detail);
    }
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Express interest')).toBe(false);
    expect(actions.onExpressInterest).not.toHaveBeenCalled();
  });

  it('opens one requested section at a time and lets the same control close it', () => {
    render({ event: tournament({ rules: ['No electronics at the table.'], prizePoolLabel: 'Venue-published prize details' }) });
    click('Structure for Sunday Event');
    expect(container.textContent).toContain('Starting chips');
    expect(container.textContent).toContain('Venue-published prize details');
    expect(container.textContent).not.toContain('No electronics at the table.');
    click('Rules for Sunday Event');
    expect(container.textContent).not.toContain('Starting chips');
    expect(container.textContent).toContain('No electronics at the table.');
    expect(container.textContent).not.toContain('Expressing interest is nonbinding.');
    click('Rules for Sunday Event');
    expect(container.textContent).not.toContain('No electronics at the table.');
  });

  it('reveals nonbinding request details before exposing the existing explicit interest action', () => {
    const actions = render();
    click('Request for Sunday Event');
    expect(container.textContent).toContain('Expressing interest is nonbinding.');
    expect(container.textContent).toContain('does not register you, guarantee a seat, create a debt, collect payment, or establish prize eligibility');
    expect(actions.onExpressInterest).not.toHaveBeenCalled();
    click('Express interest');
    expect(actions.onExpressInterest).toHaveBeenCalledExactlyOnceWith(tournament());
    expect(actions.onWithdrawInterest).not.toHaveBeenCalled();
  });

  it('registers eligible free events through a separate explicit action', () => {
    const event = tournament({ registrationAvailable: true });
    const actions = render({ event, registrationEnabled: true });
    expect(container.textContent).toContain('Registration open');
    expect(actions.onRegisterTournament).not.toHaveBeenCalled();
    click('Request for Sunday Event');
    expect(container.textContent).toContain('Join the venue’s entrant list');
    expect(container.textContent).not.toContain('Expressing interest is nonbinding');
    click('Register for free');
    expect(actions.onRegisterTournament).toHaveBeenCalledExactlyOnceWith(event);
    expect(actions.onExpressInterest).not.toHaveBeenCalled();
  });

  it.each([{ readOnly: true }, { hasOrbitAccount: false }, { busy: true }])('disables registration for %j', (state) => {
    const actions = render({ ...state, event: tournament({ registrationAvailable: true }), registrationEnabled: true });
    click('Request for Sunday Event');
    const button = Array.from(container.querySelectorAll('button')).find((node) => /Register for free|Refresh required|Registering/.test(node.textContent || ''));
    expect(button?.hasAttribute('disabled')).toBe(true);
    act(() => button?.click());
    expect(actions.onRegisterTournament).not.toHaveBeenCalled();
  });

  it('restores the private registration projection without displaying a duplicate registration action', () => {
    const event = tournament({ registrationAvailable: true });
    const registration = { id: 'entry-one', clubId: event.clubId, tournamentId: event.id, playerId: 'player-1', status: 'registered' as const, registeredAt: '2026-08-09T12:00:00Z' };
    render({ event: { ...event, registration }, registrationEnabled: true });
    click('Request for Sunday Event');
    expect(container.textContent).toContain('You are on the venue’s entrant list');
    expect(container.textContent).not.toContain('Register for free');
  });

  it('keeps paid events as nonbinding interest when free registration is available elsewhere', () => {
    const actions = render({ event: tournament({ buyIn: 100, registrationAvailable: false }), registrationEnabled: true });
    click('Request for Sunday Event'); click('Express interest');
    expect(actions.onExpressInterest).toHaveBeenCalledOnce();
    expect(actions.onRegisterTournament).not.toHaveBeenCalled();
  });

  it('resets disclosure when the event or its club changes without mutating interest', () => {
    const onExpressInterest = vi.fn(), onWithdrawInterest = vi.fn();
    const show = (event: PlayerTournament) => act(() => root.render(<TournamentCard tournament={event} hasOrbitAccount readOnly={false} busy={false} onExpressInterest={onExpressInterest} onWithdrawInterest={onWithdrawInterest} />));
    show(tournament()); click('Request for Sunday Event');
    expect(container.textContent).toContain('Express interest');
    show(tournament({ clubId: 'club-2', name: 'Other venue event' }));
    expect(container.textContent).not.toContain('Expressing interest is nonbinding.');
    expect(container.querySelector('[aria-label="Request for Other venue event"]')?.getAttribute('aria-expanded')).toBe('false');
    click('Structure for Other venue event'); expect(container.textContent).toContain('Starting chips');
    show(tournament({ id: 'event-2', clubId: 'club-2', name: 'Next event' }));
    expect(container.textContent).not.toContain('Starting chips');
    expect(onExpressInterest).not.toHaveBeenCalled(); expect(onWithdrawInterest).not.toHaveBeenCalled();
  });

  it('keeps opened request details read-only after freshness is lost', () => {
    render(); click('Request for Sunday Event');
    const actions = render({ inventoryStatus: 'error' });
    expect(container.textContent).toContain('Expressing interest is nonbinding.');
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Refresh required');
    expect(action?.disabled).toBe(true);
    act(() => action?.click());
    expect(actions.onExpressInterest).not.toHaveBeenCalled(); expect(actions.onWithdrawInterest).not.toHaveBeenCalled();
  });

  it.each(['signed-out', 'busy', 'closed'] as const)('keeps the revealed interest action disabled when %s', (condition) => {
    const actions = render({ hasOrbitAccount: condition !== 'signed-out', busy: condition === 'busy',
      event: tournament({ interestStatus: condition === 'closed' ? 'closed' : 'open' }) });
    click('Request for Sunday Event');
    const action = Array.from(container.querySelectorAll('button')).find((button) => /^(Express interest|Updating|Interest closed)/.test(button.textContent ?? ''));
    expect(action?.disabled).toBe(true);
    act(() => action?.click());
    expect(actions.onExpressInterest).not.toHaveBeenCalled(); expect(actions.onWithdrawInterest).not.toHaveBeenCalled();
  });

  it('requires the revealed explicit withdrawal action and preserves its tournament and interest identity', () => {
    const actions = render({ eventInterest: interest });
    expect(container.textContent).toContain('Interest expressed');
    expect(container.textContent).not.toContain('Withdraw interest');
    click('Request for Sunday Event');
    expect(actions.onWithdrawInterest).not.toHaveBeenCalled();
    click('Withdraw interest');
    expect(actions.onWithdrawInterest).toHaveBeenCalledExactlyOnceWith(tournament(), interest);
    expect(actions.onExpressInterest).not.toHaveBeenCalled();
  });

  it('keeps the compact venue link on the existing club route without changing interest', () => {
    const actions = render();
    click('View Published Club');
    expect(actions.onSelectClub).toHaveBeenCalledExactlyOnceWith(club);
    expect(actions.onExpressInterest).not.toHaveBeenCalled(); expect(actions.onWithdrawInterest).not.toHaveBeenCalled();
  });

  it('allows signed-out browsing, shows one result message, and exposes the exact disabled CTA', () => {
    render({ hasOrbitAccount: false, message: 'Sign in to express interest.' });
    expect(container.textContent).toContain('Browse without signing in');
    expect(container.textContent?.match(/Sign in to express interest\./g)).toHaveLength(1);
    click('Request for Sunday Event');
    expect(container.textContent).toContain('Express interest');
    const expressButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Express interest');
    expect(expressButton?.hasAttribute('disabled')).toBe(true);
    expect(container.textContent?.toLowerCase()).not.toContain('registration');
  });

  it('preserves published zero values while identifying disallowed structures', () => {
    render();
    expect(container.textContent).toContain('$0');
    expect(container.textContent).toContain('Published buy-in');
    click('Structure for Sunday Event');
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
    expect(container.textContent).toContain('Published buy-in');
    expect(container.textContent).toContain('Not published');
    click('Structure for Sunday Event');
    expect(container.textContent).toContain('Price not published · limit not published');
    expect(container.textContent).toContain('Venue totals not published.');
    expect(container.textContent).toContain('Interest expressed');
    expect(container.textContent).not.toContain('1Entrants');
    click('Request for Sunday Event');
    expect(container.textContent).toContain('nonbinding and does not reserve a seat');
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
    click('Request for Sunday Event');
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

    click('Request for First Sunday Event');
    click('Request for Second Sunday Event');
    const updating = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('Updating'));
    const available = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Express interest');
    expect(updating?.hasAttribute('disabled')).toBe(true);
    expect(available?.hasAttribute('disabled')).toBe(false);
    act(() => available?.click());
    expect(onExpressInterest).toHaveBeenCalledWith(secondTournament);
  });

  it.each(['idle', 'loading'] as const)('shows an empty %s catalogue as loading without claiming zero results', (inventoryStatus) => {
    render({ empty: true, inventoryStatus });
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Loading tournaments');
    expect(container.textContent).toContain('Loading tournaments');
    expect(container.textContent).not.toContain('0 found');
    expect(container.textContent).not.toContain('No tournaments found');
  });

  it('shows an unavailable empty catalogue after a failed refresh without claiming no events exist', () => {
    render({ empty: true, inventoryStatus: 'error' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Tournament data is unavailable');
    expect(container.textContent).not.toContain('0 found');
    expect(container.textContent).not.toContain('No tournaments found');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('labels a ready partial empty catalogue as incomplete rather than no events', () => {
    render({ empty: true, inventoryPartial: true });
    expect(container.textContent).toContain('More tournaments may be available');
    expect(container.textContent).toContain('0 loaded');
    expect(container.textContent).not.toContain('0 found');
    expect(container.textContent).not.toContain('No tournaments found');
  });

  it('preserves the complete-ready empty state and default backwards-compatible ready behavior', () => {
    render({ empty: true });
    expect(container.textContent).toContain('0 found');
    expect(container.textContent).toContain('No tournaments found');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    render();
    expect(container.textContent).toContain('1 found');
    expect(container.textContent).not.toContain('last loaded');
    expect(container.textContent).not.toContain('More tournaments may be available');
  });

  it.each([
    ['idle', false], ['loading', false], ['error', false],
    ['idle', true], ['loading', true], ['error', true]
  ] as const)('keeps retained %s rows factual and read-only, with active interest %s', (inventoryStatus, activeInterest) => {
    const actions = render({ inventoryStatus, eventInterest: activeInterest ? interest : undefined });
    expect(container.textContent).toContain('Sunday Event');
    expect(container.textContent).toContain('1 last loaded');
    expect(container.textContent).toContain('Tournament listings are read-only');
    expect(container.textContent).not.toContain('1 found');
    click('Request for Sunday Event');
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Refresh required');
    const host = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('Published Club'));
    expect(action?.disabled).toBe(true); expect(host?.disabled).toBe(true);
    act(() => { action?.click(); host?.click(); });
    expect(actions.onExpressInterest).not.toHaveBeenCalled(); expect(actions.onWithdrawInterest).not.toHaveBeenCalled();
    expect(actions.onSelectClub).not.toHaveBeenCalled();
  });

  it('keeps current partial rows usable while identifying their count as loaded', () => {
    const actions = render({ inventoryPartial: true });
    expect(container.textContent).toContain('1 loaded'); expect(container.textContent).not.toContain('1 found');
    expect(container.textContent).toContain('More tournaments may be available');
    click('Request for Sunday Event');
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Express interest');
    expect(action?.disabled).toBe(false);
    act(() => action?.click()); expect(actions.onExpressInterest).toHaveBeenCalledExactlyOnceWith(tournament());
  });
});
