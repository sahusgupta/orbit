import { describe, expect, it } from 'vitest';
import { searchMapClubs } from './mapSearch';
import type { PlayerClubSnapshot } from './playerSync';

function venue(id: string, name: string, address?: string): PlayerClubSnapshot {
  return {
    club: { id, name, address },
    games: [],
    memberships: [],
    waitlists: [],
    notifications: [],
    generatedAt: '2026-10-20T00:00:00.000Z'
  };
}

describe('Published venue map search', () => {
  const austin = venue('austin', 'River Room', '100 Main St, Austin, TX 78701');
  const secondAustin = venue('austin-north', 'North Room', '200 Oak St, Austin, TX 78702');
  const dallas = venue('dallas', 'Austin Poker Club', '300 Elm St, Dallas, TX 75201');

  it('matches city and state words despite punctuation, order, and capitalization', () => {
    expect(searchMapClubs([austin, secondAustin, dallas], '  TX AUSTIN ')).toEqual([austin, secondAustin]);
    expect(searchMapClubs([austin, dallas], 'Austin, TX')).toEqual([austin]);
    expect(searchMapClubs([austin, dallas], '78701')).toEqual([austin]);
  });

  it('restricts a published location search to that location instead of similarly named remote venues', () => {
    expect(searchMapClubs([dallas, secondAustin, austin], 'Austin')).toEqual([secondAustin, austin]);
  });

  it('still supports venue and game searches when the query is not a published location', () => {
    const gameClub = {
      ...dallas,
      games: [{ id: 'game', name: '1/2 NLH', maxSeats: 9, collectionMode: 'Time' as const, openTables: [], waitlistCount: 0,
        formingCount: 0, availableSeats: 0, knownPlayersCount: 0, updatedAt: '2026-10-20T00:00:00.000Z' }]
    };
    expect(searchMapClubs([austin, gameClub], 'River Room')).toEqual([austin]);
    expect(searchMapClubs([austin, gameClub], 'NLH')).toEqual([gameClub]);
    expect(searchMapClubs([austin, gameClub], 'Dallas NLH')).toEqual([gameClub]);
  });

  it('handles accented cities and keeps unknown locations unknown', () => {
    const montreal = venue('montreal', 'Club du Nord', '100 Rue Main, Montréal, QC');
    const missing = venue('missing', 'Unknown Room');
    expect(searchMapClubs([montreal, missing], 'montreal qc')).toEqual([montreal]);
    expect(searchMapClubs([austin, missing], 'Seattle')).toEqual([]);
    expect(missing.club.coordinate).toBeUndefined();
  });

  it('preserves the input order and does not mutate the catalog for an empty query', () => {
    const clubs = [dallas, austin];
    const results = searchMapClubs(clubs, ' , ');
    expect(results).toEqual(clubs);
    expect(results).not.toBe(clubs);
    expect(clubs).toEqual([dallas, austin]);
  });
});
