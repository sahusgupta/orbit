import { describe, expect, it } from 'vitest';
import { getDistanceMiles } from '@orbit/player-domain/discovery';
import { findGameByRouteKey, flattenGames, gameRouteKey } from './selectors';
import type { Coordinate, GameListing, PlayerClubSnapshot, PlayerSyncGame } from './types';
import { clubAlpha, formingGame, runningGame, scheduledGame } from '@/tests/fixtures';

const origin: Coordinate = { latitude: 0, longitude: 0 };
const listingKeys = ['club', 'game', 'state', 'distanceMiles', 'stakes'];

function game(id: string): PlayerSyncGame {
  return { ...runningGame, id, openTables: runningGame.openTables.map((table) => ({
    ...table, id: `table-${id}`, gameId: id
  })) };
}

function club(id: string, games: PlayerSyncGame[], coordinate?: Coordinate): PlayerClubSnapshot {
  return { ...clubAlpha, club: { ...clubAlpha.club, id, name: `Venue ${id}`, coordinate }, games };
}

function measuredClub(id: string, games: PlayerSyncGame[], coordinate: Coordinate | undefined,
  measurements: { coordinateReads: number }): PlayerClubSnapshot {
  const snapshot = club(id, games, coordinate);
  return { ...snapshot, club: { ...snapshot.club, get coordinate() {
    measurements.coordinateReads += 1;
    return coordinate;
  } } };
}

type CatalogRecord = { snapshot: PlayerClubSnapshot; expectedDistance: number | null };

function measuredCatalog() {
  const measurements = { coordinateReads: 0 };
  const known = Array.from({ length: 16 }, (_, index): CatalogRecord => {
    const coordinate = { latitude: index / 10, longitude: index / 5 };
    return { snapshot: measuredClub(`known-${index}`, Array.from({ length: 32 }, (_, gameIndex) =>
      game(`known-${index}-game-${gameIndex}`)), coordinate, measurements),
    expectedDistance: getDistanceMiles(origin, coordinate) };
  });
  const missing = Array.from({ length: 8 }, (_, index): CatalogRecord => ({
    snapshot: measuredClub(`missing-${index}`, Array.from({ length: 32 }, (_, gameIndex) =>
      game(`missing-${index}-game-${gameIndex}`)), undefined, measurements), expectedDistance: null
  }));
  const emptyKnown = { snapshot: measuredClub('empty-known', [], origin, measurements), expectedDistance: 0 };
  const emptyMissing = { snapshot: measuredClub('empty-missing', [], undefined, measurements), expectedDistance: null };
  const records = [emptyKnown, ...known.slice(0, 8), emptyMissing, ...missing, ...known.slice(8)];
  return { records, snapshots: records.map(({ snapshot }) => snapshot), measurements };
}

function expectCatalog(listings: GameListing[], records: CatalogRecord[]) {
  expect(listings).toHaveLength(768);
  let index = 0;
  for (const { snapshot, expectedDistance } of records) {
    for (const originalGame of snapshot.games) {
      const listing = listings[index++];
      expect(Object.keys(listing)).toEqual(listingKeys);
      expect(listing.club).toBe(snapshot);
      expect(listing.game).toBe(originalGame);
      expect(listing.state).toBe('running');
      expect(listing.stakes).toBe('1/2');
      expect(listing.distanceMiles).toBe(expectedDistance);
    }
  }
}

const distanceCases: { label: string; coordinate: Coordinate | undefined; location: Coordinate | null;
  expectedDistance: number | null; expectedReads: number }[] = [
  { label: 'zero', coordinate: origin, location: origin, expectedDistance: 0, expectedReads: 2 },
  { label: 'missing', coordinate: undefined, location: origin, expectedDistance: null, expectedReads: 1 },
  { label: 'invalid', coordinate: { latitude: 91, longitude: 0 }, location: origin, expectedDistance: null, expectedReads: 1 },
  { label: 'null-origin', coordinate: { latitude: 0, longitude: 1 }, location: null, expectedDistance: null, expectedReads: 2 }
];

