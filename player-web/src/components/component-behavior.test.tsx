import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '@/src/components/auth/auth-gate';
import { SignInForm } from '@/src/components/auth/sign-in-form';
import { ClubMembershipAction } from '@/src/components/actions/club-membership-action';
import { GameAction } from '@/src/components/actions/game-action';
import { TournamentAction } from '@/src/components/actions/tournament-action';
import { ClubsExplorer } from '@/src/components/discovery/clubs-explorer';
import { ClubCard, GameCard, TournamentCard } from '@/src/components/discovery/entity-cards';
import { GamesExplorer } from '@/src/components/discovery/games-explorer';
import { LocationControl } from '@/src/components/discovery/location-control';
import { TournamentsExplorer } from '@/src/components/discovery/tournaments-explorer';
import { PublishedGameTables } from '@/src/components/discovery/published-game-tables';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { OrbitFaq } from '@/src/components/home/orbit-faq';
import { MyClubs } from '@/src/components/my-orbit/sections';
import { SiteFooter } from '@/src/components/shell/site-footer';
import { SiteHeader } from '@/src/components/shell/site-header';
import { RouteShell } from '@/src/components/shell/route-shell';
import { ButtonLink } from '@/src/components/ui/button';
import { Dialog } from '@/src/components/ui/dialog';
import { Disclosure } from '@/src/components/ui/disclosure';
import { SearchField, SelectField } from '@/src/components/ui/fields';
import { EmptyState, ErrorState } from '@/src/components/ui/state-panels';
import { LocationProvider } from '@/src/location/location-context';
import { clubAlpha, clubBeta, discovery, formingGame, interest, openTournament, paidTournament, player, runningGame, scheduledGame } from '@/tests/fixtures';
import { flattenGames } from '@/src/domain/selectors';

const testState = vi.hoisted(() => ({
  search: '',
  pathname: '/games',
  replace: vi.fn(),
  refresh: vi.fn(),
  auth: {
    status: 'signed-out',
    user: null as { uid: string } | null,
    player: null as typeof player | null,
    error: '',
    signIn: vi.fn(async () => undefined),
    signOutPlayer: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => 'Reset sent.'),
    updatePlayer: vi.fn(async () => undefined),
    refreshPlayer: vi.fn(async () => undefined)
  },
  data: {
    ...({ clubs: [], tournaments: [], interests: [], page: { count: 0, hasMore: false, nextCursor: null } }),
    status: 'ready',
    error: '',
    refresh: vi.fn(async () => undefined),
    requestMembership: vi.fn(async () => undefined),
    requestSeat: vi.fn(async () => undefined),
    cancelSeat: vi.fn(async () => undefined),
    expressInterest: vi.fn(async () => interest),
    withdrawInterest: vi.fn(async () => undefined)
  }
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(testState.search),
  usePathname: () => testState.pathname,
  useRouter: () => ({ replace: testState.replace, refresh: testState.refresh })
}));

vi.mock('@/src/auth/auth-context', () => ({ useAuth: () => testState.auth }));
vi.mock('@/src/data/player-data-context', () => ({ usePlayerData: () => testState.data }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  window.history.replaceState(null, '', '/games');
  testState.search = '';
  testState.pathname = '/games';
  testState.replace.mockReset();
  testState.refresh.mockReset();
  testState.auth.status = 'signed-out';
  testState.auth.user = null;
  testState.auth.player = null;
  testState.auth.error = '';
  testState.auth.signIn.mockReset().mockResolvedValue(undefined);
  testState.auth.resetPassword.mockReset().mockResolvedValue('Reset sent.');
  Object.assign(testState.data, discovery, { status: 'ready', error: '' });
  testState.data.requestMembership.mockReset().mockResolvedValue(undefined);
  testState.data.requestSeat.mockReset().mockResolvedValue(undefined);
  testState.data.cancelSeat.mockReset().mockResolvedValue(undefined);
  testState.data.expressInterest.mockReset().mockResolvedValue(interest);
  testState.data.withdrawInterest.mockReset().mockResolvedValue(undefined);
});

