import { describe, expect, it } from 'vitest';
import { getClubCoordinate, getClubDistance } from './discovery';
import { deriveClubsViewState, reconcileSelectedClubAfterRefresh } from './playerClubViewState';
import type { PlayerClubSnapshot } from './playerSync';

function club(overrides: Partial<PlayerClubSnapshot['club']> = {}): PlayerClubSnapshot {
  return {
    club: { id: 'club-1', name: 'River Room', ...overrides },
    games: [],
    memberships: [],
    waitlists: [],
    notifications: [],
    social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
    generatedAt: '2026-09-04T00:00:00.000Z'
  };
}

describe('Player conservative release contracts', () => {
  it('never invents a venue coordinate or distance', () => {
    expect(getClubCoordinate(club())).toBeNull();
    expect(getClubCoordinate(club({ coordinate: { latitude: 91, longitude: 0 } }))).toBeNull();
    expect(getClubCoordinate(club({ coordinate: { latitude: 30.1, longitude: -96.2 } }))).toEqual({ latitude: 30.1, longitude: -96.2 });
    expect(getClubDistance(club(), { latitude: 30, longitude: -96 })).toBeNull();
  });

  it('models every empty and stale Clubs boundary without requiring a selected club', () => {
    expect(deriveClubsViewState('loading', [], undefined, false, '')).toEqual({ kind: 'loading' });
    expect(deriveClubsViewState('ready', [], undefined, false, '')).toEqual({ kind: 'empty' });
    expect(deriveClubsViewState('error', [], undefined, false, '')).toEqual({ kind: 'offline' });
    expect(deriveClubsViewState('error', [club()], club(), false, '')).toMatchObject({ kind: 'stale' });
    expect(deriveClubsViewState('ready', [club()], undefined, false, 'River Room is no longer available.')).toMatchObject({ kind: 'removed' });
  });

  it('removes a selected club that disappears from refreshed venue data before choosing a fallback', () => {
    const result = reconcileSelectedClubAfterRefresh(
      'removed-club',
      [club({ id: 'remaining-club' })],
      'remaining-club'
    );

    expect(result).toEqual({
      selectedClubId: '',
      selectionNotice: 'The previously selected club is no longer available.'
    });
  });
});
