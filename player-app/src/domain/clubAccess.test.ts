import { describe, expect, it } from 'vitest';
import { getClubMembershipPrices, getClubProductLabel, timeAccessOptions } from './clubAccess';
import type { PlayerClubSnapshot } from './playerSync';

const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Time Club', minimumAge: 21 },
  games: [],
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  timeAccess: { enabled: true, hourlyFeeCents: 1200, linked: true, savedMinutes: 0 },
  generatedAt: '2026-08-28T00:00:00.000Z'
};

describe('player time purchase options', () => {
  it('offers only 30-minute, one-hour, and two-hour choices', () => {
    expect(timeAccessOptions).toEqual([
      { product: 'time-30', minutes: 30, label: '30 min' },
      { product: 'time-60', minutes: 60, label: '1 hour' },
      { product: 'time-120', minutes: 120, label: '2 hours' }
    ]);
  });

  it('shows prices derived from the published hourly fee', () => {
    const prices = getClubMembershipPrices(club);
    expect(getClubProductLabel('time-30', prices)).toBe('$6.00');
    expect(getClubProductLabel('time-60', prices)).toBe('$12.00');
    expect(getClubProductLabel('time-120', prices)).toBe('$24.00');
  });
});