describe('game listing distance characterization', () => {
  it('retains the exact listing shape, original references and state/stakes values in new wrappers', () => {
    const paused = { ...game('paused'), name: '4/8 Limit', openTables: runningGame.openTables.map((table) => ({
      ...table, status: 'Paused' as const
    })) };
    const unpriced = { ...scheduledGame, name: 'Unpriced event' };
    const originals = [runningGame, formingGame, paused, unpriced];
    const venue = club('all-states', originals, origin);
    const listings = flattenGames([venue], origin);
    expect(listings.map(({ state }) => state)).toEqual(['running', 'forming', 'paused', 'unavailable']);
    expect(listings.map(({ stakes }) => stakes)).toEqual(['1/2', '2/5', '4/8', 'Stakes unavailable']);
    listings.forEach((listing, index) => {
      expect(Object.keys(listing)).toEqual(listingKeys);
      expect(listing.club).toBe(venue);
      expect(listing.game).toBe(originals[index]);
      expect(listing.distanceMiles).toBe(0);
    });
    const again = flattenGames([venue], origin);
    again.forEach((listing, index) => expect(listing).not.toBe(listings[index]));
  });

  it('keeps club occurrence order followed by each club game order', () => {
    const first = club('first', [game('first-a'), game('first-b')], { latitude: 0, longitude: 2 });
    const second = club('second', [game('second-a'), game('second-b')], origin);
    const listings = flattenGames([first, second], origin);
    expect(listings.map(({ game: item }) => item.id)).toEqual(['first-a', 'first-b', 'second-a', 'second-b']);
    expect(listings.map(({ club: item }) => item)).toEqual([first, first, second, second]);
  });

  it('treats distinct same-ID club objects and coordinates independently', () => {
    const far = club('shared-id', [game('far')], { latitude: 0, longitude: 5 });
    const near = club('shared-id', [game('near')], { latitude: 0, longitude: 1 });
    const listings = flattenGames([far, near], origin);
    expect(listings[0].club).toBe(far);
    expect(listings[1].club).toBe(near);
    expect(listings[0].distanceMiles).toBeGreaterThan(listings[1].distanceMiles ?? Infinity);
  });

  it('keeps repeated club, game-ID and game-object occurrences as distinct wrappers', () => {
    const first = game('shared-game-id');
    const second = { ...formingGame, id: first.id };
    const venue = club('repeated-club', [first, second, first], origin);
    const listings = flattenGames([venue, venue], origin);
    expect(listings.map(({ game: item }) => item)).toEqual([first, second, first, first, second, first]);
    listings.forEach((listing) => expect(listing.club).toBe(venue));
    expect(new Set(listings).size).toBe(6);
  });

  it.each(distanceCases)('retains $label distance values for every game', ({ coordinate, location, expectedDistance }) => {
    const venue = club('distance-case', [game('one'), game('two'), game('three')], coordinate);
    expect(flattenGames([venue], location).map(({ distanceMiles }) => distanceMiles))
      .toEqual([expectedDistance, expectedDistance, expectedDistance]);
  });

  it('does not access coordinates for empty game inventories', () => {
    const measurements = { coordinateReads: 0 };
    const empty = measuredClub('empty', [], origin, measurements);
    expect(flattenGames([empty], origin)).toEqual([]);
    expect(measurements.coordinateReads).toBe(0);
    expect(flattenGames([], origin)).toEqual([]);
  });

  it('preserves a first-game state failure before any published-coordinate access', () => {
    const failure = new Error('synthetic first-game state failure');
    const broken = { ...game('broken'), get openTables(): PlayerSyncGame['openTables'] { throw failure; } };
    const measurements = { coordinateReads: 0 };
    const venue = measuredClub('broken-state', [broken], origin, measurements);
    expect(() => flattenGames([venue], origin)).toThrow(failure);
    expect(measurements.coordinateReads).toBe(0);
  });

  it('preserves a distance failure after state evaluation and before stakes evaluation', () => {
    const order: string[] = [];
    const failure = new Error('synthetic coordinate failure');
    const original = game('ordered');
    const probe = { ...original,
      get openTables() { order.push('state'); return original.openTables; },
      get name() { order.push('stakes'); return original.name; }
    };
    const base = club('ordered', [probe]);
    const venue = { ...base, club: { ...base.club,
      get coordinate(): Coordinate { order.push('distance'); throw failure; }
    } };
    expect(() => flattenGames([venue], origin)).toThrow(failure);
    expect(order).toEqual(['state', 'distance']);
  });

  it('preserves a stakes failure after the state and real distance evaluations', () => {
    const order: string[] = [];
    const failure = new Error('synthetic stakes failure');
    const original = game('ordered');
    const probe = { ...original,
      get openTables() { order.push('state'); return original.openTables; },
      get name(): string { order.push('stakes'); throw failure; }
    };
    const base = club('ordered', [probe]);
    const venue = { ...base, club: { ...base.club,
      get coordinate() { order.push('distance'); return origin; }
    } };
    expect(() => flattenGames([venue], origin)).toThrow(failure);
    expect(order).toEqual(['state', 'distance', 'distance', 'stakes']);
  });

  it('keeps game route lookup eager when a later game fails despite an earlier canonical match', () => {
    for (const stage of ['state', 'stakes']) {
      const failure = new Error(`synthetic later-${stage} failure`);
      const first = game('first-canonical-match');
      const original = game('later-broken');
      const broken = stage === 'state'
        ? { ...original, get openTables(): PlayerSyncGame['openTables'] { throw failure; } }
        : { ...original, get name(): string { throw failure; } };
      const venue = club('eager-lookup', [first, broken], origin);
      const key = gameRouteKey(venue, first);
      expect(() => findGameByRouteKey([venue], key)).toThrow(failure);
    }
  });

  it('recalculates after origin or venue-coordinate changes and defaults to unknown origin', () => {
    const venue = club('mutable', [game('one'), game('two')], { latitude: 0, longitude: 1 });
    const first = flattenGames([venue], origin);
    const movedOrigin = flattenGames([venue], { latitude: 0, longitude: 1 });
    expect(first[0].distanceMiles).toBeGreaterThan(0);
    expect(movedOrigin.map(({ distanceMiles }) => distanceMiles)).toEqual([0, 0]);
    venue.club.coordinate = { latitude: 0, longitude: 2 };
    const movedClub = flattenGames([venue], origin);
    expect(movedClub[0].distanceMiles).toBeGreaterThan(first[0].distanceMiles ?? Infinity);
    expect(flattenGames([venue]).map(({ distanceMiles }) => distanceMiles)).toEqual([null, null]);
  });

  it('does not mutate frozen club/game inputs or source ordering', () => {
    const original = game('frozen');
    const venue = club('frozen', [original], { latitude: 0, longitude: 1 });
    const snapshots = [venue];
    const before = JSON.stringify(snapshots);
    Object.freeze(original.openTables);
    Object.freeze(original);
    Object.freeze(venue.games);
    Object.freeze(venue.club.coordinate);
    Object.freeze(venue.club);
    Object.freeze(venue);
    Object.freeze(snapshots);
    const [listing] = flattenGames(snapshots, origin);
    expect(listing.club).toBe(venue);
    expect(listing.game).toBe(original);
    expect(JSON.stringify(snapshots)).toBe(before);
  });

  it('records real coordinate-helper work for populated and empty club occurrences', () => {
    const { records, snapshots, measurements } = measuredCatalog();
    expectCatalog(flattenGames(snapshots, origin), records);
    console.info(JSON.stringify({ measurement: 'game-listing-coordinate-reads', scenario: 'mixed-catalogue',
      knownClubOccurrences: 16, missingClubOccurrences: 8, emptyClubOccurrences: 2,
      gamesPerNonemptyClub: 32, listingCount: 768, coordinateReads: measurements.coordinateReads }));
  });
});

