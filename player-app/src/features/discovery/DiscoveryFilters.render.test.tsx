/**
 * @vitest-environment jsdom
 */
import React, { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import type { GameTypeFilter } from '../../domain/playerTypes';
import { GameFilterPanel } from './DiscoveryFilters';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, onChangeText, value, disabled, editable,
    accessibilityLabel, accessibilityRole, accessibilityState, placeholder }: {
    children?: React.ReactNode; onPress?: () => void; onChangeText?: (value: string) => void;
    value?: string; disabled?: boolean; editable?: boolean; accessibilityLabel?: string;
    accessibilityRole?: string; accessibilityState?: { selected?: boolean; disabled?: boolean }; placeholder?: string;
  }) => ReactModule.createElement(tag, {
    onClick: onPress,
    onInput: onChangeText ? (event: React.FormEvent<HTMLInputElement>) => onChangeText(event.currentTarget.value) : undefined,
    onChange: onChangeText ? () => undefined : undefined,
    value, placeholder, disabled: disabled || editable === false,
    'aria-label': accessibilityLabel, role: accessibilityRole,
    'aria-selected': accessibilityState?.selected, 'aria-disabled': accessibilityState?.disabled
  }, children);
  return {
    Modal: element('div'), Pressable: element('button'), ScrollView: element('div'),
    Text: element('span'), TextInput: element('input'), View: element('div'),
    Platform: { OS: 'web' }, StyleSheet: { create: <T,>(styles: T) => styles }
  };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

type PanelProps = ComponentProps<typeof GameFilterPanel>;
const venue = (id: string, name: string, venueKind?: PlayerClubSnapshot['club']['venueKind']): PlayerClubSnapshot => ({
  club: { id, name, ...(venueKind ? { venueKind } : {}) }, games: [], memberships: [], waitlists: [], notifications: [],
  generatedAt: '2026-10-14T00:00:00.000Z'
});
const house = venue('filter-house', 'River House', 'Card house');
const unknown = venue('filter-unknown', 'Unclassified Room');
const casino = venue('filter-casino', 'Summit Casino', 'Casino');

describe('GameFilterPanel controlled discovery filters', () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: PanelProps;
  let callbacks: {
    setGameType: Mock<PanelProps['setGameType']>;
    setSelectedClubId: Mock<PanelProps['setSelectedClubId']>;
    setSelectedCasinoId: Mock<PanelProps['setSelectedCasinoId']>;
    setStakes: Mock<PanelProps['setStakes']>;
    setFitScoreEnabled: Mock<PanelProps['setFitScoreEnabled']>;
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    callbacks = {
      setGameType: vi.fn<PanelProps['setGameType']>(),
      setSelectedClubId: vi.fn<PanelProps['setSelectedClubId']>(),
      setSelectedCasinoId: vi.fn<PanelProps['setSelectedCasinoId']>(),
      setStakes: vi.fn<PanelProps['setStakes']>(),
      setFitScoreEnabled: vi.fn<PanelProps['setFitScoreEnabled']>()
    };
    props = { clubs: [house, unknown, casino], gameType: 'none', selectedClubId: 'none', selectedCasinoId: 'none',
      stakes: '', fitScoreEnabled: false, ...callbacks };
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  const render = (overrides: Partial<PanelProps> = {}) => {
    props = { ...props, ...overrides };
    act(() => root.render(<GameFilterPanel {...props} />));
  };
  const button = (label: string) => {
    const found = Array.from(container.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label);
    if (!found) throw new Error(`Missing filter control: ${label}`);
    return found;
  };
  const click = (label: string) => act(() => button(label).click());
  const expectOnly = (name: keyof typeof callbacks, calls: unknown[][]) => {
    for (const [key, callback] of Object.entries(callbacks)) expect(callback.mock.calls).toEqual(key === name ? calls : []);
  };

  it.each<[GameTypeFilter, string]>([['all', 'All'], ['card-house', 'Card house'], ['favorites', 'Favorites']])(
    'selects and clears the controlled %s choice without changing venue, stakes or preference-sort state', (value, label) => {
      render();
      expect(button(label).getAttribute('aria-selected')).toBe('false');
      click(label); expectOnly('setGameType', [[value]]);
      render({ gameType: value });
      expect(button(label).getAttribute('aria-selected')).toBe('true');
      click(label); expectOnly('setGameType', [[value], ['none']]);
      render({ gameType: 'none' });
      expect(button(label).getAttribute('aria-selected')).toBe('false');
    }
  );

  it('selects and clears all houses independently of the casino and game-type choices', () => {
    render(); click('All houses'); expectOnly('setSelectedClubId', [['all']]);
    render({ selectedClubId: 'all' });
    expect(button('All houses').getAttribute('aria-selected')).toBe('true');
    click('All houses'); expectOnly('setSelectedClubId', [['all'], ['none']]);
  });

  it.each([house, unknown])('preserves selection of the published non-casino venue $club.name', club => {
    render(); click(club.club.name); expectOnly('setSelectedClubId', [[club.club.id]]);
    render({ selectedClubId: club.club.id });
    expect(button(club.club.name).getAttribute('aria-selected')).toBe('true');
    expect(button('All houses').getAttribute('aria-selected')).toBe('false');
    click(club.club.name); expectOnly('setSelectedClubId', [[club.club.id], ['none']]);
  });

  it('selects and clears all casinos without changing a selected house', () => {
    render({ selectedClubId: house.club.id }); click('All casinos'); expectOnly('setSelectedCasinoId', [['all']]);
    render({ selectedCasinoId: 'all' });
    expect(button('All casinos').getAttribute('aria-selected')).toBe('true');
    expect(button(house.club.name).getAttribute('aria-selected')).toBe('true');
    click('All casinos'); expectOnly('setSelectedCasinoId', [['all'], ['none']]);
  });

  it('selects and clears the exact casino reference independently of the house selection', () => {
    render({ selectedClubId: unknown.club.id }); click(casino.club.name); expectOnly('setSelectedCasinoId', [[casino.club.id]]);
    render({ selectedCasinoId: casino.club.id });
    expect(button(casino.club.name).getAttribute('aria-selected')).toBe('true');
    expect(button(unknown.club.name).getAttribute('aria-selected')).toBe('true');
    click(casino.club.name); expectOnly('setSelectedCasinoId', [[casino.club.id], ['none']]);
  });

  it('edits and clears the actual Stakes field without changing unrelated controlled filters', () => {
    render({ gameType: 'favorites', selectedClubId: unknown.club.id, selectedCasinoId: casino.club.id });
    const input = container.querySelector('input[aria-label="Stakes"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing Stakes input.');
    expect(input.value).toBe('');
    act(() => { input.value = '$1/$3'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expectOnly('setStakes', [['$1/$3']]);
    render({ stakes: '$1/$3' }); expect(input.value).toBe('$1/$3');
    act(() => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expectOnly('setStakes', [['$1/$3'], ['']]);
  });

  it.each([false, true])('omits the obsolete preference-sort row with the compatible fit flag set to %s', fitScoreEnabled => {
    render({ fitScoreEnabled });
    expect(container.textContent).not.toContain('Sort by my preferences');
    expect(callbacks.setFitScoreEnabled).not.toHaveBeenCalled();
    expect(button('All')).toBeDefined();
    expect(button('Card house')).toBeDefined();
    expect(button('Favorites')).toBeDefined();
  });
});
