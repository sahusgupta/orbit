import { describe, expect, it } from 'vitest';
import { getAccessProfileText, getClubFeeProfile } from './clubAccess';
import type { PlayerClubSnapshot, PlayerSyncGame } from './playerSync';

const club = (hourlyFeeCents?: number): PlayerClubSnapshot => ({
  club: { id: 'club-1', name: 'Club One', minimumAge: 21 },
  games: [],
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  ...(hourlyFeeCents == null ? {} : { timeAccess: { enabled: true, hourlyFeeCents, linked: true, savedMinutes: 0 } }),
  generatedAt: '2026-08-28T00:00:00.000Z'
});

const game = (collectionMode?: PlayerSyncGame['collectionMode']): PlayerSyncGame => ({
  id: 'game-1',
  name: 'Holdem',
  maxSeats: 9,
  collectionMode,
  openTables: [],
  waitlistCount: 0,
  formingCount: 0,
  availableSeats: 0,
  knownPlayersCount: 0
});

describe('venue-published collection terms', () => {
  it('preserves a published hourly rate, including a legitimate zero', () => {
    expect(getClubFeeProfile(club(1200), game('Time'))).toEqual({ type: 'time', label: '$12.00/hr' });
    expect(getClubFeeProfile(club(0), game('Time'))).toEqual({ type: 'time', label: '$0.00/hr' });
  });

  it('does not invent time or drop fees when an amount is absent', () => {
    expect(getClubFeeProfile(club(), game('Time'))).toEqual({ type: 'time', label: 'Time rate not published' });
    expect(getClubFeeProfile(club(), game('Drop'))).toEqual({ type: 'drop', label: 'Drop amount not published' });
    expect(getClubFeeProfile(club(), game())).toEqual({ type: 'unknown', label: 'Collection details not published' });
    expect(getAccessProfileText(club(), game('Drop'))).toContain('Confirm current fees');
  });
});