describe('game listing distance calculation budgets', () => {
  it('bounds coordinate work by nonempty club occurrences rather than game count', () => {
    const { records, snapshots, measurements } = measuredCatalog();
    expectCatalog(flattenGames(snapshots, origin), records);
    const maximumReads = 24 * 4;
    console.info(JSON.stringify({ measurement: 'game-listing-coordinate-budget', scenario: 'mixed-catalogue',
      nonemptyClubOccurrences: 24, listingCount: 768, coordinateReads: measurements.coordinateReads, maximumReads }));
    expect(measurements.coordinateReads).toBeLessThanOrEqual(maximumReads);
  });

  it.each(distanceCases)('reuses $label distance results across all games in one club occurrence',
    ({ label, coordinate, location, expectedDistance, expectedReads }) => {
      const measurements = { coordinateReads: 0 };
      const venue = measuredClub('distance-reuse', Array.from({ length: 6 }, (_, index) => game(`game-${index}`)),
        coordinate, measurements);
      const listings = flattenGames([venue], location);
      expect(listings.map(({ distanceMiles }) => distanceMiles)).toEqual(Array.from({ length: 6 }, () => expectedDistance));
      console.info(JSON.stringify({ measurement: 'game-listing-coordinate-budget', scenario: label,
        clubOccurrences: 1, listingCount: 6, coordinateReads: measurements.coordinateReads, expectedReads }));
      expect(measurements.coordinateReads).toBe(expectedReads);
    });

  it('evaluates distance separately for repeated nonempty club occurrences', () => {
    const measurements = { coordinateReads: 0 };
    const games = Array.from({ length: 6 }, (_, index) => game(`game-${index}`));
    const venue = measuredClub('repeated-occurrence', games, { latitude: 0, longitude: 1 }, measurements);
    const listings = flattenGames([venue, venue], origin);
    expect(listings).toHaveLength(12);
    listings.forEach((listing, index) => {
      expect(listing.club).toBe(venue);
      expect(listing.game).toBe(games[index % games.length]);
    });
    console.info(JSON.stringify({ measurement: 'game-listing-coordinate-budget', scenario: 'repeated-club-occurrence',
      clubOccurrences: 2, listingCount: 12, coordinateReads: measurements.coordinateReads, expectedReads: 4 }));
    expect(measurements.coordinateReads).toBe(4);
  });
});
