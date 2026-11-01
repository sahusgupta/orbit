import { describe, expect, it } from 'vitest';
import { filterMapClubs } from './discovery';
import type { PlayerClubSnapshot, PlayerCoordinate } from './playerSync';

const origin: PlayerCoordinate = { latitude: 0, longitude: 0 };

function club(id: string, coordinate?: PlayerCoordinate): PlayerClubSnapshot {
  return {
    club: { id, name: `Club ${id}`, coordinate },
    games: [],
    memberships: [],
    waitlists: [],
    notifications: [],
    generatedAt: '2026-10-31T00:00:00.000Z'
  };
}

function measuredClub(id: string, coordinate?: PlayerCoordinate) {
  let coordinateReads = 0;
  const snapshot = club(id);
  Object.defineProperty(snapshot.club, 'coordinate', {
    enumerable: true,
    get() {
      coordinateReads += 1;
      return coordinate;
    }
  });
  return { snapshot, coordinateReads: () => coordinateReads };
}

function measuredCatalog() {
  const records = Array.from({ length: 240 }, (_, index) => {
    const longitude = ((index * 73) % 240 + 1) / 1000;
    const coordinate = index % 8 === 0 ? undefined
      : index % 11 === 0 ? { latitude: 91, longitude }
        : { latitude: 0, longitude };
    return { ...measuredClub(`catalog-${index}`, coordinate), longitude,
      valid: coordinate !== undefined && coordinate.latitude <= 90 };
  });
  const occurrences = [...records, records[1], records[0], records[11], records[1], records[0], records[11]];
  const expected = [
    ...occurrences.filter((record) => record.valid).sort((left, right) => left.longitude - right.longitude),
    ...occurrences.filter((record) => !record.valid)
  ].map((record) => record.snapshot);
  return {
    clubs: occurrences.map((record) => record.snapshot),
    expected,
    measure: () => ({
      inputOccurrences: occurrences.length,
      validOccurrences: occurrences.filter((record) => record.valid).length,
      unknownOccurrences: occurrences.filter((record) => !record.valid).length,
      validCoordinateReads: records.filter((record) => record.valid).reduce((sum, record) => sum + record.coordinateReads(), 0),
      unknownCoordinateReads: records.filter((record) => !record.valid).reduce((sum, record) => sum + record.coordinateReads(), 0)
    })
  };
}

