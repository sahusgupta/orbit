/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import { MapExploreScreen } from './MapExploreScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, props, children as React.ReactNode);
  return {
    Platform: { OS: 'web' },
    Text: element('span'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('../../components/MapView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Marker: ({ onPress, title }: { onPress?: () => void; title: string }) => onPress
    ? <button data-testid={`marker-${title}`} onClick={onPress}>{title}</button>
    : <span data-testid={`marker-${title}`}>{title}</span>,
  PROVIDER_GOOGLE: 'google'
}));

vi.mock('../../components/PlayerPresentation', () => ({
  SearchToolbar: () => null,
  IconActionButton: ({ label, onPress }: { label: string; onPress: () => void }) => <button onClick={onPress}>{label}</button>
}));

const membershipOnlyClub: PlayerClubSnapshot = {
  club: {
    id: 'club-1',
    name: 'River Room',
    membershipOptions: [{ id: 'venue-access', name: 'Venue access', priceLabel: 'Ask venue', durationDays: 30 }]
  },
  games: [],
  memberships: [],
  waitlists: [],
  notifications: [],
  generatedAt: '2026-09-04T00:00:00.000Z'
};

describe('MapExploreScreen venue actions', () => {
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

  it('opens published membership access for a venue with no current games', () => {
    const onShowGames = vi.fn();
    const onRequestAccess = vi.fn();
    act(() => {
      root.render(
        <MapExploreScreen
          clubs={[membershipOnlyClub]}
          query=""
          readOnly={false}
          setQuery={vi.fn()}
          onOpenFilters={vi.fn()}
          onDirections={vi.fn()}
          onShowGames={onShowGames}
          onRequestAccess={onRequestAccess}
        />
      );
    });

    const action = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Request access at River Room');
    expect(action).toBeDefined();
    expect(container.textContent).not.toContain('View games at River Room');
    act(() => action?.click());
    expect(onRequestAccess).toHaveBeenCalledWith(membershipOnlyClub);
    expect(onShowGames).not.toHaveBeenCalled();
  });

  it('renders cached-error venues without reachable map or venue actions', () => {
    const onDirections = vi.fn();
    const onShowGames = vi.fn();
    const onRequestAccess = vi.fn();
    act(() => {
      root.render(
        <MapExploreScreen
          clubs={[{ ...membershipOnlyClub, club: { ...membershipOnlyClub.club, address: '100 Main St', coordinate: { latitude: 30.6, longitude: -96.3 } } }]}
          query=""
          readOnly
          setQuery={vi.fn()}
          onOpenFilters={vi.fn()}
          onDirections={onDirections}
          onShowGames={onShowGames}
          onRequestAccess={onRequestAccess}
        />
      );
    });

    expect(container.textContent).toContain('Map listings are read-only');
    expect(container.textContent).not.toContain('Directions to River Room');
    expect(container.textContent).not.toContain('Request access at River Room');
    expect(container.textContent).not.toContain('View games at River Room');
    expect(container.querySelector('[data-testid="marker-River Room"]')?.tagName).toBe('SPAN');
    expect(onDirections).not.toHaveBeenCalled();
    expect(onShowGames).not.toHaveBeenCalled();
    expect(onRequestAccess).not.toHaveBeenCalled();
  });
});
