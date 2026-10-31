import { describe, expect, it } from 'vitest';
import { getClubDistance } from '@orbit/player-domain/discovery';
import { filterClubs } from './selectors';
import type { ClubFilters, Coordinate, PlayerClubSnapshot } from './types';
import { clubAlpha } from '@/tests/fixtures';

const origin: Coordinate = { latitude: 0, longitude: 0 };
const filters: ClubFilters = { query: '', activity: 'all', distance: '0' };

function club(id: string, coordinate?: Coordinate): PlayerClubSnapshot {
  return { ...clubAlpha, club: { ...clubAlpha.club, id, name: `Venue ${id}`, coordinate }, games: [] };
}

function measuredClub(id: string, coordinate: Coordinate | undefined, measurements: { coordinateReads: number }) {
  const snapshot = club(id, coordinate);
  return { ...snapshot, club: { ...snapshot.club, get coordinate() {
    measurements.coordinateReads += 1;
    return coordinate;
  } } };
}

function expectReferences(actual: PlayerClubSnapshot[], expected: PlayerClubSnapshot[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((snapshot, index) => expect(snapshot).toBe(expected[index]));
}

function measuredCatalog() {
  const measurements = { coordinateReads: 0 };
  const known = Array.from({ length: 128 }, (_, index) => {
    const rank = (index * 73) % 128;
    return { rank, snapshot: measuredClub(`known-${rank}`, { latitude: 0, longitude: (rank + 1) / 10 }, measurements) };
  });
  const firstUnknown = measuredClub('unknown-first', undefined, measurements);
  const lastUnknown = measuredClub('unknown-last', undefined, measurements);
  const snapshots = [firstUnknown, ...known.slice(0, 64).map(({ snapshot }) => snapshot), lastUnknown,
    ...known.slice(64).map(({ snapshot }) => snapshot)];
  const expected = [...known].sort((left, right) => left.rank - right.rank).map(({ snapshot }) => snapshot);
  expected.push(firstUnknown, lastUnknown);
  return { snapshots, expected, measurements };
}

describe('Web club distance sorting characterization', () => {
  it('orders zero, nearest, tied, farther and unknown distances while retaining tie order', () => {
    const zero = club('zero', origin);
    const firstTie = club('first-tie', { latitude: 0, longitude: 1 });
    const secondTie = club('second-tie', { latitude: 0, longitude: 1 });
    const far = club('far', { latitude: 0, longitude: 5 });
    const firstUnknown = club('first-unknown');
    const lastUnknown = club('last-unknown');
    const snapshots = [firstUnknown, far, secondTie, zero, firstTie, lastUnknown];
    const before = [...snapshots];
    expectReferences(filterClubs(snapshots, filters, origin), [zero, secondTie, firstTie, far, firstUnknown, lastUnknown]);
    expectReferences(snapshots, before);
  });

  it.each([null, { latitude: NaN, longitude: 0 }])('preserves input order when origin %j makes all distances unknown', (location) => {
    const snapshots = [club('far', { latitude: 0, longitude: 5 }), club('unknown'), club('near', origin)];
    expectReferences(filterClubs(snapshots, filters, location), snapshots);
  });

  it('includes the exact positive distance cutoff and excludes farther or unknown venues', () => {
    const atBoundary = club('boundary', { latitude: 0, longitude: 1 });
    const inside = club('inside', { latitude: 0, longitude: 0.5 });
    const farther = club('farther', { latitude: 0, longitude: 2 });
    const unknown = club('unknown');
    const cutoff = getClubDistance(atBoundary, origin);
    expect(cutoff).not.toBeNull();
    expectReferences(filterClubs([unknown, farther, atBoundary, inside], { ...filters, distance: String(cutoff) }, origin),
      [inside, atBoundary]);
  });

  it.each(['0', '-1', 'not-a-number'])('retains unknown-distance venues when distance filter is %s', (distance) => {
    const near = club('near', origin);
    const unknown = club('unknown');
    expectReferences(filterClubs([unknown, near], { ...filters, distance }, origin), [near, unknown]);
  });

  it('treats duplicate club IDs on distinct objects and coordinates independently', () => {
    const far = club('shared-id', { latitude: 0, longitude: 5 });
    const near = club('shared-id', { latitude: 0, longitude: 0.5 });
    expectReferences(filterClubs([far, near], filters, origin), [near, far]);
  });

  it('retains duplicate occurrences of the same snapshot object', () => {
    const shared = club('shared-object', { latitude: 0, longitude: 1 });
    const near = club('near', origin);
    const far = club('far', { latitude: 0, longitude: 5 });
    expectReferences(filterClubs([shared, far, shared, near], filters, origin), [near, shared, shared, far]);
  });

  it('does not mutate frozen snapshots, coordinate objects or input arrays', () => {
    const far = club('far', { latitude: 0, longitude: 5 });
    const near = club('near', origin);
    const snapshots = [far, near];
    const before = JSON.stringify(snapshots);
    snapshots.forEach((snapshot) => {
      Object.freeze(snapshot.club.coordinate);
      Object.freeze(snapshot.club);
      Object.freeze(snapshot);
    });
    Object.freeze(snapshots);
    expectReferences(filterClubs(snapshots, filters, origin), [near, far]);
    expect(JSON.stringify(snapshots)).toBe(before);
  });

  it('does not read coordinates when the query rejects a venue', () => {
    const measurements = { coordinateReads: 0 };
    const snapshot = measuredClub('excluded', origin, measurements);
    expect(filterClubs([snapshot], { ...filters, query: 'unmatched-query' }, origin)).toEqual([]);
    expect(measurements.coordinateReads).toBe(0);
  });

  it.each(['active', 'forming'])('does not read coordinates when %s activity rejects a venue', (activity) => {
    const measurements = { coordinateReads: 0 };
    const snapshot = measuredClub('no-games', origin, measurements);
    expect(filterClubs([snapshot], { ...filters, activity }, origin)).toEqual([]);
    expect(measurements.coordinateReads).toBe(0);
  });

  it('recalculates for a changed origin or changed coordinate on each call', () => {
    const first = club('first', origin);
    const second = club('second', { latitude: 0, longitude: 1 });
    const snapshots = [first, second];
    expectReferences(filterClubs(snapshots, filters, origin), [first, second]);
    expectReferences(filterClubs(snapshots, filters, { latitude: 0, longitude: 1 }), [second, first]);
    first.club.coordinate = { latitude: 0, longitude: 2 };
    expectReferences(filterClubs(snapshots, filters, origin), [second, first]);
    second.club.coordinate = undefined;
    expectReferences(filterClubs(snapshots, filters, origin), [first, second]);
  });

  it('records real distance-helper coordinate reads for a deterministically shuffled catalogue', () => {
    const { snapshots, expected, measurements } = measuredCatalog();
    expectReferences(filterClubs(snapshots, filters, origin), expected);
    console.info(JSON.stringify({ measurement: 'web-club-coordinate-reads', scenario: 'shuffled-catalogue',
      known: 128, missing: 2, occurrences: snapshots.length, coordinateReads: measurements.coordinateReads }));
  });
});

describe('Web club distance calculation budgets', () => {
  it('bounds published-coordinate reads linearly while preserving the catalogue order', () => {
    const { snapshots, expected, measurements } = measuredCatalog();
    expectReferences(filterClubs(snapshots, filters, origin), expected);
    const maximumReads = snapshots.length * 4;
    console.info(JSON.stringify({ measurement: 'web-club-coordinate-budget', scenario: 'shuffled-catalogue',
      occurrences: snapshots.length, coordinateReads: measurements.coordinateReads, maximumReads }));
    expect(measurements.coordinateReads).toBeLessThanOrEqual(maximumReads);
  });

  it('evaluates one real distance per reached occurrence, including a repeated object and missing coordinates', () => {
    const measurements = { coordinateReads: 0 };
    const shared = measuredClub('shared', { latitude: 0, longitude: 1 }, measurements);
    const unknown = measuredClub('unknown', undefined, measurements);
    expectReferences(filterClubs([shared, unknown, shared], filters, origin), [shared, shared, unknown]);
    console.info(JSON.stringify({ measurement: 'web-club-coordinate-budget', scenario: 'repeated-object',
      knownOccurrences: 2, missingOccurrences: 1, coordinateReads: measurements.coordinateReads, expectedReads: 5 }));
    // The real validator reads a valid published coordinate twice and a missing
    // one once. Each input occurrence must still reach that existing boundary.
    expect(measurements.coordinateReads).toBe(5);
  });

  it('keeps coordinate work linear with an unknown origin while preserving every input occurrence', () => {
    const { snapshots, measurements } = measuredCatalog();
    expectReferences(filterClubs(snapshots, filters, null), snapshots);
    const maximumReads = snapshots.length * 4;
    console.info(JSON.stringify({ measurement: 'web-club-coordinate-budget', scenario: 'unknown-origin',
      occurrences: snapshots.length, coordinateReads: measurements.coordinateReads, maximumReads }));
    expect(measurements.coordinateReads).toBeLessThanOrEqual(maximumReads);
  });
});
