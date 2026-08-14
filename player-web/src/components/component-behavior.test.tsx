import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { OrbitFaq } from '@/src/components/home/orbit-faq';
import { SiteFooter } from '@/src/components/shell/site-footer';
import { SiteHeader } from '@/src/components/shell/site-header';
import { RouteShell } from '@/src/components/shell/route-shell';
import { ButtonLink } from '@/src/components/ui/button';
import { Dialog } from '@/src/components/ui/dialog';
import { Disclosure } from '@/src/components/ui/disclosure';
import { SearchField, SelectField } from '@/src/components/ui/fields';
import { EmptyState, ErrorState } from '@/src/components/ui/state-panels';
import { LocationProvider } from '@/src/location/location-context';
import { clubAlpha, clubBeta, discovery, formingGame, openTournament, paidTournament, player, registration, runningGame } from '@/tests/fixtures';
import { flattenGames } from '@/src/domain/selectors';

const testState = vi.hoisted(() => ({
  search: '',
  pathname: '/games',
  replace: vi.fn(),
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
    ...({ clubs: [], tournaments: [], registrations: [], page: { count: 0, hasMore: false, nextCursor: null } }),
    status: 'ready',
    error: '',
    refresh: vi.fn(async () => undefined),
    requestMembership: vi.fn(async () => undefined),
    requestSeat: vi.fn(async () => undefined),
    cancelSeat: vi.fn(async () => undefined),
    register: vi.fn(async () => registration),
    unregister: vi.fn(async () => undefined)
  }
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(testState.search),
  usePathname: () => testState.pathname,
  useRouter: () => ({ replace: testState.replace, refresh: vi.fn() })
}));

vi.mock('@/src/auth/auth-context', () => ({ useAuth: () => testState.auth }));
vi.mock('@/src/data/player-data-context', () => ({ usePlayerData: () => testState.data }));

afterEach(cleanup);

beforeEach(() => {
  window.history.replaceState(null, '', '/games');
  testState.search = '';
  testState.pathname = '/games';
  testState.replace.mockReset();
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
  testState.data.register.mockReset().mockResolvedValue(registration);
  testState.data.unregister.mockReset().mockResolvedValue(undefined);
});

describe('Player Web route and component behavior', () => {
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

  it('shows tournament cost and registration state in the listing', () => {
    render(<TournamentCard listing={{ club: clubAlpha, tournament: openTournament, registration: undefined, distanceMiles: 5 }} />);
    expect(screen.getByText('Registration open')).toBeVisible();
    expect(screen.getByText(/Free entry/)).toBeVisible();
  });

  it('shows an authenticated registered tournament state', () => {
    render(<TournamentCard listing={{ club: clubAlpha, tournament: openTournament, registration, distanceMiles: 5 }} />);
    expect(screen.getByText('Registered')).toBeVisible();
  });

  it('exposes a labeled search field to keyboard and assistive technology', async () => {
    const change = vi.fn();
    render(<SearchField label="Search games" value="" onChange={change} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search games' }), 'PLO');
    expect(change).toHaveBeenCalled();
  });

  it('exposes a labeled Base UI filter select', async () => {
    const change = vi.fn();
    render(<SelectField label="Status" value="all" onValueChange={change} options={[{ value: 'all', label: 'Any' }, { value: 'running', label: 'Running' }]} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(screen.getByRole('option', { name: 'Running' }));
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
    render(<LocationProvider><GamesExplorer clubs={discovery.clubs} /></LocationProvider>);
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(screen.getByRole('option', { name: 'Forming' }));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/games?status=forming');
    expect(testState.replace).not.toHaveBeenCalled();
  });

  it('renders public clubs with activity context', () => {
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

  it('keeps public tournaments visible while signed out', () => {
    testState.pathname = '/tournaments';
    render(<LocationProvider><TournamentsExplorer discovery={discovery} /></LocationProvider>);
    expect(screen.getByText('Sunday Orbit Major')).toBeVisible();
    expect(screen.getByText('Deep Stack Classic')).toBeVisible();
  });

  it('filters public tournament results to open registration', () => {
    testState.search = 'registration=open';
    testState.pathname = '/tournaments';
    render(<LocationProvider><TournamentsExplorer discovery={discovery} /></LocationProvider>);
    expect(screen.getByText('Sunday Orbit Major')).toBeVisible();
    expect(screen.queryByText('Deep Stack Classic')).not.toBeInTheDocument();
  });

  it('shows registered events for logged-in tournament discovery', () => {
    testState.search = 'registration=registered';
    testState.pathname = '/tournaments';
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    render(<LocationProvider><TournamentsExplorer discovery={discovery} /></LocationProvider>);
    expect(screen.getByText('Sunday Orbit Major')).toBeVisible();
    expect(screen.queryByText('Deep Stack Classic')).not.toBeInTheDocument();
  });

  it('keeps manual location fallback usable when geolocation is not granted', async () => {
    render(<LocationProvider><LocationControl /></LocationProvider>);
    await userEvent.type(screen.getByLabelText('City or area'), 'Dallas');
    await userEvent.click(screen.getByRole('button', { name: 'Set area' }));
    expect(screen.getByText('Dallas')).toBeVisible();
  });

  it('protects My Orbit while preserving the requested private route', () => {
    render(<AuthGate returnTo="/me/games"><span>Private games</span></AuthGate>);
    expect(screen.queryByText('Private games')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in?returnTo=%2Fme%2Fgames');
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
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', expect.stringContaining('intent=tournament'));
  });

  it('keeps game attendance choices functional through Base UI radio controls', async () => {
    const club = { ...clubAlpha, waitlists: [] };
    testState.auth.status = 'signed-in';
    testState.auth.user = { uid: player.id };
    testState.auth.player = player;
    Object.assign(testState.data, discovery, { clubs: [club] });
    render(<GameAction club={club} game={formingGame} />);

    await userEvent.click(screen.getByRole('button', { name: "I'm interested" }));
    expect(screen.getByRole('radio', { name: /interested/i })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /coming/i }));
    expect(screen.getByLabelText('Expected arrival')).toBeVisible();
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
    await userEvent.click(screen.getByRole('button', { name: /Sign in or create account/ }));
    expect(testState.auth.signIn).toHaveBeenCalledWith('avery@example.com', 'correct-horse-battery');
    expect(testState.replace).toHaveBeenCalledWith('/games/game-key?intent=waitlist');
  });

  it('shows authentication failure without losing the current form', async () => {
    testState.auth.signIn.mockRejectedValueOnce(new Error('Invalid credentials.'));
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText('Email address'), 'avery@example.com');
    await userEvent.type(screen.getByLabelText(/Password or passphrase/), 'wrong-password-value');
    await userEvent.click(screen.getByRole('button', { name: /Sign in or create account/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials.');
    expect(screen.getByLabelText('Email address')).toHaveValue('avery@example.com');
  });

  it('uses accessible keyboard interaction for tournament filters', async () => {
    testState.pathname = '/tournaments';
    render(<LocationProvider><TournamentsExplorer discovery={{ ...discovery, clubs: [clubAlpha, clubBeta], tournaments: [openTournament, paidTournament] }} /></LocationProvider>);
    const select = screen.getByRole('combobox', { name: 'Registration' });
    await userEvent.click(select);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeVisible();
  });
});
