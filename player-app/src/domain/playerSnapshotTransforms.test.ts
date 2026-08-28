import { describe, expect, it } from 'vitest';
import type { PlayerClubSnapshot } from './playerSync';
import { filterSnapshotForPlayer } from './playerSnapshotTransforms';

const loyalty = { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New' as const, nextTierAtHours: 12 };

function snapshot(): PlayerClubSnapshot {
  return {
    club: { id: 'club-1', name: 'River Room' },
    games: [],
    memberships: [
      { id: 'membership-own', clubId: 'club-1', playerId: 'player-1', playerName: 'Other Name', status: 'Active', joinedAt: '2026-08-28', loyalty, preferredGameIds: [] },
      { id: 'membership-foreign', clubId: 'club-1', playerId: 'player-2', playerName: 'Alex', status: 'Active', joinedAt: '2026-08-28', loyalty, preferredGameIds: [] },
      { id: 'membership-legacy', clubId: 'club-1', playerId: '', playerName: 'Alex', status: 'Active', joinedAt: '2026-08-28', loyalty, preferredGameIds: [] }
    ],
    waitlists: [
      { id: 'wait-own', clubId: 'club-1', gameId: 'game-1', playerId: 'player-1', playerName: 'Other Name', status: 'Interested', position: 1, requestedAt: '2026-08-28T12:00:00.000Z' },
      { id: 'wait-foreign', clubId: 'club-1', gameId: 'game-1', playerId: 'player-2', playerName: 'Alex', status: 'Interested', position: 2, requestedAt: '2026-08-28T12:00:00.000Z' },
      { id: 'wait-legacy', clubId: 'club-1', gameId: 'game-1', playerName: 'Alex', status: 'Interested', position: 3, requestedAt: '2026-08-28T12:00:00.000Z' }
    ],
    notifications: [
      { id: 'notice-own', clubId: 'club-1', gameId: 'game-1', title: 'Own', body: 'Own', reason: 'seat-opened', createdAt: '2026-08-28T12:00:00.000Z', targetPlayerIds: ['player-1'], targetPlayerNames: ['Other Name'] },
      { id: 'notice-foreign', clubId: 'club-1', gameId: 'game-1', title: 'Foreign', body: 'Foreign', reason: 'seat-opened', createdAt: '2026-08-28T12:00:00.000Z', targetPlayerIds: ['player-2'], targetPlayerNames: ['Alex'] },
      { id: 'notice-legacy', clubId: 'club-1', gameId: 'game-1', title: 'Legacy', body: 'Legacy', reason: 'seat-opened', createdAt: '2026-08-28T12:00:00.000Z', targetPlayerNames: ['Alex'] }
    ],
    social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
    generatedAt: '2026-08-28T12:00:00.000Z'
  };
}

describe('Player snapshot ownership filtering', () => {
  it('uses stable IDs exclusively and keeps legacy name-only records', () => {
    const filtered = filterSnapshotForPlayer(snapshot(), { id: 'PLAYER-1', name: 'alex' });

    expect(filtered.memberships.map(({ id }) => id)).toEqual(['membership-own', 'membership-legacy']);
    expect(filtered.waitlists.map(({ id }) => id)).toEqual(['wait-own', 'wait-legacy']);
    expect(filtered.notifications.map(({ id }) => id)).toEqual(['notice-own', 'notice-legacy']);
  });
});
