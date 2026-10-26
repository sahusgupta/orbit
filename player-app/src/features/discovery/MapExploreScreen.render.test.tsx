/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import { MapExploreScreen } from './MapExploreScreen';
const native = vi.hoisted(() => ({ os: 'web' }));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, props, children as React.ReactNode);
  return {
    Platform: { get OS() { return native.os; } },
    Text: element('span'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('../../components/MapView', () => ({
  default: ({ children, initialRegion, provider, showsUserLocation, showsMyLocationButton }: {
    children: React.ReactNode;
    initialRegion: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
    provider?: string;
    showsUserLocation?: boolean;
    showsMyLocationButton?: boolean;
  }) => <div data-testid="map" data-provider={provider || 'default'} data-region={JSON.stringify(initialRegion)}
    data-user-location={String(showsUserLocation)} data-location-button={String(showsMyLocationButton)}>{children}</div>,
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
    native.os = 'web';
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

  it('uses Apple Maps on iOS, frames all published venues, and opens coordinate-only destinations', () => {
    native.os = 'ios';
    const first = { ...membershipOnlyClub, club: { ...membershipOnlyClub.club, coordinate: { latitude: 30.3, longitude: -97.7 } } };
    const second = { ...membershipOnlyClub, club: { ...membershipOnlyClub.club, id: 'club-2', name: 'North Room', coordinate: { latitude: 41.9, longitude: -87.6 } } };
    const onDirections = vi.fn();
    act(() => root.render(<MapExploreScreen clubs={[first, second]} query="" readOnly={false} setQuery={vi.fn()}
      onOpenFilters={vi.fn()} onDirections={onDirections} onShowGames={vi.fn()} onRequestAccess={vi.fn()} />));
    expect(container.textContent).toContain('Apple Maps');
    expect(container.textContent).not.toContain('Venue-published locations. Select a venue');
    const map = container.querySelector('[data-testid="map"]');
    expect(map?.getAttribute('data-provider')).toBe('default');
    expect(map?.getAttribute('data-region')).toContain('"latitude":36.1');
    expect(map?.getAttribute('data-region')).not.toContain('"latitudeDelta":0.25');
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Apple Maps directions to River Room');
    expect(action).toBeDefined();
    act(() => action?.click());
    expect(onDirections).toHaveBeenCalledExactlyOnceWith(first);
  });

  it('filters a city search and reframes the map to that location, then restores the catalog when cleared', () => {
    const first = { ...membershipOnlyClub, club: { ...membershipOnlyClub.club, address: '100 Main St, Austin, TX', coordinate: { latitude: 30.3, longitude: -97.7 } } };
    const second = { ...membershipOnlyClub, club: { ...membershipOnlyClub.club, id: 'club-2', name: 'North Room', address: '200 Oak St, Austin, TX', coordinate: { latitude: 30.4, longitude: -97.8 } } };
    const remote = { ...membershipOnlyClub, club: { ...membershipOnlyClub.club, id: 'club-3', name: 'Austin Poker Club', address: '300 Elm St, Dallas, TX', coordinate: { latitude: 32.8, longitude: -96.8 } } };
    const render = (query: string) => act(() => root.render(<MapExploreScreen clubs={[first, second, remote]} query={query} readOnly={false}
      setQuery={vi.fn()} onOpenFilters={vi.fn()} onDirections={vi.fn()} onShowGames={vi.fn()} onRequestAccess={vi.fn()} />));
    render('');
    const originalRegion = container.querySelector('[data-testid="map"]')?.getAttribute('data-region');
    expect(container.textContent).toContain('3 places');

    render('Austin TX');
    expect(container.textContent).toContain('2 places');
    expect(container.textContent).not.toContain('Austin Poker Club');
    expect(container.querySelector('[data-testid="marker-River Room"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="marker-North Room"]')).not.toBeNull();
    const map = container.querySelector('[data-testid="map"]');
    const region = JSON.parse(map?.getAttribute('data-region') || '{}');
    expect(region.latitude).toBeCloseTo(30.35);
    expect(region.longitude).toBeCloseTo(-97.75);
    expect(region.latitudeDelta).toBeCloseTo(0.13);
    expect(map?.getAttribute('data-user-location')).toBe('false');
    expect(map?.getAttribute('data-location-button')).toBe('false');

    render('');
    expect(container.textContent).toContain('3 places');
    expect(container.querySelector('[data-testid="marker-Austin Poker Club"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map"]')?.getAttribute('data-region')).toBe(originalRegion);
  });

  it('keeps address matches in the list without inventing a map pin and reports unmatched locations', () => {
    const withoutPin = { ...membershipOnlyClub, club: { ...membershipOnlyClub.club, address: '100 Main St, Austin, TX' } };
    const render = (query: string) => act(() => root.render(<MapExploreScreen clubs={[withoutPin]} query={query} readOnly={false}
      setQuery={vi.fn()} onOpenFilters={vi.fn()} onDirections={vi.fn()} onShowGames={vi.fn()} onRequestAccess={vi.fn()} />));
    render('Austin');
    expect(container.textContent).toContain('1 places');
    expect(container.textContent).toContain('River Room');
    expect(container.textContent).toContain('No venue coordinates published');
    expect(container.querySelector('[data-testid="map"]')).toBeNull();

    render('Seattle');
    expect(container.textContent).toContain('0 places');
    expect(container.textContent).toContain('No matching venue locations');
    expect(container.textContent).not.toContain('River Room');
    expect(container.querySelector('[data-testid="map"]')).toBeNull();
  });
});
