/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultMatchPreferences, type MatchDecision, type MatchPreferences, type RankedMatchCandidate } from '../../domain/orbitMatchTypes';
import { rankMatchCandidates } from '../../domain/orbitMatchCandidates';
import { createDemoPlayerData } from '../../demo/demoPlayerData';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import { nativeTextContrast } from '../../test-utils/nativeContrast';
import { OrbitMatchScreen, getMatchSwipeDecision, type MatchMode, type OrbitMatchScreenProps } from './OrbitMatchScreen';
import { PlayerThemeProvider, usePlayerTheme } from '../../styles/PlayerThemeProvider';

type Gesture = { dx: number; dy: number; vx: number; x0?: number; y0?: number; numberActiveTouches?: number };
type Responder = {
  onMoveShouldSetPanResponder: (event: unknown, gesture: Gesture) => boolean;
  onPanResponderGrant: (event?: unknown, gesture?: Gesture) => void;
  onPanResponderStart?: (event: unknown, gesture: Gesture) => void;
  onPanResponderEnd?: (event: unknown, gesture: Gesture) => void;
  onPanResponderMove: (event: unknown, gesture: Gesture) => void;
  onPanResponderRelease: (event: unknown, gesture: Gesture) => void;
  onPanResponderTerminate: () => void;
};
type TestAnimation = { finish: (finished: boolean) => void; stop: () => void };
type TestValue = { value: number; initialValue: number; writes: number[]; stopCount: number };
const native = vi.hoisted(() => ({
  reduced: false,
  responders: [] as Responder[],
  animations: [] as TestAnimation[],
  animationOptions: [] as { useNativeDriver: boolean; duration?: number; toValue: number; kind: 'timing' | 'spring'; value: TestValue }[],
  values: [] as TestValue[],
  motionListeners: new Set<(value: boolean) => void>(),
  unsubscribe: vi.fn(),
  scheme: 'dark' as 'light' | 'dark', appearanceListeners: new Set<() => void>(),
  platform: 'ios' as 'ios' | 'android'
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const { nativePaintStyle } = await import('../../test-utils/nativeContrast');
  type Style = { minHeight?: number } | Style[] | false | undefined;
  const minHeight = (style: Style): number => Array.isArray(style) ? Math.max(0, ...style.map(minHeight)) : style ? style.minHeight ?? 0 : 0;
  const element = (tag: string) => ({ children, onPress, onChangeText, value, disabled, editable, accessibilityLabel, accessibilityRole, accessibilityState, accessibilityElementsHidden, importantForAccessibility, style }: {
    children?: React.ReactNode; onPress?: () => void; onChangeText?: (value: string) => void; value?: string;
    disabled?: boolean; editable?: boolean; accessibilityLabel?: string; accessibilityRole?: string;
    accessibilityState?: { selected?: boolean; checked?: boolean; disabled?: boolean; expanded?: boolean };
    accessibilityElementsHidden?: boolean; importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants'; style?: Style;
  }) => ReactModule.createElement(tag, {
    onClick: onPress, onInput: onChangeText ? (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value) : undefined,
    value, disabled: disabled || editable === false, 'aria-label': accessibilityLabel, role: accessibilityRole,
    'aria-selected': accessibilityState?.selected, 'aria-checked': accessibilityState?.checked,
    'aria-expanded': accessibilityState?.expanded,
    'aria-disabled': accessibilityState?.disabled,
    'aria-hidden': native.platform === 'android' ? importantForAccessibility === 'no-hide-descendants' : accessibilityElementsHidden,
    'data-ios-hidden': accessibilityElementsHidden, 'data-android-importance': importantForAccessibility,
    'data-min-height': minHeight(style), style: { backgroundColor: 'transparent', ...nativePaintStyle(style) }
  }, children);
  class Value {
    value: number;
    initialValue: number;
    writes: number[] = [];
    stopCount = 0;
    constructor(value: number) { this.value = value; this.initialValue = value; native.values.push(this); }
    setValue(value: number) { this.value = value; this.writes.push(value); }
    stopAnimation() { this.stopCount += 1; }
    interpolate() { return 0; }
  }
  const step = (kind: 'timing' | 'spring') => (value: Value, options: { useNativeDriver: boolean; duration?: number; toValue: number }) => {
    native.animationOptions.push({ ...options, kind, value });
    return { start: vi.fn(), stop: vi.fn() };
  };
  return {
    Appearance: { getColorScheme: () => native.scheme, addChangeListener: (listener: () => void) => {
      native.appearanceListeners.add(listener); return { remove: () => { native.appearanceListeners.delete(listener); } };
    } },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(native.reduced),
      addEventListener: (_name: string, listener: (value: boolean) => void) => {
        native.motionListeners.add(listener);
        return { remove: () => { native.motionListeners.delete(listener); native.unsubscribe(); } };
      }
    },
    Animated: {
      Value, View: element('div'), timing: step('timing'), spring: step('spring'),
      parallel: () => {
        let callback: ((result: { finished: boolean }) => void) | undefined;
        const animation = { finish: (finished: boolean) => callback?.({ finished }), stop: vi.fn(() => callback?.({ finished: false })) };
        native.animations.push(animation);
        return { start: (next?: typeof callback) => { callback = next; }, stop: animation.stop };
      }
    },
    Easing: { cubic: () => 0, out: (value: unknown) => value },
    PanResponder: { create: (responder: Responder) => { native.responders.push(responder); return { panHandlers: {} }; } },
    Platform: { get OS() { return native.platform; } },
    Pressable: element('button'), Text: element('span'), TextInput: element('input'), View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const club: PlayerClubSnapshot = {
  club: { id: 'club-a', name: 'Published River Room', address: '100 Example Street, Austin, TX' },
  games: [{ id: 'game-a', name: '$1/$2 NLH', maxSeats: 9, collectionMode: 'Time',
    openTables: [
      { id: 'running', gameId: 'game-a', label: 'Running table', status: 'Running', maxSeats: 9, seatsFilled: 6, availableSeats: 3, collectionMode: 'Time', tags: [], startedAt: '', social: { seatedPlayerCount: 6, adminCount: 0, knownPlayersCount: 0 } },
      { id: 'forming', gameId: 'game-a', label: 'Forming table', status: 'Forming', maxSeats: 9, seatsFilled: 0, availableSeats: 9, collectionMode: 'Time', tags: [], startedAt: '', social: { seatedPlayerCount: 0, adminCount: 0, knownPlayersCount: 0 } }
    ], availableSeats: 12, waitlistCount: 4, formingCount: 1, knownPlayersCount: 0 }],
  memberships: [], waitlists: [], notifications: [], generatedAt: '2026-10-12T12:00:00Z'
};
const candidate: RankedMatchCandidate = {
  ref: { clubId: club.club.id, gameId: club.games[0].id, kind: 'cash' },
  summary: { venueName: club.club.name, gameName: club.games[0].name },
  opportunity: { club, game: club.games[0], distanceMiles: 6.2, isJoined: false, isPreferred: true, seatRequestAccess: 'missing' },
  tournament: null, variant: 'nlh', bigBlind: 2, buyIn: null, distanceMiles: 6.2, status: 'live', availableSeats: 3,
  waitlistCount: 4, publishedAt: '2026-10-12T12:00:00Z', score: 98,
  components: { stakes: 1, proximity: 1, variant: 1, availability: 1, venue: 1 }, reasons: ['Matches your preferred stakes.']
};
const savedRecord: MatchDecision = {
  ref: candidate.ref, summary: candidate.summary, decision: 'saved', mutationId: 'opaque-save', decidedAt: '2026-10-12T12:00:00Z'
};
const cashHeroLabel = 'Open $1/$2 NLH at Published River Room; HOLD\u2019EM; 3 seats open; Austin \u00b7 6.2 mi away';
function ThemedMatch(props: OrbitMatchScreenProps) {
  const { colors } = usePlayerTheme();
  return <div style={{ backgroundColor: colors.canvas }}><OrbitMatchScreen {...props} /></div>;
}

describe('Orbit Match native presentation and interactions', () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: OrbitMatchScreenProps;
  let selectProfileMode: React.Dispatch<React.SetStateAction<MatchMode>>;
  function MatchHarness(screenProps: OrbitMatchScreenProps) {
    const [mode, setMode] = React.useState<MatchMode>('discover');
    selectProfileMode = setMode;
    return <ThemedMatch {...screenProps} mode={screenProps.mode ?? mode} onModeChange={(next) => { setMode(next); screenProps.onModeChange?.(next); }} />;
  }
  const render = async (overrides: Partial<OrbitMatchScreenProps> = {}) => {
    props = { ...props, ...overrides };
    await act(async () => { root.render(<PlayerThemeProvider><MatchHarness {...props} /></PlayerThemeProvider>); });
  };
  const button = (label: string) => {
    const item = Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === label);
    if (!item) throw new Error(`Missing action: ${label}`);
    return item;
  };
  const hero = () => {
    const item = Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label')?.startsWith('Open '));
    if (!item) throw new Error('Missing front game card.');
    return item;
  };
  const click = (label: string) => act(() => button(label).click());
  const openPreferences = () => act(() => selectProfileMode('preferences'));
  const clickAsync = (label: string) => act(async () => { button(label).click(); });
  const type = (label: string, value: string) => act(() => {
    const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const release = (dx: number, dy = 0, vx = 0) => act(() => {
    native.responders.at(-1)?.onPanResponderGrant();
    native.responders.at(-1)?.onPanResponderRelease({}, { dx, dy, vx });
  });
  const finish = () => act(() => native.animations.at(-1)?.finish(true));
  const touchEvent = (identifier: string | number, pageX: number, pageY: number, ended = false) => {
    const point = { identifier, pageX, pageY };
    return { nativeEvent: { ...point, touches: ended ? [] : [point], changedTouches: [point] } };
  };
  const beginPointerSwipe = async (identifier: string | number = 7, dx = 29.562, dy = 0, vx = 0.404,
    grantOverrides: { event?: unknown; gesture?: Partial<Gesture> } = {}) => {
    native.platform = 'android';
    await render();
    const responder = native.responders.at(-1);
    if (!responder) throw new Error('Real MatchDeck responder was not created.');
    const origin = { x0: 200, y0: 300 };
    const grantEvent = touchEvent(identifier, origin.x0, origin.y0);
    const move: Gesture = { ...origin, dx, dy, vx, numberActiveTouches: 1 };
    act(() => {
      responder.onPanResponderGrant(Object.hasOwn(grantOverrides, 'event') ? grantOverrides.event : grantEvent,
        { ...origin, dx: 0, dy: 0, vx, numberActiveTouches: 1, ...grantOverrides.gesture });
      responder.onPanResponderMove(touchEvent(identifier, origin.x0 + dx, origin.y0 + dy), move);
    });
    return { responder, origin, move, endEvent: touchEvent(identifier, origin.x0 + 133.451, origin.y0, true) };
  };
  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    native.reduced = false;
    native.responders = [];
    native.animations = [];
    native.animationOptions = [];
    native.values = [];
    native.motionListeners.clear();
    native.appearanceListeners.clear(); native.scheme = 'dark'; native.platform = 'ios';
    props = {
      candidates: [candidate], savedGames: [], inventoryStatus: 'ready', inventoryPartial: false, storageReady: true,
      pending: false, error: '', canUndo: true, preferences: { ...defaultMatchPreferences }, clubs: [{ id: club.club.id, name: club.club.name }],
      onDecision: vi.fn(), onUndo: vi.fn(), onRemoveSaved: vi.fn(), onDetails: vi.fn(), onPreferences: vi.fn(), onRetry: vi.fn()
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(['ios', 'android'] as const)('hides decorative feedback, monograms and the next card on %s while keeping actions accessible', async (platform) => {
    native.platform = platform;
    await render({ candidates: [candidate, { ...candidate, ref: { ...candidate.ref, gameId: 'game-b' } }] });
    const decorative = Array.from(container.querySelectorAll('[data-ios-hidden="true"]'));
    expect(decorative).toHaveLength(5);
    for (const node of decorative) {
      expect(node.getAttribute('data-android-importance')).toBe('no-hide-descendants');
      expect(node.getAttribute('aria-hidden')).toBe('true');
    }
    for (const label of ['Pass $1/$2 NLH', 'Save $1/$2 NLH', 'View details', cashHeroLabel]) {
      expect(button(label).closest('[aria-hidden="true"]')).toBeNull();
    }
  });

  it.each([
    'fetch failed: java.io.IOException: unexpected end of stream on http://127.0.0.1:14639/...',
    'Network request failed',
    'Failed to fetch'
  ])('shows readable connection copy while retaining pending saves and retry: %s', async (error) => {
    await render({ mode: 'saved', pending: true, error, savedGames: [{ record: savedRecord, candidate, unavailableReason: null }] });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not connect to Match. Try again shortly.');
    expect(container.textContent).not.toContain(error);
    expect(container.textContent).toContain('Published River Room');
    expect(button('Remove saved $1/$2 NLH').disabled).toBe(true);
    click('Retry Match');
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onRemoveSaved).not.toHaveBeenCalled();
    expect(props.error).toBe(error);
  });

  it.each([
    'Sign in to your Orbit Player account first.',
    'Secure storage is unavailable. Match and location changes could not be saved.'
  ])('preserves actionable account and secure-storage errors: %s', async (error) => {
    await render({ error });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(error);
    click('Retry Match');
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('describes a ready partial empty catalogue without promising an active background load', async () => {
    await render({ inventoryPartial: true, candidates: [] });
    expect(container.textContent).toContain('Showing loaded games');
    expect(container.textContent).toContain('More games may be available');
    expect(container.textContent).toContain('Refresh to check for additional published games.');
    expect(container.textContent).not.toContain('More venues are loading');
    expect(container.textContent).not.toContain('Games from additional venues may still appear.');
    expect(container.textContent).not.toContain('No more matching games');
    click('Refresh Match games'); expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('labels a usable partial deck as loaded games without implying complete inventory or background progress', async () => {
    await render({ inventoryPartial: true });
    expect(container.textContent).toContain('Showing loaded games');
    expect(container.textContent).not.toContain('Showing loaded venues');
    expect(container.textContent).not.toContain('1 game to explore');
    expect(container.textContent).toContain('Published River Room');
    expect(button('Save $1/$2 NLH').disabled).toBe(false);
    expect(button('View details').disabled).toBe(false);
  });

  it('keeps the first card focused and reveals published facts only on request', async () => {
    await render();
    expect(container.textContent).not.toContain('Running tables');
    expect(container.textContent).not.toContain('Matches your preferred stakes.');
    expect(container.textContent).not.toContain('Published games. Set preferences anytime.');
    expect(button('Game info').getAttribute('aria-expanded')).toBe('false');
    click('Game info');
    expect(button('Game info').getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('1Running tables');
    expect(container.textContent).toContain('4Waiting');
    expect(container.textContent).toContain('Matches your preferred stakes.');
    expect(props.onDecision).not.toHaveBeenCalled();
    expect(props.onDetails).not.toHaveBeenCalled();
    click('Game info');
    expect(container.textContent).not.toContain('Running tables');
  });

  it('keeps cash primary facts visible while secondary facts start closed', async () => {
    await render();
    const content = hero().textContent;
    for (const fact of ['HOLD\u2019EM', '$1/$2 NLH', 'Published River Room', '3 seats open', 'Austin', '6.2 mi away']) {
      expect(content).toContain(fact);
    }
    for (const detail of ['Running tables', 'Waiting', 'Time rate not published', 'Matches your preferred stakes.']) {
      expect(container.textContent).not.toContain(detail);
    }
    expect(button('Game info').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a scheduled card start and published buy-in visible without live seat claims', async () => {
    const startsAt = '2030-10-13T12:00:00Z';
    const tournament = { ...createDemoPlayerData(Date.parse('2026-10-12T12:00:00Z')).tournaments[0], startsAt };
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, kind: 'tournament' }, opportunity: null, tournament,
      summary: { ...candidate.summary, gameName: 'Published Deep Stack' }, status: 'scheduled', availableSeats: null,
      waitlistCount: null, buyIn: 125, distanceMiles: 2.4 }] });
    const content = hero().textContent;
    const publishedStart = new Date(startsAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    for (const fact of ['TOURNAMENT', 'Published Deep Stack', 'Published River Room', 'Scheduled tournament', publishedStart, '$125 buy-in', '2.4 mi away']) {
      expect(content).toContain(fact);
    }
    expect(content).not.toContain('seats open');
    expect(container.textContent).not.toContain('Published buy-in');
    expect(button('Game info').getAttribute('aria-expanded')).toBe('false');
  });

  it('does not invent optional primary facts when address, distance, start and buy-in are absent', async () => {
    if (!candidate.opportunity) throw new Error('Expected the cash-game fixture opportunity.');
    const withoutAddress = { ...club, club: { id: club.club.id, name: club.club.name } };
    await render({ candidates: [{ ...candidate, distanceMiles: null,
      opportunity: { ...candidate.opportunity, club: withoutAddress }, tournament: null, buyIn: null }] });
    const content = hero().textContent;
    expect(content).toContain('Location unavailable');
    expect(content).toContain('3 seats open');
    for (const missing of ['mi away', 'buy-in', 'undefined', 'null', 'NaN']) expect(content).not.toContain(missing);
    expect(button('Game info').getAttribute('aria-expanded')).toBe('false');
  });

  it('names the cash card with the same visible primary facts and keeps details out of its summary', async () => {
    await render();
    const label = 'Open $1/$2 NLH at Published River Room; HOLD\u2019EM; 3 seats open; Austin \u00b7 6.2 mi away';
    expect(hero().getAttribute('aria-label')).toBe(label);
    expect(button('Game info').getAttribute('aria-expanded')).toBe('false');
    for (const detail of ['Running tables', 'Waiting', 'Time rate not published', 'Matches your preferred stakes.']) {
      expect(hero().getAttribute('aria-label')).not.toContain(detail);
    }
    click('Game info');
    expect(hero().getAttribute('aria-label')).toBe(label);
    click(label);
    expect(props.onDetails).toHaveBeenCalledExactlyOnceWith(candidate, 'deck');
  });

  it('updates the spoken availability and last-loaded state when the same cash card changes', async () => {
    await render();
    if (!candidate.opportunity) throw new Error('Expected the cash-game fixture opportunity.');
    const game = { ...club.games[0], openTables: [{ ...club.games[0].openTables[0], availableSeats: 0, seatsFilled: 9 }] };
    await render({ candidates: [{ ...candidate, opportunity: { ...candidate.opportunity, game }, availableSeats: 0 }] });
    const prefix = 'Open $1/$2 NLH at Published River Room; HOLD\u2019EM; ';
    const suffix = '; Austin \u00b7 6.2 mi away';
    expect(hero().getAttribute('aria-label')).toBe(prefix + 'Running table \u00b7 0 seats open' + suffix);
    await render({ inventoryStatus: 'error' });
    expect(hero().getAttribute('aria-label')).toBe(prefix + 'Last loaded: Running table \u00b7 0 seats open' + suffix);
    expect(button('Save $1/$2 NLH').disabled).toBe(true);
  });

  it('names a scheduled card with its published start and buy-in without inventing live availability', async () => {
    const startsAt = '2030-10-13T12:00:00Z';
    const tournament = { ...createDemoPlayerData(Date.parse('2026-10-12T12:00:00Z')).tournaments[0], startsAt };
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, kind: 'tournament' }, opportunity: null, tournament,
      summary: { ...candidate.summary, gameName: 'Published Deep Stack' }, status: 'scheduled', availableSeats: null,
      waitlistCount: null, buyIn: 125, distanceMiles: 2.4 }] });
    const publishedStart = new Date(startsAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    expect(hero().getAttribute('aria-label')).toBe(`Open Published Deep Stack at Published River Room; TOURNAMENT; Scheduled tournament; 2.4 mi away; ${publishedStart}; $125 buy-in`);
    expect(hero().getAttribute('aria-label')).not.toMatch(/seats open|Running tables|Waiting/);
    expect(button('Game info').getAttribute('aria-expanded')).toBe('false');
  });

  it('omits unavailable optional facts from the spoken summary while retaining a published zero buy-in', async () => {
    if (!candidate.opportunity) throw new Error('Expected the cash-game fixture opportunity.');
    const withoutAddress = { ...club, club: { id: club.club.id, name: club.club.name } };
    await render({ candidates: [{ ...candidate, distanceMiles: null,
      opportunity: { ...candidate.opportunity, club: withoutAddress }, tournament: null, buyIn: null }] });
    expect(hero().getAttribute('aria-label')).toBe('Open $1/$2 NLH at Published River Room; HOLD\u2019EM; 3 seats open; Location unavailable');
    const tournament = { ...createDemoPlayerData(Date.parse('2026-10-12T12:00:00Z')).tournaments[0], startsAt: 'invalid-start' };
    const scheduled: RankedMatchCandidate = { ...candidate, ref: { ...candidate.ref, kind: 'tournament' }, opportunity: null,
      tournament, status: 'scheduled', availableSeats: null, waitlistCount: null, distanceMiles: null, buyIn: null };
    await render({ candidates: [scheduled] });
    const label = 'Open $1/$2 NLH at Published River Room; TOURNAMENT; Scheduled tournament';
    expect(hero().getAttribute('aria-label')).toBe(label);
    expect(hero().getAttribute('aria-label')).not.toMatch(/undefined|null|NaN|Invalid Date|mi away|buy-in|seats open/);
    await render({ candidates: [{ ...scheduled, buyIn: 0 }] });
    expect(hero().getAttribute('aria-label')).toBe(label + '; $0 buy-in');
  });

  it('closes game info when the card changes and preserves explicit shell actions', async () => {
    const onBack = vi.fn(), onSearch = vi.fn(), onFilters = vi.fn();
    await render({ onBack, onSearch, onFilters, searchActive: true, deviceScope: true });
    expect(button('Search games').getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).not.toContain("This device's Match data stays separate.");
    openPreferences();
    expect(container.textContent).toContain("This device's Match data stays separate.");
    click('Discover games');
    click('Back to Games'); click('Search games'); click('Show game filters');
    expect(onBack).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onFilters).toHaveBeenCalledOnce();
    click('Game info');
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, gameId: 'other-game' } }] });
    expect(button('Game info').getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Running tables');
  });

  it('shows published facts and reasons without invented seat capacity or numerical match claims', async () => {
    await render();
    click('Game info');
    expect(container.textContent).toContain('Published River Room');
    expect(container.textContent).toContain('6.2 mi away');
    expect(container.textContent).toContain('3 seats open');
    expect(container.textContent).toContain('1Running tables');
    expect(container.textContent).toContain('4Waiting');
    expect(container.textContent).toContain('Matches your preferred stakes.');
    expect(container.textContent).not.toContain('12 seats open');
    expect(container.textContent).not.toContain('98%');
    expect(container.textContent).not.toContain('Published games. Set preferences anytime.');
    click(cashHeroLabel);
    expect(props.onDetails).toHaveBeenCalledExactlyOnceWith(candidate, 'deck');
    for (const label of ['Pass $1/$2 NLH', 'Save $1/$2 NLH', 'View details', 'Undo last swipe']) {
      expect(Number(button(label).getAttribute('data-min-height'))).toBeGreaterThanOrEqual(44);
    }
    expect(nativeTextContrast(button('Save $1/$2 NLH').querySelector('span'))).toBeGreaterThanOrEqual(4.5);
    expect(button('Save $1/$2 NLH').textContent).toBe('Save');
    expect(button('Pass $1/$2 NLH').textContent).toBe('Pass');
  });
  it('shows cold-start Running availability once and retains optional tables, queue and fee facts', async () => {
    const [ranked] = rankMatchCandidates({ candidates: [candidate], preferences: defaultMatchPreferences, decisions: [] });
    expect(ranked.reasons).toContain('3 published open seats.');
    await render({ candidates: [ranked] });
    const content = button(cashHeroLabel).textContent;
    expect(content).toContain('3 seats open');
    expect(content).not.toContain('Running tables');
    click('Game info');
    expect(container.textContent).toContain('1Running tables');
    expect(container.textContent).toContain('4Waiting');
    expect(container.textContent).toContain('Time rate not published');
    expect(content).not.toContain('Open seats');
    expect(content).not.toContain('3 published open seats.');
    expect(ranked.reasons).toContain('3 published open seats.');
  });
  it('shows the selected-location distance once without changing the real ranking explanation', async () => {
    const [ranked] = rankMatchCandidates({ candidates: [candidate], preferences: defaultMatchPreferences, decisions: [] });
    expect(ranked.reasons).toContain('6.2 miles from your selected location.');
    await render({ candidates: [ranked] });
    const content = button(cashHeroLabel).textContent;
    expect(content).toContain('6.2 mi away');
    expect(content).not.toContain('6.2 miles from your selected location.');
    expect(ranked.reasons).toContain('6.2 miles from your selected location.');
  });
  it.each([
    [{ stakes: { minBigBlind: 1, maxBigBlind: 3 } }, 'Within your preferred stakes range.'],
    [{ variants: ['nlh'] }, 'Matches your preferred game variant.'],
    [{ favoriteClubIds: ['club-a'] }, 'One of your favorite venues.'],
    [{ favoriteClubIds: ['known-venue'], exploreNewVenues: true }, 'Outside your favorite and currently saved venues.']
  ] satisfies Array<[Partial<MatchPreferences>, string]>)('retains the supported preference explanation for %s', async (selection, explanation) => {
    const preferences = { ...defaultMatchPreferences, ...selection };
    const [ranked] = rankMatchCandidates({ candidates: [{ ...candidate, distanceMiles: null }], preferences, decisions: [] });
    expect(ranked.reasons).toContain(explanation);
    await render({ candidates: [ranked], preferences });
    expect(container.textContent).not.toContain(explanation);
    click('Game info');
    expect(container.textContent).toContain(explanation);
  });
  it.each([
    ['Running', 3, 'live', '3 seats open'],
    ['Running', 0, 'live', 'Running table · 0 seats open'],
    ['Forming', 9, 'forming', 'Table forming'],
    ['Paused', 3, 'paused', 'Table paused']
  ] as const)('keeps %s / %s-seat status truthful with the same last-loaded read-only state', async (tableStatus, seats, status, label) => {
    const game = { ...club.games[0], openTables: [{ ...club.games[0].openTables[0], status: tableStatus, availableSeats: seats, seatsFilled: 9 - seats }] };
    if (!candidate.opportunity) throw new Error('Expected the cash-game fixture opportunity.');
    const current = { ...candidate, opportunity: { ...candidate.opportunity, game }, status, availableSeats: tableStatus === 'Running' ? seats : 0, reasons: [] };
    await render({ candidates: [current] });
    const prefix = 'Open $1/$2 NLH at Published River Room; HOLD\u2019EM; ';
    const suffix = '; Austin \u00b7 6.2 mi away';
    expect(button(prefix + label + suffix).textContent).toContain(label);
    expect(button(prefix + label + suffix).textContent).not.toContain('Open seats');
    await render({ inventoryStatus: 'error' });
    expect(button(prefix + `Last loaded: ${label}` + suffix).textContent).toContain(`Last loaded: ${label}`);
    expect(button('Save $1/$2 NLH').disabled).toBe(true);
    expect(button('Pass $1/$2 NLH').disabled).toBe(true);
  });
  it('keeps a scheduled event, published buy-in and schedule preference explanation without live seat claims', async () => {
    const tournament = { ...createDemoPlayerData(Date.parse('2026-10-12T12:00:00Z')).tournaments[0], startsAt: '2030-10-13T12:00:00Z' };
    const preferences = { ...defaultMatchPreferences, preferredTime: 'day' as const };
    const scheduled = { ...candidate, ref: { ...candidate.ref, kind: 'tournament' as const }, opportunity: null, tournament,
      status: 'scheduled' as const, availableSeats: null, waitlistCount: null, buyIn: 100, distanceMiles: null };
    const [ranked] = rankMatchCandidates({ candidates: [scheduled], preferences, decisions: [], timeZone: 'UTC' });
    const explanation = 'Published start matches your preferred time (UTC).';
    expect(ranked.reasons).toContain(explanation);
    await render({ candidates: [ranked], preferences });
    const content = hero().textContent;
    expect(content).toContain('Scheduled tournament');
    expect(content).toContain('$100 buy-in');
    expect(content).not.toContain(explanation);
    expect(content).not.toContain('Running tables');
    expect(content).not.toContain('Open seats');
    expect(content).not.toContain('Waiting');
    click('Game info');
    expect(container.textContent).toContain('$100Published buy-in');
    expect(container.textContent).toContain(explanation);
  });
  it('retains reasons with different values or wording, and availability when it is not displayed as a status', async () => {
    await render({ candidates: [{ ...candidate, reasons: ['4 published open seats.', 'Near one of your favorite venues.'] }] });
    click('Game info');
    let content = container.textContent;
    expect(content).toContain('4 published open seats.');
    expect(content).toContain('Near one of your favorite venues.');
    await render({ candidates: [{ ...candidate, opportunity: null, reasons: ['3 published open seats.', '7.0 miles from your selected location.'] }] });
    content = container.textContent;
    expect(content).toContain('Published game');
    expect(content).toContain('3 published open seats.');
    expect(content).toContain('7.0 miles from your selected location.');
  });
  it('opens personalization through the controlled Profile entry while keeping discover and saved icon navigation', async () => {
    await render({ preferencesRevision: 0 });
    expect(button('Discover games').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[role="tab"][aria-label="Match preferences"]')).toBeNull();
    expect(props.onPreferences).not.toHaveBeenCalled();
    openPreferences();
    expect(button('Match games preferences').getAttribute('aria-expanded')).toBe('false');
    click('Discover games');
    await render({ preferencesRevision: 1 });
    expect(container.querySelector('[aria-label="Personalize Match"]')).toBeNull();
    await render({ preferencesRevision: 0, preferences: { ...defaultMatchPreferences, variants: ['nlh'] } });
    expect(container.querySelector('[aria-label="Personalize Match"]')).toBeNull();
    expect(props.onDecision).not.toHaveBeenCalled();
  });
  it('retains an accessible screen heading and large icon targets while using the available card height', async () => {
    await render({ minimumHeight: 620 });
    expect(container.querySelector('[role="header"][aria-label="Orbit Match"]')).not.toBeNull();
    expect(container.querySelector('[data-min-height="620"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    for (const label of ['Discover games', 'Saved games, 0', 'Undo last swipe']) {
      expect(Number(button(label).getAttribute('data-min-height'))).toBeGreaterThanOrEqual(44);
    }
    expect(container.textContent).not.toContain('1 game to explore');
    click('Saved games, 0');
    expect(button('Saved games, 0').getAttribute('aria-selected')).toBe('true');
  });
  it('keeps actual primary and body text readable in light and dark system themes', async () => {
    native.scheme = 'light';
    await render();
    const gameTitle = Array.from(container.querySelectorAll('span')).find((item) => item.textContent === '$1/$2 NLH');
    expect(nativeTextContrast(gameTitle)).toBeGreaterThanOrEqual(4.5);
    expect(nativeTextContrast(button('Save $1/$2 NLH').querySelector('span'))).toBeGreaterThanOrEqual(4.5);
    act(() => { native.scheme = 'dark'; native.appearanceListeners.forEach((listener) => listener()); });
    expect(nativeTextContrast(gameTitle)).toBeGreaterThanOrEqual(4.5);
    expect(nativeTextContrast(button('Save $1/$2 NLH').querySelector('span'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([[110, 'saved'], [-110, 'passed'], [30, 'saved']] as const)('commits a horizontal gesture %s as %s only after animation finishes', async (dx, decision) => {
    await render();
    release(dx, 0, dx === 30 ? 0.7 : 0);
    expect(props.onDecision).not.toHaveBeenCalled();
    expect(native.animationOptions.every((options) => options.useNativeDriver)).toBe(true);
    finish();
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, decision);
  });

  it.each([1, -1] as const)('uses a validated release endpoint after sparse MOVE (%s)', async (direction) => {
    native.platform = 'android';
    await render();
    const responder = native.responders.at(-1);
    if (!responder) throw new Error('Real MatchDeck responder was not created.');
    const origin = { x0: 200, y0: 300 };
    const grantTouch = { identifier: 7, pageX: origin.x0, pageY: origin.y0 };
    const grantEvent = { nativeEvent: { ...grantTouch, touches: [grantTouch], changedTouches: [grantTouch] } };
    const claim: Gesture = { x0: 0, y0: 0, dx: direction * 14.359, dy: 0, vx: direction * 0.412, numberActiveTouches: 1 };
    const lastMove: Gesture = { ...origin, dx: direction * 29.562, dy: 0, vx: direction * 0.404, numberActiveTouches: 1 };
    const moveTouch = { identifier: 7, pageX: origin.x0 + lastMove.dx, pageY: origin.y0 };
    const moveEvent = { nativeEvent: { ...moveTouch, touches: [moveTouch], changedTouches: [moveTouch] } };
    const endpoint = { identifier: 7, pageX: origin.x0 + direction * 133.451, pageY: origin.y0 };
    const endEvent = { nativeEvent: { ...endpoint, touches: [], changedTouches: [endpoint] } };
    expect(responder.onMoveShouldSetPanResponder(grantEvent, claim)).toBe(true);
    act(() => {
      responder.onPanResponderGrant(grantEvent, { ...claim, ...origin, dx: 0, dy: 0 });
      responder.onPanResponderMove(moveEvent, lastMove);
      responder.onPanResponderRelease(endEvent, { ...lastMove, numberActiveTouches: 0 });
    });
    expect(props.onDecision).not.toHaveBeenCalled();
    const exit = native.animationOptions.slice(-2);
    expect(exit.map((entry) => entry.kind)).toEqual(['timing', 'timing']);
    expect(exit.every((entry) => entry.useNativeDriver && entry.duration === 180)).toBe(true);
    finish();
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, direction === 1 ? 'saved' : 'passed');
  });

  it.each([0, 'touch-7'] as const)('accepts a consistent single-pointer release endpoint %s without identifier coercion', async (identifier) => {
    const { responder, move, endEvent } = await beginPointerSwipe(identifier);
    act(() => responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 }));
    expect(props.onDecision).not.toHaveBeenCalled();
    finish();
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
  });

  it.each(['short', 'vertical'] as const)('uses the valid %s release endpoint instead of a stale long MOVE', async (shape) => {
    const { responder, origin, move } = await beginPointerSwipe(7, 110);
    const end = touchEvent(7, origin.x0 + (shape === 'short' ? 20 : 133.451), origin.y0 + (shape === 'vertical' ? 180 : 0), true);
    act(() => responder.onPanResponderRelease(end, { ...move, numberActiveTouches: 0 }));
    finish();
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it.each(['missing', 'null', 'nonfinite', 'infinity', 'different-id', 'string-id', 'string-zero-id', 'active-touch', 'multiple-ended', 'duplicate-ended', 'inconsistent-point'] as const)(
    'does not rescue a sparse MOVE from a malformed or ambiguous release endpoint: %s', async (shape) => {
      const { responder, origin, move, endEvent } = await beginPointerSwipe(shape === 'string-zero-id' ? 0 : 7);
      let end: unknown = endEvent;
      if (shape === 'missing') end = {};
      if (shape === 'null') end = null;
      if (shape === 'nonfinite') end = touchEvent(7, Number.NaN, origin.y0, true);
      if (shape === 'infinity') end = touchEvent(7, origin.x0, Number.POSITIVE_INFINITY, true);
      if (shape === 'different-id') end = touchEvent(8, origin.x0 + 133.451, origin.y0, true);
      if (shape === 'string-id') end = touchEvent('7', origin.x0 + 133.451, origin.y0, true);
      if (shape === 'string-zero-id') end = touchEvent('0', origin.x0 + 133.451, origin.y0, true);
      if (shape === 'active-touch') end = touchEvent(7, origin.x0 + 133.451, origin.y0);
      if (shape === 'multiple-ended') endEvent.nativeEvent.changedTouches.push({ identifier: 8, pageX: origin.x0, pageY: origin.y0 });
      if (shape === 'duplicate-ended') endEvent.nativeEvent.changedTouches.push({ ...endEvent.nativeEvent.changedTouches[0] });
      if (shape === 'inconsistent-point') end = { nativeEvent: { ...endEvent.nativeEvent, pageX: origin.x0 + 1 } };
      act(() => responder.onPanResponderRelease(end, { ...move, numberActiveTouches: shape === 'active-touch' ? 1 : 0 }));
      finish();
      expect(props.onDecision).not.toHaveBeenCalled();
    }
  );

  it.each(['missing', 'nonfinite-origin', 'multiple-active', 'duplicate-changed'] as const)('does not create single-pointer endpoint eligibility from an invalid grant: %s', async (shape) => {
    const grant = touchEvent(7, 200, 300);
    if (shape === 'multiple-active') grant.nativeEvent.touches.push({ identifier: 8, pageX: 200, pageY: 300 });
    if (shape === 'duplicate-changed') grant.nativeEvent.changedTouches.push({ ...grant.nativeEvent.changedTouches[0] });
    const { responder, move, endEvent } = await beginPointerSwipe(7, 29.562, 0, 0.404, {
      event: shape === 'missing' ? {} : grant,
      gesture: shape === 'nonfinite-origin' ? { x0: Number.NaN } : shape === 'multiple-active' ? { numberActiveTouches: 2 } : {}
    });
    act(() => responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 }));
    finish();
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it('does not invent velocity for a single-pointer release endpoint', async () => {
    const { responder, move, endEvent } = await beginPointerSwipe(7, 29.562, 0, Number.NaN);
    act(() => responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 }));
    finish();
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it.each([
    { axis: 'dx NaN', dx: Number.NaN, dy: 0 },
    { axis: 'dx Infinity', dx: Number.POSITIVE_INFINITY, dy: 0 },
    { axis: 'dx -Infinity', dx: Number.NEGATIVE_INFINITY, dy: 0 },
    { axis: 'dy NaN', dx: 29.562, dy: Number.NaN },
    { axis: 'dy Infinity', dx: 29.562, dy: Number.POSITIVE_INFINITY },
    { axis: 'dy -Infinity', dx: 29.562, dy: Number.NEGATIVE_INFINITY }
  ])('rejects a valid release endpoint when the release MOVE axis is nonfinite: $axis', async ({ dx, dy }) => {
    const { responder, move, endEvent } = await beginPointerSwipe();
    act(() => responder.onPanResponderRelease(endEvent, { ...move, dx, dy, numberActiveTouches: 0 }));
    finish();
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it('retains legacy MOVE behavior when release endpoint data is absent', async () => {
    const { responder, move } = await beginPointerSwipe(7, 110);
    act(() => responder.onPanResponderRelease({}, { ...move, numberActiveTouches: 0 }));
    finish();
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
  });

  it.each(['different-pointer', 'malformed-event', 'ambiguous-ended'] as const)('retains exact legacy MOVE behavior with an ineligible release endpoint: %s', async (shape) => {
    const { responder, origin, move, endEvent } = await beginPointerSwipe(7, 110);
    let end: unknown = {};
    if (shape === 'different-pointer') end = touchEvent(8, origin.x0 - 133.451, origin.y0, true);
    if (shape === 'ambiguous-ended') end = { nativeEvent: { ...endEvent.nativeEvent, changedTouches: [endEvent.nativeEvent, endEvent.nativeEvent] } };
    act(() => responder.onPanResponderRelease(end, { ...move, numberActiveTouches: 0 }));
    finish();
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
  });

  it('keeps the single-pointer release endpoint eligible through all-ended END before Release', async () => {
    const { responder, move, endEvent } = await beginPointerSwipe();
    const ended = { ...move, numberActiveTouches: 0 };
    act(() => {
      // RN updates active touches and dispatches END before its final Release.
      responder.onPanResponderEnd?.(endEvent, ended);
      responder.onPanResponderRelease(endEvent, ended);
    });
    expect(props.onDecision).not.toHaveBeenCalled();
    finish();
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
  });

  it.each(['added-touch', 'malformed-move', 'different-pointer'] as const)('invalidates single-pointer endpoint eligibility after %s', async (shape) => {
    const { responder, origin, move, endEvent } = await beginPointerSwipe();
    act(() => {
      if (shape === 'added-touch') {
        const added = touchEvent(8, origin.x0, origin.y0);
        added.nativeEvent.touches.push({ identifier: 7, pageX: origin.x0, pageY: origin.y0 });
        if (!responder.onPanResponderStart) throw new Error('Real responder start callback is required to observe added pointers.');
        responder.onPanResponderStart(added, { ...move, numberActiveTouches: 2 });
      } else responder.onPanResponderMove(shape === 'malformed-move' ? {} : touchEvent(8, origin.x0 + move.dx, origin.y0), move);
      responder.onPanResponderMove(touchEvent(7, origin.x0 + move.dx, origin.y0), move);
      responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 });
    });
    finish();
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it.each(['replacement', 'stale', 'pending', 'cancel'] as const)('preserves the release session guard after %s', async (transition) => {
    const { responder, move, endEvent } = await beginPointerSwipe();
    if (transition === 'replacement') await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, gameId: 'replacement' } }] });
    if (transition === 'stale') await render({ inventoryStatus: 'error' });
    if (transition === 'pending') await render({ pending: true });
    if (transition === 'cancel') act(() => responder.onPanResponderTerminate());
    act(() => responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 }));
    finish();
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it('keeps a single-pointer release endpoint idempotent during and after animation', async () => {
    const { responder, move, endEvent } = await beginPointerSwipe();
    act(() => {
      responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 });
      responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 });
    });
    finish();
    act(() => responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 }));
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
  });

  it('respects reduced motion for a valid release endpoint', async () => {
    native.reduced = true;
    const { responder, move, endEvent } = await beginPointerSwipe();
    act(() => responder.onPanResponderRelease(endEvent, { ...move, numberActiveTouches: 0 }));
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
    expect(native.animationOptions).toHaveLength(0);
  });

  it('springs a short swipe back and lets vertical scrolling keep the gesture', async () => {
    await render();
    expect(native.responders.at(-1)?.onMoveShouldSetPanResponder({}, { dx: 10, dy: 40, vx: 0 })).toBe(false);
    release(20, 0, 0.2);
    finish();
    expect(props.onDecision).not.toHaveBeenCalled();
    expect(getMatchSwipeDecision(20, 1, 1)).toBeNull();
    expect(getMatchSwipeDecision(90, 130, 1)).toBeNull();
  });

  it('gives button parity and rejects repeated interaction with the same card', async () => {
    await render();
    click('Save $1/$2 NLH');
    release(-130);
    click('Save $1/$2 NLH');
    finish();
    release(130);
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
    click('Undo last swipe');
    expect(props.onUndo).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight swipe when the catalog changes or becomes stale', async () => {
    await render();
    click('Save $1/$2 NLH');
    const previous = native.animations.at(-1);
    await render({ inventoryStatus: 'error' });
    act(() => previous?.finish(true));
    expect(props.onDecision).not.toHaveBeenCalled();
    expect(button('Save $1/$2 NLH').disabled).toBe(true);
    expect(container.textContent).toContain('Last loaded:');
    await render({ inventoryStatus: 'ready' });
    click('Pass $1/$2 NLH');
    const replaced = native.animations.at(-1);
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, gameId: 'new-game' } }] });
    act(() => replaced?.finish(true));
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it('does not apply a gesture to a replacement card that appeared while the finger was down', async () => {
    await render();
    const gesture = native.responders.at(-1);
    act(() => { gesture?.onPanResponderGrant(); gesture?.onPanResponderMove({}, { dx: 50, dy: 1, vx: 0 }); });
    const replacement = { ...candidate, ref: { ...candidate.ref, gameId: 'replacement-game' } };
    await render({ candidates: [replacement] });
    act(() => gesture?.onPanResponderRelease({}, { dx: 130, dy: 1, vx: 0 }));
    expect(props.onDecision).not.toHaveBeenCalled();
    release(130);
    finish();
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(replacement, 'saved');
  });

  it('respects reduced motion and cleans up motion listeners and unfinished animation callbacks', async () => {
    native.reduced = true;
    await render();
    click('Pass $1/$2 NLH');
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(candidate, 'passed');
    expect(native.animationOptions).toHaveLength(0);
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, gameId: 'new-game' } }] });
    act(() => { for (const listener of native.motionListeners) listener(false); });
    click('Save $1/$2 NLH');
    const unfinished = native.animations.at(-1);
    click('Saved games, 0');
    act(() => unfinished?.finish(true));
    expect(props.onDecision).toHaveBeenCalledOnce();
    expect(native.motionListeners.size).toBe(0);
    expect(native.unsubscribe).toHaveBeenCalledOnce();
  });
  it('promotes a replacement card with a native scale spring and fade without issuing a decision', async () => {
    await render({ candidates: [candidate, { ...candidate, ref: { ...candidate.ref, gameId: 'next' } }] });
    expect(native.animationOptions).toHaveLength(0);
    const replacement = { ...candidate, ref: { ...candidate.ref, gameId: 'next' } };
    await render({ candidates: [replacement] });
    const promotion = native.animations.at(-1);
    const options = native.animationOptions.slice(-2);
    expect(options.map((item) => item.kind)).toEqual(['spring', 'timing']);
    expect(options.every((item) => item.useNativeDriver && item.toValue === 1)).toBe(true);
    expect(options[0].value.value).toBe(0.98); expect(options[1].value.value).toBe(0.86);
    act(() => promotion?.finish(true));
    expect(options.every((item) => item.value.value === 1)).toBe(true);
    expect(props.onDecision).not.toHaveBeenCalled();
    click('Save $1/$2 NLH');
    const exit = native.animations.at(-1);
    act(() => { exit?.finish(true); exit?.finish(true); });
    expect(props.onDecision).toHaveBeenCalledExactlyOnceWith(replacement, 'saved');
  });
  it('waits until a promoted card is writable and skips promotion under reduced motion', async () => {
    await render();
    const replacement = { ...candidate, ref: { ...candidate.ref, gameId: 'pending-next' } };
    await render({ candidates: [replacement], pending: true });
    expect(native.animationOptions).toHaveLength(0);
    await render({ pending: false });
    expect(native.animationOptions.map((item) => item.kind)).toEqual(['spring', 'timing']);
    act(() => native.motionListeners.forEach((listener) => listener(true)));
    const before = native.animationOptions.length;
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, gameId: 'reduced-next' } }] });
    expect(native.animationOptions).toHaveLength(before);
    expect(native.values.filter((value) => value.initialValue === 1).every((value) => value.value === 1)).toBe(true);
    expect(props.onDecision).not.toHaveBeenCalled();
  });
  it('retires rapid promotion callbacks and animations after replacement or unmount', async () => {
    await render();
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, gameId: 'first-next' } }] });
    const retired = native.animations.at(-1);
    await render({ candidates: [{ ...candidate, ref: { ...candidate.ref, gameId: 'second-next' } }] });
    const current = native.animationOptions.slice(-2);
    act(() => retired?.finish(true));
    expect(current[0].value.value).toBe(0.98); expect(current[1].value.value).toBe(0.86);
    expect(retired?.stop).toHaveBeenCalled();
    click('Saved games, 0');
    act(() => native.animations.at(-1)?.finish(true));
    expect(current.every((item) => item.value.value === 1 && item.value.stopCount > 0)).toBe(true);
    expect(native.motionListeners.size).toBe(0);
    expect(props.onDecision).not.toHaveBeenCalled();
  });

  it('keeps unavailable saved records, separates removal from venue actions, and opens current saved details', async () => {
    await render({ savedGames: [
      { record: savedRecord, candidate, unavailableReason: null },
      { record: { ...savedRecord, ref: { ...savedRecord.ref, gameId: 'ended' }, summary: { ...savedRecord.summary, gameName: 'Ended game' } }, candidate: null, unavailableReason: 'This game is no longer published.' }
    ] });
    click('Saved games, 2');
    expect(container.textContent).toContain('3 seats open · 4 waiting');
    expect(container.textContent).toContain('This game is no longer published.');
    expect(button('Details for saved Ended game').disabled).toBe(true);
    click('Details for saved $1/$2 NLH');
    expect(props.onDetails).toHaveBeenCalledExactlyOnceWith(candidate, 'saved');
    click('Remove saved Ended game');
    expect(props.onRemoveSaved).toHaveBeenCalledOnce();
    await render({ inventoryStatus: 'error' });
    expect(button('Details for saved $1/$2 NLH').disabled).toBe(true);
    expect(container.textContent).toContain('Last loaded: 3 seats open · 4 waiting');
  });

  it('keeps the selected mode when a preference save finishes after its form was closed', async () => {
    let complete: ((value: boolean) => void) | undefined;
    await render({ onPreferences: () => new Promise<boolean>((resolve) => { complete = resolve; }) });
    openPreferences();
    click('Save Match preferences');
    click('Saved games, 0');
    await act(async () => { complete?.(true); });
    expect(button('Saved games, 0').getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('No saved games yet');
    expect(button('Discover games').getAttribute('aria-selected')).toBe('false');
  });

  it('renders saved games in pages while retaining every saved record', async () => {
    await render({ savedGames: Array.from({ length: 21 }, (_, index) => ({
      record: { ...savedRecord, ref: { ...savedRecord.ref, gameId: `saved-${index}` }, summary: { ...savedRecord.summary, gameName: `Saved ${index}` } },
      candidate: null, unavailableReason: 'No longer published'
    })) });
    click('Saved games, 21');
    expect(container.querySelectorAll('button[aria-label^="Details for saved"]')).toHaveLength(20);
    expect(container.textContent).not.toContain('Saved 20');
    click('Show more saved games');
    expect(container.querySelectorAll('button[aria-label^="Details for saved"]')).toHaveLength(21);
    expect(container.textContent).toContain('Saved 20');
    expect(props.onRemoveSaved).not.toHaveBeenCalled();
  });

  it('edits the complete structured preferences without making them mandatory or changing saved records', async () => {
    await render({ onSelectOrigin: vi.fn(), onClearOrigin: vi.fn(), originLabel: 'Selected area' });
    openPreferences();
    expect(container.querySelector('input')).toBeNull();
    expect(button('Match games preferences').getAttribute('aria-expanded')).toBe('false');
    click('Match games preferences');
    expect(button('Only these variants').disabled).toBe(true);
    click('No Limit Holdem');
    click('Only these variants');
    click('Cash games');
    type('Minimum big blind', '1'); type('Maximum big blind', '5'); click('Only this stakes range');
    type('Minimum buy-in', '50'); type('Maximum buy-in', '500'); click('Only this buy-in range');
    click('Match travel preferences'); type('Maximum travel miles', '25');
    click('Choose discovery location'); click('Clear discovery location');
    click('Match availability preferences'); type('Maximum waitlist length', '8');
    click('Require open seats now'); click('Willing to join a waitlist'); click('Fri'); click('Evenings');
    click('Match venues preferences'); click('Explore unfamiliar venues'); click('Favorite Published River Room');
    await clickAsync('Save Match preferences');
    expect(props.onPreferences).toHaveBeenCalledExactlyOnceWith({ ...defaultMatchPreferences,
      variants: ['nlh'], strictVariants: true, stakes: { minBigBlind: 1, maxBigBlind: 5 }, strictStakes: true,
      format: 'cash', buyIn: { min: 50, max: 500 }, strictBuyIn: true, maxDistanceMiles: 25,
      requireSeatsNow: true, willingToWait: false, maxWaitlist: 8, preferredDays: [5], preferredTime: 'evening',
      exploreNewVenues: true, favoriteClubIds: [club.club.id]
    });
    expect(props.onRemoveSaved).not.toHaveBeenCalled();
    expect(props.onDecision).not.toHaveBeenCalled();
    expect(props.onSelectOrigin).toHaveBeenCalledOnce();
    expect(props.onClearOrigin).toHaveBeenCalledOnce();
  });

  it('rejects invalid ranges, respects excluded venues, and disables mutations before storage restoration', async () => {
    await render();
    openPreferences();
    click('Match games preferences');
    type('Minimum big blind', '5'); type('Maximum big blind', '1');
    await clickAsync('Save Match preferences');
    expect(container.textContent).toContain('minimum no greater than the maximum');
    expect(props.onPreferences).not.toHaveBeenCalled();
    type('Maximum big blind', '10');
    click('Match venues preferences');
    click('Favorite Published River Room'); click('Exclude Published River Room');
    await clickAsync('Save Match preferences');
    expect(props.onPreferences).toHaveBeenCalledWith(expect.objectContaining({ favoriteClubIds: [], excludedClubIds: [club.club.id] }));
    await render({ storageReady: false });
    expect(button('Save $1/$2 NLH').disabled).toBe(true);
    expect(button('Undo last swipe').disabled).toBe(true);
  });

  it('keeps a failed preference draft open and submits its captured revision', async () => {
    const onPreferences = vi.fn().mockResolvedValue(false);
    await render({ preferencesRevision: 2, onPreferences });
    openPreferences(); click('Match games preferences');
    type('Minimum big blind', '1'); type('Maximum big blind', '5');
    await clickAsync('Save Match preferences');
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ stakes: { minBigBlind: 1, maxBigBlind: 5 } }), 2);
    expect(container.textContent).toContain('Your edits are still here.');
    expect((container.querySelector('input[aria-label="Minimum big blind"]') as HTMLInputElement).value).toBe('1');
    await render({ preferences: { ...defaultMatchPreferences }, preferencesRevision: 2 });
    expect(container.textContent).not.toContain('Current preferences changed.');
    expect((container.querySelector('input[aria-label="Minimum big blind"]') as HTMLInputElement).value).toBe('1');
  });

  it('preserves unsaved edits on a remote update and requires an explicit reload before saving the new revision', async () => {
    const onPreferences = vi.fn().mockResolvedValue(true);
    await render({ preferencesRevision: 2, onPreferences });
    openPreferences(); click('Match games preferences');
    type('Minimum big blind', '1'); type('Maximum big blind', '5');
    await render({ preferencesRevision: 3, preferences: { ...defaultMatchPreferences, stakes: { minBigBlind: 2, maxBigBlind: 10 } } });
    expect(container.textContent).toContain('Current preferences changed. Your edits remain here.');
    expect((container.querySelector('input[aria-label="Minimum big blind"]') as HTMLInputElement).value).toBe('1');
    expect(button('Save Match preferences').disabled).toBe(true);
    click('Save Match preferences');
    expect(onPreferences).not.toHaveBeenCalled();
    click('Reload current Match preferences');
    expect((container.querySelector('input[aria-label="Minimum big blind"]') as HTMLInputElement).value).toBe('2');
    await clickAsync('Save Match preferences');
    expect(onPreferences).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stakes: { minBigBlind: 2, maxBigBlind: 10 } }), 3);
    expect(container.querySelector('input')).toBeNull();
  });
  it('resets only the preference draft and keeps its captured revision until an explicit save', async () => {
    const selected = { ...defaultMatchPreferences, variants: ['nlh' as const], favoriteClubIds: [club.club.id], preferredDays: [5], preferredTime: 'evening' as const };
    await render({ preferences: selected, preferencesRevision: 7, savedGames: [{ record: savedRecord, candidate, unavailableReason: null }] });
    openPreferences(); click('Match games preferences');
    click('Reset Match preferences draft');
    expect((container.querySelector('input[aria-label="Minimum big blind"]') as HTMLInputElement).value).toBe('');
    expect(button('No Limit Holdem').getAttribute('aria-selected')).toBe('false');
    expect(props.onPreferences).not.toHaveBeenCalled(); expect(props.onRemoveSaved).not.toHaveBeenCalled(); expect(props.onDecision).not.toHaveBeenCalled();
    expect(selected).toEqual(expect.objectContaining({ variants: ['nlh'], favoriteClubIds: [club.club.id] }));
    await clickAsync('Save Match preferences');
    expect(props.onPreferences).toHaveBeenCalledExactlyOnceWith(defaultMatchPreferences, 7);
    click('Saved games, 1');
    expect(container.textContent).toContain('$1/$2 NLH');
    expect(props.onRemoveSaved).not.toHaveBeenCalled();
  });
  it('keeps a preference conflict after draft reset and explains exact scheduled time and exploration evidence', async () => {
    await render({ preferencesRevision: 2, timeZone: 'America/Chicago' });
    openPreferences(); click('Match availability preferences');
    expect(container.textContent).toContain('published scheduled tournaments in America/Chicago');
    expect(container.textContent).toContain('Cash game schedules are not published');
    expect(container.textContent).toContain('Daytime: 06:00–17:59. Evenings: 18:00–23:59.');
    click('Match venues preferences');
    expect(container.textContent).toContain('outside your favorites and currently saved games');
    expect(container.textContent).toContain('does not infer where you have played');
    await render({ preferencesRevision: 3 });
    click('Reset Match preferences draft');
    expect(button('Save Match preferences').disabled).toBe(true);
    expect(container.textContent).toContain('Current preferences changed');
    expect(props.onPreferences).not.toHaveBeenCalled();
  });
});
