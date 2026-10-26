/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameOpportunity } from '../../domain/playerTypes';
import { createDemoPlayerData } from '../../demo/demoPlayerData';
import { PlayerHomeScreen } from './PlayerHomeScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  type NativeStyle = { minHeight?: number } | NativeStyle[] | false | undefined;
  const minHeight = (style: NativeStyle): number => {
    if (Array.isArray(style)) return Math.max(0, ...style.map(minHeight));
    return style && style.minHeight ? style.minHeight : 0;
  };
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityRole, style }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    style?: NativeStyle | ((state: { pressed: boolean }) => NativeStyle);
  }) => ReactModule.createElement(tag, {
    onClick: onPress,
    'aria-label': accessibilityLabel,
    role: accessibilityRole,
    'data-min-height': minHeight(typeof style === 'function' ? style({ pressed: false }) : style)
  }, children);
  return {
    Pressable: element('button'),
    Text: element('span'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { clubs } = createDemoPlayerData(Date.parse('2026-10-12T12:00:00.000Z'));
const opportunities: GameOpportunity[] = [
  { club: clubs[0], game: clubs[0].games[0] },
  { club: clubs[1], game: clubs[1].games[1] },
  { club: clubs[2], game: clubs[2].games[1] },
  { club: clubs[3], game: clubs[3].games[0] }
].map((item) => ({ ...item, distanceMiles: null, isJoined: false, isPreferred: false, seatRequestAccess: 'missing' }));

describe('Native player Home', () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: React.ComponentProps<typeof PlayerHomeScreen>;
  const render = (overrides: Partial<React.ComponentProps<typeof PlayerHomeScreen>> = {}) => {
    act(() => root.render(<PlayerHomeScreen {...props} {...overrides} />));
  };
  const click = (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    act(() => button.click());
  };

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    props = {
      opportunities,
      inventoryPartial: false,
      inventoryStatus: 'ready',
      openTournamentCount: 4,
      clubCount: 2,
      onFindGame: vi.fn(),
      onOpenGame: vi.fn(),
      onBrowseTournaments: vi.fn(),
      onBrowseClubs: vi.fn()
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('starts with game actions and at most three rows without a duplicate greeting or heading', () => {
    render();
    expect(container.querySelector('[role="header"]')).toBeNull();
    expect(container.textContent).toContain('1/2 No Limit Holdem');
    expect(container.textContent).toContain('Wonderland Card House · Austin');
    expect(container.textContent).toContain('3 seats open');
    expect(container.textContent).toContain('Moonbeam Poker Club · Chicago');
    expect(container.textContent).toContain('Table forming');
    expect(container.textContent).toContain('Cloud Nine Card House · Denver');
    expect(container.textContent).toContain('Table paused');
    expect(container.textContent).not.toContain('Stardust Sandbox Casino');
    expect(container.querySelectorAll('button[aria-label^="Open "]')).toHaveLength(3);
    for (const button of container.querySelectorAll('button')) {
      expect(button.getAttribute('role')).toBe('button');
      expect(Number(button.getAttribute('data-min-height'))).toBeGreaterThanOrEqual(44);
    }
  });

  it('opens the selected game and routes the primary and secondary actions directly', () => {
    render();
    click('Find games');
    click('Browse events, 4 open');
    click('Browse clubs, 2 clubs');
    click('Open 1/2 No Limit Holdem at Wonderland Card House, Austin. 3 seats open');
    expect(props.onFindGame).toHaveBeenCalledOnce();
    expect(props.onBrowseTournaments).toHaveBeenCalledOnce();
    expect(props.onBrowseClubs).toHaveBeenCalledOnce();
    expect(props.onOpenGame).toHaveBeenCalledExactlyOnceWith(opportunities[0]);
  });

  it.each(['idle', 'loading'] as const)('shows %s inventory as loading while navigation remains available', (inventoryStatus) => {
    render({ opportunities: [], inventoryStatus });
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Loading games');
    expect(container.textContent).toContain('Loading games…');
    expect(container.textContent).not.toContain('No games to show right now.');
    click('Find games');
    click('Browse events');
    expect(props.onFindGame).toHaveBeenCalledOnce();
    expect(props.onBrowseTournaments).toHaveBeenCalledOnce();
  });

  it('keeps empty ready inventory truthful and offers the game finder', () => {
    render({ opportunities: [], clubCount: 0, openTournamentCount: 0 });
    expect(container.textContent).toContain('No games to show right now.');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    click('Find games');
    click('Browse events, 0 open');
    click('Browse clubs, 0 clubs');
    expect(props.onFindGame).toHaveBeenCalledOnce();
  });

  it('does not claim all venues are empty when only part of the inventory has loaded', () => {
    render({ opportunities: [], inventoryPartial: true });
    expect(container.textContent).toContain('No games in the venues loaded so far.');
    expect(container.textContent).not.toContain('No games to show right now.');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    click('Browse events');
    render({ inventoryPartial: true });
    expect(container.textContent).toContain('Showing loaded venues');
    expect(container.querySelector('[aria-label="Browse clubs, 2 clubs"]')).toBeNull();
  });

  it('labels retained games as last loaded when refresh failed without duplicating the global error banner', () => {
    render({ inventoryStatus: 'error' });
    expect(container.textContent).toContain('Last loaded games');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[aria-label="Browse events, 4 open"]')).toBeNull();
    click('Open 1/2 No Limit Holdem at Wonderland Card House, Austin. Last loaded: 3 seats open');
    expect(props.onOpenGame).toHaveBeenCalledExactlyOnceWith(opportunities[0]);
    render({ opportunities: [], inventoryStatus: 'error' });
    expect(container.textContent).toContain('Game data is unavailable.');
    expect(container.textContent).not.toContain('No games to show right now.');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('retains loaded game rows during a refresh and marks them as updating', () => {
    render({ inventoryStatus: 'loading' });
    expect(container.textContent).toContain('Updating…');
    expect(container.querySelectorAll('button[aria-label^="Open "]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Browse events, 4 open"]')).toBeNull();
  });

  it('omits an unknown event count while ready cash games, club counts and event navigation remain available', () => {
    render({ openTournamentCount: null });
    const events = container.querySelector('button[aria-label="Browse events"]');
    expect(events?.textContent).toBe('Events');
    expect(container.querySelector('[aria-label*="null open"]')).toBeNull();
    expect(container.querySelectorAll('button[aria-label^="Open "]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Browse clubs, 2 clubs"]')).not.toBeNull();
    click('Browse events'); expect(props.onBrowseTournaments).toHaveBeenCalledOnce();
    render({ openTournamentCount: 2 });
    expect(container.querySelector('[aria-label="Browse events, 2 open"]')?.textContent).toBe('Events2');
    render({ openTournamentCount: null });
    expect(container.querySelector('[aria-label="Browse events, 2 open"]')).toBeNull();
    expect(container.querySelector('[aria-label="Browse events"]')?.textContent).toBe('Events');
  });
});
