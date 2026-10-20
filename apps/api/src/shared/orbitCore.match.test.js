import { describe, expect, it } from 'vitest';
import core from './orbitCore.cjs';

const state = () => ({
  settings: { clubAccount: { clubName: 'Example Venue' } },
  games: [{ id: 'game', name: '1/2 NLH', maxSeats: 9 }],
  sessions: [{ id: 'table', gameId: 'game', label: 'Table 1', status: 'Running', maxSeats: 9, seatsFilled: 7, collectionMode: 'Time', startedAt: '2026-10-12T12:00:00.000Z' }],
  playerSessions: [],
  profiles: [{ id: 'own', orbitPlayerId: 'uid-own', name: 'Own' }, { id: 'other', orbitPlayerId: 'uid-other', name: 'Other' }],
  interests: [
    { id: 'own-request', gameId: 'game', profileId: 'own', playerName: 'Own', status: 'Interested', interestedAt: '2026-10-12T12:00:00.000Z' },
    { id: 'other-request', gameId: 'game', profileId: 'other', playerName: 'Other', status: 'Arrived', interestedAt: '2026-10-12T11:00:00.000Z' },
    { id: 'confirmed-request', gameId: 'game', profileId: 'other', playerName: 'Other', status: 'Confirmed Coming', interestedAt: '2026-10-12T11:30:00.000Z' },
    { id: 'seated-request', gameId: 'game', profileId: 'other', playerName: 'Other', status: 'Seated', interestedAt: '2026-10-12T10:00:00.000Z' }
  ]
});

describe('Player snapshot queue aggregate and private records', () => {
  it('characterizes public aggregate counts, running seats, and owned request position', () => {
    const publicSnapshot = core.buildPlayerClubSnapshot(state());
    expect(publicSnapshot.games[0]).toMatchObject({ availableSeats: 2, waitlistCount: 3 });
    const ownSnapshot = core.buildPlayerClubSnapshot(state(), { id: 'uid-own', name: 'Own' });
    expect(ownSnapshot.waitlists).toHaveLength(1);
    expect(ownSnapshot.waitlists[0]).toMatchObject({ id: 'own-request', playerId: 'uid-own', position: 3 });
    expect(ownSnapshot.memberships.map((membership) => membership.playerId)).toEqual(['uid-own']);
  });
  it('reports the total venue queue to authenticated players while keeping other requests private', () => {
    const own = core.buildPlayerClubSnapshot(state(), { id: 'uid-own', name: 'Own' });
    const outsider = core.buildPlayerClubSnapshot(state(), { id: 'uid-outsider', name: 'Outsider' });
    expect(own.games[0].waitlistCount).toBe(3);
    expect(own.social.waitlistCount).toBe(3);
    expect(outsider.games[0].waitlistCount).toBe(3);
    expect(outsider.waitlists).toEqual([]);
    expect(JSON.stringify(own)).not.toContain('uid-other');
    expect(JSON.stringify(own)).not.toContain('other-request');
  });
});