describe('native club distance behavior', () => {
  it('orders zero and nearest distances first with stable known and unknown ties without mutation', () => {
    const unknownFirst = club('unknown-first');
    const far = club('far', { latitude: 0, longitude: 0.2 });
    const tiedFirst = club('tied-first', { latitude: 0, longitude: 0.01 });
    const zero = club('zero', origin);
    const tiedSecond = club('tied-second', { latitude: 0, longitude: 0.01 });
    const unknownLast = club('unknown-last');
    const input = [unknownFirst, far, tiedFirst, zero, tiedSecond, unknownLast];
    const before = JSON.stringify(input);
    input.forEach((snapshot) => { Object.freeze(snapshot.club); Object.freeze(snapshot); });
    Object.freeze(input);

    const result = filterMapClubs(input, '', 'none', 'all', origin);

    const expected = [zero, tiedFirst, tiedSecond, far, unknownFirst, unknownLast];
    result.forEach((snapshot, index) => expect(snapshot).toBe(expected[index]));
    expect(result).toHaveLength(expected.length);
    expect(result).not.toBe(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps the active distance cutoff and excludes unknown or invalid coordinates', () => {
    const inside = club('inside', { latitude: 0, longitude: 0.01 });
    const outside = club('outside', { latitude: 0, longitude: 0.2 });
    const unknown = club('unknown');
    const invalid = club('invalid', { latitude: 91, longitude: 0 });
    const result = filterMapClubs([outside, unknown, inside, invalid], '', 5, 'all', origin);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(inside);
    expect(filterMapClubs([inside, unknown], '', 5, 'all', null)).toEqual([]);
  });

  it('rejects a nonmatching query before reading coordinates', () => {
    const rejected = measuredClub('unrelated', origin);
    const matching = measuredClub('needle', origin);
    const result = filterMapClubs([rejected.snapshot, matching.snapshot], '  NEEDLE  ', 'none', 'all', origin);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(matching.snapshot);
    expect(rejected.coordinateReads()).toBe(0);
  });

  it('retains distance evaluation before the native venue filter and distance rejection before venue access', () => {
    const events: string[] = [];
    const venueRejected = club('venue-rejected');
    Object.defineProperties(venueRejected.club, {
      coordinate: { get() { events.push('coordinate'); return origin; } },
      venueKind: { get() { events.push('venue'); return 'Poker club'; } }
    });
    expect(filterMapClubs([venueRejected], '', 'none', 'casino', origin)).toEqual([]);
    expect(events.indexOf('coordinate')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('venue')).toBeGreaterThan(events.indexOf('coordinate'));

    events.length = 0;
    const distanceRejected = club('distance-rejected', { latitude: 0, longitude: 1 });
    Object.defineProperty(distanceRejected.club, 'venueKind', { get() { events.push('venue'); return 'Casino'; } });
    expect(filterMapClubs([distanceRejected], '', 5, 'casino', origin)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('keeps distinct snapshot distances when IDs collide and preserves repeated references', () => {
    const far = club('__proto__', { latitude: 0, longitude: 0.2 });
    const near = club('__proto__', { latitude: 0, longitude: 0.01 });
    const zero = club('zero', origin);
    const input = [far, near, near, zero];
    const result = filterMapClubs(input, '', 'none', 'all', origin);
    const expected = [zero, near, near, far];
    expect(result).toHaveLength(4);
    result.forEach((snapshot, index) => expect(snapshot).toBe(expected[index]));
    expect(input).toEqual([far, near, near, zero]);
  });

  it('uses the current origin on every invocation and keeps all-null order stable', () => {
    const west = club('west', { latitude: 0, longitude: 0.01 });
    const east = club('east', { latitude: 0, longitude: 0.19 });
    const unknown = club('unknown');
    const input = [east, unknown, west];
    expect(filterMapClubs(input, '', 'none', 'all', null)).toEqual(input);
    expect(filterMapClubs(input, '', 'none', 'all', origin)).toEqual([west, east, unknown]);
    expect(filterMapClubs(input, '', 'none', 'all', { latitude: 0, longitude: 0.2 })).toEqual([east, west, unknown]);
  });

  it('reads a replaced coordinate on the next invocation even for the same snapshot object', () => {
    const moving = club('moving', origin);
    const fixed = club('fixed', { latitude: 0, longitude: 0.1 });
    const input = [fixed, moving];
    expect(filterMapClubs(input, '', 'none', 'all', origin)).toEqual([moving, fixed]);
    moving.club.coordinate = { latitude: 0, longitude: 1 };
    expect(filterMapClubs(input, '', 'none', 'all', origin)).toEqual([fixed, moving]);
  });

  it('characterizes real coordinate access for a fixed mixed catalog without timing or math mocks', () => {
    const fixture = measuredCatalog();
    const result = filterMapClubs(fixture.clubs, '', 'none', 'all', origin);
    expect(result).toHaveLength(fixture.expected.length);
    result.forEach((snapshot, index) => expect(snapshot).toBe(fixture.expected[index]));
    const measured = fixture.measure();
    expect(measured.validCoordinateReads).toBeGreaterThan(0);
    expect(measured.unknownCoordinateReads).toBeGreaterThan(0);
    console.info('NATIVE_CLUB_DISTANCE_COUNTS', JSON.stringify(measured));
  });

  it('keeps coordinate access linear in reached input occurrences, including unknown survivors', () => {
    const fixture = measuredCatalog();
    const result = filterMapClubs(fixture.clubs, '', 'none', 'all', origin);
    expect(result).toHaveLength(fixture.expected.length);
    result.forEach((snapshot, index) => expect(snapshot).toBe(fixture.expected[index]));
    const measured = fixture.measure();
    console.info('NATIVE_CLUB_DISTANCE_REUSE_BUDGET', JSON.stringify(measured));
    // The real helper reads a valid coordinate twice, or an unknown one once.
    // Allow one evaluation per input occurrence, without pinning sort comparisons.
    expect.soft(measured.validCoordinateReads).toBeLessThanOrEqual(2 * measured.validOccurrences);
    expect.soft(measured.unknownCoordinateReads).toBeLessThanOrEqual(measured.unknownOccurrences);
  });
});