describe('Player Web route and component behavior', () => {
  it('refreshes a tournament route when its interest window reaches a boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-12-31T23:59:59.000Z'));
    testState.auth.user = { uid: 'player-1' };
    render(<LiveRouteRefresh tournaments={[{ ...openTournament, interestStatus: 'closed' }]} />);
    vi.advanceTimersByTime(1_100);
    expect(testState.refresh).toHaveBeenCalledOnce();
  });

  it('shows the primary status and seat state on a game listing', () => {
    render(<GameCard listing={flattenGames([clubAlpha])[0]} />);
    expect(screen.getByText('Running now')).toBeVisible();
    expect(screen.getByText('2 open seats')).toBeVisible();
  });

  it('shows real formation interest before opening a game', () => {
    const listing = flattenGames([clubAlpha]).find((item) => item.game.id === formingGame.id);
    if (!listing) throw new Error('Fixture forming game missing.');
    render(<GameCard listing={listing} />);
    expect(screen.getByText('Forming')).toBeVisible();
    expect(screen.getByText('4 interested')).toBeVisible();
  });

  it('preserves an authoritative zero formation-interest count', () => {
    const listing = flattenGames([{ ...clubAlpha, games: [{ ...formingGame, waitlistCount: 0, knownPlayersCount: 7 }] }])[0];
    render(<GameCard listing={listing} />);
    expect(screen.getByText('0 interested')).toBeVisible();
    expect(screen.queryByText('7 interested')).not.toBeInTheDocument();
  });

  it('uses explicit unavailable copy when no table status was published', () => {
    const listing = flattenGames([{ ...clubAlpha, games: [scheduledGame] }])[0];
    render(<GameCard listing={listing} />);
    expect(screen.getByText('Status unavailable')).toBeVisible();
    expect(screen.getByText('Availability unavailable')).toBeVisible();
    expect(screen.queryByText(/scheduled|club schedule/i)).not.toBeInTheDocument();
  });

  it('labels capacity as available only for a running published table', () => {
    const running = { ...runningGame.openTables[0], id: 'running', status: 'Running' as const, availableSeats: 0 };
    const forming = { ...formingGame.openTables[0], id: 'forming', status: 'Forming' as const, availableSeats: 7 };
    const paused = { ...runningGame.openTables[0], id: 'paused', status: 'Paused' as const, availableSeats: 8 };
    render(<PublishedGameTables tables={[running, forming, paused]} />);

    const articles = screen.getAllByRole('article');
    expect(within(articles[0]).getByText('Available seats')).toBeVisible();
    expect(within(articles[0]).getByText('0')).toBeVisible();
    expect(within(articles[1]).getByText('Not open yet')).toBeVisible();
    expect(within(articles[1]).queryByText('7')).not.toBeInTheDocument();
    expect(within(articles[2]).getAllByText('Paused')).toHaveLength(2);
    expect(within(articles[2]).queryByText('8')).not.toBeInTheDocument();
    expect(screen.getAllByText('Unavailable for this status')).toHaveLength(2);
  });

  it('links a game card directly to its shareable detail route', () => {
    render(<GameCard listing={flattenGames([clubAlpha])[0]} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\/games\//));
  });

  it('summarizes club running and forming activity without a mini-dashboard', () => {
    render(<ClubCard club={clubAlpha} distanceMiles={4.2} />);
    expect(screen.getByText('North Loop Poker Club')).toBeVisible();
    expect(screen.getByText('4.2 mi')).toBeVisible();
    const card = screen.getByRole('link');
    expect(within(card).getAllByText('1')).toHaveLength(2);
  });

  it('does not claim a club location when none was published', () => {
    render(<ClubCard club={{ ...clubBeta, club: { ...clubBeta.club, address: undefined } }} distanceMiles={null} />);
    expect(screen.getByText('Location unavailable')).toBeVisible();
  });

  it('shows venue-listed cost and interest state in the listing', () => {
    render(<TournamentCard listing={{ club: clubAlpha, tournament: openTournament, interest: undefined, distanceMiles: 5 }} />);
    expect(screen.getByText('Interest open')).toBeVisible();
    expect(screen.getByText(/Venue lists no buy-in/)).toBeVisible();
  });

  it('shows authenticated tournament interest', () => {
    render(<TournamentCard listing={{ club: clubAlpha, tournament: openTournament, interest, distanceMiles: 5 }} />);
    expect(screen.getByText('Interested')).toBeVisible();
  });

  it('renders future and expired tournament-interest windows without an actionable control', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-04T12:00:00.000Z');
    const future = { ...openTournament, interestOpensAt: '2026-09-05T12:00:00.000Z' };
    const expired = { ...openTournament, id: 'expired', interestClosesAt: '2026-09-03T12:00:00.000Z' };

    const { unmount } = render(<TournamentAction club={clubAlpha} tournament={future} />);
    expect(screen.getByRole('button', { name: 'Interest not open yet' })).toBeDisabled();
    unmount();
    render(<TournamentAction club={clubAlpha} tournament={expired} />);
    expect(screen.getByRole('button', { name: 'Interest closed' })).toBeDisabled();
  });

  it('does not invent a tournament venue, level time, or entrant count', () => {
    render(<TournamentCard listing={{
      club: undefined,
      tournament: { ...openTournament, levelMinutes: undefined, entrantCount: undefined },
      interest: undefined,
      distanceMiles: null
    }} />);
    expect(screen.getByText('Venue unavailable')).toBeVisible();
    expect(screen.getByText('Level time unavailable')).toBeVisible();
    expect(screen.getByText('Entrants unavailable')).toBeVisible();
    expect(screen.queryByText('Orbit club')).not.toBeInTheDocument();
  });

  it('uses only a published membership plan name', () => {
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    Object.assign(testState.data, {
      ...discovery,
      clubs: [{ ...clubAlpha, memberships: [{ ...clubAlpha.memberships[0], plan: 'day', planName: undefined }] }],
      status: 'ready'
    });
    render(<MyClubs />);
    expect(screen.getByText('Membership access')).toBeVisible();
    expect(screen.queryByText('Day pass')).not.toBeInTheDocument();
  });

  it('exposes a labeled search field to keyboard and assistive technology', async () => {
    const change = vi.fn();
    render(<SearchField label="Search games" value="" onChange={change} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search games' }), 'PLO');
    expect(change).toHaveBeenCalled();
  });

  it('exposes a labeled Base UI filter select', async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<SelectField label="Status" value="all" onValueChange={change} options={[{ value: 'all', label: 'Any' }, { value: 'running', label: 'Running' }]} />);
    act(() => screen.getByRole('combobox', { name: 'Status' }).focus());
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: 'Running' }));
    expect(change).toHaveBeenCalledWith('running');
  });

  it('renders an explanatory empty result with a useful next action', () => {
    render(<EmptyState title="No games" message="Try another area." action={<ButtonLink href="/clubs">Browse clubs</ButtonLink>} />);
    expect(screen.getByText('Try another area.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse clubs' })).toHaveAttribute('href', '/clubs');
  });

  it('renders an authoritative failure and invokes retry', async () => {
    const retry = vi.fn();
    render(<ErrorState message="Live data failed." onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Live data failed.');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('provides an accessible dialog close control', async () => {
    function DialogHarness() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} onOpenChange={setOpen} title="Choose arrival"><button type="button">Inside action</button></Dialog>;
    }
    render(<DialogHarness />);
    expect(screen.getByRole('dialog', { name: 'Choose arrival' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes explicit expanded state for Watermelon-style disclosures', async () => {
    render(<Disclosure title="Refine games"><span>Filter controls</span></Disclosure>);
    const trigger = screen.getByRole('button', { name: 'Refine games' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Filter controls')).not.toBeInTheDocument();
  });

  it('does not mount the authenticated application shell on the landing route', () => {
    testState.pathname = '/';
    render(<RouteShell><span>Landing content</span></RouteShell>);
    expect(screen.getByText('Landing content')).toBeVisible();
    expect(document.querySelector('.site-header')).not.toBeInTheDocument();
    expect(document.querySelector('.site-footer')).not.toBeInTheDocument();
    expect(document.querySelector('.ambient-flow')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('keeps the web navigation visible at the top of non-home routes', () => {
    testState.pathname = '/games';
    render(<SiteHeader />);

    expect(document.querySelector('.site-header')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  });

  it('exposes explicit expanded state for the mobile web navigation', async () => {
    render(<SiteHeader />);
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the custom FAQ exclusive and keyboard-operable', async () => {
    render(<OrbitFaq />);
    const first = screen.getByRole('button', { name: 'Do I need an account to browse?' });
    const second = screen.getByRole('button', { name: 'Where does the live information come from?' });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/participating rooms publish/i)).toBeVisible();
  });

  it('links the real developer, source repository, and contact channels', () => {
    render(<SiteFooter />);
    expect(screen.getByRole('link', { name: /Caminus Labs, LLC/ })).toHaveAttribute('href', 'https://caminuslabs.com/');
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/sahusgupta/orbit');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', 'mailto:hello@caminuslabs.com');
  });

  it('keeps logged-out discovery visible on the games route', () => {
    render(<LocationProvider><GamesExplorer clubs={discovery.clubs} /></LocationProvider>);
    expect(screen.getByText('1/2 NLH')).toBeVisible();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it('shows a meaningful empty state when search has no local result', () => {
    testState.search = 'q=not-a-real-game';
    render(<LocationProvider><GamesExplorer clubs={discovery.clubs} /></LocationProvider>);
    expect(screen.getByText('No games match those filters')).toBeVisible();
  });

  it('preserves game search in route query state', async () => {
    render(<LocationProvider><GamesExplorer clubs={discovery.clubs} /></LocationProvider>);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search games or clubs' }), { target: { value: 'PLO' } });
    expect(`${window.location.pathname}${window.location.search}`).toBe('/games?q=PLO');
    expect(testState.replace).not.toHaveBeenCalled();
  });

  it('preserves game status filtering in route query state', async () => {
    const user = userEvent.setup();
    render(<LocationProvider><GamesExplorer clubs={discovery.clubs} /></LocationProvider>);
    act(() => screen.getByRole('combobox', { name: 'Status' }).focus());
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: 'Forming' }));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/games?status=forming');
    expect(testState.replace).not.toHaveBeenCalled();
  });

  it('renders club discovery with activity context', () => {
    testState.pathname = '/clubs';
    render(<LocationProvider><ClubsExplorer clubs={discovery.clubs} /></LocationProvider>);
    expect(screen.getByText('North Loop Poker Club')).toBeVisible();
    expect(screen.getByText('River Room')).toBeVisible();
  });

  it('shows a club empty result without requiring location permission', () => {
    testState.search = 'q=no-such-club';
    testState.pathname = '/clubs';
    render(<LocationProvider><ClubsExplorer clubs={discovery.clubs} /></LocationProvider>);
    expect(screen.getByText('No clubs match those filters')).toBeVisible();
  });

  it('renders tournament discovery results', () => {
    testState.pathname = '/tournaments';
    render(<LocationProvider><TournamentsExplorer discovery={discovery} /></LocationProvider>);
    expect(screen.getByText('Sunday Orbit Major')).toBeVisible();
    expect(screen.getByText('Deep Stack Classic')).toBeVisible();
  });

  it('filters tournament results to open interest', () => {
    testState.search = 'interest=open';
    testState.pathname = '/tournaments';
    render(<LocationProvider><TournamentsExplorer discovery={discovery} /></LocationProvider>);
    expect(screen.getByText('Sunday Orbit Major')).toBeVisible();
    expect(screen.queryByText('Deep Stack Classic')).not.toBeInTheDocument();
  });

  it('shows interested events for logged-in tournament discovery', () => {
    testState.search = 'interest=interested';
    testState.pathname = '/tournaments';
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    render(<LocationProvider><TournamentsExplorer discovery={discovery} /></LocationProvider>);
    expect(screen.getByText('Sunday Orbit Major')).toBeVisible();
    expect(screen.queryByText('Deep Stack Classic')).not.toBeInTheDocument();
  });

  it('keeps discovery usable without requesting or inventing a player location', () => {
    render(<LocationProvider><LocationControl /></LocationProvider>);
    expect(screen.getByText('Distance unavailable in this release')).toBeVisible();
    expect(screen.getByText(/does not request a device location/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /location/i })).not.toBeInTheDocument();
  });

  it('does not expose or honor a distance filter without a player origin', () => {
    testState.search = 'distance=5';
    render(<LocationProvider><GamesExplorer clubs={discovery.clubs} /></LocationProvider>);
    expect(screen.getByText('1/2 NLH')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Distance' })).not.toBeInTheDocument();
  });

  it('protects My Orbit while preserving the requested authenticated route', () => {
    render(<AuthGate returnTo="/me/games"><span>Account games</span></AuthGate>);
    expect(screen.queryByText('Account games')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in or create account' })).toHaveAttribute('href', '/sign-in?returnTo=%2Fme%2Fgames');
  });

  it('preserves logged-out game intent in the sign-in action', () => {
    render(<GameAction club={clubAlpha} game={runningGame} />);
    expect(screen.getByRole('link', { name: "I'm here" })).toHaveAttribute('href', expect.stringContaining('intent=waitlist'));
  });

  it('preserves logged-out membership intent in the sign-in action', () => {
    render(<ClubMembershipAction club={clubAlpha} />);
    expect(screen.getByRole('link', { name: 'Request membership' })).toHaveAttribute('href', expect.stringContaining('intent=membership'));
  });

  it('preserves logged-out tournament intent in the sign-in action', () => {
    render(<TournamentAction club={clubAlpha} tournament={openTournament} />);
    expect(screen.getByRole('link', { name: 'Express interest' })).toHaveAttribute('href', expect.stringContaining('intent=tournament'));
  });

  it.each([
    ['forming', formingGame],
    ['paused', { ...runningGame, id: 'game-paused', openTables: runningGame.openTables.map((table) => ({ ...table, id: 'table-paused', status: 'Paused' as const })) }],
    ['no-table', scheduledGame]
  ])('renders a %s game as interest-only when no Running table is published', async (_label, selectedGame) => {
    const club = { ...clubAlpha, games: [selectedGame], waitlists: [] };
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    Object.assign(testState.data, discovery, { clubs: [club] });
    render(<GameAction club={club} game={selectedGame} />);

    await userEvent.click(screen.getByRole('button', { name: "I'm interested" }));
    expect(screen.getByText('Interest only')).toBeVisible();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expected arrival')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Available from')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send interest' })).toBeVisible();
  });

  it('offers only arrived or confirmed attendance for a Running table and defaults to arrived', async () => {
    const mixedGame = {
      ...runningGame,
      openTables: [
        { ...formingGame.openTables[0], id: 'forming-first', gameId: runningGame.id },
        { ...runningGame.openTables[0], id: 'running-second' }
      ]
    };
    const club = { ...clubAlpha, games: [mixedGame], waitlists: [] };
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    Object.assign(testState.data, discovery, { clubs: [club] });
    render(<GameAction club={club} game={mixedGame} />);

    await userEvent.click(screen.getByRole('button', { name: "I'm here" }));
    expect(screen.getByRole('radio', { name: /here/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /coming/i })).toBeVisible();
    expect(screen.queryByRole('radio', { name: /interested/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm with club' }));
    expect(testState.data.requestSeat).toHaveBeenCalledWith(club, mixedGame, { attendance: 'arrived' });
  });

  it('submits interest-only availability for a game without a Running table', async () => {
    const club = { ...clubAlpha, games: [formingGame], waitlists: [] };
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    Object.assign(testState.data, discovery, { clubs: [club] });
    render(<GameAction club={club} game={formingGame} />);

    await userEvent.click(screen.getByRole('button', { name: "I'm interested" }));
    fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Available until'), { target: { value: '22:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Send interest' }));
    expect(testState.data.requestSeat).toHaveBeenCalledWith(club, formingGame, {
      attendance: 'interested',
      availabilityStartTime: '18:00',
      availabilityEndTime: '22:00'
    });
  });

  it('preserves a reported zero request position without inventing club confirmation', () => {
    const club = {
      ...clubAlpha,
      waitlists: clubAlpha.waitlists.map((entry) => ({ ...entry, position: 0 }))
    };
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    Object.assign(testState.data, discovery, { clubs: [club] });
    render(<GameAction club={club} game={runningGame} />);
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.queryByText('Club confirmed')).not.toBeInTheDocument();
  });

  it('submits the selected membership option through the Base UI form', async () => {
    const club = { ...clubAlpha, memberships: [], waitlists: [] };
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    Object.assign(testState.data, discovery, { clubs: [club] });
    render(<ClubMembershipAction club={club} />);

    await userEvent.click(screen.getByRole('button', { name: 'Request membership' }));
    await userEvent.click(screen.getByRole('radio', { name: /Monthly/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(testState.data.requestMembership).toHaveBeenCalledWith(club, expect.objectContaining({ id: 'monthly' }));
  });

  it('returns successful authentication to the original action context', async () => {
    testState.search = 'returnTo=%2Fgames%2Fgame-key&intent=waitlist';
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText('Email address'), 'avery@example.com');
    await userEvent.type(screen.getByLabelText(/Password or passphrase/), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('checkbox', { name: /18 years of age or older/i }));
    await userEvent.click(screen.getByRole('button', { name: /Sign in or create account/ }));
    expect(testState.auth.signIn).toHaveBeenCalledWith('avery@example.com', 'correct-horse-battery', true);
    expect(testState.replace).toHaveBeenCalledWith('/games/game-key?intent=waitlist');
  });

  it('requires an explicit adult declaration before sign-in or account creation', async () => {
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText('Email address'), 'avery@example.com');
    await userEvent.type(screen.getByLabelText(/Password or passphrase/), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: /Sign in or create account/ }));
    expect(testState.auth.signIn).not.toHaveBeenCalled();
  });

  it('shows authentication failure without losing the current form', async () => {
    testState.auth.signIn.mockRejectedValueOnce(new Error('Invalid credentials.'));
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText('Email address'), 'avery@example.com');
    await userEvent.type(screen.getByLabelText(/Password or passphrase/), 'wrong-password-value');
    await userEvent.click(screen.getByRole('checkbox', { name: /18 years of age or older/i }));
    await userEvent.click(screen.getByRole('button', { name: /Sign in or create account/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials.');
    expect(screen.getByLabelText('Email address')).toHaveValue('avery@example.com');
  });

  it('shows a deadline error when authentication never responds', async () => {
    vi.useFakeTimers();
    testState.auth.signIn.mockImplementationOnce(() => new Promise(() => undefined));
    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'avery@example.com' } });
    fireEvent.change(screen.getByLabelText(/Password or passphrase/), { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /18 years of age or older/i }));
    fireEvent.click(screen.getByRole('button', { name: /Sign in or create account/ }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/took too long/i);
    expect(screen.getByRole('button', { name: /Sign in or create account/ })).toBeEnabled();
  });

  it('uses accessible keyboard interaction for tournament filters', async () => {
    testState.pathname = '/tournaments';
    render(<LocationProvider><TournamentsExplorer discovery={{ ...discovery, clubs: [clubAlpha, clubBeta], tournaments: [openTournament, paidTournament] }} /></LocationProvider>);
    const select = screen.getByRole('combobox', { name: 'Interest' });
    await userEvent.click(select);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeVisible();
  });
});
